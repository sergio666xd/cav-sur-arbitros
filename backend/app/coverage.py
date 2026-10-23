"""Qué árbitros están disponibles para cada franja de torneo y qué asignaciones se cruzan.

Un árbitro está disponible para una franja si se inscribió en una disponibilidad habilitada de esa
fecha cuyo horario cubre por completo el de la franja. Las disponibilidades marcadas con el sistema
anterior (por franja) se siguen respetando. Las franjas ocultas no piden disponibilidad.
"""
from collections import defaultdict
from datetime import datetime, time

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import Assignment, Availability, AvailabilityWindow, TournamentDay, User, WindowSignup
from .slots import Slot, end_or_max


def day_span(d: TournamentDay) -> tuple[time, time]:
    """Horario de una franja para comparar. Todo el día (o sin hora de fin) llega hasta el final del día."""
    start = d.start_time or time.min
    if d.all_day or d.start_time is None:
        return start, time.max
    return start, end_or_max(d.end_time)


def window_span(w: AvailabilityWindow) -> tuple[time, time]:
    if w.all_day or w.start_time is None:
        return time.min, time.max
    return w.start_time, end_or_max(w.end_time)


def window_slot(w: AvailabilityWindow) -> Slot:
    return Slot(all_day=w.all_day or w.start_time is None, start=None if w.all_day else w.start_time, end=w.end_time)


def covers(w: AvailabilityWindow, d: TournamentDay) -> bool:
    if w.date != d.date:
        return False
    ws, we = window_span(w)
    ds, de = day_span(d)
    return ws <= ds and de <= we


def overlaps(a: TournamentDay, b: TournamentDay) -> bool:
    if a.date != b.date:
        return False
    a_start, a_end = day_span(a)
    b_start, b_end = day_span(b)
    return a_start < b_end and b_start < a_end


def available_by_day(db: Session, days: list[TournamentDay]) -> dict[int, dict[int, tuple[User, datetime]]]:
    """Para cada franja (no oculta): árbitro -> (usuario, cuándo se inscribió). Solo usuarios activos."""
    out: dict[int, dict[int, tuple[User, datetime]]] = defaultdict(dict)
    days = [d for d in days if not d.hidden]
    if not days:
        return out

    def add(day_id: int, u: User, at: datetime) -> None:
        if u.active and (u.id not in out[day_id] or at < out[day_id][u.id][1]):
            out[day_id][u.id] = (u, at)

    windows = db.scalars(
        select(AvailabilityWindow).where(AvailabilityWindow.date.in_({d.date for d in days}))
        .options(selectinload(AvailabilityWindow.signups).selectinload(WindowSignup.user))
    ).all()
    for d in days:
        for w in windows:
            if covers(w, d):
                for s in w.signups:
                    add(d.id, s.user, s.created_at)
    for day_id, u, at in db.execute(
        select(Availability.day_id, User, Availability.created_at)
        .join(User, User.id == Availability.user_id)
        .where(Availability.day_id.in_([d.id for d in days]))
    ).all():
        add(day_id, u, at)
    return out


def check_overlaps(db: Session, added: list[tuple[TournamentDay, User]]) -> None:
    """Rechaza a un árbitro recién asignado si ya está en otra franja de esa fecha que se cruza.

    Se llama con todas las asignaciones ya aplicadas, para que mover a alguien de una franja a otra
    en el mismo guardado no cuente como cruce. El Jefe puede estar en varias a la vez.
    """
    for day, u in added:
        if u.is_chief:
            continue
        others = db.scalars(
            select(TournamentDay).join(Assignment, Assignment.day_id == TournamentDay.id)
            .where(Assignment.user_id == u.id, TournamentDay.date == day.date, TournamentDay.id != day.id)
        ).all()
        clash = next((o for o in others if overlaps(day, o)), None)
        if clash:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{u.full_name} ya está asignado en {clash.tournament.name} el {day.date:%d/%m/%Y} "
                f"a una hora que se cruza con {day.tournament.name}.",
            )
