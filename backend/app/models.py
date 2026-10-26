from datetime import date, datetime, time

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .timeutil import utcnow

# Escala vigente. Las calificaciones antiguas (Muy Malo...Excelente) conservan los puntos con que se guardaron.
RATING_POINTS = {"P5": 5, "P10": 10, "P20": 20, "P35": 35, "P50": 50}

DEFAULT_ROLES = ["Principal", "Segundo", "Planillero"]

# Puntos con los que empieza cada árbitro en el ranking.
ENTRY_POINTS = 20


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    document: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    birth_date: Mapped[date] = mapped_column(Date)
    whatsapp: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pin_hash: Mapped[str] = mapped_column(String(200))

    is_referee: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Obsoleto: ahora solo el Jefe (y system) crean torneos. Se conserva la columna en la base de datos.
    can_create_tournaments: Mapped[bool] = mapped_column(Boolean, default=False)
    is_chief: Mapped[bool] = mapped_column(Boolean, default=False)
    # Rol oculto con todos los permisos del Jefe. Solo se cambia directamente en la base de datos.
    is_system: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Puntos de ingreso. Se guardan por usuario para que cambiar ENTRY_POINTS no altere a los que ya están.
    entry_points: Mapped[int | None] = mapped_column(Integer, default=ENTRY_POINTS, nullable=True)
    # Árbitro externo: solo tiene nombre, no es usuario (no inicia sesión). Lo agrega un administrador
    # a una disponibilidad para poder asignarlo; no entra al ranking, calificaciones ni lista arbitral.
    is_guest: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)

    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def guest(self) -> bool:
        return bool(self.is_guest)

    # Permisos efectivos: el JEFE y el rol system tienen todo.
    @property
    def system(self) -> bool:
        return bool(self.is_system)

    @property
    def chief_powers(self) -> bool:
        return self.is_chief or self.system

    @property
    def admin(self) -> bool:
        return self.chief_powers or self.is_admin

    @property
    def tournament_creator(self) -> bool:
        return self.chief_powers

    def manages(self, t: "Tournament") -> bool:
        """El Jefe gestiona todos los torneos; un administrador, solo los que el Jefe le asignó."""
        return self.chief_powers or (self.is_admin and any(a.id == self.id for a in t.admins))

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
    # Sube cada vez que se guarda el formulario del torneo, para no pisar los cambios de otro usuario.
    version: Mapped[int | None] = mapped_column(Integer, default=1, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    days: Mapped[list["TournamentDay"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan", order_by="TournamentDay.date"
    )
    # Administradores que gestionan el torneo (los asigna el Jefe).
    admins: Mapped[list[User]] = relationship(secondary="tournament_admins")

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


class TournamentAdmin(Base):
    __tablename__ = "tournament_admins"

    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


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
    # Franja oculta: no sale en Disponibilidad y se puede asignar a cualquier árbitro (eventos privados).
    hidden: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)
    shirt_id: Mapped[int | None] = mapped_column(ForeignKey("shirts.id", ondelete="SET NULL"), nullable=True)
    # Marcada como finalizada a mano antes de su hora de fin (o del día siguiente).
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

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


class AvailabilityWindow(Base):
    """Disponibilidad habilitada por el Jefe o un administrador para una fecha.

    Puede ser de todo el día o de un horario. Cubre franjas de torneo de esa fecha (que dan los
    árbitros requeridos) y los árbitros se inscriben en ella.
    """
    __tablename__ = "availability_windows"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # Los árbitros pueden indicar su propio horario (desde y hasta qué hora pueden, dentro del de la disponibilidad).
    allow_custom_hours: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    days: Mapped[list["TournamentDay"]] = relationship(secondary="availability_window_days")
    signups: Mapped[list["WindowSignup"]] = relationship(back_populates="window", cascade="all, delete-orphan")
    hidden_names: Mapped[list["WindowHiddenName"]] = relationship(cascade="all, delete-orphan")

    @property
    def hidden_tournament_ids(self) -> set[int]:
        return {h.tournament_id for h in self.hidden_names}


class WindowHiddenName(Base):
    """Torneo cuyo nombre no se muestra a los árbitros en una disponibilidad."""
    __tablename__ = "availability_window_hidden_names"

    window_id: Mapped[int] = mapped_column(ForeignKey("availability_windows.id", ondelete="CASCADE"), primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), primary_key=True)


class AvailabilityWindowDay(Base):
    __tablename__ = "availability_window_days"

    window_id: Mapped[int] = mapped_column(ForeignKey("availability_windows.id", ondelete="CASCADE"), primary_key=True)
    day_id: Mapped[int] = mapped_column(ForeignKey("tournament_days.id", ondelete="CASCADE"), primary_key=True)


class WindowSignup(Base):
    """Inscripción de un árbitro en una disponibilidad habilitada."""
    __tablename__ = "window_signups"
    __table_args__ = (UniqueConstraint("window_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    window_id: Mapped[int] = mapped_column(ForeignKey("availability_windows.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Horario propio del árbitro, si la disponibilidad lo permite. Vacías: desde el inicio / hasta el final.
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    window: Mapped[AvailabilityWindow] = relationship(back_populates="signups")
    user: Mapped[User] = relationship()


class Availability(Base):
    """Disponibilidad de un árbitro para un día de torneo (sistema anterior, solo se conserva y se respeta).

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
    score: Mapped[str] = mapped_column(String(20))  # Valor de la escala, o DESCUENTO (puntos negativos que pone el Jefe).
    points: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)  # Motivo opcional de un descuento.

    batch: Mapped[RatingBatch] = relationship(back_populates="ratings")
    user: Mapped[User] = relationship()
