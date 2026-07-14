// ETA v2 (PRD §8 fase 2): velocidade média APRENDIDA POR SEGMENTO do trajeto a
// partir do histórico de posições, combinada com a velocidade instantânea no
// segmento atual. Mantém a interface de eta.js (goal 01) — os consumidores não mudam.
//
// Modelo: para cada viagem, amostras de velocidade (par de posições consecutivas,
// gap < 120s) são atribuídas ao segmento (índice do ponto mais próximo do ponto
// médio). Média por segmento com fallback: média da viagem → instantânea → 20 km/h.
// Recarrega a cada 5 min.
import { read } from './directus.js';
import { config } from './config.js';
import { haversine, distanceAlongTrip } from './eta.js';

let model = new Map();   // trip_id -> { segments: Map<segIdx, kmh>, overall: kmh }
let loadedAt = 0;
let loading = null;

async function buildModel(net) {
  const res = await read('/items/vehicle_positions', {
    limit: 5000, sort: '-recorded_at',
    fields: 'trip_id,lat,lng,recorded_at',
    filter: { _and: [
      { trip_id: { _nnull: true } },
      { recorded_at: { _gte: '$NOW(-7 days)' } }] },
  });
  if (!res.ok) throw new Error(`histórico: HTTP ${res.status}`);

  // agrupa por viagem, ordena por tempo
  const byTrip = new Map();
  for (const p of res.data) {
    if (!byTrip.has(p.trip_id)) byTrip.set(p.trip_id, []);
    byTrip.get(p.trip_id).push(p);
  }

  const next = new Map();
  for (const [tripId, list] of byTrip) {
    const seq = net.seqByTrip.get(tripId);
    if (!seq?.length) continue;
    const coords = seq.map(st => {
      const s = net.stopById.get(st.stop_id);
      return { lat: Number(s.lat), lng: Number(s.lng) };
    });
    list.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

    const samples = new Map(); // segIdx -> [kmh]
    const all = [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const dt = (new Date(b.recorded_at) - new Date(a.recorded_at)) / 1000;
      if (dt <= 0 || dt > 120) continue;
      const dist = haversine(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng));
      const kmh = (dist / dt) * 3.6;
      if (kmh < 1 || kmh > 800) continue; // descarta ruído
      // segmento = ponto do trajeto mais próximo do ponto médio do par
      const mid = { lat: (Number(a.lat) + Number(b.lat)) / 2, lng: (Number(a.lng) + Number(b.lng)) / 2 };
      let segIdx = 0, best = Infinity;
      for (let j = 0; j < coords.length; j++) {
        const d = haversine(mid.lat, mid.lng, coords[j].lat, coords[j].lng);
        if (d < best) { best = d; segIdx = j; }
      }
      if (!samples.has(segIdx)) samples.set(segIdx, []);
      samples.get(segIdx).push(kmh);
      all.push(kmh);
    }
    if (!all.length) continue;
    const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
    next.set(tripId, {
      segments: new Map([...samples].map(([k, v]) => [k, avg(v)])),
      overall: avg(all),
      samples: all.length,
    });
  }
  return next;
}

export async function refreshModel(net, force = false) {
  const now = Date.now();
  if (!force && now - loadedAt < 5 * 60_000) return model;
  if (!loading) {
    loading = buildModel(net)
      .then(m => { model = m; loadedAt = Date.now(); return m; })
      .finally(() => { loading = null; });
  }
  if (model.size && !force) { loading.catch(() => {}); return model; }
  return loading;
}

export function modelInfo() {
  return [...model].map(([tripId, m]) => ({
    trip_id: tripId, samples: m.samples, overall_kmh: Math.round(m.overall),
    segments: [...m.segments].map(([i, v]) => `${i}:${Math.round(v)}`).join(' '),
  }));
}

/**
 * ETA v2 com a mesma assinatura de eta.js: caminha os segmentos até o alvo
 * usando a velocidade aprendida de cada um; o segmento atual combina 50/50 com a
 * velocidade instantânea (se fresca e válida).
 */
export function eta2(position, seq, stopById, targetStopId, tripId) {
  const coords = seq.map(st => {
    const s = stopById.get(st.stop_id);
    return { stopId: st.stop_id, lat: Number(s.lat), lng: Number(s.lng) };
  });
  const targetIdx = coords.findIndex(c => c.stopId === targetStopId);
  if (targetIdx < 0) return null;

  const m = tripId ? model.get(tripId) : null;
  const segKmh = (idx) =>
    m?.segments.get(idx) ?? m?.overall ?? null;

  // próximo ponto à frente (mesma heurística do v1)
  let nearestIdx = 0, nearestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(position.lat, position.lng, coords[i].lat, coords[i].lng);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  const nextIdx = nearestDist < 80 ? nearestIdx + 1 : nearestIdx;
  if (targetIdx < nextIdx) return null;

  const instant = Number(position.speed) >= config.etaMinSpeedKmh ? Number(position.speed) : null;
  const fallback = instant ?? config.etaAvgSpeedKmh;

  let seconds = 0;
  let dist = 0;
  // trecho até o próximo ponto: combina aprendida do segmento atual com instantânea
  const first = haversine(position.lat, position.lng,
    coords[Math.min(nextIdx, coords.length - 1)].lat, coords[Math.min(nextIdx, coords.length - 1)].lng);
  const curLearned = segKmh(Math.max(0, nextIdx - 1));
  const curKmh = curLearned && instant ? (curLearned + instant) / 2 : (curLearned ?? fallback);
  seconds += first / (curKmh / 3.6);
  dist += first;
  // segmentos seguintes: velocidade aprendida de cada um
  for (let i = nextIdx; i < targetIdx; i++) {
    const d = haversine(coords[i].lat, coords[i].lng, coords[i + 1].lat, coords[i + 1].lng);
    const kmh = segKmh(i) ?? fallback;
    seconds += d / (kmh / 3.6);
    dist += d;
  }
  seconds = Math.round(seconds);
  return {
    eta_seconds: seconds,
    eta_text: seconds < 60 ? 'chegando' : `~${Math.round(seconds / 60)} min`,
    distance_m: Math.round(dist),
    model: m ? 'v2' : 'v1-fallback',
  };
}

export { distanceAlongTrip };
