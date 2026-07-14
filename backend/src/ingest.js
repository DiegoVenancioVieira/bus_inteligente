// Ingestão de posições GPS (RF-M3/M5). Auth: o token do MOTORISTA é repassado
// ao Directus, que aplica as permissões da role Driver (escrita negada a anônimos).
import { dx } from './directus.js';
import { getNetwork } from './network.js';
import { setLastPosition, publish, withStale } from './store.js';
import { config } from './config.js';
import { inc, observeBroadcastLatency } from './metrics.js';

// ---- rate limit por veículo (token bucket) --------------------------------
const buckets = new Map();
function allow(vehicleId) {
  const now = Date.now();
  let b = buckets.get(vehicleId);
  if (!b) { b = { tokens: config.rateLimit.burst, at: now }; buckets.set(vehicleId, b); }
  b.tokens = Math.min(config.rateLimit.burst,
    b.tokens + ((now - b.at) / 1000) * config.rateLimit.perSecond);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function validate(p) {
  const errors = [];
  if (!p.vehicle_id) errors.push('vehicle_id obrigatório');
  const lat = Number(p.lat), lng = Number(p.lng);
  if (!(lat >= -90 && lat <= 90)) errors.push('lat inválida');
  if (!(lng >= -180 && lng <= 180)) errors.push('lng inválida');
  if (p.heading != null && !(Number(p.heading) >= 0 && Number(p.heading) <= 359))
    errors.push('heading deve ser 0–359');
  if (p.recorded_at) {
    const t = new Date(p.recorded_at).getTime();
    if (Number.isNaN(t)) errors.push('recorded_at inválido');
    else if (t > Date.now() + 60_000) errors.push('recorded_at no futuro');
  }
  return errors;
}

export function registerIngest(app) {
  app.post('/ingest/position', async (req, reply) => {
    inc('ingest_requests_total');
    const auth = req.headers.authorization;
    if (!auth) { inc('ingest_rejected_total'); return reply.code(401).send({ error: 'Authorization obrigatório (token de motorista)' }); }
    const t0 = Date.now();

    // aceita objeto único ou lote (buffer offline, RF-M5)
    const batch = Array.isArray(req.body) ? req.body : [req.body];
    if (batch.length === 0 || batch.length > 500)
      return reply.code(400).send({ error: 'lote deve ter 1–500 posições' });

    const vehicleId = batch[0]?.vehicle_id;
    if (!allow(vehicleId)) { inc('ingest_rate_limited_total'); return reply.code(429).send({ error: 'rate limit excedido' }); }

    const rows = [];
    for (const p of batch) {
      const errors = validate(p);
      if (errors.length) { inc('ingest_rejected_total'); return reply.code(400).send({ error: errors.join('; '), item: p }); }
      rows.push({
        vehicle_id: p.vehicle_id,
        trip_id: p.trip_id ?? null,
        lat: Number(p.lat), lng: Number(p.lng),
        speed: p.speed != null ? Number(p.speed) : null,
        heading: p.heading != null ? Number(p.heading) : null,
        occupancy: p.occupancy ?? null,
        recorded_at: p.recorded_at ?? new Date().toISOString(),
      });
    }
    // ordena por recorded_at (lotes offline podem vir fora de ordem)
    rows.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

    // grava no Directus com o token do CHAMADOR → role Driver é exigida
    const token = auth.replace(/^Bearer\s+/i, '');
    const res = await dx('POST', '/items/vehicle_positions', { body: rows, token });
    if (!res.ok) {
      inc('ingest_rejected_total');
      const code = res.status === 401 || res.status === 403 ? res.status : 502;
      return reply.code(code).send({ error: 'gravação negada/falhou', directus_status: res.status });
    }
    inc('ingest_positions_total', rows.length);

    // última posição do lote atualiza cache + broadcast
    const latest = rows[rows.length - 1];
    setLastPosition(latest.vehicle_id, latest);

    const net = await getNetwork().catch(() => null);
    const vehicle = net?.vehicleById.get(latest.vehicle_id);
    const trip = latest.trip_id ? net?.tripById.get(latest.trip_id) : null;
    const event = {
      type: 'position',
      vehicle: vehicle ? { id: vehicle.id, code: vehicle.code } : { id: latest.vehicle_id },
      trip_id: latest.trip_id,
      route_id: trip?.route_id ?? null,
      position: withStale(latest),
    };
    publish(`vehicle:${vehicle?.code ?? latest.vehicle_id}`, event);
    if (trip?.route_id) publish(`route:${trip.route_id}`, event);
    inc('broadcast_events_total');
    observeBroadcastLatency(Date.now() - t0);

    return reply.send({ accepted: rows.length, latest_recorded_at: latest.recorded_at });
  });
}
