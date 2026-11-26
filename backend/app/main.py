import logging

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from . import models  # noqa: F401  (registra las tablas)
from .bootstrap import ensure_initial_chief
from .config import CORS_ORIGINS
from .migrate import migrate
from .routers import auth, availability, catalog, codes, me, ratings, shirts, tournaments, users

log = logging.getLogger(__name__)
DB_DOWN = "No se pudo conectar con la base de datos. Intenta de nuevo en unos minutos."
_ready = False


def _prepare() -> bool:
    """Migra y crea el Jefe inicial. Si la base de datos no responde, la API sigue en pie y lo reintenta."""
    global _ready
    if not _ready:
        try:
            migrate()
            ensure_initial_chief()
            _ready = True
        except OperationalError:
            log.exception("La base de datos no responde")
    return _ready


_prepare()

app = FastAPI(title="CAV-Sur Árbitros", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
)


@app.middleware("http")
async def require_database(request: Request, call_next):
    if not _ready and not await run_in_threadpool(_prepare):
        return JSONResponse({"detail": DB_DOWN}, status_code=503)
    return await call_next(request)


@app.exception_handler(OperationalError)
async def database_down(request: Request, exc: OperationalError):
    log.exception("La base de datos no responde", exc_info=exc)
    return JSONResponse({"detail": DB_DOWN}, status_code=503)


for r in (auth, codes, users, tournaments, shirts, catalog, availability, me, ratings):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}
