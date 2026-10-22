from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from .config import DATABASE_URL

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # En Vercel cada función es efímera y Supabase ya agrupa conexiones (pooler en el puerto 6543),
    # así que no mantenemos un pool propio ni sentencias preparadas (no las admite el modo transacción).
    engine = create_engine(DATABASE_URL, poolclass=NullPool, connect_args={"prepare_threshold": None})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
