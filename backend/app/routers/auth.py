from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import LOCK_MINUTES, MAX_FAILED_LOGINS
from ..database import get_db
from ..deps import current_user, session_user
from ..models import RegistrationCode, User
from ..schemas import ChangePinIn, LoginIn, Me, RegisterIn, TokenOut, WhatsappIn
from ..security import create_token, hash_pin, verify_pin
from ..serializers import me_out
from ..timeutil import utcnow

router = APIRouter(prefix="/auth", tags=["auth"])

_BAD_LOGIN = "Documento o contraseña incorrectos."


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.document == data.document))
    now = utcnow()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _BAD_LOGIN)
    if user.locked_until and user.locked_until > now:
        minutes = int((user.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Demasiados intentos fallidos. Intenta de nuevo en {minutes} minuto(s).",
        )
    if not verify_pin(data.pin, user.pin_hash):
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.failed_logins = 0
            user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _BAD_LOGIN)
    user.failed_logins = 0
    user.locked_until = None
    db.commit()
    return TokenOut(token=create_token(user.id), user=me_out(user))


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    now = utcnow()
    code = db.scalar(
        select(RegistrationCode).where(
            RegistrationCode.code == data.code,
            RegistrationCode.revoked.is_(False),
            RegistrationCode.expires_at > now,
        )
    )
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La clave de registro no es válida o ya caducó.")
    if db.scalar(select(User).where(User.document == data.document)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese número de documento.")
    user = User(
        first_name=data.first_name,
        last_name=data.last_name,
        document=data.document,
        birth_date=data.birth_date,
        whatsapp=data.whatsapp,
        pin_hash=hash_pin(data.pin),
        is_referee=True,
    )
    code.uses += 1
    db.add(user)
    db.commit()
    return TokenOut(token=create_token(user.id), user=me_out(user))


@router.get("/me", response_model=Me)
def me(user: User = Depends(session_user)):
    return me_out(user)


@router.get("/suspension")
def suspension(_: User = Depends(session_user), db: Session = Depends(get_db)):
    """Contacto del Jefe para el aviso que ve un usuario suspendido."""
    chiefs = db.scalars(select(User).where(User.is_chief.is_(True), User.active.is_(True)).order_by(User.id)).all()
    chief = next((c for c in chiefs if c.whatsapp), chiefs[0] if chiefs else None)
    return {"chief_name": chief.full_name if chief else None, "whatsapp": chief.whatsapp if chief else None}


@router.post("/change-pin", status_code=204)
def change_pin(data: ChangePinIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_pin(data.current_pin, user.pin_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña actual no es correcta.")
    user.pin_hash = hash_pin(data.new_pin)
    db.commit()


@router.put("/whatsapp", response_model=Me)
def set_whatsapp(data: WhatsappIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.whatsapp = data.whatsapp
    db.commit()
    return me_out(user)
