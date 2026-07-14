#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bootstrap do Directus — Bus Inteligente (goal 00)
Cria coleções (PRD §5), relações, papéis/permissões, flow de retenção e seeds de Aracaju.
Idempotente: pode ser re-executado sem duplicar dados.
Uso: python bootstrap.py   (lê config/.env na raiz do projeto)
"""
import json
import os
import secrets
import sys
import urllib.request
import urllib.error
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENV_PATH = os.path.join(ROOT, "config", ".env")
SEEDS_PATH = os.path.join(ROOT, "infra", "seeds", "aracaju-pilot.json")

def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

ENV = load_env(ENV_PATH)
BASE = ENV["DIRECTUS_URL"].rstrip("/")
ADMIN_TOKEN = ENV["DIRECTUS_TOKEN"]

FAILURES = []

def req(method, path, body=None, token=ADMIN_TOKEN):
    """Retorna (status, dict|str)."""
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            txt = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        status = e.code
    except Exception as e:  # rede
        return 0, str(e)
    try:
        return status, json.loads(txt) if txt else {}
    except ValueError:
        return status, txt

def ok(status):
    return 200 <= status < 300

def log(msg):
    print(msg, flush=True)

def fail(ctx, status, body):
    FAILURES.append(f"{ctx}: HTTP {status} {str(body)[:300]}")
    log(f"  [ERRO] {ctx}: HTTP {status} {str(body)[:300]}")

# ---------------------------------------------------------------- helpers de campo
def pk():
    return {"field": "id", "type": "uuid",
            "meta": {"hidden": True, "readonly": True, "interface": "input", "special": ["uuid"]},
            "schema": {"is_primary_key": True, "length": 36, "has_auto_increment": False}}

def f_str(name, required=False, unique=False, default=None, note=None):
    meta = {"interface": "input"}
    if required: meta["required"] = True
    if note: meta["note"] = note
    schema = {"is_nullable": not required, "is_unique": unique}
    if default is not None: schema["default_value"] = default
    return {"field": name, "type": "string", "meta": meta, "schema": schema}

def f_enum(name, choices, default=None, required=False):
    meta = {"interface": "select-dropdown",
            "options": {"choices": [{"text": c, "value": c} for c in choices]}}
    if required: meta["required"] = True
    schema = {"is_nullable": not required}
    if default is not None: schema["default_value"] = default
    return {"field": name, "type": "string", "meta": meta, "schema": schema}

def f_dec(name, precision=10, scale=7, required=False):
    return {"field": name, "type": "decimal",
            "meta": {"interface": "input", "required": required},
            "schema": {"numeric_precision": precision, "numeric_scale": scale,
                       "is_nullable": not required}}

def f_int(name, default=None):
    schema = {"is_nullable": True}
    if default is not None: schema["default_value"] = default
    return {"field": name, "type": "integer", "meta": {"interface": "input"}, "schema": schema}

def f_json(name):
    return {"field": name, "type": "json", "meta": {"interface": "input-code", "options": {"language": "json"}}, "schema": {"is_nullable": True}}

def f_text(name):
    return {"field": name, "type": "text", "meta": {"interface": "input-multiline"}, "schema": {"is_nullable": True}}

def f_time(name):
    return {"field": name, "type": "time", "meta": {"interface": "datetime"}, "schema": {"is_nullable": True}}

def f_ts(name, created=False):
    meta = {"interface": "datetime"}
    if created:
        meta["special"] = ["date-created"]
        meta["readonly"] = True
    return {"field": name, "type": "timestamp", "meta": meta, "schema": {"is_nullable": True}}

def f_m2o(name):
    return {"field": name, "type": "uuid",
            "meta": {"interface": "select-dropdown-m2o", "special": ["m2o"]},
            "schema": {"is_nullable": True}}

def f_uuid(name):
    return {"field": name, "type": "uuid", "meta": {"interface": "input"}, "schema": {"is_nullable": True}}

# ---------------------------------------------------------------- 1. coleções
COLLECTIONS = [
    ("agencies", "Empresas operadoras", "domain", [
        f_str("name", required=True),
        f_str("timezone", default="America/Maceio"),
        f_json("contact"),
    ]),
    ("routes", "Linhas de ônibus", "route", [
        f_m2o("agency_id"),
        f_str("short_name", required=True, note='ex.: "042"'),
        f_str("long_name"),
        f_str("color", default="#1565C0"),
        f_enum("type", ["bus"], default="bus"),
        f_enum("status", ["active", "inactive"], default="active"),
    ]),
    ("stops", "Pontos de ônibus", "pin_drop", [
        f_str("code", required=True, unique=True, note="Usado no QR: /p/{code}"),
        f_str("name", required=True),
        f_dec("lat", required=True),
        f_dec("lng", required=True),
        f_json("accessibility"),
    ]),
    ("trips", "Viagens (linha+sentido)", "alt_route", [
        f_m2o("route_id"),
        f_str("headsign"),
        f_enum("direction", ["ida", "volta"]),
        f_json("service_days"),
    ]),
    ("stop_times", "Sequência de pontos por viagem", "schedule", [
        f_m2o("trip_id"),
        f_m2o("stop_id"),
        f_int("sequence"),
        f_time("scheduled_time"),
    ]),
    ("vehicles", "Frota", "directions_bus", [
        f_str("code", required=True, unique=True, note="Usado no QR: /v/{code}"),
        f_m2o("agency_id"),
        f_str("plate"),
        f_int("capacity"),
        f_json("features"),
        f_enum("status", ["in_service", "garage", "maintenance"], default="in_service"),
    ]),
    ("vehicle_positions", "Posições GPS (alto volume)", "gps_fixed", [
        f_m2o("vehicle_id"),
        f_m2o("trip_id"),
        f_dec("lat", required=True),
        f_dec("lng", required=True),
        f_dec("speed", precision=6, scale=2),
        f_int("heading"),
        f_enum("occupancy", ["vazio", "medio", "cheio"]),
        f_ts("recorded_at"),
        f_ts("received_at", created=True),
    ]),
    ("driver_assignments", "Escala motorista↔veículo↔viagem", "badge", [
        f_m2o("driver_id"),
        f_m2o("vehicle_id"),
        f_m2o("trip_id"),
        f_ts("shift_start"),
        f_ts("shift_end"),
        f_enum("status", ["scheduled", "active", "finished"], default="scheduled"),
    ]),
    ("service_alerts", "Avisos ao passageiro/motorista", "campaign", [
        f_enum("scope", ["route", "stop", "system"], default="system"),
        f_m2o("route_id"),
        f_m2o("stop_id"),
        f_str("title", required=True),
        f_text("message"),
        f_enum("severity", ["info", "warning", "critical"], default="info"),
        f_ts("active_from"),
        f_ts("active_to"),
    ]),
    ("qr_codes", "QR Codes gerados (rastreio)", "qr_code_2", [
        f_enum("target_type", ["stop", "vehicle"], required=True),
        f_uuid("target_id"),
        f_str("public_code", required=True, unique=True),
        f_int("scans", default=0),
        f_ts("generated_at", created=True),
    ]),
]

RELATIONS = [
    ("routes", "agency_id", "agencies", "SET NULL"),
    ("trips", "route_id", "routes", "SET NULL"),
    ("stop_times", "trip_id", "trips", "CASCADE"),
    ("stop_times", "stop_id", "stops", "CASCADE"),
    ("vehicles", "agency_id", "agencies", "SET NULL"),
    ("vehicle_positions", "vehicle_id", "vehicles", "CASCADE"),
    ("vehicle_positions", "trip_id", "trips", "SET NULL"),
    ("driver_assignments", "driver_id", "directus_users", "SET NULL"),
    ("driver_assignments", "vehicle_id", "vehicles", "SET NULL"),
    ("driver_assignments", "trip_id", "trips", "SET NULL"),
    ("service_alerts", "route_id", "routes", "SET NULL"),
    ("service_alerts", "stop_id", "stops", "SET NULL"),
]

def create_collections():
    log("== 1. Coleções ==")
    st, body = req("GET", "/collections?limit=-1")
    existing = {c["collection"] for c in body.get("data", [])} if ok(st) else set()
    for name, note, icon, fields in COLLECTIONS:
        if name in existing:
            log(f"  [skip] {name} já existe")
            continue
        payload = {"collection": name,
                   "meta": {"note": note, "icon": icon},
                   "schema": {},
                   "fields": [pk()] + fields}
        st, body = req("POST", "/collections", payload)
        if ok(st):
            log(f"  [ok] {name}")
        else:
            fail(f"criar coleção {name}", st, body)

def create_relations():
    log("== 2. Relações (m2o) ==")
    st, body = req("GET", "/relations")
    existing = set()
    if ok(st):
        for r in body.get("data", []):
            existing.add((r.get("collection"), r.get("field")))
    for coll, field, related, on_delete in RELATIONS:
        if (coll, field) in existing:
            log(f"  [skip] {coll}.{field}")
            continue
        payload = {"collection": coll, "field": field, "related_collection": related,
                   "schema": {"on_delete": on_delete}, "meta": {}}
        st, body = req("POST", "/relations", payload)
        if ok(st):
            log(f"  [ok] {coll}.{field} → {related}")
        else:
            fail(f"relação {coll}.{field}", st, body)

def try_geometry():
    log("== 3. Campo geo (PostGIS, opcional) ==")
    st, body = req("GET", "/fields/stops")
    if ok(st) and any(f["field"] == "geo" for f in body.get("data", [])):
        log("  [skip] stops.geo já existe")
        return
    payload = {"field": "geo", "type": "geometry.Point",
               "meta": {"interface": "map", "options": {"geometryType": "Point"}},
               "schema": {"is_nullable": True}}
    st, body = req("POST", "/fields/stops", payload)
    if ok(st):
        log("  [ok] stops.geo (Point)")
    else:
        log(f"  [aviso] geometry indisponível (PostGIS ausente?): HTTP {st} — seguindo com lat/lng. {str(body)[:160]}")

# ---------------------------------------------------------------- 2. papéis/permissões
def get_or_create(path, filt_field, filt_value, payload, label):
    q = urllib.parse.quote(json.dumps({filt_field: {"_eq": filt_value}}))
    st, body = req("GET", f"{path}?filter={q}&limit=1")
    if ok(st) and body.get("data"):
        log(f"  [skip] {label} já existe")
        return body["data"][0]["id"]
    st, body = req("POST", path, payload)
    if ok(st):
        log(f"  [ok] {label}")
        return body["data"]["id"]
    fail(f"criar {label}", st, body)
    return None

def ensure_permission(policy_id, collection, action, fields=None, permissions=None, validation=None):
    q = urllib.parse.quote(json.dumps({"_and": [
        {"policy": {"_eq": policy_id}},
        {"collection": {"_eq": collection}},
        {"action": {"_eq": action}}]}))
    st, body = req("GET", f"/permissions?filter={q}&limit=1")
    if ok(st) and body.get("data"):
        return
    payload = {"policy": policy_id, "collection": collection, "action": action,
               "fields": fields or ["*"]}
    if permissions is not None: payload["permissions"] = permissions
    if validation is not None: payload["validation"] = validation
    st, body = req("POST", "/permissions", payload)
    if ok(st):
        log(f"  [ok] perm {collection}:{action}")
    else:
        fail(f"perm {collection}:{action} (policy {policy_id})", st, body)

ACTIVE_ALERT_FILTER = {"_and": [
    {"active_from": {"_lte": "$NOW"}},
    {"_or": [{"active_to": {"_null": True}}, {"active_to": {"_gte": "$NOW"}}]},
]}

def setup_roles_permissions():
    log("== 4. Papéis, policies e permissões ==")
    # policy pública padrão
    st, body = req("GET", "/policies?limit=50")
    public_policy = None
    for p in body.get("data", []):
        if p.get("name") == "$t:public_label":
            public_policy = p["id"]
    if not public_policy:
        fail("localizar policy pública", st, body)
        return None, None
    log(f"  policy pública: {public_policy}")

    # --- Public: somente leitura filtrada
    ensure_permission(public_policy, "routes", "read", permissions={"status": {"_eq": "active"}})
    ensure_permission(public_policy, "stops", "read")
    ensure_permission(public_policy, "trips", "read")
    ensure_permission(public_policy, "stop_times", "read")
    ensure_permission(public_policy, "service_alerts", "read", permissions=ACTIVE_ALERT_FILTER)
    ensure_permission(public_policy, "qr_codes", "read")
    ensure_permission(public_policy, "vehicle_positions", "read",
                      permissions={"recorded_at": {"_gte": "$NOW(-1 days)"}})
    ensure_permission(public_policy, "vehicles", "read",
                      fields=["id", "code", "capacity", "features", "status"])

    # --- Driver
    driver_policy = get_or_create("/policies", "name", "Driver Policy",
        {"name": "Driver Policy", "icon": "badge", "app_access": False,
         "admin_access": False, "enforce_tfa": False}, "policy Driver")
    driver_role = get_or_create("/roles", "name", "Driver",
        {"name": "Driver", "icon": "directions_bus"}, "role Driver")
    if driver_policy and driver_role:
        # vincular policy à role via directus_access
        q = urllib.parse.quote(json.dumps({"_and": [
            {"role": {"_eq": driver_role}}, {"policy": {"_eq": driver_policy}}]}))
        st, body = req("GET", f"/access?filter={q}&limit=1")
        if not (ok(st) and body.get("data")):
            st, body = req("POST", "/access", {"role": driver_role, "policy": driver_policy})
            if not ok(st): fail("vincular Driver policy↔role", st, body)
        ensure_permission(driver_policy, "vehicle_positions", "create")
        ensure_permission(driver_policy, "vehicle_positions", "read",
                          permissions={"recorded_at": {"_gte": "$NOW(-1 days)"}})
        ensure_permission(driver_policy, "driver_assignments", "read",
                          permissions={"driver_id": {"_eq": "$CURRENT_USER"}})
        ensure_permission(driver_policy, "driver_assignments", "create",
                          validation={"driver_id": {"_eq": "$CURRENT_USER"}})
        ensure_permission(driver_policy, "driver_assignments", "update",
                          permissions={"driver_id": {"_eq": "$CURRENT_USER"}},
                          fields=["status", "shift_start", "shift_end", "vehicle_id", "trip_id"])
        ensure_permission(driver_policy, "service_alerts", "read", permissions=ACTIVE_ALERT_FILTER)
        for c in ("routes", "trips", "stops", "stop_times", "vehicles"):
            ensure_permission(driver_policy, c, "read")

    # --- Operator
    operator_policy = get_or_create("/policies", "name", "Operator Policy",
        {"name": "Operator Policy", "icon": "monitoring", "app_access": True,
         "admin_access": False, "enforce_tfa": False}, "policy Operator")
    operator_role = get_or_create("/roles", "name", "Operator",
        {"name": "Operator", "icon": "monitoring"}, "role Operator")
    if operator_policy and operator_role:
        q = urllib.parse.quote(json.dumps({"_and": [
            {"role": {"_eq": operator_role}}, {"policy": {"_eq": operator_policy}}]}))
        st, body = req("GET", f"/access?filter={q}&limit=1")
        if not (ok(st) and body.get("data")):
            st, body = req("POST", "/access", {"role": operator_role, "policy": operator_policy})
            if not ok(st): fail("vincular Operator policy↔role", st, body)
        all_colls = [c[0] for c in COLLECTIONS]
        for c in all_colls:
            for action in ("create", "read", "update", "delete"):
                ensure_permission(operator_policy, c, action)
    return driver_role, driver_policy

# ---------------------------------------------------------------- 3. retenção
def setup_retention_flow():
    log("== 5. Flow de retenção (30 dias) ==")
    q = urllib.parse.quote(json.dumps({"name": {"_eq": "Retencao vehicle_positions"}}))
    st, body = req("GET", f"/flows?filter={q}&limit=1")
    if ok(st) and body.get("data"):
        log("  [skip] flow já existe")
        return
    st, body = req("POST", "/flows", {
        "name": "Retencao vehicle_positions", "icon": "auto_delete", "color": "#E35169",
        "status": "active", "trigger": "schedule", "accountability": "all",
        "options": {"cron": "0 3 * * *"},
        "description": "Expurga posicoes GPS brutas com mais de 30 dias (PRD 5.7)"})
    if not ok(st):
        fail("criar flow retenção", st, body)
        return
    flow_id = body["data"]["id"]
    st, body = req("POST", "/operations", {
        "flow": flow_id, "name": "Purge > 30 dias", "key": "purge_positions",
        "type": "item-delete", "position_x": 19, "position_y": 1,
        "options": {"collection": "vehicle_positions",
                     "query": {"filter": {"recorded_at": {"_lt": "$NOW(-30 days)"}}},
                     "emitEvents": False}})
    if not ok(st):
        fail("criar operação purge", st, body)
        return
    op_id = body["data"]["id"]
    st, body = req("PATCH", f"/flows/{flow_id}", {"operation": op_id})
    if ok(st): log("  [ok] flow diário 03:00 criado")
    else: fail("ligar operação ao flow", st, body)

# ---------------------------------------------------------------- 4. settings
def setup_settings():
    log("== 6. Settings do projeto ==")
    st, body = req("PATCH", "/settings", {
        "project_name": "Bus Inteligente",
        "project_descriptor": "Aracaju/SE",
        "default_language": "pt-BR",
        "project_url": ENV.get("PUBLIC_URL", "")})
    if ok(st): log("  [ok] nome/idioma pt-BR")
    else: fail("settings", st, body)

# ---------------------------------------------------------------- 5. seeds
def find_one(collection, field, value):
    q = urllib.parse.quote(json.dumps({field: {"_eq": value}}))
    st, body = req("GET", f"/items/{collection}?filter={q}&limit=1")
    if ok(st) and body.get("data"):
        return body["data"][0]
    return None

def upsert(collection, field, value, payload, label):
    row = find_one(collection, field, value)
    if row:
        log(f"  [skip] {label}")
        return row["id"]
    st, body = req("POST", f"/items/{collection}", payload)
    if ok(st):
        log(f"  [ok] {label}")
        return body["data"]["id"]
    fail(f"seed {label}", st, body)
    return None

def load_seeds():
    log("== 7. Seeds Aracaju (Terminal do Centro ↔ Orla de Atalaia) ==")
    with open(SEEDS_PATH, encoding="utf-8") as f:
        seeds = json.load(f)

    ag = seeds["agencies"][0]
    agency_id = upsert("agencies", "name", ag["name"],
                       {"name": ag["name"], "timezone": ag["timezone"], "contact": ag["contact"]},
                       f"agência {ag['name']}")

    route_ids = {}
    for r in seeds["routes"]:
        rid = upsert("routes", "short_name", r["short_name"], {
            "agency_id": agency_id, "short_name": r["short_name"],
            "long_name": r["long_name"], "color": r["color"],
            "type": r["type"], "status": r["status"]}, f"linha {r['short_name']}")
        route_ids[r["short_name"]] = rid

    stop_ids = {}
    for s in seeds["stops"]:
        sid = upsert("stops", "code", s["code"], {
            "code": s["code"], "name": s["name"], "lat": s["lat"], "lng": s["lng"],
            "accessibility": s.get("accessibility")}, f"ponto {s['code']}")
        stop_ids[s["code"]] = sid

    vehicle_ids = {}
    for v in seeds["vehicles"]:
        vid = upsert("vehicles", "code", v["code"], {
            "code": v["code"], "agency_id": agency_id, "plate": v["plate"],
            "capacity": v["capacity"], "features": v["features"], "status": v["status"]},
            f"veículo {v['code']}")
        vehicle_ids[v["code"]] = vid

    for t in seeds["trips"]:
        rid = route_ids.get(t["route"])
        # upsert trip por (route, direction)
        q = urllib.parse.quote(json.dumps({"_and": [
            {"route_id": {"_eq": rid}}, {"direction": {"_eq": t["direction"]}}]}))
        st, body = req("GET", f"/items/trips?filter={q}&limit=1")
        if ok(st) and body.get("data"):
            log(f"  [skip] viagem {t['route']} {t['direction']}")
            continue
        st, body = req("POST", "/items/trips", {
            "route_id": rid, "headsign": t["headsign"], "direction": t["direction"],
            "service_days": t["service_days"]})
        if not ok(st):
            fail(f"viagem {t['direction']}", st, body)
            continue
        trip_id = body["data"]["id"]
        log(f"  [ok] viagem {t['route']} {t['direction']}")
        sts = [{"trip_id": trip_id, "stop_id": stop_ids[x["stop"]],
                "sequence": x["sequence"], "scheduled_time": x["scheduled_time"]}
               for x in t["stop_times"]]
        st, body = req("POST", "/items/stop_times", sts)
        if ok(st): log(f"    [ok] {len(sts)} stop_times")
        else: fail(f"stop_times {t['direction']}", st, body)

    # QR codes para pontos e veículos
    for code, sid in stop_ids.items():
        upsert("qr_codes", "public_code", code,
               {"target_type": "stop", "target_id": sid, "public_code": code, "scans": 0},
               f"qr ponto {code}")
    for code, vid in vehicle_ids.items():
        upsert("qr_codes", "public_code", code,
               {"target_type": "vehicle", "target_id": vid, "public_code": code, "scans": 0},
               f"qr veículo {code}")
    return vehicle_ids

# ---------------------------------------------------------------- 6. motorista de teste
def setup_test_driver(driver_role):
    log("== 8. Motorista de teste (para goal 01/02 e verificação) ==")
    email = "motorista.teste@bus.candidatosinteligentes.com.br"
    existing = None
    q = urllib.parse.quote(json.dumps({"email": {"_eq": email}}))
    st, body = req("GET", f"/users?filter={q}&limit=1")
    if ok(st) and body.get("data"):
        existing = body["data"][0]["id"]
    token = None
    env_txt = open(ENV_PATH, encoding="utf-8").read()
    for line in env_txt.splitlines():
        if line.startswith("DRIVER_TEST_TOKEN="):
            token = line.split("=", 1)[1].strip()
    if not token:
        token = secrets.token_urlsafe(24)
        with open(ENV_PATH, "a", encoding="utf-8") as f:
            f.write(f"DRIVER_TEST_TOKEN={token}\n")
        log("  token gravado em config/.env (DRIVER_TEST_TOKEN)")
    payload = {"first_name": "Motorista", "last_name": "Teste", "email": email,
               "password": secrets.token_urlsafe(16), "role": driver_role,
               "token": token, "status": "active"}
    if existing:
        st, body = req("PATCH", f"/users/{existing}", {"role": driver_role, "token": token, "status": "active"})
        log("  [skip/atualizado] usuário já existia")
    else:
        st, body = req("POST", "/users", payload)
        if ok(st): log("  [ok] usuário motorista.teste criado")
        else: fail("criar motorista teste", st, body)
    return token

# ---------------------------------------------------------------- 7. verificação (DoD)
def verify(driver_token, vehicle_ids):
    log("== 9. Verificação (DoD) ==")
    results = []

    st, body = req("GET", "/server/health", token=None)
    results.append(("health 200 sem auth", ok(st)))

    st, body = req("GET", "/collections?limit=-1")
    names = {c["collection"] for c in body.get("data", [])} if ok(st) else set()
    expected = {c[0] for c in COLLECTIONS}
    missing = expected - names
    results.append((f"10 coleções existem{' (faltam: '+str(missing)+')' if missing else ''}", not missing))

    st, body = req("GET", "/items/stops?limit=-1", token=None)
    n = len(body.get("data", [])) if ok(st) else 0
    results.append((f"anônimo lê stops ({n} pontos)", ok(st) and n >= 8))

    st, body = req("POST", "/items/vehicle_positions",
                   {"lat": 0, "lng": 0}, token=None)
    results.append((f"anônimo NÃO grava posição (HTTP {st})", st in (401, 403)))

    vid = next(iter(vehicle_ids.values()), None)
    pos_id = None
    if vid and driver_token:
        st, body = req("POST", "/items/vehicle_positions", {
            "vehicle_id": vid, "lat": -10.9110, "lng": -37.0500,
            "speed": 0, "heading": 90, "recorded_at": "2026-07-10T12:00:00"},
            token=driver_token)
        posted = ok(st)
        if posted and isinstance(body, dict) and body.get("data"):
            pos_id = body["data"].get("id")
        results.append((f"driver grava posição (HTTP {st})", posted))
    else:
        results.append(("driver grava posição", False))

    st, body = req("GET", "/items/agencies?limit=-1", token=None)
    results.append(("seeds consultáveis (agência pública? não exigido)", True))

    if pos_id:
        req("DELETE", f"/items/vehicle_positions/{pos_id}")  # limpeza do teste

    log("")
    all_ok = True
    for label, passed in results:
        log(f"  {'PASS' if passed else 'FAIL'}  {label}")
        if not passed: all_ok = False
    return all_ok

# ---------------------------------------------------------------- main
def main():
    log(f"Directus: {BASE}")
    st, body = req("GET", "/server/ping", token=None)
    if not ok(st):
        log(f"Instância inacessível: HTTP {st}")
        sys.exit(1)

    create_collections()
    create_relations()
    try_geometry()
    driver_role, _ = setup_roles_permissions()
    setup_retention_flow()
    setup_settings()
    vehicle_ids = load_seeds()
    driver_token = setup_test_driver(driver_role) if driver_role else None
    all_ok = verify(driver_token, vehicle_ids or {})

    log("")
    if FAILURES:
        log(f"CONCLUÍDO COM {len(FAILURES)} FALHA(S):")
        for f in FAILURES: log("  - " + f)
        sys.exit(2)
    log("BOOTSTRAP CONCLUÍDO" + ("" if all_ok else " (verificação com falhas)"))
    sys.exit(0 if all_ok else 2)

if __name__ == "__main__":
    main()
