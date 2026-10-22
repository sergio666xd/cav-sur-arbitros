from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import Assignment, MatchRecord, TournamentDay, User
from ..serializers import day_info, name_key, tournament_info

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/assignments")
def my_assignments(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Detalle completo de los torneos asignados (aunque el torneo no sea visible)."""
    assignments = db.scalars(
        select(Assignment).join(TournamentDay).where(Assignment.user_id == user.id).order_by(TournamentDay.date.desc())
    ).all()
    grouped: dict[int, dict] = {}
    for a in assignments:
        d = a.day
        t = d.tournament
        entry = grouped.setdefault(t.id, {**tournament_info(t), "days": []})
        record = next((r for r in d.match_records if r.user_id == user.id), None)
        crew = [
            {"name": x.user.full_name, "role": x.role, "me": x.user_id == user.id}
            for x in sorted(d.assignments, key=lambda x: (t.roles.index(x.role) if x.role in (t.roles or []) else 99, name_key(x.user)))
        ]
        entry["days"].append({
            **day_info(d),
            "role": a.role,
            "crew": crew,
            "refereed": record.refereed if record else None,
            "scored": record.scored if record else None,
        })
    result = list(grouped.values())
    for t in result:
        t["days"].sort(key=lambda x: x["date"])
    result.sort(key=lambda t: t["days"][0]["date"], reverse=True)
    return result


@router.get("/stats")
def my_stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    records = db.scalars(select(MatchRecord).where(MatchRecord.user_id == user.id)).all()
    return {
        "refereed": sum(r.refereed for r in records),
        "scored": sum(r.scored for r in records),
        "days_recorded": len(records),
        "assignments": db.query(Assignment).filter(Assignment.user_id == user.id).count(),
    }
