// Store de tempo real: última posição por veículo + pub/sub.
// Implementação in-memory (instância única). A interface é estável para que,
// na escala (PRD §4.1 opção B), Redis/MQTT substituam sem tocar nos consumidores.
import { EventEmitter } from 'node:events';
import { config } from './config.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

/** vehicle_id -> { position, updatedAt } */
const lastPositions = new Map();

export function setLastPosition(vehicleId, position) {
  lastPositions.set(vehicleId, { position, updatedAt: Date.now() });
}

export function getLastPosition(vehicleId) {
  const entry = lastPositions.get(vehicleId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > config.lastPositionTtlMs) {
    lastPositions.delete(vehicleId);
    return null;
  }
  return entry.position;
}

export function allLastPositions() {
  const out = [];
  for (const [vehicleId] of lastPositions) {
    const p = getLastPosition(vehicleId);
    if (p) out.push(p);
  }
  return out;
}

/** Marca stale conforme PRD §9 (>90s). */
export function withStale(position) {
  if (!position) return null;
  const age = (Date.now() - new Date(position.recorded_at).getTime()) / 1000;
  return { ...position, stale: age > config.staleAfterSeconds };
}

// ---- pub/sub -------------------------------------------------------------
export function publish(channel, payload) {
  emitter.emit(channel, payload);
}

export function subscribe(channel, handler) {
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}
