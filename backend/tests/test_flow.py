from collections import defaultdict
from datetime import date, time, timedelta

from app.database import SessionLocal
from app.models import Availability, TournamentDay, User
from app.slots import group_days
from app.timeutil import today_local

from .conftest import login


def _start_today(day_id):
    """Pasa la franja a hoy, ya comenzada (todo el día desde las 00:00)."""
    with SessionLocal() as db:
        d = db.get(TournamentDay, day_id)
        d.date, d.all_day, d.start_time = today_local(), True, time(0, 0)
        db.commit()


def _register(client, code, doc, first, last="Test"):
    r = client.post("/api/auth/register", json={
        "first_name": first, "last_name": last, "document": doc, "birth_date": "1995-06-15",
        "whatsapp": "300 123 4567", "code": code.lower(), "pin": "2222",
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _open_windows(client, chief):
    """Habilita una disponibilidad por cada bloque de franjas superpuestas, como hacía el sistema anterior.

    Oculta el nombre de los torneos si hay más de uno en la fecha.
    """
    by_date = defaultdict(list)
    with SessionLocal() as db:
        for d in db.query(TournamentDay).filter(TournamentDay.date >= today_local(), TournamentDay.hidden.isnot(True)).all():
            by_date[d.date].append(d)
        specs = []
        for date, days in by_date.items():
            single = len({d.tournament_id for d in days}) == 1
            for g in group_days(days):
                specs.append({
                    "date": date.isoformat(), "all_day": g.slot.all_day,
                    "hidden_tournament_ids": [] if single else list({d.tournament_id for d in g.days}),
                    "start_time": g.slot.start.strftime("%H:%M") if g.slot.start and not g.slot.all_day else None,
                    "end_time": g.slot.end.strftime("%H:%M") if g.slot.end and not g.slot.all_day else None,
                    "day_ids": [d.id for d in g.days],
                })
    for spec in specs:
        r = client.post("/api/availability-windows", headers=chief, json=spec)
        assert r.status_code == 201, r.text


def test_full_flow(client):
    chief = login(client, "10000000", "1111")

    # Clave de registro: solo una vigente a la vez y sirve para varios árbitros.
    r = client.post("/api/codes", headers=chief)
    assert r.status_code == 201
    code = r.json()["code"]
    assert len(code) == 6
    assert client.post("/api/codes", headers=chief).status_code == 409

    ref_a = _register(client, code, "20000001", "Ana", "Alvarez")
    ref_b = _register(client, code, "20000002", "Beto", "Bravo")
    ref_c = _register(client, code, "20000003", "Caro", "Castro")
    assert client.post("/api/auth/register", json={
        "first_name": "X", "last_name": "Y", "document": "20000001", "birth_date": "1995-06-15",
        "whatsapp": "3001234567", "code": code, "pin": "2222"}).status_code == 409

    # Torneo visible y torneo oculto especial el mismo día.
    tomorrow = today_local() + timedelta(days=1)
    later = today_local() + timedelta(days=5)
    r = client.post("/api/tournaments", headers=chief, json={
        "name": "Copa Sur", "location": "Coliseo", "categories": ["Sub-15", "Mayores"], "referees_required": 4,
        "is_visible": True, "days": [
            {"date": tomorrow.isoformat(), "start_time": "08:00", "end_time": "12:00"},
            {"date": later.isoformat(), "all_day": True, "start_time": "08:00", "referees_required": 6},
        ]})
    assert r.status_code == 201, r.text
    copa = r.json()["id"]
    r = client.post("/api/tournaments", headers=chief, json={
        "name": "Final Especial", "location": "Estadio", "referees_required": 3, "is_visible": False,
        "has_roles": True, "days": [{"date": tomorrow.isoformat(), "start_time": "11:00", "end_time": "18:00"}]})
    assert r.status_code == 201, r.text
    especial = r.json()["id"]
    _open_windows(client, chief)

    # Vista del árbitro: el día con dos torneos se agrupa.
    r = client.get("/api/availability", headers=ref_a)
    days = {d["date"]: d for d in r.json()}
    assert len(r.json()) == 2
    d1 = days[tomorrow.isoformat()]
    assert d1["tournaments"] == []
    assert d1["slot_label"] == "8:00 a. m. - 6:00 p. m."
    assert d1["required"] == 7
    d2 = days[later.isoformat()]
    assert d2["tournaments"][0]["name"] == "Copa Sur"
    assert d2["slot_label"] == "Todo el día"
    # Un administrador ve siempre el detalle, incluso de torneos ocultos.
    caro = next(u["id"] for u in client.get("/api/users", headers=chief).json() if u["first_name"] == "Caro")
    client.patch(f"/api/users/{caro}/roles", headers=chief, json={"is_admin": True})
    mine = {d["date"]: d for d in client.get("/api/availability", headers=ref_c).json()}
    assert [(x["name"], x["visible"]) for x in mine[tomorrow.isoformat()]["tournaments"]] == [
        ("Copa Sur", True), ("Final Especial", False)]
    client.patch(f"/api/users/{caro}/roles", headers=chief, json={"is_admin": False})

    for h in (ref_a, ref_b, ref_c):
        assert client.post(f"/api/availability/{d1['key']}", headers=h).status_code == 204
    r = client.get("/api/availability", headers=ref_a)
    assert {d["date"]: d for d in r.json()}[tomorrow.isoformat()]["registered"] == 3
    names = [x["name"] for x in client.get(f"/api/availability/{d1['key']}/referees", headers=ref_b).json()]
    assert names == ["Ana Alvarez", "Beto Bravo", "Caro Castro"]

    # El JEFE no marca disponibilidad.
    assert client.post(f"/api/availability/{d1['key']}", headers=chief).status_code == 403

    # Asignación con roles.
    detail = client.get(f"/api/tournaments/{especial}", headers=chief).json()
    day = detail["days"][0]
    ids = {c["name"]: c["user_id"] for c in day["candidates"]}
    r = client.put(f"/api/tournament-days/{day['id']}/assignments", headers=chief, json=[
        {"user_id": ids["Ana Alvarez"], "role": "Principal"},
        {"user_id": ids["Beto Bravo"], "role": "Principal"},
    ])
    assert r.status_code == 400
    r = client.put(f"/api/tournament-days/{day['id']}/assignments", headers=chief, json=[
        {"user_id": ids["Ana Alvarez"], "role": "Principal"},
        {"user_id": ids["Beto Bravo"], "role": "Segundo"},
        {"user_id": ids["Caro Castro"], "role": "Planillero"},
    ])
    assert r.status_code == 200, r.text
    # No se puede asignar a quien no marcó disponibilidad en esa fecha.
    copa_detail = client.get(f"/api/tournaments/{copa}", headers=chief).json()
    later_day = next(d for d in copa_detail["days"] if d["date"] == later.isoformat())
    r = client.put(f"/api/tournament-days/{later_day['id']}/assignments", headers=chief,
                   json=[{"user_id": ids["Ana Alvarez"]}])
    assert r.status_code == 400

    # Partidos: solo cuando la franja está finalizada.
    early = client.put(f"/api/tournament-days/{day['id']}/matches", headers=chief, json=[
        {"user_id": ids["Ana Alvarez"], "refereed": 4, "scored": 0}])
    assert early.status_code == 400
    # Solo se finaliza una franja que ya comenzó.
    assert client.put(f"/api/tournament-days/{day['id']}/finished", headers=chief, json={"finished": True}).status_code == 400
    _start_today(day["id"])
    r = client.put(f"/api/tournament-days/{day['id']}/finished", headers=chief, json={"finished": True})
    assert r.json()["finished"] and r.json()["can_reopen"]
    # Finalizada: ya no se cambia su asignación.
    assert client.put(f"/api/tournament-days/{day['id']}/assignments", headers=chief, json=[]).status_code == 400
    r = client.put(f"/api/tournament-days/{day['id']}/matches", headers=chief, json=[
        {"user_id": ids["Ana Alvarez"], "refereed": 4, "scored": 0},
        {"user_id": ids["Caro Castro"], "refereed": 0, "scored": 5},
    ])
    assert r.status_code == 200
    mine = client.get("/api/me/assignments", headers=ref_a).json()
    assert mine[0]["name"] == "Final Especial"
    assert mine[0]["days"][0]["role"] == "Principal"
    assert mine[0]["days"][0]["refereed"] == 4
    assert len(mine[0]["days"][0]["crew"]) == 3

    # Calificaciones y ranking.
    assert client.post("/api/ratings", headers=ref_a, json={"items": [{"user_id": ids["Ana Alvarez"], "score": "P20"}]}).status_code == 403
    r = client.post("/api/ratings", headers=chief, json={"items": [
        {"user_id": ids["Beto Bravo"], "score": "P50"},
        {"user_id": ids["Ana Alvarez"], "score": "P35"},
    ]})
    assert r.status_code == 201
    ranking = client.get("/api/ranking", headers=ref_c).json()
    assert [r["name"] for r in ranking] == ["Jefa Principal", "Beto Bravo", "Ana Alvarez", "Caro Castro"]
    assert ranking[1]["points"] == 50

    # Empate en puntos: gana quien tiene más partidos pitados (Caro 0 pitados vs Beto 0; Ana 4).
    client.post("/api/ratings", headers=chief, json={"items": [{"user_id": ids["Caro Castro"], "score": "P50"},
                                                                {"user_id": ids["Ana Alvarez"], "score": "P10"}]})
    client.post("/api/ratings", headers=chief, json={"items": [{"user_id": ids["Ana Alvarez"], "score": "P5"}]})
    # La escala anterior ya no se acepta.
    assert client.post("/api/ratings", headers=chief, json={"items": [{"user_id": ids["Ana Alvarez"], "score": "BUENO"}]}).status_code == 422
    assert [s["label"] for s in client.get("/api/ratings/scale", headers=chief).json()] == ["+5", "+10", "+20", "+35", "+50"]
    client.put(f"/api/tournament-days/{day['id']}/matches", headers=chief, json=[
        {"user_id": ids["Caro Castro"], "refereed": 1, "scored": 5}])
    ranking = client.get("/api/ranking", headers=ref_c).json()
    assert [r["name"] for r in ranking][1:] == ["Ana Alvarez", "Caro Castro", "Beto Bravo"]

    # Admin sin permiso de crear torneos.
    client.patch(f"/api/users/{ids['Ana Alvarez']}/roles", headers=chief, json={"is_admin": True})
    ref_a = login(client, "20000001", "2222")
    assert client.get("/api/tournaments", headers=ref_a).status_code == 200
    assert client.post("/api/tournaments", headers=ref_a, json={
        "name": "X", "location": "Y", "referees_required": 1, "days": [{"date": later.isoformat(), "all_day": True, "start_time": "08:00"}]
    }).status_code == 403
    users = client.get("/api/users", headers=ref_a).json()
    assert "age" not in users[0]
    assert "age" in client.get("/api/users", headers=chief).json()[0]


def test_closed_today_and_lockout(client):
    chief = login(client, "10000000", "1111")
    today = today_local()
    client.post("/api/tournaments", headers=chief, json={
        "name": "Hoy", "location": "X", "referees_required": 2, "days": [{"date": today.isoformat(), "all_day": True, "start_time": "08:00"}]})
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "30000001", "Dani")
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    assert client.post(f"/api/availability/{key}", headers=ref).status_code == 400
    assert client.get("/api/availability", headers=ref).json()[0]["open"] is False

    for _ in range(5):
        assert client.post("/api/auth/login", json={"document": "30000001", "pin": "9999"}).status_code == 401
    assert client.post("/api/auth/login", json={"document": "30000001", "pin": "2222"}).status_code == 429


def test_code_revoke_and_invalid(client):
    chief = login(client, "10000000", "1111")
    client.post("/api/codes", headers=chief)
    assert client.delete("/api/codes/active", headers=chief).status_code == 204
    assert client.get("/api/codes/active", headers=chief).json() is None
    r = client.post("/api/auth/register", json={
        "first_name": "A", "last_name": "B", "document": "40000001", "birth_date": "1990-01-01",
        "whatsapp": "3001234567", "code": "ZZZZZZ", "pin": "1234"})
    assert r.status_code == 400

    # Historial: las claves revocadas se pueden eliminar; la vigente no.
    client.post("/api/codes", headers=chief)
    client.delete("/api/codes/active", headers=chief)
    live = client.post("/api/codes", headers=chief).json()
    old = client.get("/api/codes/history", headers=chief).json()
    assert len(old) == 2 and all(c["revoked"] for c in old)
    assert client.delete(f"/api/codes/{live['id']}", headers=chief).status_code == 409
    assert client.delete(f"/api/codes/{old[0]['id']}", headers=chief).status_code == 204
    assert len(client.get("/api/codes/history", headers=chief).json()) == 1
    assert client.delete("/api/codes/history", headers=chief).status_code == 204
    assert client.get("/api/codes/history", headers=chief).json() == []
    assert client.get("/api/codes/active", headers=chief).json()["code"] == live["code"]


def test_separate_slots(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=2)).isoformat()
    for name, start, end in (("Mañana", "08:00", "11:00"), ("Tarde", "14:00", "18:00"), ("Tarde 2", "17:00", "20:00")):
        client.post("/api/tournaments", headers=chief, json={
            "name": name, "location": "X", "referees_required": 2, "days": [{"date": d, "start_time": start, "end_time": end}]})
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "50000001", "Eva")
    slots = client.get("/api/availability", headers=ref).json()
    assert [s["slot_label"] for s in slots] == ["8:00 a. m. - 11:00 a. m.", "2:00 p. m. - 8:00 p. m."]
    assert slots[1]["required"] == 4
    assert all(s["tournaments"] == [] for s in slots)
    assert client.post(f"/api/availability/{slots[0]['key']}", headers=ref).status_code == 204
    slots = client.get("/api/availability", headers=ref).json()
    assert [s["mine"] for s in slots] == [True, False]
    # Solo es candidata en el torneo de la mañana.
    ts = client.get("/api/tournaments", headers=chief).json()
    for t in ts:
        detail = client.get(f"/api/tournaments/{t['id']}", headers=chief).json()
        names = [c["name"] for c in detail["days"][0]["candidates"] if not c["is_chief"]]
        assert names == (["Eva Test"] if t["name"] == "Mañana" else [])


