"""Franjas horarias tal como las ve el árbitro.

En una misma fecha, las franjas de los distintos torneos que se superponen se suman en un solo bloque;
las que no se tocan quedan como bloques separados y el árbitro marca disponibilidad en cada uno.
"Todo el día" cubre cualquier otra franja de esa fecha.
"""
from dataclasses import dataclass, field
from datetime import time

from .models import TournamentDay


@dataclass
class Slot:
    all_day: bool
    start: time | None = None
    end: time | None = None

    @property
    def label(self) -> str:
        if self.all_day or not self.start or not self.end:
            return "Todo el día"
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
    if day.all_day or day.start_time is None or day.end_time is None:
        return Slot(all_day=True)
    return Slot(all_day=False, start=day.start_time, end=day.end_time)


def group_days(days: list[TournamentDay]) -> list[SlotGroup]:
    """Agrupa días de torneo de UNA misma fecha en bloques de franjas superpuestas."""
    if not days:
        return []
    if any(day_slot(d).all_day for d in days):
        return [SlotGroup(Slot(all_day=True), list(days))]
    groups: list[SlotGroup] = []
    for d in sorted(days, key=lambda d: (d.start_time, d.end_time)):
        last = groups[-1] if groups else None
        if last and d.start_time < last.slot.end:  # se superponen (tocarse en el borde no cuenta)
            last.days.append(d)
            last.slot.end = max(last.slot.end, d.end_time)
        else:
            groups.append(SlotGroup(Slot(all_day=False, start=d.start_time, end=d.end_time), [d]))
    return groups
