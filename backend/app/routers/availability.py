from collections import defaultdict
from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..coverage import covers, window_slot
from ..database import get_db
from ..deps import current_user, require_admin, require_referee
from ..models import AvailabilityWindow, TournamentDay, User, WindowHiddenName, WindowSignup
from ..schemas import WindowIn
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
    }


def _admin_out(w: AvailabilityWindow) -> dict:
    return {
        **_base(w),
        "days": [{
            "id": d.id,
            "tournament_id": d.tournament_id,
            "tournament": d.tournament.name,
            "slot_label": day_slot(d).label,
            "required": d.required,
        } for d in _ordered_days(w)],
    }


# ---------- Árbitros ----------
@router.get("/availability")
def list_availability(user: User = Depends(require_referee), db: Session = Depends(get_db)):
    """Disponibilidades habilitadas de hoy en adelante, tal como las ve un árbitro."""
    result = []
    for w in _windows(db, from_date=today_local()):
        tournaments = []
        hidden = w.hidden_tournament_ids
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
            })
        # Los requeridos se ocultan si algún torneo de la disponibilidad lo pide, o si no tiene franjas.
        show_required = bool(w.days) and (user.admin or all(d.tournament.show_required is not False for d in w.days))
        base = _base(w)
        result.append({
            **base,
            "key": w.id,
            "required": base["required"] if show_required else None,
            "mine": any(s.user_id == user.id for s in w.signups),
            "tournaments": tournaments,
        })
    return result


@router.get("/availability/summary")
def availability_summary(d: date | None = None, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Disponibilidades con los árbitros inscritos (sin el Jefe), en orden de inscripción, para compartir."""
    result = []
    for w in _windows(db, on_date=d) if d else _windows(db, from_date=today_local()):
        tournament = None
        days = [x for x in _ordered_days(w) if x.tournament_id not in w.hidden_tournament_ids]
        if days:
            names = list(dict.fromkeys(x.tournament.name for x in days))
            locations = list(dict.fromkeys(
                x.effective_location.split(",")[0] for x in days if x.effective_location and x.tournament.is_visible
            ))
            tournament = {"name": " / ".join(names), "location": " / ".join(locations)}
        result.append({
            "date": w.date.isoformat(),
            "slot_label": window_slot(w).label,
            "start_time": w.start_time.strftime("%H:%M") if w.start_time else None,
            "required": sum(x.required for x in w.days),
            "tournament": tournament,
            "entries": [{"user_id": s.user_id, "name": s.user.full_name, "at": s.created_at.isoformat()}
                        for s in _active_signups(w) if not s.user.is_chief],
        })
    return result


def _check_open(w: AvailabilityWindow) -> None:
    if not is_open_for_availability(w.date):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La selección de disponibilidad para esa fecha ya está cerrada.")


@router.post("/availability/{window_id}", status_code=204)
def add_availability(window_id: int, user: User = Depends(require_referee), db: Session = Depends(get_db)):
    w = _get_window(db, window_id)
    _check_open(w)
    if not any(s.user_id == user.id for s in w.signups):
        w.signups.append(WindowSignup(user_id=user.id))
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
    return [{"name": s.user.full_name, "since": s.created_at.isoformat()} for s in _active_signups(w)]


# ---------- Jefe y administradores ----------
@router.get("/availability-windows")
def list_windows(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Disponibilidades habilitadas de hoy en adelante."""
    return [_admin_out(w) for w in _windows(db, from_date=today_local())]


@router.get("/availability-windows/slots")
def slots_on(d: date, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Franjas de torneo (no ocultas) de una fecha, para elegir cuáles cubre una disponibilidad."""
    days = db.scalars(
        select(TournamentDay).where(TournamentDay.date == d, TournamentDay.hidden.isnot(True))
        .options(selectinload(TournamentDay.tournament))
    ).all()
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


def _apply(db: Session, w: AvailabilityWindow, data: WindowIn) -> None:
    w.date, w.all_day = data.date, data.all_day
    w.start_time, w.end_time = data.start_time, data.end_time
    days = []
    for day_id in data.day_ids:
        d = db.get(TournamentDay, day_id)
        if not d or d.date != data.date:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Las franjas deben ser de la misma fecha que la disponibilidad.")
        if d.hidden:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La franja de {d.tournament.name} está oculta: no necesita disponibilidad.")
        if not covers(w, d):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"La franja de {d.tournament.name} ({day_slot(d).label}) no cabe en el horario de la disponibilidad.",
            )
        days.append(d)
    w.days = days
    hide = set(data.hidden_tournament_ids) & {d.tournament_id for d in days}
    w.hidden_names = [h for h in w.hidden_names if h.tournament_id in hide] + [
        WindowHiddenName(tournament_id=t) for t in sorted(hide - w.hidden_tournament_ids)
    ]


@router.post("/availability-windows", status_code=201)
def create_window(data: WindowIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if data.date < today_local():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha ya pasó.")
    w = AvailabilityWindow(created_by_id=user.id)
    db.add(w)
    _apply(db, w, data)
    db.commit()
    return _admin_out(w)


@router.put("/availability-windows/{window_id}")
def update_window(window_id: int, data: WindowIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Editar conserva las inscripciones."""
    w = _get_window(db, window_id)
    _apply(db, w, data)
    db.commit()
    return _admin_out(w)


@router.delete("/availability-windows/{window_id}", status_code=204)
def delete_window(window_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.delete(_get_window(db, window_id))
    db.commit()
