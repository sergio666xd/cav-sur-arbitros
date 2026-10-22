from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin, require_creator
from ..models import SavedValue, User
from ..serializers import fold

router = APIRouter(prefix="/catalog", tags=["catalog"])

Kind = Literal["location", "category"]


def remember(db: Session, kind: Kind, names: list[str | None]) -> None:
    """Guarda lugares o categorías usados para que aparezcan en el autocompletado."""
    for name in names:
        name = " ".join((name or "").split())
        if not name:
            continue
        key = fold(name)
        if not db.scalar(select(SavedValue.id).where(SavedValue.kind == kind, SavedValue.key == key)):
            db.add(SavedValue(kind=kind, name=name, key=key))
            db.flush()


@router.get("/{kind}")
def list_values(kind: Kind, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    values = db.scalars(select(SavedValue).where(SavedValue.kind == kind)).all()
    return [{"id": v.id, "name": v.name} for v in sorted(values, key=lambda v: v.key)]


@router.delete("/{kind}/{value_id}", status_code=204)
def delete_value(kind: Kind, value_id: int, _: User = Depends(require_creator), db: Session = Depends(get_db)):
    v = db.get(SavedValue, value_id)
    if not v or v.kind != kind:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No encontrado.")
    db.delete(v)
    db.commit()
