// Captura de GPS com frequência adaptativa (RF-M3/M9):
// em movimento → amostra a cada 5s; parado >30s → 15s (economia de bateria/dados).
// Sem GPS disponível (ex.: desktop/preview), oferece modo simulado ao longo do trajeto.

export class GpsSource {
  constructor(onSample) {
    this.onSample = onSample;       // ({lat,lng,speed,heading}) => void
    this.watchId = null;
    this.timer = null;
    this.last = null;
    this.lastMovedAt = Date.now();
    this.simulating = false;
    this._simState = null;
  }

  get movingIntervalMs() { return 5_000; }
  get idleIntervalMs() { return 15_000; }

  start() {
    if (!('geolocation' in navigator)) return false;
    // watchPosition alimenta this.last; o timer adaptativo decide quando emitir
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const speedKmh = pos.coords.speed != null ? pos.coords.speed * 3.6 : null;
        this.last = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          speed: speedKmh, heading: pos.coords.heading != null ? Math.round(pos.coords.heading) : null,
        };
        if ((speedKmh ?? 0) > 3) this.lastMovedAt = Date.now();
      },
      () => { /* erro tratado pela UI via hasFix() */ },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    this._tick();
    return true;
  }

  _tick() {
    const idle = Date.now() - this.lastMovedAt > 30_000;
    const interval = idle ? this.idleIntervalMs : this.movingIntervalMs;
    this.timer = setTimeout(() => { this._emit(); this._tick(); }, interval);
  }

  _emit() {
    if (this.last) this.onSample({ ...this.last });
  }

  hasFix() { return this.last !== null; }

  // ---- modo simulado (dev/demo): percorre o trajeto da viagem -----------------
  startSimulation(path, speedKmh = 30) {
    this.simulating = true;
    this._simState = { path, speedKmh, seg: 0, frac: 0 };
    const stepMs = 5000;
    const advance = () => {
      const s = this._simState;
      if (!s || s.seg >= s.path.length - 1) { s.seg = 0; s.frac = 0; } // loop
      const a = s.path[s.seg], b = s.path[s.seg + 1];
      const segKm = haversineKm(a, b);
      const stepKm = (s.speedKmh / 3600) * (stepMs / 1000);
      s.frac += segKm > 0 ? stepKm / segKm : 1;
      if (s.frac >= 1) { s.seg++; s.frac = 0; }
      const cur = s.path[Math.min(s.seg, s.path.length - 1)];
      const nxt = s.path[Math.min(s.seg + 1, s.path.length - 1)];
      this.last = {
        lat: cur.lat + (nxt.lat - cur.lat) * s.frac,
        lng: cur.lng + (nxt.lng - cur.lng) * s.frac,
        speed: s.speedKmh, heading: bearing(cur, nxt),
      };
      this.lastMovedAt = Date.now();
      this._emit();
    };
    advance();
    this.timer = setInterval(advance, stepMs);
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    if (this.timer) { clearTimeout(this.timer); clearInterval(this.timer); }
    this.watchId = null; this.timer = null; this.last = null;
    this.simulating = false; this._simState = null;
  }
}

export function haversineKm(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360);
}

/** Próxima parada: ponto do trajeto mais próximo à frente (RF-M4). */
export function nextStop(position, path) {
  if (!position || !path?.length) return null;
  let nearestIdx = 0, nearestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm(position, path[i]);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  const idx = nearestDist < 0.08 ? nearestIdx + 1 : nearestIdx;
  return path[Math.min(idx, path.length - 1)];
}
