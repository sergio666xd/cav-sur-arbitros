from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import Shirt, TournamentDay, User
from ..serializers import fold, shirt_info

router = APIRouter(tags=["shirts"])


class ShirtIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class DayShirtIn(BaseModel):
    shirt_id: int | None = None


@router.get("/shirts")
def list_shirts(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [shirt_info(s) for s in sorted(db.scalars(select(Shirt)).all(), key=lambda s: fold(s.name))]


@router.post("/shirts", status_code=201)
def create_shirt(data: ShirtIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    name = " ".join(data.name.split())
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escribe el nombre de la camiseta.")
    if any(fold(s.name) == fold(name) for s in db.scalars(select(Shirt)).all()):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una camiseta con ese nombre.")
    shirt = Shirt(name=name, color=data.color.lower())
    db.add(shirt)
    db.commit()
    return shirt_info(shirt)


@router.delete("/shirts/{shirt_id}", status_code=204)
def delete_shirt(shirt_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    shirt = db.get(Shirt, shirt_id)
    if not shirt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Camiseta no encontrada.")
    # Las franjas que la tenían quedan sin camiseta.
    db.execute(update(TournamentDay).where(TournamentDay.shirt_id == shirt_id).values(shirt_id=None))
    db.delete(shirt)
    db.commit()


@router.put("/tournament-days/{day_id}/shirt")
def set_day_shirt(day_id: int, data: DayShirtIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    day = db.get(TournamentDay, day_id)
    if not day:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Franja no encontrada.")
    if data.shirt_id is not None and not db.get(Shirt, data.shirt_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Camiseta no encontrada.")
    day.shirt_id = data.shirt_id
    db.commit()
    db.refresh(day)
    return {"shirt": shirt_info(day.shirt) if day.shirt else None}
