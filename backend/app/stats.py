from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Assignment, MatchRecord, Rating, User


def match_totals(db: Session) -> dict[int, dict]:
    rows = db.execute(
        select(MatchRecord.user_id, func.sum(MatchRecord.refereed), func.sum(MatchRecord.scored),
               func.sum(func.coalesce(MatchRecord.other, 0)), func.count())
        .group_by(MatchRecord.user_id)
    ).all()
    return {uid: {"refereed": int(r or 0), "scored": int(s or 0), "other": int(o or 0), "days_recorded": n}
            for uid, r, s, o, n in rows}


def assignment_counts(db: Session) -> dict[int, int]:
    return dict(db.execute(select(Assignment.user_id, func.count()).group_by(Assignment.user_id)).all())


def points_totals(db: Session) -> dict[int, int]:
    """Puntos de cada usuario: los de ingreso más los de sus calificaciones (y descuentos)."""
    rated = dict(db.execute(select(Rating.user_id, func.sum(Rating.points)).group_by(Rating.user_id)).all())
    return {uid: (entry or 0) + int(rated.get(uid) or 0) for uid, entry in db.execute(select(User.id, User.entry_points)).all()}
