// Cliente do backend: leitura /live + WebSocket com fallback de polling (RF-P3/P10).
const BASE = new URL('..', location.href).href.replace(/\/$/, '');

export async function liveStop(code)    { return get(`/live/stop/${encodeURIComponent(code)}`); }
export async function liveRoute(id)     { return get(`/live/route/${encodeURIComponent(id)}`); }
export async function liveVehicle(code) { return get(`/live/vehicle/${encodeURIComponent(code)}`); }

async function get(path) {
  const res = await fetch(BASE + path);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/**
 * Assinatura em tempo real com resiliência (RF-P3):
 * tenta WebSocket; se falhar/cair, ativa polling (20s) chamando refresh().
 * refresh() também roda a cada 30s mesmo com WS (alertas/ETA completos).
 */
export function subscribe({ channel, onEvent, refresh, onConnState }) {
  let ws = null;
  let pollTimer = null;
  let fullTimer = null;
  let closed = false;

  const startPolling = () => {
    if (pollTimer || closed) return;
    onConnState?.('polling');
    pollTimer = setInterval(refresh, 20_000);
  };

  const connect = () => {
    if (closed) return;
    try {
      const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        onConnState?.('ws');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        ws.send(JSON.stringify({ type: 'subscribe', channel }));
      };
      ws.onmessage = (e) => {
        try { const msg = JSON.parse(e.data); if (msg.type === 'position') onEvent(msg); } catch {}
      };
      ws.onclose = () => { if (!closed) { startPolling(); setTimeout(connect, 15_000); } };
      ws.onerror = () => ws.close();
    } catch { startPolling(); }
  };

  connect();
  fullTimer = setInterval(refresh, 30_000);

  return () => {
    closed = true;
    ws?.close();
    if (pollTimer) clearInterval(pollTimer);
    clearInterval(fullTimer);
  };
}

// ---- favoritos locais, sem conta (RF-P8) -----------------------------------
const FAV_KEY = 'bi_favoritos';
export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) ?? []; } catch { return []; }
}
export function toggleFavorite(stop) {
  const favs = getFavorites();
  const i = favs.findIndex(f => f.code === stop.code);
  if (i >= 0) favs.splice(i, 1);
  else favs.push({ code: stop.code, name: stop.name });
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  return i < 0;
}
export function isFavorite(code) {
  return getFavorites().some(f => f.code === code);
}
