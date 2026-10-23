"""Migración mínima: crea tablas nuevas y añade columnas nuevas (siempre opcionales) a tablas existentes."""
from sqlalchemy import inspect, text

from .database import Base, engine
from .models import ENTRY_POINTS


def migrate() -> None:
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
        # Los usuarios anteriores a los puntos de ingreso también los reciben.
        conn.execute(text("UPDATE users SET entry_points = :p WHERE entry_points IS NULL"), {"p": ENTRY_POINTS})
