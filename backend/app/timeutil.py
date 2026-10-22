from datetime import date, datetime, timezone

from .config import APP_TIMEZONE


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today_local() -> date:
    return datetime.now(APP_TIMEZONE).date()


def is_open_for_availability(day: date) -> bool:
    """La selección de disponibilidad se cierra automáticamente el mismo día del torneo."""
    return day > today_local()


def age_on(birth: date, ref: date) -> int:
    return ref.year - birth.year - ((ref.month, ref.day) < (birth.month, birth.day))
