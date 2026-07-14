// ETA MVP (PRD §8 fase 1): distância ao longo do trajeto ÷ velocidade.
// Interface estável — o goal 06 substitui a implementação por ETA v2.
import { config } from './config.js';

const R = 6371e3; // raio da Terra (m)
export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Distância restante (m) do veículo até o ponto alvo, ao longo da sequência da viagem.
 * Estratégia MVP: encontra o segmento do trajeto mais próximo do veículo e soma
 * as distâncias ponto-a-ponto até o alvo. Retorna null se o alvo já ficou para trás.
 */
export function distanceAlongTrip(position, seq, stopById, targetStopId) {
  const coords = seq.map(st => {
    const s = stopById.get(st.stop_id);
    return { stopId: st.stop_id, lat: Number(s.lat), lng: Number(s.lng) };
  });
  const targetIdx = coords.findIndex(c => c.stopId === targetStopId);
  if (targetIdx < 0) return null;

  // índice do próximo ponto do trajeto (o ponto mais próximo à frente do veículo)
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(position.lat, position.lng, coords[i].lat, coords[i].lng);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  // heurística: se o veículo já está muito perto do ponto mais próximo,
  // considera que o próximo é o seguinte na sequência
  const nextIdx = nearestDist < 80 ? nearestIdx + 1 : nearestIdx;
  if (targetIdx < nextIdx) return null; // alvo já passou

  let dist = haversine(position.lat, position.lng, coords[Math.min(nextIdx, coords.length - 1)].lat,
    coords[Math.min(nextIdx, coords.length - 1)].lng);
  for (let i = nextIdx; i < targetIdx; i++) {
    dist += haversine(coords[i].lat, coords[i].lng, coords[i + 1].lat, coords[i + 1].lng);
  }
  return dist;
}

/** Calcula eta_seconds e texto amigável. */
export function eta(position, seq, stopById, targetStopId) {
  const dist = distanceAlongTrip(position, seq, stopById, targetStopId);
  if (dist === null) return null;
  const speedKmh = Number(position.speed) >= config.etaMinSpeedKmh
    ? Number(position.speed)
    : config.etaAvgSpeedKmh;
  const seconds = Math.round(dist / (speedKmh / 3.6));
  return {
    eta_seconds: seconds,
    eta_text: seconds < 60 ? 'chegando' : `~${Math.round(seconds / 60)} min`,
    distance_m: Math.round(dist),
  };
}
