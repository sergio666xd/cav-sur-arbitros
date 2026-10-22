"""Franjas horarias tal como las ve el árbitro.

En una misma fecha, las franjas de los distintos torneos que se superponen se suman en un solo bloque;
las que no se tocan quedan como bloques separados y el árbitro marca disponibilidad en cada uno.
"Todo el día" cubre cualquier otra franja de esa fecha; tiene hora de inicio pero no de fin.
Las demás franjas pueden no tener hora de fin (hora de citación): se consideran abiertas hasta el final del día.
"""
from dataclasses import dataclass, field
from datetime import time

END_OF_DAY = time.max


def end_or_max(t: time | None) -> time:
    """Hora de fin para comparar: sin hora de fin, la franja sigue hasta el final del día."""
    return t or END_OF_DAY

from .models import TournamentDay


@dataclass
class Slot:
    all_day: bool
    start: time | None = None
    end: time | None = None

    @property
    def label(self) -> str:
        if self.all_day or not self.start:
            return f"Todo el día desde las {self.start.strftime('%H:%M')}" if self.start else "Todo el día"
        if not self.end:
            return f"Desde las {self.start.strftime('%H:%M')}"
        return f"{self.start.strftime('%H:%M')} - {self.end.strftime('%H:%M')}"


@dataclass
class SlotGroup:
    slot: Slot
    days: list[TournamentDay] = field(default_factory=list)

    @property
    def key(self) -> int:
        """Identificador estable mientras no cambien los torneos: el menor id de día del grupo."""
        return min(d.id for d in self.days)


def day_slot(day: TournamentDay) -> Slot:
    if day.all_day or day.start_time is None:
        return Slot(all_day=True, start=day.start_time)
    return Slot(all_day=False, start=day.start_time, end=day.end_time)


def group_days(days: list[TournamentDay]) -> list[SlotGroup]:
    """Agrupa días de torneo de UNA misma fecha en bloques de franjas superpuestas."""
    if not days:
        return []
    if any(day_slot(d).all_day for d in days):
        starts = [d.start_time for d in days if d.start_time]
        return [SlotGroup(Slot(all_day=True, start=min(starts) if starts else None), list(days))]
    groups: list[SlotGroup] = []
    for d in sorted(days, key=lambda d: (d.start_time, end_or_max(d.end_time))):
        last = groups[-1] if groups else None
        if last and d.start_time < end_or_max(last.slot.end):  # se superponen (tocarse en el borde no cuenta)
            last.days.append(d)
            # Si alguna no tiene hora de fin, el bloque tampoco.
            last.slot.end = None if last.slot.end is None or d.end_time is None else max(last.slot.end, d.end_time)
        else:
            groups.append(SlotGroup(Slot(all_day=False, start=d.start_time, end=d.end_time), [d]))
    return groups
