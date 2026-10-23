import unicodedata

from .models import Shirt, Tournament, TournamentDay, User
from .schemas import Me, UserOut
from .slots import day_slot
from .timeutil import today_local


def user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id, first_name=u.first_name, last_name=u.last_name, document=u.document, whatsapp=u.whatsapp,
        is_referee=u.is_referee, is_admin=u.is_admin, can_create_tournaments=u.can_create_tournaments,
        is_chief=u.is_chief, active=u.active,
    )


def me_out(u: User) -> Me:
    return Me(
        **user_out(u).model_dump(),
        perm_admin=u.admin,
        perm_create_tournaments=u.tournament_creator,
        perm_availability=u.is_referee and not u.is_chief,
        perm_chief=u.chief_powers,
    )


def tournament_info(t: Tournament) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "location": t.location,
        "venues": t.venue_list,
        "categories": t.categories or [],
        "referees_required": t.referees_required,
        "is_visible": t.is_visible,
        "show_required": t.show_required is not False,
        "has_roles": t.has_roles,
        "roles": t.roles or [],
        "notes": t.notes or "",
    }


def day_info(d: TournamentDay) -> dict:
    slot = day_slot(d)
    return {
        "id": d.id,
        "date": d.date.isoformat(),
        "all_day": slot.all_day,
        "start_time": slot.start.strftime("%H:%M") if slot.start else None,
        "end_time": slot.end.strftime("%H:%M") if slot.end else None,
        "slot_label": slot.label,
        "referees_required": d.referees_required,
        "required": d.required,
        "location": d.location,
        "categories": d.categories,
        "effective_location": d.effective_location,
        "effective_categories": d.effective_categories,
        "specification": d.specification,
        "past": d.date < today_local(),
        "shirt": shirt_info(d.shirt) if d.shirt else None,
    }


def shirt_info(s: Shirt) -> dict:
    return {"id": s.id, "name": s.name, "color": s.color}


def fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def name_key(u: User) -> tuple[str, str]:
    """Orden alfabético por apellido sin tener en cuenta tildes (Álvarez va antes que Bravo)."""
    return (fold(u.last_name), fold(u.first_name))