def test_initial_chief_from_env(client, monkeypatch):
    from app.bootstrap import ensure_initial_chief
    from app.database import SessionLocal
    from app.models import User

    # Ya hay un Jefe (el del fixture): no se crea otro.
    monkeypatch.setenv("INITIAL_CHIEF_DOCUMENT", "99999999")
    monkeypatch.setenv("INITIAL_CHIEF_PIN", "4321")
    ensure_initial_chief()
    assert client.post("/api/auth/login", json={"document": "99999999", "pin": "4321"}).status_code == 401

    # Sin Jefe, se crea con los datos del entorno.
    with SessionLocal() as db:
        db.query(User).delete()
        db.commit()
    monkeypatch.setenv("INITIAL_CHIEF_FIRST_NAME", "Sergio")
    ensure_initial_chief()
    r = client.post("/api/auth/login", json={"document": "99999999", "pin": "4321"})
    assert r.status_code == 200
    assert r.json()["user"]["is_chief"] is True


def test_per_slot_fields_catalog_and_past_days(client):
    chief = login(client, "10000000", "1111")
    past = (today_local() - timedelta(days=3)).isoformat()
    soon = (today_local() + timedelta(days=4)).isoformat()

    # Sin lugar global, cada franja necesita el suyo.
    bad = {"name": "Liga", "location": "", "referees_required": 2,
           "days": [{"date": soon, "start_time": "08:00", "end_time": "10:00"}]}
    assert client.post("/api/tournaments", headers=chief, json=bad).status_code == 422

    r = client.post("/api/tournaments", headers=chief, json={
        "name": "Liga", "location": "Coliseo Sur", "categories": ["Mayores"], "referees_required": 2,
        "days": [
            {"date": past, "all_day": True, "start_time": "08:00"},
            {"date": soon, "start_time": "08:00", "end_time": "10:00"},
            {"date": soon, "start_time": "14:00", "end_time": "16:00", "location": "Colegio Norte", "categories": ["Sub-13"]},
        ]})
    assert r.status_code == 201, r.text
    tid = r.json()["id"]

    # Franjas superpuestas del mismo torneo el mismo día no se permiten.
    overlap = {"name": "X", "location": "Y", "referees_required": 1, "days": [
        {"date": soon, "start_time": "08:00", "end_time": "10:00"}, {"date": soon, "start_time": "09:00", "end_time": "11:00"}]}
    assert client.post("/api/tournaments", headers=chief, json=overlap).status_code == 422

    # Catálogo para autocompletar.
    assert [v["name"] for v in client.get("/api/catalog/location", headers=chief).json()] == ["Colegio Norte", "Coliseo Sur"]
    assert [v["name"] for v in client.get("/api/catalog/category", headers=chief).json()] == ["Mayores", "Sub-13"]

    # El torneo sigue en la lista con sus próximas franjas y cuenta las pasadas.
    t = next(x for x in client.get("/api/tournaments", headers=chief).json() if x["id"] == tid)
    assert len(t["days"]) == 2 and t["past_count"] == 1
    afternoon = t["days"][1]
    assert afternoon["effective_location"] == "Colegio Norte" and afternoon["effective_categories"] == ["Sub-13"]
    assert t["days"][0]["effective_location"] == "Coliseo Sur"

    # Fechas anteriores.
    past_days = client.get(f"/api/tournament-days/past?tournament_id={tid}", headers=chief).json()
    assert [d["date"] for d in past_days] == [past]

    # Editar enviando solo las próximas franjas (y una nueva) conserva la pasada.
    days = [{"id": d["id"], "date": d["date"], "start_time": d["start_time"], "end_time": d["end_time"],
             "location": d["location"], "categories": d["categories"]} for d in t["days"]]
    days.append({"date": (today_local() + timedelta(days=10)).isoformat(), "all_day": True, "start_time": "08:00"})
    r = client.put(f"/api/tournaments/{tid}", headers=chief, json={
        "name": "Liga", "location": "Coliseo Sur", "categories": ["Mayores"], "referees_required": 2, "days": days})
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/tournaments/{tid}", headers=chief).json()
    assert len(detail["days"]) == 4
    assert sum(d["past"] for d in detail["days"]) == 1

    # El árbitro no ve el lugar en Disponibilidad, solo las categorías de cada franja.
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "60000001", "Fer")
    slots = [s for s in client.get("/api/availability", headers=ref).json() if s["date"] == soon]
    assert all("location" not in t for s in slots for t in s["tournaments"])
    assert [s["tournaments"][0]["categories"] for s in slots] == [["Mayores"], ["Sub-13"]]


