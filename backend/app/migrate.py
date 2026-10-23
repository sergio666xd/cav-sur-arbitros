"""Migración mínima: crea tablas nuevas y añade columnas nuevas (siempre opcionales) a tablas existentes."""
from sqlalchemy import insert, inspect, select, text

from .database import Base, engine
from .models import Tournament, TournamentAdmin, User


def migrate() -> None:
    had_admins = inspect(engine).has_table("tournament_admins")
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {col_type}'))
    if not had_admins:
        _assign_creators()


def _assign_creators() -> None:
    """Al pasar a torneos asignados, cada administrador sigue gestionando los torneos que creó."""
    with engine.begin() as conn:
        rows = conn.execute(
            select(Tournament.id, Tournament.created_by_id).join(User, User.id == Tournament.created_by_id)
            .where(User.is_admin.is_(True), User.is_chief.is_(False))
        ).all()
        if rows:
            conn.execute(insert(TournamentAdmin), [{"tournament_id": t, "user_id": u} for t, u in rows])
