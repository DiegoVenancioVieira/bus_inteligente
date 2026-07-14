// Cliente Directus mínimo (REST via fetch)
import { config } from './config.js';

export async function dx(method, path, { body, token, query } = {}) {
  const url = new URL(config.directusUrl + path);
  if (query) for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { status: res.status, ok: res.ok, data: data?.data ?? data, raw: data };
}

// Leitura server-side (token de serviço)
export const read = (path, query) =>
  dx('GET', path, { token: config.directusToken, query });