def test_migration_adds_new_columns():
    from sqlalchemy import create_engine, inspect, text

    import app.migrate as m

    import tempfile, os
    path = os.path.join(tempfile.mkdtemp(), "old.db")
    old = create_engine(f"sqlite:///{path}")
    with old.begin() as c:
        c.execute(text("CREATE TABLE tournament_days (id INTEGER PRIMARY KEY, tournament_id INTEGER, date DATE)"))
    original = m.engine
    m.engine = old
    try:
        m.migrate()
    finally:
        m.engine = original
    cols = {c["name"] for c in inspect(old).get_columns("tournament_days")}
    assert {"location", "categories", "all_day"} <= cols


def test_assignment_board(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref_a = _register(client, code, "30000001", "Ana", "Alvarez")
    ref_b = _register(client, code, "30000002", "Beto", "Bravo")
    day = (today_local() + timedelta(days=2)).isoformat()
    t1 = client.post("/api/tournaments", headers=chief, json={
        "name": "Liga Norte", "location": "Coliseo", "referees_required": 2,
        "days": [{"date": day, "start_time": "08:00", "end_time": "12:00"}]}).json()["id"]
    t2 = client.post("/api/tournaments", headers=chief, json={
        "name": "Copa Roles", "location": "Estadio", "referees_required": 3, "has_roles": True,
        "days": [{"date": day, "start_time": "10:00", "end_time": "14:00"}]}).json()["id"]
    client.post("/api/tournaments", headers=chief, json={
        "name": "Nocturno", "location": "Cancha", "referees_required": 2,
        "days": [{"date": day, "start_time": "19:00", "end_time": "22:00"}]})
    _open_windows(client, chief)

    av = {d["slot_label"]: d for d in client.get("/api/availability", headers=ref_a).json()}
    client.post(f"/api/availability/{av['8:00 a. m. - 2:00 p. m.']['key']}", headers=ref_a)
    client.post(f"/api/availability/{av['8:00 a. m. - 2:00 p. m.']['key']}", headers=ref_b)

    assert client.get("/api/assignment-board", headers=ref_a).status_code == 403
    board = client.get("/api/assignment-board", headers=chief).json()
    assert board["date"] == day and board["dates"] == [day]
    assert [g["slot_label"] for g in board["groups"]] == ["8:00 a. m. - 2:00 p. m.", "7:00 p. m. - 10:00 p. m."]
    g = board["groups"][0]
    cols = {c["tournament"]: c for c in g["columns"]}
    assert [c["tournament"] for c in g["columns"]] == ["Liga Norte", "Copa Roles"]
    assert cols["Copa Roles"]["has_roles"] and "Principal" in cols["Copa Roles"]["roles"]
    rows = {r["name"]: r for r in g["rows"]}
    assert list(rows) == ["Jefa Principal", "Ana Alvarez", "Beto Bravo"]
    assert sorted(rows["Ana Alvarez"]["available_day_ids"]) == sorted(c["id"] for c in g["columns"])
    # La franja nocturna no tiene disponibles: solo aparece el JEFE.
    assert [r["name"] for r in board["groups"][1]["rows"]] == ["Jefa Principal"]

    a, b, jefe = rows["Ana Alvarez"]["user_id"], rows["Beto Bravo"]["user_id"], rows["Jefa Principal"]["user_id"]
    c1, c2 = cols["Liga Norte"]["id"], cols["Copa Roles"]["id"]
    noct = board["groups"][1]["columns"][0]["id"]
    # Si una franja falla, no se guarda ninguna.
    r = client.put("/api/assignment-board", headers=chief, json={"days": [
        {"day_id": c1, "items": [{"user_id": a}]},
        {"day_id": noct, "items": [{"user_id": b}]},
    ]})
    assert r.status_code == 400
    assert client.get("/api/assignment-board", headers=chief).json()["groups"][0]["rows"][1]["assigned"] == {}

    r = client.put("/api/assignment-board", headers=chief, json={"days": [
        {"day_id": c1, "items": [{"user_id": a}]},
        {"day_id": c2, "items": [{"user_id": b, "role": "Principal"}, {"user_id": jefe, "role": "Segundo"}]},
        {"day_id": noct, "items": [{"user_id": jefe}]},
    ]})
    assert r.status_code == 200, r.text
    g = client.get(f"/api/assignment-board?d={day}", headers=chief).json()["groups"][0]
    rows = {r["name"]: r for r in g["rows"]}
    assert rows["Ana Alvarez"]["assigned"] == {str(c1): None}
    assert rows["Beto Bravo"]["assigned"] == {str(c2): "Principal"}
    assert rows["Jefa Principal"]["assigned"] == {str(c2): "Segundo"}
    detail = client.get(f"/api/tournaments/{t2}", headers=chief).json()
    assert len(detail["days"][0]["assignments"]) == 2
    assert t1


def test_same_day_two_venues(client):
    chief = login(client, "10000000", "1111")
    day = (today_local() + timedelta(days=3)).isoformat()
    base = {"name": "Copa Sedes", "referees_required": 2}
    r = client.post("/api/tournaments", headers=chief, json={**base, "days": [
        {"date": day, "all_day": True, "start_time": "08:00", "location": "Colegio San José"},
        {"date": day, "all_day": True, "start_time": "08:00", "location": "Polideportivo Sur"},
    ]})
    assert r.status_code == 201, r.text
    detail = client.get(f"/api/tournaments/{r.json()['id']}", headers=chief).json()
    assert sorted(d["effective_location"] for d in detail["days"]) == ["Colegio San José", "Polideportivo Sur"]
    # En la misma sede sí se rechaza.
    r = client.post("/api/tournaments", headers=chief, json={**base, "location": "Coliseo", "days": [
        {"date": day, "all_day": True, "start_time": "08:00"}, {"date": day, "start_time": "08:00", "end_time": "10:00"}]})
    assert r.status_code == 422
    board = client.get(f"/api/assignment-board?d={day}", headers=chief).json()
    assert len(board["groups"]) == 1 and len(board["groups"][0]["columns"]) == 2


def test_tournament_venues(client):
    chief = login(client, "10000000", "1111")
    day = (today_local() + timedelta(days=4)).isoformat()
    venues = ["Colegio San José", "Polideportivo Sur"]
    base = {"name": "Copa Sedes", "referees_required": 2, "venues": venues}
    r = client.post("/api/tournaments", headers=chief, json={**base, "days": [
        {"date": day, "all_day": True, "start_time": "08:00", "location": venues[0]},
        {"date": day, "all_day": True, "start_time": "08:00", "location": venues[1]},
    ]})
    assert r.status_code == 201, r.text
    t = client.get(f"/api/tournaments/{r.json()['id']}", headers=chief).json()
    assert t["venues"] == venues and t["location"] == venues[0]
    assert [d["location"] for d in t["days"]] == venues
    # Con varias sedes hay que elegir la de cada franja, y debe ser una de la lista.
    assert client.post("/api/tournaments", headers=chief, json={**base, "days": [{"date": day, "all_day": True, "start_time": "08:00"}]}).status_code == 422
    assert client.post("/api/tournaments", headers=chief, json={**base, "days": [
        {"date": day, "all_day": True, "start_time": "08:00", "location": "Otra"}]}).status_code == 422
    # Con una sola sede se asigna sola.
    r = client.post("/api/tournaments", headers=chief, json={**base, "venues": ["Coliseo"], "days": [{"date": day, "all_day": True, "start_time": "08:00"}]})
    t = client.get(f"/api/tournaments/{r.json()['id']}", headers=chief).json()
    assert t["days"][0]["location"] == "Coliseo"
    names = [c["name"] for c in client.get("/api/catalog/location", headers=chief).json()]
    assert set(venues + ["Coliseo"]) <= set(names)


def test_matches_by_category(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "50000001", "Lu", "Lopez")
    day = (today_local() + timedelta(days=2)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={
        "name": "Copa Cat", "venues": ["Coliseo"], "categories": ["Mini", "Infantil"], "referees_required": 1,
        "days": [{"date": day, "all_day": True, "start_time": "08:00"}]}).json()["id"]
    _open_windows(client, chief)
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    client.post(f"/api/availability/{key}", headers=ref)
    d = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    uid = next(c["user_id"] for c in d["candidates"] if c["name"] == "Lu Lopez")
    client.put(f"/api/tournament-days/{d['id']}/assignments", headers=chief, json=[{"user_id": uid}])
    _start_today(d["id"])
    client.put(f"/api/tournament-days/{d['id']}/finished", headers=chief, json={"finished": True})
    bad = client.put(f"/api/tournament-days/{d['id']}/matches", headers=chief, json=[
        {"user_id": uid, "categories": [{"category": "Mayores", "refereed": 1}]}])
    assert bad.status_code == 400
    r = client.put(f"/api/tournament-days/{d['id']}/matches", headers=chief, json=[{"user_id": uid, "categories": [
        {"category": "Mini", "refereed": 2, "scored": 1}, {"category": "Infantil", "refereed": 3, "scored": 0}]}])
    assert r.status_code == 200, r.text
    a = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["assignments"][0]
    assert (a["refereed"], a["scored"]) == (5, 1)
    assert a["by_category"][0] == {"category": "Mini", "refereed": 2, "scored": 1, "other": 0}
    mine = client.get("/api/me/assignments", headers=ref).json()[0]["days"][0]
    assert mine["refereed"] == 5 and len(mine["by_category"]) == 2
    assert client.get("/api/me/stats", headers=ref).json()["refereed"] == 5
    client.put(f"/api/tournament-days/{d['id']}/matches", headers=chief, json=[{"user_id": uid, "categories": [
        {"category": "Mini", "other": 2}, {"category": "Infantil", "refereed": 1, "other": 1}]}])
    row = next(r for r in client.get("/api/ranking", headers=ref).json() if r["name"] == "Lu Lopez")
    assert (row["refereed"], row["scored"], row["other"]) == (1, 0, 3)


def test_availability_summary(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref_z = _register(client, code, "40000001", "Zoe", "Zapata")
    ref_a = _register(client, code, "40000002", "Ana", "Alvarez")
    d1 = (today_local() + timedelta(days=2)).isoformat()
    d2 = (today_local() + timedelta(days=3)).isoformat()
    for name, start, end in [("Liga Norte", "08:00", "12:00"), ("Copa Sur", "10:00", "14:00")]:
        client.post("/api/tournaments", headers=chief, json={
            "name": name, "location": "Coliseo", "referees_required": 2,
            "days": [{"date": d1, "start_time": start, "end_time": end}]})
    client.post("/api/tournaments", headers=chief, json={
        "name": "Solo Visible", "location": "Estadio, Calle 1", "referees_required": 3,
        "days": [{"date": d2, "all_day": True, "start_time": "08:00"}]})
    _open_windows(client, chief)

    av = {(d["date"], d["slot_label"]): d for d in client.get("/api/availability", headers=ref_z).json()}
    for ref in (ref_z, ref_a):
        client.post(f"/api/availability/{av[(d1, '8:00 a. m. - 2:00 p. m.')]['key']}", headers=ref)
    for ref in (ref_a, ref_z):
        client.post(f"/api/availability/{av[(d2, 'Todo el día')]['key']}", headers=ref)

    rows = client.get("/api/availability/summary", headers=chief).json()
    assert [(r["date"], r["slot_label"]) for r in rows] == [(d1, "8:00 a. m. - 2:00 p. m."), (d2, "Todo el día")]
    # Franjas superpuestas se combinan; con los nombres ocultos solo se dice cuántos torneos son.
    assert rows[0]["required"] == 4 and rows[0]["tournament"] == {"name": "2 torneos"}
    assert [e["name"] for e in rows[0]["entries"]] == ["Zoe Zapata", "Ana Alvarez"]  # orden de registro, no alfabético
    assert rows[1]["tournament"] == {"name": "Solo Visible"}
    assert [e["name"] for e in rows[1]["entries"]] == ["Ana Alvarez", "Zoe Zapata"]
    assert len(client.get(f"/api/availability/summary?d={d2}", headers=chief).json()) == 1
    assert client.get("/api/availability/summary", headers=ref_a).status_code == 403


def test_all_day_requires_start_time(client):
    chief = login(client, "10000000", "1111")
    later = (today_local() + timedelta(days=5)).isoformat()
    r = client.post("/api/tournaments", headers=chief, json={
        "name": "Sin hora", "location": "Coliseo", "referees_required": 1, "days": [{"date": later, "all_day": True}]})
    assert r.status_code == 422
    r = client.post("/api/tournaments", headers=chief, json={
        "name": "Con hora", "location": "Coliseo", "referees_required": 1,
        "days": [{"date": later, "all_day": True, "start_time": "07:30", "end_time": "12:00"}]})
    assert r.status_code == 201, r.text
    day = client.get(f"/api/tournaments/{r.json()['id']}", headers=chief).json()["days"][0]
    assert (day["start_time"], day["end_time"], day["slot_label"]) == ("07:30", None, "Todo el día desde las 7:30 a. m.")


def test_slot_without_end_time(client):
    # Sin hora de fin es una hora de citación: la franja cuenta hasta las 23:59.
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=3)).isoformat()
    for name, start, end in (("Mañana", "08:00", "10:00"), ("Citación", "10:00", None), ("Noche", "19:00", "21:00")):
        r = client.post("/api/tournaments", headers=chief, json={
            "name": name, "location": "X", "referees_required": 1, "days": [{"date": d, "start_time": start, "end_time": end}]})
        assert r.status_code == 201, r.text
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "60000001", "Fabi")
    slots = client.get("/api/availability", headers=ref).json()
    # 08:00-10:00 solo se toca en el borde con la citación; la de la noche queda dentro de ella.
    assert [s["slot_label"] for s in slots] == ["8:00 a. m. - 10:00 a. m.", "Desde las 10:00 a. m."]
    assert slots[1]["required"] == 2
    # Dos franjas del mismo torneo en la misma sede: la abierta choca con cualquiera posterior.
    r = client.post("/api/tournaments", headers=chief, json={
        "name": "Choque", "location": "X", "referees_required": 1,
        "days": [{"date": d, "start_time": "08:00"}, {"date": d, "start_time": "20:00", "end_time": "22:00"}]})
    assert r.status_code == 422


