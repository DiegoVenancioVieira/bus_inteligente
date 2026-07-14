// Simulador de motorista: move o veículo AJU-1001 ao longo da viagem "ida"
// da linha CT-ATL, enviando posições ao endpoint de ingestão como role Driver.
// Uso: node scripts/simulator.js [--interval 5] [--speed 30] [--loops 1]
import '../src/config.js';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8060';
const DIRECTUS = process.env.DIRECTUS_URL.replace(/\/$/, '');
const DRIVER_TOKEN = process.env.DRIVER_TEST_TOKEN;
if (!DRIVER_TOKEN) { console.error('DRIVER_TEST_TOKEN ausente em config/.env'); process.exit(1); }

const args = Object.fromEntries(process.argv.slice(2).join(' ')
  .split('--').filter(Boolean).map(s => s.trim().split(/\s+/)));
const INTERVAL = Number(args.interval ?? 5) * 1000;
const SPEED_KMH = Number(args.speed ?? 30);
const LOOPS = Number(args.loops ?? 1);

async function directus(path, query = {}) {
  const url = new URL(DIRECTUS + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const res = await fetch(url); // leitura pública
  const body = await res.json();
  return body.data;
}

function interpolate(a, b, f) {
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}
function bearing(a, b) {
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360);
}
function haversineKm(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function sendPosition(vehicleId, tripId, pos, heading) {
  const res = await fetch(`${BACKEND}/ingest/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DRIVER_TOKEN}` },
    body: JSON.stringify({
      vehicle_id: vehicleId, trip_id: tripId,
      lat: pos.lat, lng: pos.lng, speed: SPEED_KMH, heading,
      recorded_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) console.error(`  envio falhou: HTTP ${res.status} ${await res.text()}`);
  return res.ok;
}

async function main() {
  // carrega rede via leitura pública do Directus
  const routes = await directus('/items/routes', { filter: { short_name: { _eq: 'CT-ATL' } } });
  const route = routes[0];
  const trips = await directus('/items/trips', {
    filter: { _and: [{ route_id: { _eq: route.id } }, { direction: { _eq: 'ida' } }] } });
  const trip = trips[0];
  const stopTimes = await directus('/items/stop_times', {
    filter: { trip_id: { _eq: trip.id } }, sort: 'sequence', fields: 'sequence,stop_id' });
  const stops = await directus('/items/stops', { limit: -1, fields: 'id,code,name,lat,lng' });
  const stopById = new Map(stops.map(s => [s.id, s]));
  const path = stopTimes.map(st => {
    const s = stopById.get(st.stop_id);
    return { code: s.code, name: s.name, lat: Number(s.lat), lng: Number(s.lng) };
  });
  const vehicles = await directus('/items/vehicles', { filter: { code: { _eq: 'AJU-1001' } } });
  const vehicle = vehicles[0];

  console.log(`Simulando ${vehicle.code} na linha ${route.short_name} (${trip.headsign})`);
  console.log(`Trajeto: ${path.map(p => p.code).join(' → ')}`);
  console.log(`Velocidade ${SPEED_KMH} km/h, envio a cada ${INTERVAL / 1000}s\n`);

  const stepKm = (SPEED_KMH / 3600) * (INTERVAL / 1000); // km por tick
  for (let loop = 0; loop < LOOPS; loop++) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const segKm = haversineKm(a, b);
      const ticks = Math.max(1, Math.ceil(segKm / stepKm));
      for (let t = 0; t <= ticks; t++) {
        const pos = interpolate(a, b, t / ticks);
        const okSend = await sendPosition(vehicle.id, trip.id, pos, bearing(a, b));
        console.log(`${okSend ? 'OK ' : 'ERR'} ${a.code}→${b.code} ${(t / ticks * 100).toFixed(0).padStart(3)}%  ${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`);
        if (t < ticks) await new Promise(r => setTimeout(r, INTERVAL));
      }
    }
  }
  console.log('\nSimulação concluída.');
}

main().catch(e => { console.error(e); process.exit(1); });
