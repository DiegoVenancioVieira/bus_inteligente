// Cliente do backend (mesma origem): auth Directus via proxy /dx + ingestão.
const BASE = new URL('..', location.href).href.replace(/\/$/, '');

const LS_KEY = 'bi_driver_session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}
function saveSession(s) {
  if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
  else localStorage.removeItem(LS_KEY);
}

async function jfetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* vazio */ }
  return { ok: res.ok, status: res.status, data: data?.data ?? data };
}

// ---- sessão longa (RF-M1): access_token renovado via refresh_token ---------
export async function login(email, password) {
  const r = await jfetch('/dx/auth/login', { method: 'POST', auth: false,
    body: { email, password } });
  if (!r.ok) return null;
  const s = { access_token: r.data.access_token, refresh_token: r.data.refresh_token,
              expires_at: Date.now() + (r.data.expires ?? 900_000) - 60_000 };
  saveSession(s);
  const me = await jfetch('/dx/users/me');
  s.user_id = me.data?.id;
  saveSession(s);
  return s;
}

export async function accessToken() {
  const s = getSession();
  if (!s) return null;
  if (Date.now() < s.expires_at) return s.access_token;
  const r = await jfetch('/dx/auth/refresh', { method: 'POST', auth: false,
    body: { refresh_token: s.refresh_token, mode: 'json' } });
  if (!r.ok) { saveSession(null); return null; }
  Object.assign(s, {
    access_token: r.data.access_token, refresh_token: r.data.refresh_token,
    expires_at: Date.now() + (r.data.expires ?? 900_000) - 60_000 });
  saveSession(s);
  return s.access_token;
}

export function logout() { saveSession(null); }

// ---- dados para o turno -----------------------------------------------------
export const listVehicles = () =>
  jfetch('/dx/items/vehicles?filter=' + encodeURIComponent(JSON.stringify(
    { status: { _eq: 'in_service' } })) + '&fields=id,code,plate');

export const listTrips = async () => {
  const [routes, trips] = await Promise.all([
    jfetch('/dx/items/routes?fields=id,short_name,long_name'),
    jfetch('/dx/items/trips?fields=id,route_id,headsign,direction'),
  ]);
  const routeById = new Map((routes.data ?? []).map(r => [r.id, r]));
  return (trips.data ?? []).map(t => ({
    ...t, route: routeById.get(t.route_id) }));
};

export const tripPath = async (tripId) => {
  const st = await jfetch('/dx/items/stop_times?sort=sequence&filter=' +
    encodeURIComponent(JSON.stringify({ trip_id: { _eq: tripId } })) +
    '&fields=sequence,stop_id');
  const stops = await jfetch('/dx/items/stops?limit=-1&fields=id,code,name,lat,lng');
  const byId = new Map((stops.data ?? []).map(s => [s.id, s]));
  return (st.data ?? []).map(x => {
    const s = byId.get(x.stop_id);
    return { name: s.name, code: s.code, lat: Number(s.lat), lng: Number(s.lng) };
  });
};

// ---- escala (RF-M2/M6) ------------------------------------------------------
export async function activeAssignment(userId) {
  const r = await jfetch('/dx/items/driver_assignments?limit=1&filter=' +
    encodeURIComponent(JSON.stringify({ _and: [
      { driver_id: { _eq: userId } }, { status: { _eq: 'active' } }] })) +
    '&fields=id,vehicle_id,trip_id,shift_start');
  return r.data?.[0] ?? null;
}

export const startShift = (userId, vehicleId, tripId) =>
  jfetch('/dx/items/driver_assignments', { method: 'POST', body: {
    driver_id: userId, vehicle_id: vehicleId, trip_id: tripId,
    shift_start: new Date().toISOString(), status: 'active' } });

export const endShift = (assignmentId) =>
  jfetch(`/dx/items/driver_assignments/${assignmentId}`, { method: 'PATCH', body: {
    status: 'finished', shift_end: new Date().toISOString() } });

// ---- avisos (RF-M7) ----------------------------------------------------------
export const listAlerts = () =>
  jfetch('/dx/items/service_alerts?limit=10&sort=-active_from&fields=id,title,message,severity');

// ---- ingestão (RF-M3/M5) — lote ---------------------------------------------
export async function sendPositions(batch) {
  const token = await accessToken();
  const res = await fetch(`${BASE}/ingest/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(batch),
  });
  return res.ok;
}