def test_hidden_tournament_shows_only_name(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    client.post("/api/tournaments", headers=chief, json={
        "name": "Copa Secreta", "location": "Coliseo Norte, Calle 1", "categories": ["mini"], "referees_required": 1,
        "is_visible": False, "days": [{"date": d, "start_time": "09:00"}]})
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "70000001", "Gabi")
    slot = client.get("/api/availability", headers=ref).json()[0]
    assert slot["tournaments"] == [{"name": "Copa Secreta", "categories": [], "visible": False, "name_hidden": False, "required": 1}]
    rows = client.get(f"/api/availability/summary?d={d}", headers=chief).json()
    assert rows[0]["tournament"] == {"name": "Copa Secreta"}


def test_editing_slot_keeps_assignment(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 2,
        "days": [{"date": d, "start_time": "09:00", "end_time": "12:00"}]}).json()["id"]
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "80000001", "Hugo")
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    assert client.post(f"/api/availability/{key}", headers=ref).status_code == 204
    day_id = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["id"]
    hugo = next(c["user_id"] for c in client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["candidates"]
                if c["name"].startswith("Hugo"))
    assert client.put(f"/api/tournament-days/{day_id}/assignments", headers=chief, json=[{"user_id": hugo}]).status_code == 200
    later = (today_local() + timedelta(days=5)).isoformat()
    # Cambian hora, sede y fecha: la asignación se conserva; la inscripción sigue en su disponibilidad.
    r = client.put(f"/api/tournaments/{tid}", headers=chief, json={
        "name": "T", "venues": ["A", "B"], "referees_required": 2,
        "days": [{"id": day_id, "date": later, "start_time": "10:00", "location": "B"}]})
    assert r.status_code == 200, r.text
    assert [(s["date"], s["mine"]) for s in client.get("/api/availability", headers=ref).json()] == [(d, True)]
    day = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    assert [a["user_id"] for a in day["assignments"]] == [hugo]
    assert day["has_window"] is False and day["candidates"][0]["is_chief"] and len(day["candidates"]) == 1


