import re
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

PIN_RE = re.compile(r"^\d{4}$")
DOC_RE = re.compile(r"^[A-Za-z0-9]{5,20}$")

RatingScore = Literal["MUY_MALO", "MALO", "REGULAR", "BUENO", "EXCELENTE"]


def _clean_document(v: str) -> str:
    v = re.sub(r"[\s.\-]", "", v or "")
    if not DOC_RE.match(v):
        raise ValueError("El documento debe tener entre 5 y 20 letras o números.")
    return v.upper()


def _check_pin(v: str) -> str:
    if not PIN_RE.match(v or ""):
        raise ValueError("La contraseña debe tener exactamente 4 dígitos.")
    return v


Document = Annotated[str, AfterValidator(_clean_document)]
Pin = Annotated[str, AfterValidator(_check_pin)]


# ---------- Autenticación ----------
class LoginIn(BaseModel):
    document: Document
    pin: str


class RegisterIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    document: Document
    birth_date: date
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


class ResetPinIn(BaseModel):
    new_pin: Pin


class UserOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    document: str
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


class TokenOut(BaseModel):
    token: str
    user: Me


# ---------- Claves de registro ----------
class CodeOut(BaseModel):
    code: str
    created_at: datetime
    expires_at: datetime
    created_by: str
    uses: int


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

    @model_validator(mode="after")
    def _times(self):
        self.location = (self.location or "").strip() or None
        self.categories = _clean(self.categories or []) or None
        if self.all_day:
            self.start_time = self.end_time = None
        else:
            if not self.start_time or not self.end_time:
                raise ValueError("Indica hora de inicio y fin, o marca 'Todo el día'.")
            if self.end_time <= self.start_time:
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
    location: str = Field(default="", max_length=200)
    categories: list[str] = Field(default_factory=list)
    referees_required: int = Field(ge=1, le=200)
    is_visible: bool = True
    has_roles: bool = False
    roles: list[str] = Field(default_factory=list)
    notes: str = ""
    days: list[DayIn] = Field(default_factory=list)

    @field_validator("categories", "roles")
    @classmethod
    def _clean_list(cls, v: list[str]) -> list[str]:
        return _clean(v)

    @model_validator(mode="after")
    def _check(self):
        self.location = self.location.strip()
        if not self.location and any(not d.location for d in self.days):
            raise ValueError("Indica el lugar del torneo o el de cada franja.")
        # Varias franjas el mismo día son válidas mientras no se superpongan.
        by_date: dict = {}
        for d in self.days:
            by_date.setdefault(d.date, []).append(d)
        for day_list in by_date.values():
            if len(day_list) < 2:
                continue
            if any(d.all_day for d in day_list):
                raise ValueError("Una franja de todo el día no puede compartir fecha con otra franja del mismo torneo.")
            day_list.sort(key=lambda d: d.start_time)
            for a, b in zip(day_list, day_list[1:]):
                if b.start_time < a.end_time:
                    raise ValueError("Hay franjas del mismo torneo que se superponen el mismo día.")
        if self.has_roles and not self.roles:
            self.roles = ["Principal", "Segundo", "Planillero"]
        if not self.has_roles:
            self.roles = []
        return self


class AssignmentIn(BaseModel):
    user_id: int
    role: str | None = None


class MatchIn(BaseModel):
    user_id: int
    refereed: int = Field(ge=0, le=100)
    scored: int = Field(ge=0, le=100)


# ---------- Calificaciones ----------
class RatingItemIn(BaseModel):
    user_id: int
    score: RatingScore


class RatingBatchIn(BaseModel):
    items: list[RatingItemIn] = Field(min_length=1)
