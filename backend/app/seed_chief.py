"""Crea (o actualiza) el usuario JEFE inicial.

Uso:
    python -m app.seed_chief --documento 12345678 --nombre Ana --apellido Pérez --nacimiento 1980-05-01 --pin 1234
"""
import argparse
from datetime import date

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import User
from .schemas import _check_pin, _clean_document
from .security import hash_pin


def main() -> None:
    p = argparse.ArgumentParser(description="Crear el JEFE inicial")
    p.add_argument("--documento", required=True)
    p.add_argument("--nombre", required=True)
    p.add_argument("--apellido", required=True)
    p.add_argument("--nacimiento", required=True, help="AAAA-MM-DD")
    p.add_argument("--pin", required=True, help="4 dígitos")
    a = p.parse_args()

    Base.metadata.create_all(bind=engine)
    doc = _clean_document(a.documento)
    pin = _check_pin(a.pin)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.document == doc))
        if not user:
            user = User(document=doc)
            db.add(user)
        user.first_name, user.last_name = a.nombre, a.apellido
        user.birth_date = date.fromisoformat(a.nacimiento)
        user.pin_hash = hash_pin(pin)
        user.is_chief = True
        user.is_admin = True
        user.is_referee = False
        user.active = True
        db.commit()
        print(f"JEFE listo: {user.full_name} (documento {doc})")


if __name__ == "__main__":
    main()
