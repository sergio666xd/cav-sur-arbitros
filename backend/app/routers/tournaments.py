from collections import defaultdict
from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..coverage import available_by_day, check_overlaps, covers, overlaps, start_times_by_day
from ..database import get_db
from ..deps import check_manages, require_admin, require_creator
from ..models import Assignment, AvailabilityWindow, MatchRecord, Tournament, TournamentDay, User
from ..schemas import AssignmentIn, BoardIn, ConfirmedIn, FinishedIn, MatchIn, TournamentIn
from ..serializers import day_info, fold, name_key, tournament_info
from ..slots import day_slot, ended_by_time, group_days, has_started, is_finished
from ..timeutil import is_open_for_availability, today_local, utcnow
from .catalog import remember

router = APIRouter(tags=["tournaments"])


def _get_tournament(db: Session, tournament_id: int) -> Tournament:
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Torneo no encontrado.")
    return t


def _get_day(db: Session, day_id: int, user: User) -> TournamentDay:
    d = db.get(TournamentDay, day_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Día de torneo no encontrado.")
    check_manages(user, d.tournament)
    return d


def _admins(db: Session, ids: list[int]) -> list[User]:
    """Administradores a los que se asigna un torneo.

    El Jefe y el rol system ya gestionan todos los torneos: si vienen, no hace falta asignarlos.
    """
    users = [db.get(User, i) for i in dict.fromkeys(ids)]
    if any(u is None or not u.admin for u in users):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se pueden asignar coordinadores.")
    return [u for u in users if not u.chief_powers]


@router.get("/tournaments")
def list_tournaments(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Torneos (nunca se archivan) con sus próximas franjas; las pasadas solo se cuentan.

    El Jefe ve todos; un administrador, solo los que tiene asignados.
    """
    tournaments = [t for t in db.scalars(select(Tournament).options(selectinload(Tournament.days))).all() if user.manages(t)]
    today = today_local()
    future = [d for t in tournaments for d in t.days if d.date >= today]
    avail = available_by_day(db, future)
    windows = _windows_on(db, {d.date for d in future})
    assigned_counts = dict(db.execute(select(Assignment.day_id, func.count()).group_by(Assignment.day_id)).all())

    result = []
    for t in tournaments:
        upcoming = []
        for d in t.days:
            if d.date < today:
                continue
            info = day_info(d)
            info["available_count"] = len(avail.get(d.id, {}))
            info["assigned_count"] = assigned_counts.get(d.id, 0)
            info["open"] = is_open_for_availability(d.date)
            info["has_window"] = any(covers(w, d) for w in windows)
            upcoming.append(info)
        past = [d.date for d in t.days if d.date < today]
        result.append({
            **tournament_info(t),
            "days": upcoming,
            "past_count": len(past),
            "last_past_date": max(past).isoformat() if past else None,
        })
    # Primero los que tienen fechas próximas (la más cercana arriba), luego el resto por nombre.
    result.sort(key=lambda x: (0, x["days"][0]["date"], "") if x["days"] else (1, "", fold(x["name"])))
    return result


@router.get("/tournament-days/past")
def past_days(
    tournament_id: int | None = None, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    """Franjas finalizadas (ya pasadas, o de hoy terminadas o marcadas como finalizadas), de la más reciente a la más antigua."""
    q = (
        select(TournamentDay)
        .where((TournamentDay.date <= today_local()) | TournamentDay.finished_at.is_not(None))
        .options(selectinload(TournamentDay.tournament), selectinload(TournamentDay.assignments),
                 selectinload(TournamentDay.match_records))
        .order_by(TournamentDay.date.desc(), TournamentDay.start_time)
    )
    if tournament_id:
        q = q.where(TournamentDay.tournament_id == tournament_id)
    out = []
    for d in db.scalars(q).all():
        if not is_finished(d) or not user.manages(d.tournament):
            continue
        refs = [a for a in d.assignments if not a.user.is_chief and not a.user.guest]
        out.append({
            **day_info(d),
            "tournament_id": d.tournament_id,
            "tournament": d.tournament.name,
            "assigned_count": len(d.assignments),
            "records_count": len(d.match_records),
            "records_pending": len(refs) - len(d.match_records),
            "refereed": sum(r.refereed for r in d.match_records),
            "scored": sum(r.scored for r in d.match_records),
            "other": sum(r.other or 0 for r in d.match_records),
        })
    return out


def _apply_days(db: Session, t: Tournament, data: TournamentIn) -> None:
    """Crea, actualiza o borra franjas. Las franjas ya pasadas que no vienen en el formulario se conservan."""
    existing = {d.id: d for d in t.days}
    today = today_local()
    keep_ids = set()
    for day_in in data.days:
        if day_in.id is not None:
            day = existing.get(day_in.id)
            if not day:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un día no pertenece a este torneo.")
            keep_ids.add(day.id)
            # Editar una franja (incluso su fecha) conserva sus disponibilidades, asignaciones y partidos.
        else:
            day = TournamentDay()
            t.days.append(day)
        day.date = day_in.date
        day.all_day = day_in.all_day
        day.start_time = day_in.start_time
        day.end_time = day_in.end_time
        day.referees_required = day_in.referees_required
        day.location = day_in.location
        day.categories = day_in.categories
        day.specification = day_in.specification
        day.hidden = day_in.hidden
    for day_id, day in existing.items():
        if day_id not in keep_ids and day.date >= today:
            t.days.remove(day)
    remember(db, "location", t.venue_list)
    remember(db, "category", [*t.categories, *(c for d in data.days for c in (d.categories or []))])


def _apply_fields(db: Session, t: Tournament, data: TournamentIn) -> None:
    t.name = data.name.strip()
    t.venues = data.venues
    t.location = data.venues[0]
    t.categories = data.categories
    t.referees_required = data.referees_required
    t.is_visible = data.is_visible
    t.show_required = data.show_required
    t.has_roles = data.has_roles
    t.roles = data.roles
    t.notes = data.notes.strip()
    if data.admin_ids is not None:
        t.admins = _admins(db, data.admin_ids)


@router.post("/tournaments", status_code=201)
def create_tournament(data: TournamentIn, user: User = Depends(require_creator), db: Session = Depends(get_db)):
    # Se puede crear sin franjas y añadirlas después.
    t = Tournament(created_by_id=user.id, days=[])
    db.add(t)
    _apply_fields(db, t, data)
    _apply_days(db, t, data)
    db.commit()
    return {"id": t.id}


@router.put("/tournaments/{tournament_id}")
def update_tournament(
    tournament_id: int, data: TournamentIn, _: User = Depends(require_creator), db: Session = Depends(get_db)
):
    t = _get_tournament(db, tournament_id)
    _apply_fields(db, t, data)
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
def get_tournament(tournament_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    t = _get_tournament(db, tournament_id)
    check_manages(user, t)
    dates = [d.date for d in t.days]

    available = available_by_day(db, list(t.days))
    starts = start_times_by_day(db, list(t.days))
    windows = _windows_on(db, set(dates))

    # Asignaciones de esas fechas en otros torneos, para avisar de choques de horario.
    elsewhere: dict = defaultdict(list)
    if dates:
        for other, uid in db.execute(
            select(TournamentDay, Assignment.user_id)
            .join(Assignment, Assignment.day_id == TournamentDay.id)
            .where(TournamentDay.date.in_(dates), TournamentDay.tournament_id != t.id)
        ).all():
            elsewhere[uid].append(other)

    chiefs = db.scalars(select(User).where(User.is_chief.is_(True), User.active.is_(True))).all()
    referees = _open_referees(db) if any(d.hidden for d in t.days) else []

    days = []
    for d in t.days:
        records = {r.user_id: r for r in d.match_records}
        candidates = []
        if d.hidden:  # Franja oculta: cualquier árbitro activo es candidato.
            avail = [(u, None) for u in referees]
        else:
            avail = sorted(available.get(d.id, {}).values(), key=lambda x: name_key(x[0]))
        seen: set[int] = set()
        for u, at in [*((c, None) for c in chiefs), *avail]:
            if u.id in seen:
                continue
            seen.add(u.id)
            clash = next((o for o in elsewhere[u.id] if overlaps(d, o)), None)
            candidates.append({
                "user_id": u.id,
                "name": u.full_name,
                "is_chief": u.is_chief,
                "is_guest": u.guest,
                "assigned_elsewhere": clash.tournament.name if clash else None,
                "available_at": at.isoformat() if at else None,
                # Hora desde la que puede, si la indicó al inscribirse.
                "available_from": _hhmm(starts.get(d.id, {}).get(u.id)),
            })
        assignments = []
        for a in sorted(d.assignments, key=lambda a: (t.roles.index(a.role) if a.role in (t.roles or []) else 99, name_key(a.user))):
            rec = records.get(a.user_id)
            assignments.append({
                "user_id": a.user_id,
                "name": a.user.full_name,
                "is_chief": a.user.is_chief,
                "is_guest": a.user.guest,
                "role": a.role,
                "confirmed": a.confirmed_at is not None,
                "refereed": rec.refereed if rec else None,
                "scored": rec.scored if rec else None,
                "other": (rec.other or 0) if rec else None,
                "by_category": rec.by_category if rec else None,
            })
        info = day_info(d)
        info.update({
            "open": is_open_for_availability(d.date),
            "candidates": candidates,
            "available_count": len(available.get(d.id, {})),
            "has_window": any(covers(w, d) for w in windows),
            "assignments": assignments,
        })
        days.append(info)
    return {**tournament_info(t), "days": days}


def _hhmm(t) -> str | None:
    return t.strftime("%H:%M") if t else None


def _windows_on(db: Session, dates: set) -> list[AvailabilityWindow]:
    if not dates:
        return []
    return list(db.scalars(select(AvailabilityWindow).where(AvailabilityWindow.date.in_(dates))).all())


def _open_referees(db: Session) -> list[User]:
    """Árbitros activos (sin el Jefe ni externos), en orden alfabético: candidatos de una franja oculta."""
    users = db.scalars(select(User).where(
        User.is_referee.is_(True), User.is_chief.is_(False), User.active.is_(True), User.is_guest.isnot(True))).all()
    return sorted(users, key=name_key)


@router.put("/tournament-days/{day_id}/assignments")
def set_assignments(
    day_id: int, items: list[AssignmentIn], user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    day = _get_day(db, day_id, user)
    check_overlaps(db, _apply_assignments(db, day, items))
    db.commit()
    return {"ok": True}


def _apply_assignments(db: Session, day: TournamentDay, items: list[AssignmentIn]) -> list[tuple[TournamentDay, User]]:
    """Deja la asignación de la franja exactamente como `items` (sin confirmar la transacción).

    Devuelve los árbitros recién asignados, para revisar después si se cruzan con otra franja.
    """
    t = day.tournament
    if is_finished(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La franja de {t.name} ya finalizó; su asignación no se puede cambiar.")
    current = {a.user_id: a for a in day.assignments}
    user_ids = [i.user_id for i in items]
    if len(user_ids) != len(set(user_ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un árbitro está repetido en la asignación.")

    available = set(available_by_day(db, [day]).get(day.id, {}))
    added: list[tuple[TournamentDay, User]] = []
    roles_used: set[str] = set()
    for item in items:
        u = db.get(User, item.user_id)
        if not u or not u.active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Árbitro no encontrado.")
        if not u.is_chief and (not u.is_referee or (u.id not in available and not day.hidden)):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{u.full_name} no tiene una disponibilidad que cubra {t.name} el {day.date:%d/%m/%Y} ({day_slot(day).label}).",
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
            added.append((day, db.get(User, item.user_id)))
    db.flush()
    return added


@router.put("/tournament-days/{day_id}/assignments/{user_id}/confirmed")
def set_guest_confirmed(
    day_id: int, user_id: int, data: ConfirmedIn, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    """Un árbitro externo no inicia sesión: el administrador marca si confirmó su asignación."""
    day = _get_day(db, day_id, user)
    a = next((a for a in day.assignments if a.user_id == user_id), None)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese árbitro no está asignado a esta franja.")
    if not a.user.guest:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este árbitro confirma desde su cuenta.")
    a.confirmed_at = (a.confirmed_at or utcnow()) if data.confirmed else None
    db.commit()
    return {"confirmed": a.confirmed_at is not None}


@router.put("/tournament-days/{day_id}/finished")
def set_finished(day_id: int, data: FinishedIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    day = _get_day(db, day_id, user)
    if data.finished:
        if not has_started(day):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La franja aún no ha comenzado.")
        day.finished_at = day.finished_at or utcnow()
    else:
        if ended_by_time(day):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta franja ya terminó; no se puede reabrir.")
        day.finished_at = None
    db.commit()
    return day_info(day)


@router.put("/tournament-days/{day_id}/matches")
def set_matches(day_id: int, items: list[MatchIn], user: User = Depends(require_admin), db: Session = Depends(get_db)):
    day = _get_day(db, day_id, user)
    if not is_finished(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los partidos se registran cuando la franja esté finalizada.")
    assigned = {a.user_id: a.user for a in day.assignments}
    records = {r.user_id: r for r in day.match_records}
    categories = day.effective_categories
    for item in items:
        u = assigned.get(item.user_id)
        if not u:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se registran partidos de árbitros asignados a ese día.")
        if u.is_chief or u.guest:
            continue  # Al JEFE y a los árbitros externos no se les registran partidos.
        breakdown = None
        if item.categories:
            unknown = [c.category for c in item.categories if c.category not in categories]
            if unknown:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La categoría '{unknown[0]}' no es de esta franja.")
            breakdown = [c.model_dump() for c in item.categories]
        rec = records.get(item.user_id)
        if rec:
            rec.refereed, rec.scored, rec.other = item.refereed, item.scored, item.other
            rec.by_category, rec.recorded_by_id = breakdown, user.id
        else:
            day.match_records.append(MatchRecord(
                user_id=item.user_id, refereed=item.refereed, scored=item.scored, other=item.other,
                by_category=breakdown, recorded_by_id=user.id,
            ))
    db.commit()
    return {"ok": True}


# ---------- Asignación global por fecha ----------
@router.get("/assignment-board")
def assignment_board(d: date | None = None, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Para una fecha: por cada franja combinada, los árbitros disponibles (filas) y los torneos (columnas).

    Un administrador solo ve las franjas de los torneos que tiene asignados.
    """
    today = today_local()
    # Las franjas finalizadas ya no se asignan: salen del tablero.
    upcoming = sorted({x.date for x in db.scalars(select(TournamentDay).where(TournamentDay.date >= today))
                       if not is_finished(x) and user.manages(x.tournament)})
    if d is None:
        d = upcoming[0] if upcoming else today
    days = [x for x in db.scalars(
        select(TournamentDay).where(TournamentDay.date == d)
        .options(selectinload(TournamentDay.tournament), selectinload(TournamentDay.assignments))
    ).all() if not is_finished(x) and user.manages(x.tournament)]
    avail = available_by_day(db, list(days))
    starts = start_times_by_day(db, list(days))
    chiefs = db.scalars(select(User).where(User.is_chief.is_(True), User.active.is_(True))).all()
    referees = _open_referees(db) if any(x.hidden for x in days) else []

    groups = []
    for g in group_days(list(days)):
        cols = sorted(g.days, key=lambda x: (x.start_time or time.min, fold(x.tournament.name)))
        people: dict[int, User] = {c.id: c for c in chiefs}
        available: dict[int, list[int]] = defaultdict(list)
        assigned: dict[int, dict[str, str | None]] = defaultdict(dict)
        confirmed: dict[int, list[int]] = defaultdict(list)
        for day in cols:
            # En una franja oculta todos los árbitros cuentan como disponibles.
            for u in referees if day.hidden else (u for u, _ in avail.get(day.id, {}).values()):
                people[u.id] = u
                available[u.id].append(day.id)
            for a in day.assignments:
                people[a.user_id] = a.user
                assigned[a.user_id][str(day.id)] = a.role
                if a.confirmed_at is not None:
                    confirmed[a.user_id].append(day.id)
        rows = sorted(people.values(), key=lambda u: (not u.is_chief, *name_key(u)))
        groups.append({
            "key": g.key,
            "slot_label": g.slot.label,
            "columns": [{
                **day_info(day),
                "tournament_id": day.tournament_id,
                "tournament": day.tournament.name,
                "visible": day.tournament.is_visible,
                "has_roles": day.tournament.has_roles,
                "roles": day.tournament.roles or [],
            } for day in cols],
            "rows": [{
                "user_id": u.id,
                "name": u.full_name,
                "is_chief": u.is_chief,
                "is_guest": u.guest,
                "available_day_ids": available.get(u.id, []),
                "assigned": assigned.get(u.id, {}),
                "confirmed_day_ids": confirmed.get(u.id, []),
                "start_times": {str(day.id): _hhmm(starts[day.id][u.id]) for day in cols if u.id in starts.get(day.id, {})},
            } for u in rows],
        })
    return {"date": d.isoformat(), "dates": [x.isoformat() for x in upcoming], "groups": groups}


@router.put("/assignment-board")
def save_assignment_board(data: BoardIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Guarda varias franjas a la vez: o se guardan todas o ninguna."""
    added = []
    for entry in data.days:
        added += _apply_assignments(db, _get_day(db, entry.day_id, user), entry.items)
    check_overlaps(db, added)
    db.commit()
    return {"ok": True}
