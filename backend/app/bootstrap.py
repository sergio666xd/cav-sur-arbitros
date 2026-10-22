"""Crea el JEFE inicial a partir de variables de entorno, solo si todavía no existe ningún Jefe.

Variables: INITIAL_CHIEF_DOCUMENT, INITIAL_CHIEF_PIN, INITIAL_CHIEF_FIRST_NAME,
INITIAL_CHIEF_LAST_NAME e INITIAL_CHIEF_BIRTH_DATE (AAAA-MM-DD).
"""
import logging
import os
from datetime import date

from sqlalchemy import select

from .database import SessionLocal
from .models import User
from .schemas import _check_pin, _clean_document
from .security import hash_pin

log = logging.getLogger(__name__)


def ensure_initial_chief() -> None:
    doc = os.getenv("INITIAL_CHIEF_DOCUMENT")
    pin = os.getenv("INITIAL_CHIEF_PIN")
    if not doc or not pin:
        return
    try:
        with SessionLocal() as db:
            if db.scalar(select(User.id).where(User.is_chief.is_(True)).limit(1)):
                return
            document = _clean_document(doc)
            user = db.scalar(select(User).where(User.document == document)) or User(document=document)
            user.first_name = os.getenv("INITIAL_CHIEF_FIRST_NAME", "Jefe")
            user.last_name = os.getenv("INITIAL_CHIEF_LAST_NAME", "CAV-Sur")
            user.birth_date = date.fromisoformat(os.getenv("INITIAL_CHIEF_BIRTH_DATE", "1990-01-01"))
            user.pin_hash = hash_pin(_check_pin(pin))
            user.is_chief = user.is_admin = user.can_create_tournaments = user.active = True
            user.is_referee = False
            db.add(user)
            db.commit()
    except Exception:  # un error aquí no debe tumbar la API
        log.exception("No se pudo crear el Jefe inicial")
