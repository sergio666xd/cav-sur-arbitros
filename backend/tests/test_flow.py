from datetime import timedelta

from app.timeutil import today_local

from .conftest import login


def _register(client, code, doc, first, last="Test"):
    r = client.post("/api/auth/register", json={
        "first_name": first, "last_name": last, "document": doc, "birth_date": "1995-06-15",
        "code": code.lower(), "pin": "2222",
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


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
        "code": code, "pin": "2222"}).status_code == 409

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
    assert d2["slot_label"] == "Todo el día desde las 8:00 a. m."
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

    # Partidos.
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
    assert client.post("/api/ratings", headers=ref_a, json={"items": [{"user_id": ids["Ana Alvarez"], "score": "BUENO"}]}).status_code == 403
    r = client.post("/api/ratings", headers=chief, json={"items": [
        {"user_id": ids["Beto Bravo"], "score": "EXCELENTE"},
        {"user_id": ids["Ana Alvarez"], "score": "BUENO"},
    ]})
    assert r.status_code == 201
    ranking = client.get("/api/ranking", headers=ref_c).json()
    assert [r["name"] for r in ranking] == ["Jefa Principal", "Beto Bravo", "Ana Alvarez", "Caro Castro"]
    assert ranking[1]["points"] == 50

    # Empate en puntos: gana quien tiene más partidos pitados (Caro 0 pitados vs Beto 0; Ana 4).
    client.post("/api/ratings", headers=chief, json={"items": [{"user_id": ids["Caro Castro"], "score": "EXCELENTE"},
                                                                {"user_id": ids["Ana Alvarez"], "score": "BUENO"}]})
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
        "code": "ZZZZZZ", "pin": "1234"})
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

    # El árbitro ve el lugar de cada franja.
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "60000001", "Fer")
    slots = [s for s in client.get("/api/availability", headers=ref).json() if s["date"] == soon]
    assert [s["tournaments"][0]["location"] for s in slots] == ["Coliseo Sur", "Colegio Norte"]


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
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    client.post(f"/api/availability/{key}", headers=ref)
    d = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    uid = next(c["user_id"] for c in d["candidates"] if c["name"] == "Lu Lopez")
    client.put(f"/api/tournament-days/{d['id']}/assignments", headers=chief, json=[{"user_id": uid}])
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

    av = {(d["date"], d["slot_label"]): d for d in client.get("/api/availability", headers=ref_z).json()}
    for ref in (ref_z, ref_a):
        client.post(f"/api/availability/{av[(d1, '8:00 a. m. - 2:00 p. m.')]['key']}", headers=ref)
    for ref in (ref_a, ref_z):
        client.post(f"/api/availability/{av[(d2, 'Todo el día desde las 8:00 a. m.')]['key']}", headers=ref)

    rows = client.get("/api/availability/summary", headers=chief).json()
    assert [(r["date"], r["slot_label"]) for r in rows] == [(d1, "8:00 a. m. - 2:00 p. m."), (d2, "Todo el día desde las 8:00 a. m.")]
    # Franjas superpuestas se combinan; con varios torneos el día no se nombra ninguno.
    assert rows[0]["required"] == 4 and rows[0]["tournament"] is None
    assert [e["name"] for e in rows[0]["entries"]] == ["Zoe Zapata", "Ana Alvarez"]  # orden de registro, no alfabético
    assert rows[1]["tournament"] == {"name": "Solo Visible", "location": "Estadio"}
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
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "70000001", "Gabi")
    slot = client.get("/api/availability", headers=ref).json()[0]
    assert slot["tournaments"] == [{"name": "Copa Secreta", "location": "", "categories": [], "visible": False}]
    rows = client.get(f"/api/availability/summary?d={d}", headers=chief).json()
    assert rows[0]["tournament"] == {"name": "Copa Secreta", "location": ""}


def test_editing_slot_keeps_availability(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 2,
        "days": [{"date": d, "start_time": "09:00", "end_time": "12:00"}]}).json()["id"]
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "80000001", "Hugo")
    key = client.get("/api/availability", headers=ref).json()[0]["key"]
    assert client.post(f"/api/availability/{key}", headers=ref).status_code == 204
    day_id = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["id"]
    hugo = next(c["user_id"] for c in client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]["candidates"]
                if c["name"].startswith("Hugo"))
    assert client.put(f"/api/tournament-days/{day_id}/assignments", headers=chief, json=[{"user_id": hugo}]).status_code == 200
    later = (today_local() + timedelta(days=5)).isoformat()
    # Cambian hora, sede y fecha: la disponibilidad y la asignación se conservan.
    r = client.put(f"/api/tournaments/{tid}", headers=chief, json={
        "name": "T", "venues": ["A", "B"], "referees_required": 2,
        "days": [{"id": day_id, "date": later, "start_time": "10:00", "location": "B"}]})
    assert r.status_code == 200, r.text
    slots = client.get("/api/availability", headers=ref).json()
    assert [(s["date"], s["mine"]) for s in slots] == [(later, True)]
    day = client.get(f"/api/tournaments/{tid}", headers=chief).json()["days"][0]
    assert [a["user_id"] for a in day["assignments"]] == [hugo]


def test_required_can_be_hidden(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=4)).isoformat()
    tid = client.post("/api/tournaments", headers=chief, json={"name": "T", "location": "A", "referees_required": 3,
        "show_required": False, "days": [{"date": d, "start_time": "09:00"}]}).json()["id"]
    assert client.get(f"/api/tournaments/{tid}", headers=chief).json()["show_required"] is False
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "90000001", "Iris")
    slot = client.get("/api/availability", headers=ref).json()[0]
    assert (slot["required"], slot["registered"]) == (None, 0)


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
