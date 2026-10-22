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
            {"date": later.isoformat(), "all_day": True, "referees_required": 6},
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
    assert d1["tournament"] is None
    assert d1["slot_label"] == "08:00 - 18:00"
    assert d1["required"] == 7
    d2 = days[later.isoformat()]
    assert d2["tournament"]["name"] == "Copa Sur"
    assert d2["slot_label"] == "Todo el día"

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
        "name": "X", "location": "Y", "referees_required": 1, "days": [{"date": later.isoformat(), "all_day": True}]
    }).status_code == 403
    users = client.get("/api/users", headers=ref_a).json()
    assert "age" not in users[0]
    assert "age" in client.get("/api/users", headers=chief).json()[0]


def test_closed_today_and_lockout(client):
    chief = login(client, "10000000", "1111")
    today = today_local()
    client.post("/api/tournaments", headers=chief, json={
        "name": "Hoy", "location": "X", "referees_required": 2, "days": [{"date": today.isoformat(), "all_day": True}]})
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


def test_separate_slots(client):
    chief = login(client, "10000000", "1111")
    d = (today_local() + timedelta(days=2)).isoformat()
    for name, start, end in (("Mañana", "08:00", "11:00"), ("Tarde", "14:00", "18:00"), ("Tarde 2", "17:00", "20:00")):
        client.post("/api/tournaments", headers=chief, json={
            "name": name, "location": "X", "referees_required": 2, "days": [{"date": d, "start_time": start, "end_time": end}]})
    code = client.post("/api/codes", headers=chief).json()["code"]
    ref = _register(client, code, "50000001", "Eva")
    slots = client.get("/api/availability", headers=ref).json()
    assert [s["slot_label"] for s in slots] == ["08:00 - 11:00", "14:00 - 20:00"]
    assert slots[1]["required"] == 4
    assert all(s["tournament"] is None for s in slots)
    assert client.post(f"/api/availability/{slots[0]['key']}", headers=ref).status_code == 204
    slots = client.get("/api/availability", headers=ref).json()
    assert [s["mine"] for s in slots] == [True, False]
    # Solo es candidata en el torneo de la mañana.
    ts = client.get("/api/tournaments", headers=chief).json()
    for t in ts:
        detail = client.get(f"/api/tournaments/{t['id']}", headers=chief).json()
        names = [c["name"] for c in detail["days"][0]["candidates"] if not c["is_chief"]]
        assert names == (["Eva Test"] if t["name"] == "Mañana" else [])
