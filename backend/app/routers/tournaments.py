from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin, require_creator
from ..models import Assignment, Availability, MatchRecord, Tournament, TournamentDay, User
from ..schemas import AssignmentIn, MatchIn, TournamentIn
from ..serializers import day_info, name_key, tournament_info
from ..timeutil import is_open_for_availability, today_local

router = APIRouter(tags=["tournaments"])


def _get_tournament(db: Session, tournament_id: int) -> Tournament:
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Torneo no encontrado.")
    return t


def _get_day(db: Session, day_id: int) -> TournamentDay:
    d = db.get(TournamentDay, day_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Día de torneo no encontrado.")
    return d


@router.get("/tournaments")
def list_tournaments(scope: str = "upcoming", _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """scope=upcoming: torneos con algún día de hoy en adelante; scope=past: el resto; scope=all: todos."""
    tournaments = db.scalars(select(Tournament).options(selectinload(Tournament.days))).all()
    today = today_local()
    avail_counts = dict(db.execute(select(Availability.day_id, func.count()).group_by(Availability.day_id)).all())
    assigned_counts = dict(
        db.execute(select(Assignment.day_id, func.count()).group_by(Assignment.day_id)).all()
    )

    result = []
    for t in tournaments:
        last = max((d.date for d in t.days), default=None)
        upcoming = last is not None and last >= today
        if (scope == "upcoming" and not upcoming) or (scope == "past" and upcoming):
            continue
        days = []
        for d in t.days:
            info = day_info(d)
            info["available_count"] = avail_counts.get(d.id, 0)
            info["assigned_count"] = assigned_counts.get(d.id, 0)
            info["open"] = is_open_for_availability(d.date)
            days.append(info)
        result.append({**tournament_info(t), "days": days})
    result.sort(key=lambda x: x["days"][0]["date"] if x["days"] else "", reverse=(scope == "past"))
    return result


def _apply_days(db: Session, t: Tournament, data: TournamentIn) -> None:
    existing = {d.id: d for d in t.days}
    keep_ids = set()
    for day_in in data.days:
        if day_in.id is not None:
            day = existing.get(day_in.id)
            if not day:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un día no pertenece a este torneo.")
            keep_ids.add(day.id)
            if day.date != day_in.date:
                # Cambió la fecha: las disponibilidades y asignaciones de ese día ya no valen.
                day.availabilities.clear()
                day.assignments.clear()
                day.match_records.clear()
        else:
            day = TournamentDay()
            t.days.append(day)
        day.date = day_in.date
        day.all_day = day_in.all_day
        day.start_time = day_in.start_time
        day.end_time = day_in.end_time
        day.referees_required = day_in.referees_required
    for day_id, day in existing.items():
        if day_id not in keep_ids:
            t.days.remove(day)


def _apply_fields(t: Tournament, data: TournamentIn) -> None:
    t.name = data.name.strip()
    t.location = data.location.strip()
    t.categories = data.categories
    t.referees_required = data.referees_required
    t.is_visible = data.is_visible
    t.has_roles = data.has_roles
    t.roles = data.roles
    t.notes = data.notes.strip()


@router.post("/tournaments", status_code=201)
def create_tournament(data: TournamentIn, user: User = Depends(require_creator), db: Session = Depends(get_db)):
    t = Tournament(created_by_id=user.id, days=[])
    _apply_fields(t, data)
    _apply_days(db, t, data)
    db.add(t)
    db.commit()
    return {"id": t.id}


@router.put("/tournaments/{tournament_id}")
def update_tournament(
    tournament_id: int, data: TournamentIn, _: User = Depends(require_creator), db: Session = Depends(get_db)
):
    t = _get_tournament(db, tournament_id)
    _apply_fields(t, data)
    _apply_days(db, t, data)
    if not t.has_roles:
        for d in t.days:
            for a in d.assignments:
                a.role = None
    else:
        for d in t.days:
            for a in d.assignments:
                if a.role not in t.roles:
                    a.role = None
    db.commit()
    return {"id": t.id}


@router.delete("/tournaments/{tournament_id}", status_code=204)
def delete_tournament(tournament_id: int, _: User = Depends(require_creator), db: Session = Depends(get_db)):
    db.delete(_get_tournament(db, tournament_id))
    db.commit()


@router.get("/tournaments/{tournament_id}")
def get_tournament(tournament_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    t = _get_tournament(db, tournament_id)
    dates = [d.date for d in t.days]

    available_by_day: dict = defaultdict(list)
    if t.days:
        rows = db.execute(
            select(Availability.day_id, User)
            .join(User, User.id == Availability.user_id)
            .where(Availability.day_id.in_([d.id for d in t.days]), User.active.is_(True))
        ).all()
        for day_id, u in rows:
            available_by_day[day_id].append(u)

    # Asignaciones de esas fechas en otros torneos, para avisar de choques.
    elsewhere: dict = defaultdict(dict)
    if dates:
        rows = db.execute(
            select(TournamentDay.date, Assignment.user_id, Tournament.name)
            .join(Assignment, Assignment.day_id == TournamentDay.id)
            .join(Tournament, Tournament.id == TournamentDay.tournament_id)
            .where(TournamentDay.date.in_(dates), Tournament.id != t.id)
        ).all()
        for d, uid, name in rows:
            elsewhere[d][uid] = name

    chiefs = db.scalars(select(User).where(User.is_chief.is_(True), User.active.is_(True))).all()

    days = []
    for d in t.days:
        records = {r.user_id: r for r in d.match_records}
        candidates = []
        for u in [*chiefs, *sorted(available_by_day.get(d.id, []), key=name_key)]:
            candidates.append({
                "user_id": u.id,
                "name": u.full_name,
                "is_chief": u.is_chief,
                "assigned_elsewhere": elsewhere[d.date].get(u.id),
            })
        assignments = []
        for a in sorted(d.assignments, key=lambda a: (t.roles.index(a.role) if a.role in (t.roles or []) else 99, name_key(a.user))):
            rec = records.get(a.user_id)
            assignments.append({
                "user_id": a.user_id,
                "name": a.user.full_name,
                "is_chief": a.user.is_chief,
                "role": a.role,
                "refereed": rec.refereed if rec else None,
                "scored": rec.scored if rec else None,
            })
        info = day_info(d)
        info.update({
            "open": is_open_for_availability(d.date),
            "candidates": candidates,
            "available_count": len(available_by_day.get(d.id, [])),
            "assignments": assignments,
        })
        days.append(info)
    return {**tournament_info(t), "days": days}


@router.put("/tournament-days/{day_id}/assignments")
def set_assignments(
    day_id: int, items: list[AssignmentIn], _: User = Depends(require_admin), db: Session = Depends(get_db)
):
    day = _get_day(db, day_id)
    t = day.tournament
    current = {a.user_id: a for a in day.assignments}
    user_ids = [i.user_id for i in items]
    if len(user_ids) != len(set(user_ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un árbitro está repetido en la asignación.")

    available = set(db.scalars(select(Availability.user_id).where(Availability.day_id == day.id)).all())
    roles_used: set[str] = set()
    for item in items:
        u = db.get(User, item.user_id)
        if not u or not u.active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Árbitro no encontrado.")
        if not u.is_chief and (not u.is_referee or u.id not in available):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{u.full_name} no marcó disponibilidad para esta franja del {day.date:%d/%m/%Y}."
            )
        if t.has_roles:
            if item.role and item.role not in t.roles:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rol '{item.role}' no existe en este torneo.")
            if item.role:
                if item.role in roles_used:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rol '{item.role}' está asignado dos veces.")
                roles_used.add(item.role)
        else:
            item.role = None

    for uid, a in current.items():
        if uid not in user_ids:
            day.assignments.remove(a)
            for r in [r for r in day.match_records if r.user_id == uid]:
                day.match_records.remove(r)
    for item in items:
        a = current.get(item.user_id)
        if a:
            a.role = item.role
        else:
            day.assignments.append(Assignment(user_id=item.user_id, role=item.role))
    db.commit()
    return {"ok": True}


@router.put("/tournament-days/{day_id}/matches")
def set_matches(day_id: int, items: list[MatchIn], user: User = Depends(require_admin), db: Session = Depends(get_db)):
    day = _get_day(db, day_id)
    assigned = {a.user_id: a.user for a in day.assignments}
    records = {r.user_id: r for r in day.match_records}
    for item in items:
        u = assigned.get(item.user_id)
        if not u:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se registran partidos de árbitros asignados a ese día.")
        if u.is_chief:
            continue  # Al JEFE no se le registran partidos.
        rec = records.get(item.user_id)
        if rec:
            rec.refereed, rec.scored, rec.recorded_by_id = item.refereed, item.scored, user.id
        else:
            day.match_records.append(
                MatchRecord(user_id=item.user_id, refereed=item.refereed, scored=item.scored, recorded_by_id=user.id)
            )
    db.commit()
    return {"ok": True}
