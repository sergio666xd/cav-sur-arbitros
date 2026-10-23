import re
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

PIN_RE = re.compile(r"^\d{4}$")
DOC_RE = re.compile(r"^[A-Za-z0-9]{5,20}$")

RatingScore = Literal["P5", "P10", "P20", "P35", "P50"]


def _clean_document(v: str) -> str:
    v = re.sub(r"[\s.\-]", "", v or "")
    if not DOC_RE.match(v):
        raise ValueError("El documento debe tener entre 5 y 20 letras o números.")
    return v.upper()


def _check_pin(v: str) -> str:
    if not PIN_RE.match(v or ""):
        raise ValueError("La contraseña debe tener exactamente 4 dígitos.")
    return v


def _clean_whatsapp(v: str) -> str:
    # Celular colombiano de 10 dígitos; si escriben el indicativo (+57, 0057, 57) se quita.
    v = re.sub(r"\D", "", v or "")
    if v.startswith("00"):
        v = v[2:]
    if len(v) == 12 and v.startswith("57"):
        v = v[2:]
    if not re.fullmatch(r"3\d{9}", v):
        raise ValueError("El número de WhatsApp debe ser un celular de 10 dígitos.")
    return v


Document = Annotated[str, AfterValidator(_clean_document)]
Pin = Annotated[str, AfterValidator(_check_pin)]
Whatsapp = Annotated[str, AfterValidator(_clean_whatsapp)]


# ---------- Autenticación ----------
class LoginIn(BaseModel):
    document: Document
    pin: str


class RegisterIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    document: Document
    birth_date: date
    whatsapp: Whatsapp
    code: str
    pin: Pin

    @field_validator("first_name", "last_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Campo obligatorio.")
        return v

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("birth_date")
    @classmethod
    def _birth(cls, v: date) -> date:
        if v >= date.today() or v.year < 1900:
            raise ValueError("Fecha de nacimiento no válida.")
        return v


class ChangePinIn(BaseModel):
    current_pin: str
    new_pin: Pin


class WhatsappIn(BaseModel):
    whatsapp: Whatsapp


class ResetPinIn(BaseModel):
    new_pin: Pin


class UserOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    document: str
    whatsapp: str | None = None
    is_referee: bool
    is_admin: bool
    can_create_tournaments: bool
    is_chief: bool
    active: bool


class Me(UserOut):
    # Permisos efectivos, ya resueltos para la interfaz.
    perm_admin: bool
    perm_create_tournaments: bool
    perm_availability: bool
    perm_chief: bool


class TokenOut(BaseModel):
    token: str
    user: Me


# ---------- Claves de registro ----------
class CodeOut(BaseModel):
    id: int
    code: str
    created_at: datetime
    expires_at: datetime
    created_by: str
    uses: int
    revoked: bool = False


# ---------- Usuarios ----------
class RolesIn(BaseModel):
    is_referee: bool | None = None
    is_admin: bool | None = None
    can_create_tournaments: bool | None = None
    active: bool | None = None


