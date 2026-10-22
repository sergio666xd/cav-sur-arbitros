from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from ..config import REGISTRATION_CODE_HOURS
from ..database import get_db
from ..deps import require_admin
from ..models import RegistrationCode, User
from ..schemas import CodeOut
from ..security import generate_code
from ..timeutil import utcnow

router = APIRouter(prefix="/codes", tags=["codes"])


def _active(db: Session) -> RegistrationCode | None:
    return db.scalar(
        select(RegistrationCode)
        .where(RegistrationCode.revoked.is_(False), RegistrationCode.expires_at > utcnow())
        .order_by(RegistrationCode.created_at.desc())
    )


def _out(c: RegistrationCode) -> CodeOut:
    return CodeOut(id=c.id, revoked=c.revoked, code=c.code, created_at=c.created_at, expires_at=c.expires_at,
                   created_by=c.created_by.full_name, uses=c.uses)


@router.get("/active", response_model=CodeOut | None)
def get_active(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    code = _active(db)
    return _out(code) if code else None


@router.post("", response_model=CodeOut, status_code=201)
def create_code(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if _active(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una clave vigente. Revócala o espera a que caduque.")
    now = utcnow()
    code = RegistrationCode(
        code=generate_code(), created_by_id=user.id, created_at=now,
        expires_at=now + timedelta(hours=REGISTRATION_CODE_HOURS),
    )
    db.add(code)
    db.commit()
    db.refresh(code)
    return _out(code)


@router.delete("/active", status_code=204)
def revoke_code(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    code = _active(db)
    if code:
        code.revoked = True
        db.commit()


def _inactive():
    return or_(RegistrationCode.revoked.is_(True), RegistrationCode.expires_at <= utcnow())


@router.get("/history", response_model=list[CodeOut])
def history(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Claves revocadas o caducadas, de la más reciente a la más antigua."""
    codes = db.scalars(select(RegistrationCode).where(_inactive()).order_by(RegistrationCode.created_at.desc())).all()
    return [_out(c) for c in codes]


@router.delete("/history", status_code=204)
def delete_history(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.execute(delete(RegistrationCode).where(_inactive()))
    db.commit()


@router.delete("/{code_id}", status_code=204)
def delete_code(code_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    code = db.get(RegistrationCode, code_id)
    if not code:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clave no encontrada.")
    if not code.revoked and code.expires_at > utcnow():
        raise HTTPException(status.HTTP_409_CONFLICT, "La clave está vigente. Revócala antes de eliminarla.")
    db.delete(code)
    db.commit()
