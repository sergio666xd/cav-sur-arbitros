import os
import sys
import tempfile
from datetime import date

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_pin  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.add(User(first_name="Jefa", last_name="Principal", document="10000000", birth_date=date(1980, 1, 1),
                    pin_hash=hash_pin("1111"), is_chief=True, is_admin=True, can_create_tournaments=True,
                    is_referee=False))
        db.commit()
    return TestClient(app)


def login(client, document, pin):
    r = client.post("/api/auth/login", json={"document": document, "pin": pin})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
