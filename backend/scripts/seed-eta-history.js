// Gera histórico sintético de posições para treinar/avaliar o ETA v2:
// duas viagens completas na CT-ATL (ida) com velocidade VARIANDO por segmento
// (lento no centro, rápido na orla — padrão urbano real). Timestamps no passado,
// inseridos via ingestão em lote (o buffer offline permite recorded_at passado).
//
//   node scripts/seed-eta-history.js            # viagem de treino (ontem 08:00)
//   node scripts/seed-eta-history.js --test     # viagem de avaliação (hoje -2h)
import '../src/config.js';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8060';
const DIRECTUS = process.env.DIRECTUS_URL.replace(/\/$/, '');
const DRIVER_TOKEN = process.env.DRIVER_TEST_TOKEN;

// velocidade por segmento (km/h): centro congestionado → orla fluida
export const SEGMENT_SPEEDS = [12, 15, 28, 40, 45, 50, 35];
const SAMPLE_S = 15;

async function directus(path, query = {}) {
  const url = new URL(DIRECTUS + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const res = await fetch(url);
  return (await res.json()).data;
}

function haversineKm(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export async function loadTripPath() {
  const routes = await directus('/items/routes', { filter: { short_name: { _eq: 'CT-ATL' } } });
  const trips = await directus('/items/trips', {
    filter: { _and: [{ route_id: { _eq: routes[0].id } }, { direction: { _eq: 'ida' } }] } });
  const st = await directus('/items/stop_times', {
    filter: { trip_id: { _eq: trips[0].id } }, sort: 'sequence', fields: 'stop_id,sequence' });
  const stops = await directus('/items/stops', { limit: -1, fields: 'id,code,name,lat,lng' });
  const byId = new Map(stops.map(s => [s.id, s]));
  const vehicles = await directus('/items/vehicles', { filter: { code: { _eq: 'AJU-1001' } } });
  return {
    tripId: trips[0].id,
    vehicleId: vehicles[0].id,
    path: st.map(x => {
      const s = byId.get(x.stop_id);
      return { code: s.code, lat: Number(s.lat), lng: Number(s.lng) };
    }),
  };
}

/** Simula a viagem e retorna { positions, arrivals } com timestamps a partir de startMs. */
export function simulateTrip(path, startMs, speeds = SEGMENT_SPEEDS, noise = 0) {
  const positions = [];
  const arrivals = [{ stop: path[0].code, at: startMs }];
  let t = startMs;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const kmh = speeds[i % speeds.length] * (1 + (Math.random() * 2 - 1) * noise);
    const segKm = haversineKm(a, b);
    const segS = (segKm / kmh) * 3600;
    const ticks = Math.max(1, Math.round(segS / SAMPLE_S));
    for (let k = 0; k <= ticks; k++) {
      const f = k / ticks;
      positions.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
        speed: Math.round(kmh),
        recorded_at: new Date(t + segS * 1000 * f).toISOString(),
      });
    }
    t += segS * 1000;
    arrivals.push({ stop: b.code, at: t });
  }
  return { positions, arrivals };
}

async function main() {
  const isTest = process.argv.includes('--test');
  const { tripId, vehicleId, path } = await loadTripPath();
  const start = isTest
    ? Date.now() - 2 * 3600_000                       // avaliação: hoje, 2h atrás
    : Date.now() - 24 * 3600_000;                     // treino: ontem, mesma hora
  const { positions, arrivals } = simulateTrip(path, start, SEGMENT_SPEEDS, isTest ? 0.08 : 0);

  const rows = positions.map(p => ({ ...p, vehicle_id: vehicleId, trip_id: tripId }));
  // envia em lotes de 400 (limite 500/lote)
  for (let i = 0; i < rows.length; i += 400) {
    const res = await fetch(`${BACKEND}/ingest/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DRIVER_TOKEN}` },
      body: JSON.stringify(rows.slice(i, i + 400)),
    });
    if (!res.ok) throw new Error(`lote falhou: HTTP ${res.status} ${await res.text()}`);
  }
  console.log(`${isTest ? 'TESTE' : 'TREINO'}: ${rows.length} posições inseridas ` +
    `(viagem ${new Date(start).toLocaleTimeString('pt-BR')} → ${new Date(arrivals.at(-1).at).toLocaleTimeString('pt-BR')})`);
  console.log('chegadas reais:', arrivals.map(a => `${a.stop}@${new Date(a.at).toLocaleTimeString('pt-BR')}`).join(' '));
}

// executa apenas quando chamado diretamente (o verify importa as funções)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
