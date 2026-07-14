// Verificação DoD goal 06:
//  1. Backtest ETA v1 × v2 (erro absoluto médio) sobre viagem de teste sintética
//  2. Feeds GTFS-RT decodificáveis e estruturalmente válidos
//  3. GTFS estático gerado
//  4. Alerta operacional dispara quando linha ativa fica sem transmissão
//  5. Regra dos 90s (stale) mantida
//  6. /metrics expõe contadores
import '../src/config.js';
import GtfsRt from 'gtfs-realtime-bindings';
import { getNetwork } from '../src/network.js';
import { eta } from '../src/eta.js';
import { eta2, refreshModel } from '../src/eta2.js';
import { loadTripPath, simulateTrip, SEGMENT_SPEEDS } from './seed-eta-history.js';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8060';
const { FeedMessage } = GtfsRt.transit_realtime;

const results = [];
const check = (label, passed, extra = '') =>
  results.push({ label: label + (extra ? ` — ${extra}` : ''), passed });

// ---------------------------------------------------------------- 1. backtest
async function backtest() {
  const net = await getNetwork();
  await refreshModel(net, true);   // aprende com o histórico (viagem de treino)

  const { tripId, path } = await loadTripPath();
  const seq = net.seqByTrip.get(tripId);
  const stopByCode = new Map(net.stops.map(s => [s.code, s]));

  // viagem de avaliação: nova simulação em memória com os mesmos perfis de
  // velocidade (+ ruído 8%) — o modelo v2 só conhece a viagem de TREINO do banco.
  const { positions, arrivals } = simulateTrip(path, Date.now() - 3600_000, SEGMENT_SPEEDS, 0.08);
  const arrivalAt = new Map(arrivals.map(a => [a.stop, a.at]));

  let e1sum = 0, e2sum = 0, n = 0;
  for (let i = 0; i < positions.length; i += 3) {   // amostra a cada ~45s
    const p = positions[i];
    const t = new Date(p.recorded_at).getTime();
    for (const st of seq) {
      const stop = net.stopById.get(st.stop_id);
      const actualMs = arrivalAt.get(stop.code);
      if (!actualMs || actualMs <= t + 30_000) continue; // só paradas à frente
      const v1 = eta({ ...p }, seq, net.stopById, st.stop_id);
      const v2 = eta2({ ...p }, seq, net.stopById, st.stop_id, tripId);
      if (!v1 || !v2) continue;
      const actualS = (actualMs - t) / 1000;
      e1sum += Math.abs(v1.eta_seconds - actualS);
      e2sum += Math.abs(v2.eta_seconds - actualS);
      n++;
    }
  }
  const mae1 = e1sum / n, mae2 = e2sum / n;
  check(`ETA v2 mais preciso que v1 (MAE v1=${Math.round(mae1)}s, v2=${Math.round(mae2)}s, n=${n})`,
    mae2 < mae1, `melhora ${(100 * (1 - mae2 / mae1)).toFixed(0)}%`);
}

// ---------------------------------------------------------------- 2. GTFS-RT
async function checkGtfsRt() {
  for (const feed of ['vehicle-positions', 'trip-updates', 'service-alerts']) {
    const res = await fetch(`${BACKEND}/gtfs/realtime/${feed}`);
    const buf = Buffer.from(await res.arrayBuffer());
    let ok = res.ok && res.headers.get('content-type')?.includes('protobuf');
    let extra = `HTTP ${res.status}`;
    try {
      const msg = FeedMessage.decode(buf);
      const err = FeedMessage.verify(FeedMessage.toObject(msg));
      const h = msg.header;
      const fresh = Math.abs(Date.now() / 1000 - Number(h.timestamp)) < 60;
      ok = ok && !err && h.gtfsRealtimeVersion === '2.0' && fresh;
      extra = `entities=${msg.entity.length}, header ts fresco=${fresh}`;
    } catch (e) { ok = false; extra = e.message; }
    check(`GTFS-RT ${feed} decodifica (protobuf válido)`, ok, extra);
  }
}

// ---------------------------------------------------------------- 3. estático
async function checkGtfsStatic() {
  const res = await fetch(`${BACKEND}/gtfs/static.zip`);
  const buf = Buffer.from(await res.arrayBuffer());
  const isZip = buf.subarray(0, 2).toString() === 'PK';
  check('GTFS estático gerado (zip)', res.ok && isZip, `${(buf.length / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------- 4. alerta operacional
async function checkOperationalAlert() {
  // cria escala ativa numa linha sem ninguém transmitindo → alerta deve disparar
  const TOKEN = process.env.DIRECTUS_TOKEN;
  const DIRECTUS = process.env.DIRECTUS_URL.replace(/\/$/, '');
  const dq = async (path, opts = {}) => {
    const res = await fetch(DIRECTUS + path, {
      ...opts,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    return res.json();
  };
  const { tripId, vehicleId } = await loadTripPath();
  const drv = await dq(`/users?filter=${encodeURIComponent(JSON.stringify({ email: { _contains: 'motorista.teste' } }))}&fields=id`);
  const created = await dq('/items/driver_assignments', { method: 'POST',
    body: JSON.stringify({ driver_id: drv.data[0].id, vehicle_id: vehicleId, trip_id: tripId,
      shift_start: new Date().toISOString(), status: 'active' }) });

  await fetch(`${BACKEND}/health/check-now`, { method: 'POST' });
  const h = await (await fetch(`${BACKEND}/health/operational`)).json();
  const fired = h.status === 'alert' &&
    h.alerts.some(a => a.kind === 'line_without_signal' && a.route === 'CT-ATL');
  check('alerta dispara: linha com escala ativa sem transmissão', fired,
    JSON.stringify(h.alerts));

  // encerra a escala de teste e confirma que o alerta limpa
  await dq(`/items/driver_assignments/${created.data.id}`, { method: 'PATCH',
    body: JSON.stringify({ status: 'finished', shift_end: new Date().toISOString() }) });
  await fetch(`${BACKEND}/health/check-now`, { method: 'POST' });
  const h2 = await (await fetch(`${BACKEND}/health/operational`)).json();
  check('alerta limpa quando a escala encerra', h2.status === 'ok');
}

// ---------------------------------------------------------------- 5. regra 90s
async function checkStaleRule() {
  const r = await (await fetch(`${BACKEND}/live/fleet`)).json();
  const violation = r.vehicles.some(v => v.position &&
    (Date.now() - new Date(v.position.recorded_at).getTime()) > 90_000 && v.position.stale !== true);
  check('nenhuma posição >90s servida sem marcação stale', !violation,
    `${r.vehicles.filter(v => v.position?.stale).length} marcada(s) stale`);
}

// ---------------------------------------------------------------- 6. métricas
async function checkMetrics() {
  const txt = await (await fetch(`${BACKEND}/metrics`)).text();
  const required = ['ingest_positions_total', 'broadcast_events_total', 'vehicles_no_signal', 'ws_clients'];
  const missing = required.filter(m => !txt.includes(m));
  check('/metrics expõe contadores Prometheus', missing.length === 0,
    missing.length ? `faltam: ${missing}` : `${txt.split('# TYPE').length - 1} métricas`);
}

async function main() {
  await backtest();
  await checkGtfsRt();
  await checkGtfsStatic();
  await checkOperationalAlert();
  await checkStaleRule();
  await checkMetrics();

  console.log('\n===== DoD goal 06 =====');
  let ok = true;
  for (const r of results) { console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}`); if (!r.passed) ok = false; }
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
