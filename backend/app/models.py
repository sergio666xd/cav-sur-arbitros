from datetime import date, datetime, time

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .timeutil import utcnow

RATING_POINTS = {
    "MUY_MALO": 0,
    "MALO": 5,
    "REGULAR": 10,
    "BUENO": 25,
    "EXCELENTE": 50,
}

DEFAULT_ROLES = ["Principal", "Segundo", "Planillero"]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    document: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    birth_date: Mapped[date] = mapped_column(Date)
    pin_hash: Mapped[str] = mapped_column(String(200))

    is_referee: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    can_create_tournaments: Mapped[bool] = mapped_column(Boolean, default=False)
    is_chief: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    # Permisos efectivos: el JEFE tiene todo.
    @property
    def admin(self) -> bool:
        return self.is_chief or self.is_admin

    @property
    def tournament_creator(self) -> bool:
        return self.is_chief or (self.is_admin and self.can_create_tournaments)

    @property
    def referee(self) -> bool:
        return self.is_chief or self.is_referee


class RegistrationCode(Base):
    __tablename__ = "registration_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(6), index=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    uses: Mapped[int] = mapped_column(Integer, default=0)

    created_by: Mapped[User] = relationship()


class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    location: Mapped[str] = mapped_column(String(200), default="")  # Sede principal (la primera de `venues`).
    venues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    categories: Mapped[list] = mapped_column(JSON, default=list)
    referees_required: Mapped[int] = mapped_column(Integer, default=1)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    # Si los árbitros ven cuántos se requieren por franja. Vacío (torneos antiguos) equivale a sí.
    show_required: Mapped[bool | None] = mapped_column(Boolean, default=True, nullable=True)
    has_roles: Mapped[bool] = mapped_column(Boolean, default=False)
    roles: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    days: Mapped[list["TournamentDay"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan", order_by="TournamentDay.date"
    )

    @property
    def venue_list(self) -> list[str]:
        """Sedes del torneo. Los torneos creados antes de las sedes las toman de su lugar y el de sus franjas."""
        if self.venues:
            return list(self.venues)
        out: list[str] = []
        for v in [self.location, *(d.location for d in self.days)]:
            if v and v not in out:
                out.append(v)
        return out


class Shirt(Base):
    """Camiseta que pueden llevar los árbitros; se asigna a cada franja."""
    __tablename__ = "shirts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(7))  # #RRGGBB


class TournamentDay(Base):
    __tablename__ = "tournament_days"

    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    referees_required: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Lugar y categorías propios de la franja; si están vacíos se usan los del torneo.
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    categories: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Especificación opcional de la franja (p. ej. "Final, cancha 2"); sale en la imagen de asignación.
    specification: Mapped[str | None] = mapped_column(String(300), nullable=True)
    shirt_id: Mapped[int | None] = mapped_column(ForeignKey("shirts.id", ondelete="SET NULL"), nullable=True)

    tournament: Mapped[Tournament] = relationship(back_populates="days")
    shirt: Mapped[Shirt | None] = relationship()
    assignments: Mapped[list["Assignment"]] = relationship(back_populates="day", cascade="all, delete-orphan")
    match_records: Mapped[list["MatchRecord"]] = relationship(back_populates="day", cascade="all, delete-orphan")
    availabilities: Mapped[list["Availability"]] = relationship(back_populates="day", cascade="all, delete-orphan")

    @property
    def required(self) -> int:
        return self.referees_required if self.referees_required is not None else self.tournament.referees_required

    @property
    def effective_location(self) -> str:
        return self.location or self.tournament.location

    @property
    def effective_categories(self) -> list:
        return self.categories if self.categories else (self.tournament.categories or [])


class SavedValue(Base):
    """Lugares y categorías guardados para autocompletar en torneos y franjas."""
    __tablename__ = "saved_values"
    __table_args__ = (UniqueConstraint("kind", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)  # "location" o "category"
    name: Mapped[str] = mapped_column(String(200))
    key: Mapped[str] = mapped_column(String(200))  # nombre normalizado, sin tildes ni mayúsculas
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Availability(Base):
    """Disponibilidad de un árbitro para un día de torneo.

    El árbitro marca una franja combinada (ver slots.group_days) y se crea una fila por cada
    día de torneo que forma esa franja.
    """
    __tablename__ = "availabilities"
    __table_args__ = (UniqueConstraint("user_id", "day_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day_id: Mapped[int] = mapped_column(ForeignKey("tournament_days.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship()
    day: Mapped["TournamentDay"] = relationship(back_populates="availabilities")


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("day_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    day_id: Mapped[int] = mapped_column(ForeignKey("tournament_days.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Cuándo el árbitro confirmó la asignación; vacío si aún no la confirma.
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    day: Mapped[TournamentDay] = relationship(back_populates="assignments")
    user: Mapped[User] = relationship()


class MatchRecord(Base):
    __tablename__ = "match_records"
    __table_args__ = (UniqueConstraint("day_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    day_id: Mapped[int] = mapped_column(ForeignKey("tournament_days.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refereed: Mapped[int] = mapped_column(Integer, default=0)
    scored: Mapped[int] = mapped_column(Integer, default=0)
    other: Mapped[int | None] = mapped_column(Integer, default=0)  # Partidos en otros roles (no pitados ni planillados).
    # Desglose por categoría: [{"category", "refereed", "scored"}]; refereed/scored guardan los totales.
    by_category: Mapped[list | None] = mapped_column(JSON, nullable=True)
    recorded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    day: Mapped[TournamentDay] = relationship(back_populates="match_records")
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class RatingBatch(Base):
    __tablename__ = "rating_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    ratings: Mapped[list["Rating"]] = relationship(back_populates="batch", cascade="all, delete-orphan")


class Rating(Base):
    __tablename__ = "ratings"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("rating_batches.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    score: Mapped[str] = mapped_column(String(20))
    points: Mapped[int] = mapped_column(Integer)

    batch: Mapped[RatingBatch] = relationship(back_populates="ratings")
    user: Mapped[User] = relationship()
