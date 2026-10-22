from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registra las tablas)
from .config import CORS_ORIGINS
from .database import Base, engine
from .routers import auth, availability, codes, me, ratings, tournaments, users

Base.metadata.create_all(bind=engine)

app = FastAPI(title="CAV-Sur Árbitros", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
)

for r in (auth, codes, users, tournaments, availability, me, ratings):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}
