from collections import defaultdict
from datetime import date, time
from secrets import token_hex

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..coverage import covers, window_slot
from ..database import get_db
from ..deps import check_manages, current_user, require_admin, require_referee
from ..models import AvailabilityWindow, TournamentDay, User, WindowHiddenName, WindowSignup
from ..schemas import GuestIn, SignupIn, WindowIn
from ..serializers import fold
from ..slots import day_slot
from ..timeutil import is_open_for_availability, today_local

router = APIRouter(tags=["availability"])


def _windows(db: Session, from_date: date | None = None, on_date: date | None = None) -> list[AvailabilityWindow]:
    q = select(AvailabilityWindow).options(
        selectinload(AvailabilityWindow.days).selectinload(TournamentDay.tournament),
        selectinload(AvailabilityWindow.signups).selectinload(WindowSignup.user),
        selectinload(AvailabilityWindow.hidden_names),
    )
    if from_date:
        q = q.where(AvailabilityWindow.date >= from_date)
    if on_date:
        q = q.where(AvailabilityWindow.date == on_date)
    rows = db.scalars(q).all()
    return sorted(rows, key=lambda w: (w.date, w.start_time or time.min, w.end_time or time.max))


def _get_window(db: Session, window_id: int) -> AvailabilityWindow:
    w = db.get(AvailabilityWindow, window_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Disponibilidad no encontrada.")
    return w


def _active_signups(w: AvailabilityWindow) -> list[WindowSignup]:
    return sorted((s for s in w.signups if s.user.active), key=lambda s: s.created_at)


def _ordered_days(w: AvailabilityWindow) -> list[TournamentDay]:
    return sorted(w.days, key=lambda d: (d.start_time or time.min, fold(d.tournament.name)))


def _tournament_ids(w: AvailabilityWindow) -> list[int]:
    return list(dict.fromkeys(d.tournament_id for d in _ordered_days(w)))


def hidden_label(shown: list[str], hidden: int) -> str:
    """Nombre que ven los árbitros: los torneos visibles y, si hay ocultos, "y otros torneos" o "N torneos"."""
    if not hidden:
        return " / ".join(shown)
    if not shown:
        return "1 torneo" if hidden == 1 else f"{hidden} torneos"
    return f"{' / '.join(shown)} y otros torneos"


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def _base(w: AvailabilityWindow) -> dict:
    slot = window_slot(w)
    return {
        "id": w.id,
        "date": w.date.isoformat(),
        "all_day": slot.all_day,
        "start_time": w.start_time.strftime("%H:%M") if w.start_time else None,
        "end_time": w.end_time.strftime("%H:%M") if w.end_time else None,
        "slot_label": slot.label,
        "hidden_tournament_ids": sorted(w.hidden_tournament_ids),
        "required": sum(d.required for d in w.days),
        "registered": len(_active_signups(w)),
        "open": is_open_for_availability(w.date),
        "allow_custom_hours": bool(w.allow_custom_hours),
    }


def _admin_out(w: AvailabilityWindow, user: User) -> dict:
    """Vista del Jefe o de un administrador: este último solo ve las franjas de sus torneos."""
    days = [d for d in _ordered_days(w) if user.manages(d.tournament)]
    return {
        **_base(w),
        "hidden_tournament_ids": sorted({d.tournament_id for d in days} & w.hidden_tournament_ids),
        "required": sum(d.required for d in days),
        "days": [{
            "id": d.id,
            "tournament_id": d.tournament_id,
            "tournament": d.tournament.name,
            "slot_label": day_slot(d).label,
            "required": d.required,
        } for d in days],
        "guests": [{"user_id": s.user_id, "name": s.user.full_name} for s in _active_signups(w) if s.user.guest],
        "can_edit_guests": all(user.manages(d.tournament) for d in w.days),
    }


# ---------- Árbitros ----------
@router.get("/availability")
def list_availability(user: User = Depends(require_referee), db: Session = Depends(get_db)):
    """Disponibilidades habilitadas de hoy en adelante, tal como las ve un árbitro."""
    result = []
    for w in _windows(db, from_date=today_local()):
        tournaments = []
        hidden = w.hidden_tournament_ids
        # Cuántos torneos no ve este árbitro, para mostrar "y otros torneos" o "N torneos".
        hidden_count = 0 if user.admin else sum(1 for tid in _tournament_ids(w) if tid in hidden)
        by_tournament: dict[int, list[TournamentDay]] = defaultdict(list)
        for d in _ordered_days(w):
            by_tournament[d.tournament_id].append(d)
        for tid, tdays in by_tournament.items():
            # Los árbitros no ven los torneos con el nombre oculto; los administradores sí, marcados.
            if tid in hidden and not user.admin:
                continue
            t = tdays[0].tournament
            details = t.is_visible or user.admin
            tournaments.append({
                "name": t.name,
                "categories": list(dict.fromkeys(c for x in tdays for c in x.effective_categories)) if details else [],
                "visible": t.is_visible,
                "name_hidden": tid in hidden,
                # Al lado del nombre, los requeridos de ese torneo si el torneo los muestra.
                "required": sum(x.required for x in tdays) if user.admin or t.show_required is not False else None,
            })
        # El total (inscritos / requeridos) se muestra si todos los torneos elegidos muestran sus requeridos,
        # o si los árbitros no ven ningún torneo por nombre (entonces aunque alguno los oculte).
        show_total = bool(w.days) and (
            all(tid in hidden for tid in by_tournament)
            or all(d.tournament.show_required is not False for d in w.days)
        )
        base = _base(w)
        result.append({
            **base,
            "key": w.id,
            "required": base["required"] if show_total else None,
            "mine": any(s.user_id == user.id for s in w.signups),
            "my_start_time": next((_hhmm(s.start_time) for s in w.signups if s.user_id == user.id), None),
            "my_end_time": next((_hhmm(s.end_time) for s in w.signups if s.user_id == user.id), None),
            "tournaments": tournaments,
            "hidden_count": hidden_count,
        })
    return result


@router.get("/availability/summary")
def availability_summary(d: date | None = None, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Disponibilidades con los árbitros inscritos (sin el Jefe), en orden de inscripción, para compartir.

    Un administrador solo ve en ellas los torneos que tiene asignados.
    """
    result = []
    for w in _windows(db, on_date=d) if d else _windows(db, from_date=today_local()):
        tournament = None
        mine = [x for x in _ordered_days(w) if user.manages(x.tournament)]
        days = [x for x in mine if x.tournament_id not in w.hidden_tournament_ids]
        hidden = len({x.tournament_id for x in mine if x.tournament_id in w.hidden_tournament_ids})
        if days or hidden:
            # Sin el lugar: la imagen de disponibilidad no lo muestra.
            names = list(dict.fromkeys(x.tournament.name for x in days))
            tournament = {"name": hidden_label(names, hidden)}
        result.append({
            "date": w.date.isoformat(),
            "slot_label": window_slot(w).label,
            "start_time": w.start_time.strftime("%H:%M") if w.start_time else None,
            "required": sum(x.required for x in mine),
            # Franjas que cubre, para no contar dos veces sus requeridos al agrupar por fecha.
            "days": [{"id": x.id, "required": x.required} for x in mine],
            "tournament": tournament,
            "entries": [{"user_id": s.user_id, "name": s.user.full_name, "at": s.created_at.isoformat(),
                         "is_guest": s.user.guest}
                        for s in _active_signups(w) if not s.user.is_chief],
        })
    return result


def _check_open(w: AvailabilityWindow) -> None:
    if not is_open_for_availability(w.date):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La selección de disponibilidad para esa fecha ya está cerrada.")


def _fit_hours(w: AvailabilityWindow, start: time | None, end: time | None) -> tuple[time | None, time | None]:
    """Horario propio del árbitro dentro del de la disponibilidad. Las mismas horas de inicio o fin cuentan como vacías.

    Lanza ValueError con el motivo si no cabe.
    """
    slot = window_slot(w)
    if slot.start and start == slot.start:
        start = None
    if w.end_time and end == w.end_time:
        end = None
    if (start or end) and not w.allow_custom_hours:
        raise ValueError("Esta disponibilidad no permite indicar otro horario.")
    outside = f"Tu horario debe estar dentro del de la disponibilidad ({slot.label})."
    for t in (start, end):
        if t and ((slot.start and t <= slot.start) or (w.end_time and t >= w.end_time)):
            raise ValueError(outside)
    if end and end <= (start or slot.start or time.min):
        raise ValueError("La hora hasta la que puedes debe ser posterior a la hora desde la que puedes.")
    return start, end


@router.post("/availability/{window_id}", status_code=204)
def add_availability(
    window_id: int, data: SignupIn | None = None, user: User = Depends(require_referee), db: Session = Depends(get_db)
):
    """Inscribe al árbitro (o le cambia su horario si ya estaba inscrito)."""
    w = _get_window(db, window_id)
    _check_open(w)
    try:
        start, end = _fit_hours(w, data.start_time if data else None, data.end_time if data else None)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    mine = next((s for s in w.signups if s.user_id == user.id), None)
    if mine:
        mine.start_time, mine.end_time = start, end
    else:
        w.signups.append(WindowSignup(user_id=user.id, start_time=start, end_time=end))
    db.commit()


@router.delete("/availability/{window_id}", status_code=204)
def remove_availability(window_id: int, user: User = Depends(require_referee), db: Session = Depends(get_db)):
    w = _get_window(db, window_id)
    _check_open(w)
    for s in [s for s in w.signups if s.user_id == user.id]:
        w.signups.remove(s)
    db.commit()


@router.get("/availability/{window_id}/referees")
def referees_for_window(window_id: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    w = _get_window(db, window_id)
    return [{"name": s.user.full_name, "since": s.created_at.isoformat(),
             "start_time": _hhmm(s.start_time), "end_time": _hhmm(s.end_time)}
            for s in _active_signups(w)]


# ---------- Jefe y administradores ----------
@router.get("/availability-windows")
def list_windows(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Disponibilidades habilitadas de hoy en adelante."""
    return [_admin_out(w, user) for w in _windows(db, from_date=today_local())]


@router.get("/availability-windows/slots")
def slots_on(d: date, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Franjas de torneo (no ocultas) de una fecha, para elegir cuáles cubre una disponibilidad.

    Un administrador solo puede vincular las franjas de sus torneos.
    """
    days = [x for x in db.scalars(
        select(TournamentDay).where(TournamentDay.date == d, TournamentDay.hidden.isnot(True))
        .options(selectinload(TournamentDay.tournament))
    ).all() if user.manages(x.tournament)]
    windows = _windows(db, on_date=d)
    days = sorted(days, key=lambda x: (x.start_time or time.min, fold(x.tournament.name)))
    return [{
        "id": x.id,
        "tournament_id": x.tournament_id,
        "tournament": x.tournament.name,
        "all_day": day_slot(x).all_day,
        "start_time": x.start_time.strftime("%H:%M") if x.start_time else None,
        "end_time": x.end_time.strftime("%H:%M") if x.end_time else None,
        "slot_label": day_slot(x).label,
        "required": x.required,
        "location": x.effective_location,
        "window_ids": [w.id for w in windows if any(y.id == x.id for y in w.days)],
    } for x in days]


def _apply(db: Session, w: AvailabilityWindow, data: WindowIn, user: User) -> None:
    # Las franjas de torneos que este administrador no gestiona se conservan tal cual.
    others = [d for d in w.days if not user.manages(d.tournament)]
    if others and data.date != w.date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta disponibilidad incluye torneos que no tienes asignados: no puedes cambiar su fecha.")
    w.date, w.all_day = data.date, data.all_day
    w.start_time, w.end_time = data.start_time, data.end_time
    days = list(others)
    for day_id in data.day_ids:
        d = db.get(TournamentDay, day_id)
        if not d or d.date != data.date:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Las franjas deben ser de la misma fecha que la disponibilidad.")
        if d in others:
            continue
        check_manages(user, d.tournament)
        if d.hidden:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La franja de {d.tournament.name} está oculta: no necesita disponibilidad.")
        if not covers(w, d):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"La franja de {d.tournament.name} ({day_slot(d).label}) no cabe en el horario de la disponibilidad.",
            )
        days.append(d)
    for d in others:
        if not covers(w, d):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"La franja de {d.tournament.name} ({day_slot(d).label}) quedaría fuera del horario, y ese torneo no está asignado a ti.",
            )
    w.days = days
    w.allow_custom_hours = data.allow_custom_hours
    # Los horarios que ya no caben (o si ya no se permite indicarlos) vuelven a ser todo el horario.
    for s in w.signups:
        try:
            s.start_time, s.end_time = _fit_hours(w, s.start_time, s.end_time)
        except ValueError:
            s.start_time = s.end_time = None
    other_ids = {d.tournament_id for d in others}
    hide = (set(data.hidden_tournament_ids) - other_ids | (w.hidden_tournament_ids & other_ids)) & {d.tournament_id for d in days}
    w.hidden_names = [h for h in w.hidden_names if h.tournament_id in hide] + [
        WindowHiddenName(tournament_id=t) for t in sorted(hide - w.hidden_tournament_ids)
    ]


@router.post("/availability-windows", status_code=201)
def create_window(data: WindowIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if data.date < today_local():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha ya pasó.")
    w = AvailabilityWindow(created_by_id=user.id)
    db.add(w)
    _apply(db, w, data, user)
    db.commit()
    return _admin_out(w, user)


@router.put("/availability-windows/{window_id}")
def update_window(window_id: int, data: WindowIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Editar conserva las inscripciones."""
    w = _get_window(db, window_id)
    _apply(db, w, data, user)
    db.commit()
    return _admin_out(w, user)


@router.delete("/availability-windows/{window_id}", status_code=204)
def delete_window(window_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    w = _get_window(db, window_id)
    if any(not user.manages(d.tournament) for d in w.days):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta disponibilidad incluye torneos que no tienes asignados: no puedes eliminarla.")
    db.delete(w)
    db.commit()


# ---------- Árbitros externos ----------
def _check_manages_all(user: User, w: AvailabilityWindow) -> None:
    if any(not user.manages(d.tournament) for d in w.days):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta disponibilidad incluye torneos que no tienes asignados.")


def _guest(db: Session, name: str) -> User:
    """El árbitro externo con ese nombre (sin importar mayúsculas ni tildes), o uno nuevo."""
    key = fold(name)
    for g in db.scalars(select(User).where(User.is_guest.is_(True))).all():
        if fold(g.full_name) == key:
            g.active = True
            return g
    first, _, last = name.partition(" ")
    g = User(
        first_name=first, last_name=last, document=f"externo-{token_hex(8)}", birth_date=date(1900, 1, 1),
        pin_hash="!", is_referee=True, is_guest=True, entry_points=0,
    )
    db.add(g)
    db.flush()
    return g


@router.post("/availability-windows/{window_id}/guests")
def add_guest(window_id: int, data: GuestIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Inscribe a un árbitro externo (solo con su nombre). Se puede aunque ya cerró la selección de los árbitros."""
    w = _get_window(db, window_id)
    _check_manages_all(user, w)
    if w.date < today_local():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha ya pasó.")
    g = _guest(db, data.name)
    if not any(s.user_id == g.id for s in w.signups):
        w.signups.append(WindowSignup(user_id=g.id, user=g))
    db.commit()
    return _admin_out(w, user)


@router.delete("/availability-windows/{window_id}/guests/{user_id}")
def remove_guest(window_id: int, user_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    w = _get_window(db, window_id)
    _check_manages_all(user, w)
    for s in [s for s in w.signups if s.user_id == user_id and s.user.guest]:
        w.signups.remove(s)
    db.commit()
    return _admin_out(w, user)
