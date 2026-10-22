import os
from zoneinfo import ZoneInfo


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./arbitros.db")
    # Neon / Vercel entregan "postgres://" o "postgresql://"; SQLAlchemy necesita el driver explícito.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _database_url()
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me-only-for-local-use")
if not DATABASE_URL.startswith("sqlite") and SECRET_KEY.startswith("dev-secret"):
    raise RuntimeError("Configura la variable de entorno SECRET_KEY antes de usar una base de datos real.")
TOKEN_HOURS = int(os.getenv("TOKEN_HOURS", "168"))
APP_TIMEZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "America/Bogota"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
REGISTRATION_CODE_HOURS = 24
