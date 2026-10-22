from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import current_user, require_referee
from ..models import Availability, TournamentDay, User
from ..slots import SlotGroup, group_days
from ..timeutil import is_open_for_availability, today_local

router = APIRouter(prefix="/availability", tags=["availability"])


def _days_by_date(db: Session, from_date: date | None = None, on_date: date | None = None) -> dict[date, list[TournamentDay]]:
    q = select(TournamentDay).options(selectinload(TournamentDay.tournament)).order_by(TournamentDay.date)
    if from_date:
        q = q.where(TournamentDay.date >= from_date)
    if on_date:
        q = q.where(TournamentDay.date == on_date)
    grouped: dict[date, list[TournamentDay]] = defaultdict(list)
    for d in db.scalars(q).all():
        grouped[d.date].append(d)
    return grouped


def _group_for(db: Session, day_id: int) -> SlotGroup:
    day = db.get(TournamentDay, day_id)
    if not day:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Franja no encontrada.")
    for g in group_days(_days_by_date(db, on_date=day.date)[day.date]):
        if any(d.id == day_id for d in g.days):
            return g
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Franja no encontrada.")


@router.get("")
def list_availability(user: User = Depends(require_referee), db: Session = Depends(get_db)):
    """Franjas de hoy en adelante, tal como las ve un árbitro."""
    by_date = _days_by_date(db, from_date=today_local())
    day_ids = [d.id for days in by_date.values() for d in days]
    users_by_day: dict[int, set[int]] = defaultdict(set)
    if day_ids:
        for day_id, uid in db.execute(
            select(Availability.day_id, Availability.user_id)
            .join(User, User.id == Availability.user_id)
            .where(Availability.day_id.in_(day_ids), User.active.is_(True))
        ).all():
            users_by_day[day_id].add(uid)

    result = []
    for d, days in by_date.items():
        # Solo se muestran los detalles si ese día hay un único torneo y es visible.
        single = len({x.tournament_id for x in days}) == 1 and days[0].tournament.is_visible
        for g in group_days(days):
            tournament = None
            if single:
                locations = list(dict.fromkeys(x.effective_location for x in g.days))
                categories = list(dict.fromkeys(c for x in g.days for c in x.effective_categories))
                tournament = {"name": days[0].tournament.name, "location": " / ".join(locations), "categories": categories}
            registered = set().union(*(users_by_day[x.id] for x in g.days))
            result.append({
                "key": g.key,
                "date": d.isoformat(),
                "slot_label": g.slot.label,
                "all_day": g.slot.all_day,
                "start_time": g.slot.start.strftime("%H:%M") if g.slot.start else None,
                "required": sum(x.required for x in g.days),
                "registered": len(registered),
                "mine": user.id in registered,
                "open": is_open_for_availability(d),
                "tournament": tournament,
            })
    result.sort(key=lambda x: (x["date"], x["start_time"] or ""))
    return result


def _check_open(g: SlotGroup) -> None:
    if not is_open_for_availability(g.days[0].date):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La selección de disponibilidad para esa fecha ya está cerrada.")


@router.post("/{day_id}", status_code=204)
def add_availability(day_id: int, user: User = Depends(require_referee), db: Session = Depends(get_db)):
    g = _group_for(db, day_id)
    _check_open(g)
    ids = [d.id for d in g.days]
    have = set(db.scalars(select(Availability.day_id).where(Availability.user_id == user.id, Availability.day_id.in_(ids))).all())
    for i in ids:
        if i not in have:
            db.add(Availability(user_id=user.id, day_id=i))
    db.commit()


@router.delete("/{day_id}", status_code=204)
def remove_availability(day_id: int, user: User = Depends(require_referee), db: Session = Depends(get_db)):
    g = _group_for(db, day_id)
    _check_open(g)
    for a in db.scalars(
        select(Availability).where(Availability.user_id == user.id, Availability.day_id.in_([d.id for d in g.days]))
    ).all():
        db.delete(a)
    db.commit()


@router.get("/{day_id}/referees")
def referees_for_slot(day_id: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    g = _group_for(db, day_id)
    rows = db.execute(
        select(User.id, User.first_name, User.last_name, Availability.created_at)
        .join(Availability, Availability.user_id == User.id)
        .where(Availability.day_id.in_([d.id for d in g.days]), User.active.is_(True))
        .order_by(Availability.created_at)
    ).all()
    seen, out = set(), []
    for uid, f, l, c in rows:
        if uid not in seen:
            seen.add(uid)
            out.append({"name": f"{f} {l}", "since": c.isoformat()})
    return out
