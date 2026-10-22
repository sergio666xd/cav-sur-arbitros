# Árbitros CAV-Sur

Aplicación web para gestionar las disponibilidades, asignaciones, partidos y ranking de los árbitros de voleibol de CAV-Sur.

Todo vive en un solo proyecto de Vercel:

- Raíz (`app/`, `components/`, `lib/`): Next.js (App Router) + Tailwind, interfaz en español.
- `backend/`: API en FastAPI + SQLAlchemy (PostgreSQL en Supabase; SQLite en local).
- `api/index.py`: función de Python de Vercel que sirve la API; `vercel.json` le envía todas las rutas `/api/*`.

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
# Una vez
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements-dev.txt
npm install
cd backend && python -m app.seed_chief --documento 12345678 --nombre Nombre --apellido Apellido --nacimiento 1990-01-01 --pin 1234 && cd ..

# Cada vez (dos terminales)
npm run dev:api     # FastAPI en http://localhost:8000 (docs en /api/docs)
npm run dev         # Next.js en http://localhost:3000, reenvía /api/* a FastAPI

npm run test:api    # pruebas del backend
```

Sin `DATABASE_URL`, el backend usa un archivo SQLite local (`backend/arbitros.db`).

## Despliegue (Supabase + Vercel, un solo proyecto)

1. **Supabase:** crea un proyecto y copia la cadena de conexión del *Transaction pooler* (puerto 6543) en Project Settings → Database.
2. **Vercel:** importa este repositorio como un proyecto (framework Next.js, carpeta raíz). En Environment Variables añade `DATABASE_URL` y `SECRET_KEY` (ver `.env.example`). Vercel construye Next.js y crea la función de Python de `api/index.py` con `requirements.txt`. Las tablas se crean solas en el primer arranque.
3. **Primer Jefe:** desde tu computador, con la misma `DATABASE_URL` y `SECRET_KEY` exportadas, ejecuta dentro de `backend/`: `python -m app.seed_chief --documento ... --nombre ... --apellido ... --nacimiento AAAA-MM-DD --pin ....`
