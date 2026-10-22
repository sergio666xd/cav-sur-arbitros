# Árbitros CAV-Sur

Aplicación web para gestionar las disponibilidades, asignaciones, partidos y ranking de los árbitros de voleibol de CAV-Sur.

- `backend/`: API en FastAPI + SQLAlchemy (PostgreSQL en Supabase; SQLite en local).
- `frontend/`: Next.js (App Router) + Tailwind, interfaz en español. Reenvía `/api/*` al backend, así el navegador solo ve un dominio.

## Roles

| Rol | Qué puede hacer |
| --- | --- |
| Árbitro | Marcar/quitar disponibilidad por franja, ver inscritos, ver torneos asignados con su rol y partidos, ver el ranking (solo puntos). |
| Administrador | Asignar árbitros (y roles Principal/Segundo/Planillero) por día, registrar partidos pitados/planillados, generar la clave de registro, ver el detalle de todos los árbitros. Crea y edita torneos solo si el Jefe le da permiso. Puede ser también árbitro. |
| Jefe | Todo lo anterior, más: calificar el desempeño, dar o quitar permisos, ver la edad, restablecer contraseñas. Va primero en el ranking, no marca disponibilidad y no se le registran partidos. |

## Reglas principales

- **Franjas.** En una misma fecha, las franjas de torneos que se superponen se combinan en un solo bloque; las que no se tocan se muestran por separado y el árbitro marca cada una. "Todo el día" cubre todas las franjas de esa fecha.
- **Información reservada.** Si el torneo no es visible, o ese día hay más de un torneo, el árbitro solo ve fecha, franja e inscritos/requeridos.
- **Cierre automático.** Desde las 00:00 (hora de Colombia) del día del torneo no se puede marcar ni quitar disponibilidad para ese día.
- **Ranking.** Suma de puntos de las calificaciones (Muy Malo 0, Malo 5, Regular 10, Bueno 25, Excelente 50). Empates: más partidos pitados y luego orden alfabético.
- **Clave de registro.** 6 caracteres, válida 24 h, solo una vigente a la vez, la pueden usar varios árbitros.
- **Seguridad.** El PIN de 4 dígitos se guarda con PBKDF2; la cuenta se bloquea 15 minutos tras 5 intentos fallidos.

## Desarrollo local

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.seed_chief --documento 12345678 --nombre Nombre --apellido Apellido --nacimiento 1990-01-01 --pin 1234
uvicorn app.main:app --reload --port 8000     # API en http://localhost:8000/api/docs
pytest                                        # pruebas

# Frontend (otra terminal)
cd frontend
npm install
npm run dev                                   # http://localhost:3000
```

Sin `DATABASE_URL`, el backend usa un archivo SQLite local (`backend/arbitros.db`).

## Despliegue (Supabase + Vercel)

1. **Supabase:** crea un proyecto y copia la cadena de conexión del *Transaction pooler* (puerto 6543) en Project Settings → Database.
2. **Backend en Vercel:** nuevo proyecto desde este repositorio con *Root Directory* = `backend` (Vercel detecta FastAPI por `index.py`). Variables de entorno: `DATABASE_URL` y `SECRET_KEY` (ver `backend/.env.example`). Las tablas se crean solas en el primer arranque.
3. **Frontend en Vercel:** otro proyecto desde el mismo repositorio con *Root Directory* = `frontend`. Variable de entorno: `BACKEND_URL` = URL del proyecto del backend.
4. **Primer Jefe:** desde tu computador, con la misma `DATABASE_URL` y `SECRET_KEY` exportadas, ejecuta `python -m app.seed_chief ...` dentro de `backend/`.