def test_required_can_be_hidden(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 3,
        "show_required": False, "days": [{"date": d, "start_time": "09:00"}]}).json()["id"]
    _open_windows(client, chief)
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["show_required"] is False
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "90000001", "Iris")
    slot = client.get("/api/availability", headers=ref).json()[0]
    assert (slot["required"], slot["registered"], slot["tournaments"][0]["required"]) == (None, 0, None)
    # Sin ningún torneo a la vista se muestra el total, aunque el torneo oculte sus requeridos.
    w = next(x for x in client.get("/api/availability-windows", headers=chief).json() if x["id"] == slot["key"])
    spec = {"date": d, "start_time": "09:00", "day_ids": [x["id"] for x in w["days"]], "hidden_tournament_ids": [tid]}
    assert client.put(f"/api/availability-windows/{w['id']}", headers=chief, json=spec).status_code == 200
    slot = next(x for x in client.get("/api/availability", headers=ref).json() if x["key"] == w["id"])
    assert (slot["required"], slot["tournaments"]) == (3, [])


def test_shirts(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 1,
        "days": [{"date": d, "start_time": "09:00"}]}).json()["id"]
    day_id = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["id"]
    r = client.post("/api/shirts", headers=chief, json={"name": " Naranja ", "color": "#F65A03"})
    assert r.status_code == 201, r.text
    shirt = r.json()
    assert shirt == {"id": shirt["id"], "name": "Naranja", "color": "#f65a03"}
    assert client.post("/api/shirts", headers=chief, json={"name": "naranja", "color": "#000000"}).status_code == 409
    assert client.post("/api/shirts", headers=chief, json={"name": "X", "color": "rojo"}).status_code == 422
    assert client.put(f"/api/tournament-days/{day_id}/shirt", headers=chief, json={"shirt_id": shirt["id"]}).status_code == 200
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["shirt"]["name"] == "Naranja"
    # Editar el torneo conserva la camiseta de la franja.
    assert client.put(f"/api/tournaments/{tid}", headers=chief, json={"name": "T", "location": "A", "referees_required": 1,
        "days": [{"id": day_id, "date": d, "start_time": "10:00"}]}).status_code == 200
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["shirt"]["name"] == "Naranja"
    # Al borrar la camiseta, la franja queda sin camiseta.
    assert client.delete(f"/api/shirts/{shirt['id']}", headers=chief).status_code == 204
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["shirt"] is None


