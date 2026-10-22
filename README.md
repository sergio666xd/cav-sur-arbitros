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

- **Torneos reutilizables.** Un torneo nunca se archiva: se le pueden añadir fechas nuevas en cualquier momento. Desde el día siguiente, cada fecha pasa a "Fechas anteriores" (filtrable y agrupable por torneo) y conserva sus asignaciones y partidos.
- **Lugar y categorías.** Se definen para todo el torneo y cada franja puede tener los suyos. Los lugares y categorías usados se guardan para autocompletar.
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
2. **Vercel:** importa este repositorio como un proyecto (framework Next.js, carpeta raíz). En Environment Variables añade `DATABASE_URL` y `SECRET_KEY` (ver `.env.example`). Vercel construye Next.js y crea la función de Python de `api/index.py` con `requirements.txt`. Las tablas (y las columnas nuevas de versiones posteriores) se crean solas al arrancar.
3. **Primer Jefe:** añade también en Vercel `INITIAL_CHIEF_DOCUMENT`, `INITIAL_CHIEF_PIN` (4 dígitos), `INITIAL_CHIEF_FIRST_NAME`, `INITIAL_CHIEF_LAST_NAME` e `INITIAL_CHIEF_BIRTH_DATE` (AAAA-MM-DD). Al arrancar, la app crea ese Jefe si todavía no existe ninguno; después puedes borrar esas variables. Alternativa: desde tu computador, con `DATABASE_URL` y `SECRET_KEY` exportadas, ejecuta en `backend/` `python -m app.seed_chief --documento ... --nombre ... --apellido ... --nacimiento AAAA-MM-DD --pin ....`

## Google Maps (opcional)

Con la variable `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` el campo "Lugar" sugiere direcciones de Google (además de los lugares guardados), tiene un botón "Mapa" para elegir el punto con un clic, y cada lugar muestra un botón "Ver mapa". Sin la clave todo funciona igual, con un enlace "Abrir en Google Maps".

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto (requiere cuenta de facturación; el uso de este tamaño suele quedar dentro del crédito gratuito mensual).
2. Habilita **Maps JavaScript API**, **Places API (New)**, **Maps Embed API** y **Geocoding API** (esta última convierte el punto elegido en el mapa en una dirección; sin ella se guardan las coordenadas).
3. En *Credenciales* crea una clave de API, restríngela a esas cuatro APIs y a los sitios web `cavsur.vercel.app/*` (con `/*` al final, para que sirva en todas las páginas; añade `cavsur-*.vercel.app/*` si quieres usarla en las vistas previas).
4. Añádela en Vercel como `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` y vuelve a desplegar (las variables `NEXT_PUBLIC_` se leen al compilar).
