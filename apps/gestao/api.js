// Cliente do backend para a gestão: auth Directus via /dx + endpoints /live.
const BASE = new URL('..', location.href).href.replace(/\/$/, '');
const LS_KEY = 'bi_operator_session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}
function saveSession(s) {
  if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
  else localStorage.removeItem(LS_KEY);
}

export async function jfetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = await accessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(BASE + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* vazio */ }
  return { ok: res.ok, status: res.status, data: data?.data ?? data };
}

export async function login(email, password) {
  const r = await jfetch('/dx/auth/login', { method: 'POST', auth: false, body: { email, password } });
  if (!r.ok) return null;
  const s = { access_token: r.data.access_token, refresh_token: r.data.refresh_token,
              expires_at: Date.now() + (r.data.expires ?? 900_000) - 60_000 };
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
  Object.assign(s, { access_token: r.data.access_token, refresh_token: r.data.refresh_token,
    expires_at: Date.now() + (r.data.expires ?? 900_000) - 60_000 });
  saveSession(s);
  return s.access_token;
}

export function logout() { saveSession(null); }

export const filt = (obj) => encodeURIComponent(JSON.stringify(obj));