def test_confirm_assignment(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 1,
        "days": [{"date": d, "start_time": "09:00"}]}).json()["id"]
    _open_windows(client, chief)
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "91000001", "Juan")
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    assert client.post(f"/api/availability/{key}", headers=ref).status_code == 204
    day = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    juan = next(c["user_id"] for c in day["candidates"] if c["name"].startswith("Juan"))
    assert client.get("/api/me/pending-confirmations", headers=ref).json() == {"count": 0}
    client.put(f"/api/tournament-days/{day['id']}/assignments", headers=chief, json=[{"user_id": juan}])
    assert client.get("/api/me/pending-confirmations", headers=ref).json() == {"count": 1}
    assert client.get("/api/me/assignments", headers=ref).json()[0]["days"][0]["confirmed"] is False
    assert client.post(f"/api/me/assignments/{day['id']}/confirm", headers=ref).status_code == 200
    assert client.get("/api/me/pending-confirmations", headers=ref).json() == {"count": 0}
    assert client.get("/api/me/assignments", headers=ref).json()[0]["days"][0]["confirmed"] is True
    # Volver a guardar la asignación conserva la confirmación.
    client.put(f"/api/tournament-days/{day['id']}/assignments", headers=chief, json=[{"user_id": juan}])
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["assignments"][0]["confirmed"] is True
    # No se puede confirmar una franja sin asignación.
    assert client.post(f"/api/me/assignments/{day['id']}/confirm", headers=chief).status_code == 404


def test_day_specification(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 1,
        "days": [{"date": d, "start_time": "09:00", "specification": "  Final,   cancha 2 "}]}).json()["id"]
    day = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    assert day["specification"] == "Final, cancha 2"
    client.put(f"/api/tournaments/{tid}", headers=chief, json={"name": "T", "location": "A", "referees_required": 1,
        "days": [{"id": day["id"], "date": d, "start_time": "09:00", "specification": ""}]})
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["specification"] is None


def test_whatsapp_is_cleaned(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    base = {"first_name": "Wa", "last_name": "Test", "birth_date": "1995-06-15", "code": code, "pin": "2222"}
    r = client.post("/api/auth/register", json={**base, "document": "50000001", "whatsapp": "+57 310 555-1234"})
    assert r.status_code == 201, r.text
    assert r.json()["user"]["whatsapp"] == "3105551234"
    r = client.post("/api/auth/register", json={**base, "document": "50000002", "whatsapp": "12345"})
    assert r.status_code == 422
    assert "WhatsApp" in r.text
    ref = {"Authorization": f"Bearer {client.post('/api/auth/register', json={**base, 'document': '50000003', 'whatsapp': '0057 3209998877'}).json()['token']}"}
    assert client.get("/api/auth/me", headers=ref).json()["whatsapp"] == "3209998877"
    r = client.put("/api/auth/whatsapp", headers=ref, json={"whatsapp": "(311) 222 3333"})
    assert r.status_code == 200 and r.json()["whatsapp"] == "3112223333"
    uid = r.json()["id"]
    assert client.get(f"/api/users/{uid}", headers=chief).json()["whatsapp"] == "3112223333"


def test_my_detail(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "60000001", "Pepe")
    r = client.get("/api/me/detail", headers=ref)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["assignments"] == [] and d["ratings"] == [] and d["points"] == 0 and d["age"] > 0
    uid = client.get("/api/auth/me", headers=ref).json()["id"]
    assert client.get(f"/api/users/{uid}", headers=ref).status_code == 403


def test_finish_and_reopen_day(client):
    chief = login(client, "10000000", "1111")
    later = (today_local() + timedelta(days=3)).isoformat()
    past = (today_local() - timedelta(days=1)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={
        "name": "Copa Fin", "venues": ["Coliseo"], "referees_required": 1,
        "days": [{"date": later, "all_day": True, "start_time": "08:00"}]}).json()["id"]
    d = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    assert not d["finished"] and not d["started"]
    assert all(x["id"] != d["id"] for x in client.get("/api/tournament-days/past", headers=chief).json())
    _start_today(d["id"])
    board = client.get("/api/assignment-board", headers=chief).json()
    assert any(c["id"] == d["id"] for g in board["groups"] for c in g["columns"])
    r = client.put(f"/api/tournament-days/{d['id']}/finished", headers=chief, json={"finished": True})
    assert r.status_code == 200 and r.json()["finished"]
    # Aparece en la lista para registrar partidos aunque la fecha no haya pasado, y sale del tablero de asignación.
    assert any(x["id"] == d["id"] for x in client.get("/api/tournament-days/past", headers=chief).json())
    board = client.get("/api/assignment-board", headers=chief).json()
    assert all(c["id"] != d["id"] for g in board["groups"] for c in g["columns"])
    r = client.put(f"/api/tournament-days/{d['id']}/finished", headers=chief, json={"finished": False})
    assert r.status_code == 200 and not r.json()["finished"]
    # Una franja que ya terminó por fecha no se puede reabrir.
    with SessionLocal() as db:
        db.get(TournamentDay, d["id"]).date = date.fromisoformat(past)
        db.commit()
    assert client.put(f"/api/tournament-days/{d['id']}/finished", headers=chief, json={"finished": False}).status_code == 400


def test_suspend_and_delete_user(client):
    chief = login(client, "10000000", "1111")
    client.put("/api/auth/whatsapp", headers=chief, json={"whatsapp": "3009998877"})
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "70000001", "Susi")
    uid = client.get("/api/auth/me", headers=ref).json()["id"]

    # Suspendido: puede ingresar y ver su perfil y el contacto del Jefe, pero nada más.
    assert client.patch(f"/api/users/{uid}/roles", headers=chief, json={"active": False}).status_code == 200
    ref = login(client, "70000001", "2222")
    me = client.get("/api/auth/me", headers=ref).json()
    assert me["active"] is False
    contact = client.get("/api/auth/suspension", headers=ref).json()
    assert contact == {"chief_name": "Jefa", "whatsapp": "3009998877"}
    r = client.get("/api/availability", headers=ref)
    assert r.status_code == 403 and "suspendida" in r.json()["detail"]
    client.patch(f"/api/users/{uid}/roles", headers=chief, json={"active": True})
    assert client.get("/api/availability", headers=ref).status_code == 200

    # Eliminar: solo el Jefe, nunca al Jefe.
    tid = client.post("/api/tournaments", headers=chief, json={
        "name": "Copa Borrar", "venues": ["Coliseo"], "referees_required": 1,
        "days": [{"date": (today_local() + timedelta(days=3)).isoformat(), "all_day": True, "start_time": "08:00"}]}).json()["id"]
    _open_windows(client, chief)
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    client.post(f"/api/availability/{key}", headers=ref)
    d = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    client.put(f"/api/tournament-days/{d['id']}/assignments", headers=chief, json=[{"user_id": uid}])
    client.post("/api/ratings", headers=chief, json={"items": [{"user_id": uid, "score": "P20"}]})
    chief_id = client.get("/api/auth/me", headers=chief).json()["id"]
    assert client.delete(f"/api/users/{chief_id}", headers=chief).status_code == 400
    assert client.delete(f"/api/users/{uid}", headers=ref).status_code == 403
    assert client.delete(f"/api/users/{uid}", headers=chief).status_code == 204
    assert client.get(f"/api/users/{uid}", headers=chief).status_code == 404
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["assignments"] == []
    assert client.get("/api/auth/me", headers=ref).status_code == 401


