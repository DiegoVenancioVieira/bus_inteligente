// Dados estáticos da rede (linhas, pontos, viagens, sequências) com cache TTL.
// Fonte: Directus. Base para resolução de canais e cálculo de ETA.
import { read } from './directus.js';
import { config } from './config.js';

let cache = null;
let cacheAt = 0;
let loading = null;

async function fetchNetwork() {
  const [routes, stops, trips, stopTimes, vehicles] = await Promise.all([
    read('/items/routes', { limit: -1, fields: 'id,short_name,long_name,color,status' }),
    read('/items/stops', { limit: -1, fields: 'id,code,name,lat,lng,accessibility' }),
    read('/items/trips', { limit: -1, fields: 'id,route_id,headsign,direction' }),
    read('/items/stop_times', { limit: -1, fields: 'id,trip_id,stop_id,sequence,scheduled_time', sort: 'sequence' }),
    read('/items/vehicles', { limit: -1, fields: 'id,code,capacity,features,status' }),
  ]);
  for (const r of [routes, stops, trips, stopTimes, vehicles]) {
    if (!r.ok) throw new Error(`Falha ao carregar rede: HTTP ${r.status}`);
  }

  const stopById = new Map(stops.data.map(s => [s.id, s]));
  const stopByCode = new Map(stops.data.map(s => [s.code, s]));
  const routeById = new Map(routes.data.map(r => [r.id, r]));
  const tripById = new Map(trips.data.map(t => [t.id, t]));
  const vehicleById = new Map(vehicles.data.map(v => [v.id, v]));
  const vehicleByCode = new Map(vehicles.data.map(v => [v.code, v]));

  // sequência de pontos por viagem (ordenada)
  const seqByTrip = new Map();
  for (const st of stopTimes.data) {
    if (!seqByTrip.has(st.trip_id)) seqByTrip.set(st.trip_id, []);
    seqByTrip.get(st.trip_id).push(st);
  }
  for (const arr of seqByTrip.values()) arr.sort((a, b) => a.sequence - b.sequence);

  // viagens que atendem cada ponto
  const tripsByStop = new Map();
  for (const [tripId, seq] of seqByTrip) {
    for (const st of seq) {
      if (!tripsByStop.has(st.stop_id)) tripsByStop.set(st.stop_id, []);
      tripsByStop.get(st.stop_id).push(tripId);
    }
  }

  return { routes: routes.data, stops: stops.data, trips: trips.data,
           stopById, stopByCode, routeById, tripById, vehicleById, vehicleByCode,
           seqByTrip, tripsByStop };
}

export async function getNetwork() {
  const now = Date.now();
  if (cache && now - cacheAt < config.staticCacheTtlMs) return cache;
  if (!loading) {
    loading = fetchNetwork()
      .then(n => { cache = n; cacheAt = Date.now(); return n; })
      .finally(() => { loading = null; });
  }
  // se já existe cache velho, serve o velho enquanto recarrega (stale-while-revalidate)
  if (cache) { loading.catch(() => {}); return cache; }
  return loading;
}
