// Verificação DoD do goal 01 — roda contra o backend local + Directus real.
// Uso: node scripts/verify.js   (backend precisa estar rodando)
import '../src/config.js';
import WebSocket from 'ws';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8060';
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws';
const DRIVER_TOKEN = process.env.DRIVER_TEST_TOKEN;

const results = [];
const check = (label, passed, extra = '') =>
  results.push({ label: label + (extra ? ` — ${extra}` : ''), passed });

async function jfetch(path, opts = {}) {
  const res = await fetch(BACKEND + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* vazio */ }
  return { status: res.status, ok: res.ok, body };
}

async function getVehicleAndTrip() {
  const stop = await jfetch('/live/route/CT-ATL');
  const trip = stop.body.directions.find(d => d.direction === 'ida');
  const dxRes = await fetch(process.env.DIRECTUS_URL +
    '/items/vehicles?filter=' + encodeURIComponent(JSON.stringify({ code: { _eq: 'AJU-1002' } })));
  const vehicle = (await dxRes.json()).data[0];
  return { vehicle, tripId: trip.trip_id, routeId: stop.body.route.id };
}

async function main() {
  // 0. health
  const h = await jfetch('/health');
  check('backend health ok (Directus alcançável)', h.ok && h.body.status === 'ok',
    `stops=${h.body?.stops}`);

  const { vehicle, tripId, routeId } = await getVehicleAndTrip();

  // 1. ingestão anônima rejeitada
  const anon = await jfetch('/ingest/position', {
    method: 'POST', body: JSON.stringify({ vehicle_id: vehicle.id, lat: -10.95, lng: -37.05 }) });
  check('ingestão anônima rejeitada', anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);

  // 2. WS: assina o canal da linha, envia posição como driver, mede latência
  const ws = new WebSocket(WS_URL);
  const wsEvent = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout 10s')), 10_000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', channel: `route:${routeId}` })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'position') { clearTimeout(timer); resolve({ msg, at: Date.now() }); }
    });
    ws.on('error', reject);
  });
  await new Promise(r => setTimeout(r, 500)); // garante subscribe

  const sentAt = Date.now();
  const post = await jfetch('/ingest/position', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DRIVER_TOKEN}` },
    body: JSON.stringify({ vehicle_id: vehicle.id, trip_id: tripId,
      lat: -10.9200, lng: -37.0520, speed: 25, heading: 180,
      recorded_at: new Date().toISOString() }),
  });
  check('driver grava posição via ingestão', post.ok, `HTTP ${post.status}`);

  try {
    const { at } = await wsEvent;
    const latency = (at - sentAt) / 1000;
    check('WS entrega posição em ≤5s', latency <= 5, `${latency.toFixed(2)}s`);
  } catch (e) {
    check('WS entrega posição em ≤5s', false, e.message);
  }
  ws.close();

  // 3. lote offline fora de ordem → aceito e ordenado
  const now = Date.now();
  const batch = [
    { vehicle_id: vehicle.id, trip_id: tripId, lat: -10.9520, lng: -37.0480, speed: 20, recorded_at: new Date(now - 30_000).toISOString() },
    { vehicle_id: vehicle.id, trip_id: tripId, lat: -10.9400, lng: -37.0500, speed: 20, recorded_at: new Date(now - 60_000).toISOString() },
    { vehicle_id: vehicle.id, trip_id: tripId, lat: -10.9700, lng: -37.0470, speed: 20, recorded_at: new Date(now - 5_000).toISOString() },
  ];
  const b = await jfetch('/ingest/position', {
    method: 'POST', headers: { Authorization: `Bearer ${DRIVER_TOKEN}` },
    body: JSON.stringify(batch) });
  check('lote offline aceito e ordenado', b.ok &&
    b.body.latest_recorded_at === batch[2].recorded_at, `latest=${b.body?.latest_recorded_at}`);

  // 4. leitura de polling: posição aparece em /live/stop
  await new Promise(r => setTimeout(r, 5100)); // espera cache curto (5s) expirar
  const live = await jfetch('/live/stop/CARANGU');
  const found = live.body?.lines?.some(l => l.arrivals?.some(a => a.vehicle?.code === vehicle.code));
  check('posição visível em GET /live/stop (polling)', live.ok && !!found,
    found ? `eta=${live.body.lines.flatMap(l => l.arrivals).find(a => a.vehicle.code === vehicle.code)?.eta_text}` : 'não encontrado');

  // 5. stale: posição com 3 min é marcada
  const oldPos = { vehicle_id: vehicle.id, trip_id: tripId, lat: -10.9700, lng: -37.0470,
    speed: 20, recorded_at: new Date(Date.now() - 180_000).toISOString() };
  await jfetch('/ingest/position', { method: 'POST',
    headers: { Authorization: `Bearer ${DRIVER_TOKEN}` }, body: JSON.stringify(oldPos) });
  await new Promise(r => setTimeout(r, 5100));
  const live2 = await jfetch('/live/route/CT-ATL');
  const vp = live2.body?.vehicles?.find(v => v.vehicle.code === vehicle.code);
  check('posição >90s marcada stale', vp?.position?.stale === true,
    `stale=${vp?.position?.stale}`);

  // 6. rate limit
  let got429 = false;
  for (let i = 0; i < 20; i++) {
    const r = await jfetch('/ingest/position', {
      method: 'POST', headers: { Authorization: `Bearer ${DRIVER_TOKEN}` },
      body: JSON.stringify({ vehicle_id: vehicle.id, lat: -10.95, lng: -37.05,
        recorded_at: new Date().toISOString() }) });
    if (r.status === 429) { got429 = true; break; }
  }
  check('rate limit responde 429', got429);

  // relatório
  console.log('\n===== DoD goal 01 =====');
  let allOk = true;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}`);
    if (!r.passed) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