class UserUpdateIn(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    birth_date: date | None = None
    whatsapp: Whatsapp | None = None


# ---------- Torneos ----------
class DayIn(BaseModel):
    id: int | None = None
    date: date
    all_day: bool = False
    start_time: time | None = None
    end_time: time | None = None
    referees_required: int | None = Field(default=None, ge=1, le=200)
    location: str | None = Field(default=None, max_length=200)
    categories: list[str] | None = None
    specification: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _times(self):
        self.location = (self.location or "").strip() or None
        self.specification = " ".join((self.specification or "").split()) or None
        self.categories = _clean(self.categories or []) or None
        if self.all_day:
            # Todo el día no tiene hora de fin, pero sí de inicio.
            if not self.start_time:
                raise ValueError("Indica la hora de inicio de la franja de todo el día.")
            self.end_time = None
        else:
            # La hora de fin es opcional: a veces solo se sabe la hora de citación.
            if not self.start_time:
                raise ValueError("Indica la hora de inicio de la franja.")
            if self.end_time and self.end_time <= self.start_time:
                raise ValueError("La hora de fin debe ser posterior a la de inicio.")
        return self


def _clean(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        item = item.strip()
        if item and item not in seen:
            seen.append(item)
    return seen


class TournamentIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    venues: list[str] = Field(default_factory=list)
    location: str = Field(default="", max_length=200)  # Compatibilidad: una sola sede.
    categories: list[str] = Field(default_factory=list)
    referees_required: int = Field(ge=1, le=200)
    is_visible: bool = True
    show_required: bool = True
    has_roles: bool = False
    roles: list[str] = Field(default_factory=list)
    notes: str = ""
    days: list[DayIn] = Field(default_factory=list)

    @field_validator("venues", "categories", "roles")
    @classmethod
    def _clean_list(cls, v: list[str]) -> list[str]:
        return _clean(v)

    @model_validator(mode="after")
    def _check(self):
        explicit = bool(_clean(self.venues))
        # Sin lista de sedes (formato anterior), las sedes son el lugar general y el de las franjas.
        self.venues = _clean(self.venues) or _clean([self.location, *(d.location or "" for d in self.days)])
        if not self.venues:
            raise ValueError("Añade al menos una sede del torneo.")
        if any(len(v) > 200 for v in self.venues):
            raise ValueError("El nombre de una sede es demasiado largo.")
        self.location = self.venues[0]
        for d in self.days:
            if not d.location:
                if explicit and len(self.venues) > 1:
                    raise ValueError("Elige la sede de cada franja.")
                d.location = self.venues[0]
            elif d.location not in self.venues:
                raise ValueError(f"La sede '{d.location}' no está en la lista de sedes del torneo.")
        # Varias franjas el mismo día son válidas si no se superponen o si son en sedes distintas.
        by_place: dict = {}
        for d in self.days:
            by_place.setdefault((d.date, d.location), []).append(d)
        for day_list in by_place.values():
            if len(day_list) < 2:
                continue
            if any(d.all_day for d in day_list):
                raise ValueError("Una franja de todo el día no puede compartir fecha y sede con otra franja del mismo torneo.")
            day_list.sort(key=lambda d: d.start_time)
            for a, b in zip(day_list, day_list[1:]):
                if b.start_time < (a.end_time or time.max):  # sin hora de fin, hasta las 23:59
                    raise ValueError("Hay franjas del mismo torneo que se superponen el mismo día en la misma sede.")
        if self.has_roles and not self.roles:
            self.roles = ["Principal", "Segundo", "Planillero"]
        if not self.has_roles:
            self.roles = []
        return self


class AssignmentIn(BaseModel):
    user_id: int
    role: str | None = None


class BoardDayIn(BaseModel):
    day_id: int
    items: list[AssignmentIn]


class BoardIn(BaseModel):
    days: list[BoardDayIn]


class MatchCategoryIn(BaseModel):
    category: str
    refereed: int = Field(default=0, ge=0, le=100)
    scored: int = Field(default=0, ge=0, le=100)
    other: int = Field(default=0, ge=0, le=100)


class MatchIn(BaseModel):
    user_id: int
    refereed: int = Field(default=0, ge=0, le=100)
    scored: int = Field(default=0, ge=0, le=100)
    other: int = Field(default=0, ge=0, le=100)
    categories: list[MatchCategoryIn] | None = None

    @model_validator(mode="after")
    def _totals(self):
        if self.categories:
            names = [c.category for c in self.categories]
            if len(names) != len(set(names)):
                raise ValueError("Una categoría está repetida en el registro de partidos.")
            self.refereed = sum(c.refereed for c in self.categories)
            self.scored = sum(c.scored for c in self.categories)
            self.other = sum(c.other for c in self.categories)
        return self


# ---------- Calificaciones ----------
class RatingItemIn(BaseModel):
    user_id: int
    score: RatingScore


class RatingBatchIn(BaseModel):
    items: list[RatingItemIn] = Field(min_length=1)
