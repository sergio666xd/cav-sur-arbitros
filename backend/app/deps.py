from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_token

_bearer = HTTPBearer(auto_error=False)


def session_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User:
    """Usuario de la sesión, aunque esté suspendido (solo para ver su perfil y el aviso)."""
    user_id = decode_token(creds.credentials) if creds else None
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión no válida. Vuelve a ingresar.")
    return user


def current_user(user: User = Depends(session_user)) -> User:
    # Un usuario suspendido puede ingresar, pero no usar nada más.
    if not user.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu cuenta está suspendida.")
    return user


def require_referee(user: User = Depends(current_user)) -> User:
    # El JEFE no marca disponibilidad, por eso aquí solo cuenta la marca de árbitro.
    if not user.is_referee or user.is_chief:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo los árbitros pueden hacer esto.")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Se requiere rol de administrador.")
    return user


def require_creator(user: User = Depends(current_user)) -> User:
    if not user.tournament_creator:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tienes permiso para crear o editar torneos.")
    return user


def require_chief(user: User = Depends(current_user)) -> User:
    if not user.chief_powers:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el Jefe puede hacer esto.")
    return user


def require_real_chief(user: User = Depends(current_user)) -> User:
    """Solo el Jefe de verdad (el rol system no): calificar."""
    if not user.is_chief:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el Jefe puede calificar.")
    return user
