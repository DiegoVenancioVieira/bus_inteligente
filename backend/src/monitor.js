// Monitor de saúde operacional (PRD §9): a cada 60s verifica cada linha ativa;
// linha com escala ativa e NENHUM veículo transmitindo há <5min dispara alerta
// operacional (log estruturado + estado em /health/operational + webhook opcional
// via ALERT_WEBHOOK_URL). Não polui os service_alerts do passageiro.
import { read } from './directus.js';
import { getNetwork } from './network.js';
import { getLastPosition } from './store.js';

const FRESH_MS = 5 * 60_000;
const activeAlerts = new Map(); // route_id -> { since, route }
let lastCheckAt = null;

async function check() {
  const net = await getNetwork().catch(() => null);
  if (!net) return;
  lastCheckAt = new Date().toISOString();

  // linhas com escala ativa agora
  const assignments = await read('/items/driver_assignments', {
    limit: -1, fields: 'trip_id,vehicle_id',
    filter: { status: { _eq: 'active' } },
  });
  const activeRouteIds = new Set();
  for (const a of assignments.ok ? assignments.data : []) {
    const trip = net.tripById.get(a.trip_id);
    if (trip) activeRouteIds.add(trip.route_id);
  }

  for (const routeId of activeRouteIds) {
    const route = net.routeById.get(routeId);
    const tripIds = net.trips.filter(t => t.route_id === routeId).map(t => t.id);
    let transmitting = 0;
    for (const v of net.vehicleById.values()) {
      const p = getLastPosition(v.id);
      if (p && tripIds.includes(p.trip_id) &&
          Date.now() - new Date(p.recorded_at).getTime() < FRESH_MS) transmitting++;
    }
    if (transmitting === 0 && !activeAlerts.has(routeId)) {
      const alert = { route: route?.short_name ?? routeId, since: new Date().toISOString() };
      activeAlerts.set(routeId, alert);
      console.error(JSON.stringify({ level: 'alert', kind: 'line_without_signal',
        message: `Linha ${alert.route} com escala ativa e NENHUM veículo transmitindo`, ...alert }));
      fireWebhook(alert).catch(() => {});
    } else if (transmitting > 0 && activeAlerts.has(routeId)) {
      const a = activeAlerts.get(routeId);
      activeAlerts.delete(routeId);
      console.error(JSON.stringify({ level: 'info', kind: 'line_signal_recovered',
        message: `Linha ${a.route} voltou a transmitir`, route: a.route }));
    }
  }
  // linhas que deixaram de ter escala ativa saem do estado de alerta
  for (const routeId of [...activeAlerts.keys()]) {
    if (!activeRouteIds.has(routeId)) activeAlerts.delete(routeId);
  }
}

async function fireWebhook(alert) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'line_without_signal', ...alert }) });
}

export function registerMonitor(app, { intervalMs = 60_000 } = {}) {
  setInterval(check, intervalMs).unref();
  check().catch(() => {});

  app.get('/health/operational', async () => ({
    status: activeAlerts.size ? 'alert' : 'ok',
    last_check: lastCheckAt,
    alerts: [...activeAlerts.values()].map(a => ({
      kind: 'line_without_signal', ...a })),
  }));

  // gatilho manual p/ testes e cron externos
  app.post('/health/check-now', async () => { await check(); return { checked: true }; });
}
