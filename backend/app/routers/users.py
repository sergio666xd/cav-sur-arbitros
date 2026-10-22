from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin, require_chief
from ..models import Assignment, Availability, MatchRecord, Rating, RatingBatch, Tournament, TournamentDay, User
from ..schemas import ResetPinIn, RolesIn, UserUpdateIn
from ..security import hash_pin
from ..serializers import name_key, user_out
from ..slots import day_slot
from ..stats import assignment_counts, match_totals, points_totals
from ..timeutil import age_on, today_local

router = APIRouter(prefix="/users", tags=["users"])


def _base(u: User, viewer: User) -> dict:
    data = user_out(u).model_dump()
    data["created_at"] = u.created_at.isoformat()
    if viewer.is_chief:  # Solo el JEFE ve la fecha de nacimiento y la edad.
        data["birth_date"] = u.birth_date.isoformat()
        data["age"] = age_on(u.birth_date, today_local())
    return data


def _get(db: Session, user_id: int) -> User:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado.")
    return u


@router.get("")
def list_users(viewer: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = sorted(db.scalars(select(User)).all(), key=name_key)
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
            "assignments": assigns.get(u.id, 0),
            "points": None if u.is_chief else points.get(u.id, 0),
        })
    return out


@router.get("/{user_id}")
def get_user(user_id: int, viewer: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    today = today_local()
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
        })
    ratings = db.execute(
        select(Rating.score, Rating.points, RatingBatch.created_at)
        .join(RatingBatch).where(Rating.user_id == u.id).order_by(RatingBatch.created_at.desc())
    ).all()
    recs = db.scalars(select(MatchRecord).where(MatchRecord.user_id == u.id)).all()
    return {
        **_base(u, viewer),
        "upcoming_availability": [
            {"date": d.date.isoformat(), "slot_label": day_slot(d).label, "tournament": name} for d, name in availabilities
        ],
        "assignments": history,
        "refereed": sum(r.refereed for r in recs),
        "scored": sum(r.scored for r in recs),
        "points": None if u.is_chief else sum(p for _, p, _ in ratings),
        "ratings": [{"score": s, "points": p, "date": c.isoformat()} for s, p, c in ratings],
    }


@router.patch("/{user_id}/roles")
def update_roles(user_id: int, data: RolesIn, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    if u.is_chief:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los permisos del Jefe no se pueden modificar.")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(u, field, value)
    if not u.is_admin:
        u.can_create_tournaments = False
    db.commit()
    return _base(u, chief)


@router.patch("/{user_id}")
def update_user(user_id: int, data: UserUpdateIn, chief: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(u, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return _base(u, chief)


@router.post("/{user_id}/reset-pin", status_code=204)
def reset_pin(user_id: int, data: ResetPinIn, _: User = Depends(require_chief), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    u.pin_hash = hash_pin(data.new_pin)
    u.failed_logins = 0
    u.locked_until = None
    db.commit()
