from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user, require_chief, require_real_chief
from ..models import RATING_POINTS, Rating, RatingBatch, User
from ..schemas import RatingBatchIn
from ..serializers import name_key
from ..stats import match_totals, points_totals

router = APIRouter(tags=["ratings"])

SCORE_LABELS = {
    **{k: f"+{v}" for k, v in RATING_POINTS.items()},
    # Escala anterior, para el historial.
    "MUY_MALO": "Muy Malo", "MALO": "Malo", "REGULAR": "Regular", "BUENO": "Bueno", "EXCELENTE": "Excelente",
}


def _ratable(db: Session) -> list[User]:
    users = db.scalars(
        select(User).where(User.is_referee.is_(True), User.is_chief.is_(False), User.active.is_(True))
    ).all()
    return sorted(users, key=name_key)


@router.get("/ranking")
def ranking(_: User = Depends(current_user), db: Session = Depends(get_db)):
    """El JEFE va siempre primero; el resto por puntos, en empate por más partidos pitados y luego alfabéticamente."""
    points = points_totals(db)
    matches = match_totals(db)
    chiefs = db.scalars(select(User).where(User.is_chief.is_(True), User.active.is_(True))).all()
    referees = sorted(_ratable(db), key=lambda u: (
        -points.get(u.id, 0), -matches.get(u.id, {}).get("refereed", 0), *name_key(u)))
    rows = [{"position": i + 1, "name": c.full_name, "points": None, "is_chief": True,
             "refereed": None, "scored": None, "other": None} for i, c in enumerate(chiefs)]
    offset = len(rows)
    for i, u in enumerate(referees):
        m = matches.get(u.id, {})
        rows.append({"position": offset + i + 1, "name": u.full_name, "points": points.get(u.id, 0), "is_chief": False,
                     "refereed": m.get("refereed", 0), "scored": m.get("scored", 0), "other": m.get("other", 0)})
    return rows


@router.get("/ratings/scale")
def scale(_: User = Depends(current_user)):
    return [{"value": k, "label": SCORE_LABELS[k], "points": v} for k, v in RATING_POINTS.items()]


@router.get("/ratings/referees")
def ratable_referees(_: User = Depends(require_chief), db: Session = Depends(get_db)):
    points = points_totals(db)
    return [{"user_id": u.id, "name": u.full_name, "points": points.get(u.id, 0)} for u in _ratable(db)]


@router.post("/ratings", status_code=201)
def create_batch(data: RatingBatchIn, chief: User = Depends(require_real_chief), db: Session = Depends(get_db)):
    valid = {u.id for u in _ratable(db)}
    ids = [i.user_id for i in data.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un árbitro aparece dos veces.")
    if any(i not in valid for i in ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se puede calificar a árbitros activos.")
    batch = RatingBatch(created_by_id=chief.id)
    for item in data.items:
        batch.ratings.append(Rating(user_id=item.user_id, score=item.score, points=RATING_POINTS[item.score]))
    db.add(batch)
    db.commit()
    return {"id": batch.id, "count": len(batch.ratings)}


@router.get("/ratings/history")
def history(_: User = Depends(require_chief), db: Session = Depends(get_db)):
    batches = db.scalars(select(RatingBatch).order_by(RatingBatch.created_at.desc()).limit(50)).all()
    return [{
        "id": b.id,
        "created_at": b.created_at.isoformat(),
        "items": [
            {"name": r.user.full_name, "score": SCORE_LABELS.get(r.score, r.score), "points": r.points}
            for r in sorted(b.ratings, key=lambda r: name_key(r.user))
        ],
    } for b in batches]


@router.delete("/ratings/{batch_id}", status_code=204)
def delete_batch(batch_id: int, _: User = Depends(require_real_chief), db: Session = Depends(get_db)):
    b = db.get(RatingBatch, batch_id)
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calificación no encontrada.")
    db.delete(b)
    db.commit()
