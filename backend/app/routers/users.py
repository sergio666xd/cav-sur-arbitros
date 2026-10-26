from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin, require_chief
from ..models import (
    Assignment, Availability, AvailabilityWindow, MatchRecord, Rating, RatingBatch, RegistrationCode, Tournament, TournamentAdmin,
    TournamentDay, User, WindowSignup,
)
from ..schemas import ResetPinIn, RolesIn, UserUpdateIn
from ..security import hash_pin
from ..serializers import name_key, user_out
from ..coverage import window_slot
from ..slots import day_slot
from ..stats import assignment_counts, match_totals, points_totals
from ..timeutil import age_on, today_local

router = APIRouter(prefix="/users", tags=["users"])


def _base(u: User, viewer: User) -> dict:
    data = user_out(u).model_dump()
    data["created_at"] = u.created_at.isoformat()
    if viewer.chief_powers:  # Solo el JEFE ve la fecha de nacimiento, la edad y el rol system.
        data["birth_date"] = u.birth_date.isoformat()
        data["age"] = age_on(u.birth_date, today_local())
        data["is_system"] = u.system
    return data


def _listed(u: User) -> bool:
    """El rol system no aparece en la lista arbitral, salvo que también sea árbitro. Los externos nunca."""
    return not u.guest and (not u.system or u.is_referee)


def _protect(u: User, viewer: User) -> None:
    if u.is_chief:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los permisos del Jefe no se pueden modificar.")
    if u.system and not viewer.system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este usuario no se puede modificar.")


def _get(db: Session, user_id: int) -> User:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado.")
    return u


@router.get("")
def list_users(viewer: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = sorted((u for u in db.scalars(select(User)).all() if _listed(u)), key=name_key)
    matches = match_totals(db)
    assigns = assignment_counts(db)
    points = points_totals(db)
    out = []
    for u in users:
        m = matches.get(u.id, {})
        out.append({
            **_base(u, viewer),
            "refereed": m.get("refereed", 0),
            "scored": m.get("scored", 0),
            "other": m.get("other", 0),
            "assignments": assigns.get(u.id, 0),
            "points": None if u.is_chief else points.get(u.id, 0),
        })
    return out


def user_detail(db: Session, u: User) -> dict:
    """Estadísticas e historial de un usuario (página del árbitro y Mi perfil)."""
    today = today_local()
    windows = db.scalars(
        select(AvailabilityWindow).join(WindowSignup)
        .where(WindowSignup.user_id == u.id, AvailabilityWindow.date >= today)
    ).all()
    upcoming = [{
        "date": w.date.isoformat(),
        "slot_label": window_slot(w).label,
        "tournament": " / ".join(dict.fromkeys(d.tournament.name for d in w.days)),
    } for w in windows]
    # Disponibilidades marcadas con el sistema anterior (por franja).
    availabilities = db.execute(
        select(TournamentDay, Tournament.name)
        .join(Availability, Availability.day_id == TournamentDay.id)
        .join(Tournament, Tournament.id == TournamentDay.tournament_id)
        .where(Availability.user_id == u.id, TournamentDay.date >= today)
        .order_by(TournamentDay.date, TournamentDay.start_time)
    ).all()
    history = []
    for a in db.scalars(
        select(Assignment).join(TournamentDay).where(Assignment.user_id == u.id).order_by(TournamentDay.date.desc())
    ).all():
        rec = next((r for r in a.day.match_records if r.user_id == u.id), None)
        history.append({
            "tournament_id": a.day.tournament_id,
            "tournament": a.day.tournament.name,
            "date": a.day.date.isoformat(),
            "role": a.role,
            "refereed": rec.refereed if rec else None,
            "scored": rec.scored if rec else None,
            "other": (rec.other or 0) if rec else None,
            "by_category": rec.by_category if rec else None,
        })
    ratings = db.execute(
        select(Rating.score, Rating.points, RatingBatch.created_at, Rating.reason)
        .join(RatingBatch).where(Rating.user_id == u.id).order_by(RatingBatch.created_at.desc())
    ).all()
    recs = db.scalars(select(MatchRecord).where(MatchRecord.user_id == u.id)).all()
    return {
        "upcoming_availability": sorted(upcoming + [
            {"date": d.date.isoformat(), "slot_label": day_slot(d).label, "tournament": name} for d, name in availabilities
        ], key=lambda x: x["date"]),
        "assignments": history,
        "refereed": sum(r.refereed for r in recs),
        "scored": sum(r.scored for r in recs),
        "other": sum(r.other or 0 for r in recs),
        "points": None if u.is_chief else (u.entry_points or 0) + sum(r.points for r in ratings),
        "ratings": [{"score": s, "points": p, "date": c.isoformat(), "reason": why} for s, p, c, why in ratings] + (
            [{"score": "INGRESO", "points": u.entry_points, "date": u.created_at.isoformat(), "reason": None}]
            if u.entry_points and not u.is_chief else []
        ),
    }


@router.get("/{user_id}")
def get_user(user_id: int, viewer: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    if not _listed(u) and not viewer.system:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado.")
    return {**_base(u, viewer), **user_detail(db, u)}


@router.patch("/{user_id}/roles")
def update_roles(user_id: int, data: RolesIn, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    _protect(u, chief)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(u, field, value)
    db.commit()
    return _base(u, chief)


@router.patch("/{user_id}")
def update_user(user_id: int, data: UserUpdateIn, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    if u.system and not chief.system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este usuario no se puede modificar.")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(u, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return _base(u, chief)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    if u.is_chief:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El Jefe no se puede eliminar.")
    if u.system and not chief.system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este usuario no se puede eliminar.")
    # Lo que registró este usuario (torneos, claves, calificaciones, partidos) pasa al Jefe que lo elimina.
    for model, column in ((Tournament, Tournament.created_by_id), (RegistrationCode, RegistrationCode.created_by_id),
                          (AvailabilityWindow, AvailabilityWindow.created_by_id),
                          (RatingBatch, RatingBatch.created_by_id), (MatchRecord, MatchRecord.recorded_by_id)):
        db.execute(update(model).where(column == u.id).values({column.key: chief.id}))
    for model in (Assignment, Availability, WindowSignup, MatchRecord, Rating, TournamentAdmin):
        db.execute(delete(model).where(model.user_id == u.id))
    db.delete(u)
    db.commit()


@router.post("/{user_id}/transfer-chief")
def transfer_chief(user_id: int, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    """Solo hay un Jefe: lo traspasa a otro usuario y quien lo era queda como administrador."""
    if not chief.is_chief:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el Jefe puede transferir su rol.")
    u = _get(db, user_id)
    if u.id == chief.id or u.is_chief:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese usuario ya es el Jefe.")
    if u.system or not u.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El rol de Jefe solo se puede transferir a un usuario activo.")
    for c in db.scalars(select(User).where(User.is_chief.is_(True))).all():
        c.is_chief, c.is_admin = False, True
    u.is_chief = u.is_admin = True
    db.commit()
    return _base(u, chief)


@router.post("/{user_id}/reset-pin", status_code=204)
def reset_pin(user_id: int, data: ResetPinIn, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    if u.system and not chief.system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este usuario no se puede modificar.")
    u.pin_hash = hash_pin(data.new_pin)
    u.failed_logins = 0
    u.locked_until = None
    db.commit()