def test_system_role(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    sys_h = _register(client, code, "80000001", "Sys", "Tema")
    sid = client.get("/api/auth/me", headers=sys_h).json()["id"]
    # El rol system solo se pone en la base de datos; la API no lo acepta.
    client.patch(f"/api/users/{sid}/roles", headers=chief, json={"is_system": True})
    assert client.get("/api/auth/me", headers=sys_h).json()["perm_chief"] is False
    with SessionLocal() as db:
        u = db.get(User, sid)
        u.is_system, u.is_referee = True, False
        db.commit()

    # Tiene todos los permisos del Jefe.
    me = client.get("/api/auth/me", headers=sys_h).json()
    assert me["perm_chief"] and me["perm_admin"] and me["perm_create_tournaments"] and not me["is_chief"]
    assert client.get("/api/ratings/history", headers=sys_h).status_code == 200
    # Pero no califica ni anula calificaciones: solo las ve.
    assert client.post("/api/ratings", headers=sys_h, json={"items": []}).status_code == 403
    assert client.delete("/api/ratings/1", headers=sys_h).status_code == 403

    # Sin rol de árbitro no aparece en la lista; el Jefe no lo puede modificar.
    assert all(u["id"] != sid for u in client.get("/api/users", headers=chief).json())
    assert client.get(f"/api/users/{sid}", headers=chief).status_code == 404
    assert client.patch(f"/api/users/{sid}/roles", headers=chief, json={"active": False}).status_code == 400
    assert client.post(f"/api/users/{sid}/reset-pin", headers=chief, json={"new_pin": "9999"}).status_code == 400
    assert client.delete(f"/api/users/{sid}", headers=chief).status_code == 400

    # Con rol de árbitro aparece como un árbitro más; solo quien tiene poderes de Jefe ve el rol.
    with SessionLocal() as db:
        db.get(User, sid).is_referee = True
        db.commit()
    row = next(u for u in client.get("/api/users", headers=chief).json() if u["id"] == sid)
    assert row["is_system"] is True and row["is_chief"] is False and row["points"] == 0
    client.patch(f"/api/users/{sid}/roles", headers=sys_h, json={"is_admin": True})  # system puede consigo
    admin_ref = _register(client, code, "80000002", "Ad", "Min")
    aid = client.get("/api/auth/me", headers=admin_ref).json()["id"]
    client.patch(f"/api/users/{aid}/roles", headers=chief, json={"is_admin": True})
    row = next(u for u in client.get("/api/users", headers=admin_ref).json() if u["id"] == sid)
    assert "is_system" not in row
    assert any(r["name"] == "Sys Tema" for r in client.get("/api/ranking", headers=admin_ref).json())


def test_system_suspends_deletes_and_chief_transfer(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    sys_h = _register(client, code, "90000001", "Sys", "Tema")
    a = _register(client, code, "90000002", "Ana", "Uno")
    _register(client, code, "90000003", "Beto", "Dos")
    ids = {u["document"]: u["id"] for u in client.get("/api/users", headers=chief).json()}
    with SessionLocal() as db:
        db.get(User, ids["90000001"]).is_system = True
        db.commit()
    # system suspende y elimina usuarios, pero no al Jefe.
    assert client.patch(f"/api/users/{ids['90000002']}/roles", headers=sys_h, json={"active": False}).status_code == 200
    assert client.patch(f"/api/users/{ids['90000002']}/roles", headers=sys_h, json={"active": True}).status_code == 200
    assert client.delete(f"/api/users/{ids['90000003']}", headers=sys_h).status_code == 204
    assert client.delete(f"/api/users/{ids['10000000']}", headers=sys_h).status_code == 400
    # Transferir el rol de Jefe: solo el Jefe, y queda uno solo.
    assert client.post(f"/api/users/{ids['90000002']}/transfer-chief", headers=sys_h).status_code == 403
    assert client.post(f"/api/users/{ids['90000001']}/transfer-chief", headers=chief).status_code == 400
    r = client.post(f"/api/users/{ids['90000002']}/transfer-chief", headers=chief)
    assert r.status_code == 200 and r.json()["is_chief"]
    old = client.get("/api/auth/me", headers=chief).json()
    assert not old["is_chief"] and old["is_admin"] and not old["perm_chief"]
    assert client.get("/api/auth/me", headers=a).json()["perm_chief"]
    chiefs = [u for u in client.get("/api/users", headers=a).json() if u["is_chief"]]
    assert [c["document"] for c in chiefs] == ["90000002"]


def test_hidden_slot(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref_a = _register(client, code, "40000001", "Ana", "Alvarez")
    _register(client, code, "40000002", "Beto", "Bravo")
    day = (today_local() + timedelta(days=3)).isoformat()
    t = client.post("/api/tournaments", headers=chief, json={
        "name": "Evento privado", "location": "Club", "referees_required": 2,
        "days": [{"date": day, "start_time": "09:00", "end_time": "12:00", "hidden": True}]}).json()["id"]
    detail = client.get(f"/api/tournaments/{t}", headers=chief).json()
    d = detail["days"][0]
    assert d["hidden"] is True

    # No aparece en Disponibilidad ni se puede marcar.
    assert not any(a["date"] == day and a["start_time"] == "09:00" for a in client.get("/api/availability", headers=ref_a).json())
    assert client.post(f"/api/availability/{d['id']}", headers=ref_a).status_code == 404
    assert not any(a["start_time"] == "09:00" for a in client.get(f"/api/availability/summary?d={day}", headers=chief).json())

    # Cualquier árbitro es candidato y se puede asignar sin disponibilidad.
    names = [c["name"] for c in d["candidates"]]
    assert "Ana Alvarez" in names and "Beto Bravo" in names
    ids = {c["name"]: c["user_id"] for c in d["candidates"]}
    r = client.put(f"/api/tournament-days/{d['id']}/assignments", headers=chief,
                   json=[{"user_id": ids["Ana Alvarez"]}, {"user_id": ids["Beto Bravo"]}])
    assert r.status_code == 200, r.text
    board = client.get(f"/api/assignment-board?d={day}", headers=chief).json()
    g = next(g for g in board["groups"] if any(c["id"] == d["id"] for c in g["columns"]))
    rows = {r["name"]: r for r in g["rows"]}
    assert d["id"] in rows["Beto Bravo"]["available_day_ids"]
    assert rows["Ana Alvarez"]["assigned"] == {str(d["id"]): None}
    # El árbitro asignado la ve en Mis torneos.
    assert any(x["name"] == "Evento privado" for x in client.get("/api/me/assignments", headers=ref_a).json())

    # Al quitar la marca de oculta vuelve a exigir disponibilidad.
    r = client.put(f"/api/tournaments/{t}", headers=chief, json={
        "name": "Evento privado", "location": "Club", "referees_required": 2,
        "days": [{"id": d["id"], "date": day, "start_time": "09:00", "end_time": "12:00"}]})
    assert r.status_code == 200, r.text
    _open_windows(client, chief)
    assert any(a["date"] == day and a["start_time"] == "09:00" for a in client.get("/api/availability", headers=ref_a).json())
    r = client.put(f"/api/tournament-days/{d['id']}/assignments", headers=chief, json=[{"user_id": ids["Ana Alvarez"]}])
    assert r.status_code == 400


def test_availability_windows(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    ana = _register(client, code, "93000001", "Ana", "Alvarez")
    beto = _register(client, code, "93000002", "Beto", "Bravo")
    d = (today_local() + timedelta(days=6)).isoformat()
    t1 = client.post("/api/tournaments", headers=chief, json={"name": "Liga", "location": "A", "referees_required": 2,
        "days": [{"date": d, "start_time": "08:00", "end_time": "12:00"}]}).json()["id"]
    t2 = client.post("/api/tournaments", headers=chief, json={"name": "Copa", "location": "B", "referees_required": 3,
        "days": [{"date": d, "start_time": "10:00", "end_time": "13:00"}, {"date": d, "start_time": "15:00", "end_time": "18:00"}]}).json()["id"]
    liga = client.get(f"/api/tournaments/{t1}", headers=chief).json()["days"][0]
    copa_m, copa_t = client.get(f"/api/tournaments/{t2}", headers=chief).json()["days"]
    assert liga["has_window"] is False

    # Sin disponibilidades habilitadas, el árbitro no ve nada y nadie es candidato.
    assert client.get("/api/availability", headers=ana).json() == []
    slots = client.get(f"/api/availability-windows/slots?d={d}", headers=chief).json()
    assert [(s["tournament"], s["slot_label"]) for s in slots] == [
        ("Liga", "8:00 a. m. - 12:00 p. m."), ("Copa", "10:00 a. m. - 1:00 p. m."), ("Copa", "3:00 p. m. - 6:00 p. m.")]
    assert client.get(f"/api/availability-windows/slots?d={d}", headers=ana).status_code == 403

    # Una franja que no cabe en el horario se rechaza.
    morning = {"date": d, "start_time": "08:00", "end_time": "12:00", "day_ids": [liga["id"], copa_m["id"]],
              "hidden_tournament_ids": [t2, 999999]}
    assert client.post("/api/availability-windows", headers=chief, json=morning).status_code == 400
    morning["end_time"] = "13:00"
    r = client.post("/api/availability-windows", headers=chief, json=morning)
    assert r.status_code == 201, r.text
    w1 = r.json()
    assert (w1["slot_label"], w1["required"], [x["tournament"] for x in w1["days"]]) == ("8:00 a. m. - 1:00 p. m.", 5, ["Liga", "Copa"])
    # Solo se guarda el nombre oculto de torneos que están en la disponibilidad.
    assert w1["hidden_tournament_ids"] == [t2]
    w2 = client.post("/api/availability-windows", headers=chief, json={
        "date": d, "all_day": True, "day_ids": [copa_t["id"]]}).json()
    assert w2["slot_label"] == "Todo el día" and w2["required"] == 3

    view = client.get("/api/availability", headers=ana).json()
    # Los requeridos van al lado de cada torneo a la vista, y el total si todos los muestran.
    assert [(v["slot_label"], v["required"], [(t["name"], t["required"]) for t in v["tournaments"]]) for v in view] == [
        ("Todo el día", 3, [("Copa", 3)]), ("8:00 a. m. - 1:00 p. m.", 5, [("Liga", 2)])]
    assert [v["hidden_count"] for v in view] == [0, 1]

    # Ana se inscribe en la mañana; Beto en todo el día.
    assert client.post(f"/api/availability/{w1['id']}", headers=ana).status_code == 204
    assert client.post(f"/api/availability/{w2['id']}", headers=beto).status_code == 204
    detail = client.get(f"/api/tournaments/{t2}", headers=chief).json()
    cands = {x["id"]: [c["name"] for c in x["candidates"] if not c["is_chief"]] for x in detail["days"]}
    assert cands == {copa_m["id"]: ["Ana Alvarez", "Beto Bravo"], copa_t["id"]: ["Beto Bravo"]}
    ids = {c["name"]: c["user_id"] for x in detail["days"] for c in x["candidates"]}

    # Ana no cubre la tarde.
    r = client.put(f"/api/tournament-days/{copa_t['id']}/assignments", headers=chief, json=[{"user_id": ids["Ana Alvarez"]}])
    assert r.status_code == 400 and "no tiene una disponibilidad" in r.json()["detail"]
    # No se puede asignar en dos franjas que se cruzan (Liga 8-12 y Copa 10-13).
    assert client.put(f"/api/tournament-days/{liga['id']}/assignments", headers=chief,
                      json=[{"user_id": ids["Ana Alvarez"]}]).status_code == 200
    r = client.put(f"/api/tournament-days/{copa_m['id']}/assignments", headers=chief, json=[{"user_id": ids["Ana Alvarez"]}])
    assert r.status_code == 400 and "se cruza" in r.json()["detail"]
    assert "Liga" == next(c for c in client.get(f"/api/tournaments/{t2}", headers=chief).json()["days"][0]["candidates"]
                          if c["name"] == "Ana Alvarez")["assigned_elsewhere"]
    # Moverla de una a otra en el mismo guardado sí se puede.
    r = client.put("/api/assignment-board", headers=chief, json={"days": [
        {"day_id": liga["id"], "items": []}, {"day_id": copa_m["id"], "items": [{"user_id": ids["Ana Alvarez"]}]}]})
    assert r.status_code == 200, r.text
    # Beto en dos franjas de Copa que no se cruzan.
    r = client.put("/api/assignment-board", headers=chief, json={"days": [
        {"day_id": copa_m["id"], "items": [{"user_id": ids["Ana Alvarez"]}, {"user_id": ids["Beto Bravo"]}]},
        {"day_id": copa_t["id"], "items": [{"user_id": ids["Beto Bravo"]}]}]})
    assert r.status_code == 200, r.text

    # El resumen para la imagen sale por disponibilidad.
    rows = client.get(f"/api/availability/summary?d={d}", headers=chief).json()
    assert [(r["slot_label"], r["tournament"], [e["name"] for e in r["entries"]]) for r in rows] == [
        ("Todo el día", {"name": "Copa"}, ["Beto Bravo"]),
        ("8:00 a. m. - 1:00 p. m.", {"name": "Liga y otros torneos"}, ["Ana Alvarez"])]
    me = client.get("/api/auth/me", headers=ana).json()["id"]
    assert [a["slot_label"] for a in client.get(f"/api/users/{me}", headers=chief).json()["upcoming_availability"]] == ["8:00 a. m. - 1:00 p. m."]

    # Editar conserva las inscripciones; eliminar las borra.
    r = client.put(f"/api/availability-windows/{w1['id']}", headers=chief, json={**morning, "hidden_tournament_ids": [t1]})
    assert r.status_code == 200 and r.json()["registered"] == 1 and r.json()["hidden_tournament_ids"] == [t1]
    assert [t["name"] for t in client.get("/api/availability", headers=ana).json()[1]["tournaments"]] == ["Copa"]
    # Con todos ocultos solo se dice cuántos torneos son.
    client.put(f"/api/availability-windows/{w1['id']}", headers=chief, json={**morning, "hidden_tournament_ids": [t1, t2]})
    v = client.get("/api/availability", headers=ana).json()[1]
    assert (v["tournaments"], v["hidden_count"], v["required"]) == ([], 2, 5)
    assert client.get(f"/api/availability/summary?d={d}", headers=chief).json()[1]["tournament"] == {"name": "2 torneos"}
    assert [w["id"] for w in client.get("/api/availability-windows", headers=chief).json()] == [w2["id"], w1["id"]]
    assert client.delete(f"/api/availability-windows/{w2['id']}", headers=chief).status_code == 204
    assert [v["key"] for v in client.get("/api/availability", headers=beto).json()] == [w1["id"]]
    assert client.post("/api/availability-windows", headers=ana, json=morning).status_code == 403


def test_legacy_availability_still_counts(client):
    chief = login(client, "10000000", "1111")
    code = client.post("/api/codes", headers=chief).json()["code"]
    _register(client, code, "94000001", "Vera", "Vieja")
    d = (today_local() + timedelta(days=6)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 1,
        "days": [{"date": d, "start_time": "08:00", "end_time": "12:00"}]}).json()["id"]
    day = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    with SessionLocal() as db:
        uid = db.query(User).filter(User.document == "94000001").one().id
        db.add(Availability(user_id=uid, day_id=day["id"]))
        db.commit()
    day = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    assert [c["name"] for c in day["candidates"] if not c["is_chief"]] == ["Vera Vieja"]
    assert client.put(f"/api/tournament-days/{day['id']}/assignments", headers=chief, json=[{"user_id": uid}]).status_code == 200


def test_tournament_without_slots(client):
    chief = login(client, "10000000", "1111")
    r = client.post("/api/tournaments", headers=chief, json={"name": "Sin Franjas", "location": "A", "referees_required": 2})
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    t = next(x for x in client.get("/api/tournaments", headers=chief).json() if x["id"] == tid)
    assert (t["days"], t["past_count"]) == ([], 0)
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"] == []
