// Validador GTFS-Realtime — subconjunto central das regras do MobilityData
// (github.com/MobilityData/gtfs-realtime-validator/blob/master/RULES.md).
// O validador oficial é Java sem binários publicados (só build Maven); este script
// implementa as regras estruturais e de referência cruzada mais importantes,
// conferindo os feeds contra a mesma fonte que gera o GTFS estático.
//
// Regras: E001 (POSIX time), E002 (stop_time_update ordenado), E003 (trip_id existe),
// E004 (route_id existe), E011 (stop_id existe), E022 (stop_sequence válida/crescente),
// E026/E027 (lat/lng válidos), E048 (versão 1.0/2.0), W001 (timestamps presentes),
// W002 (vehicle_id presente), frescor de header ≤65s (best practice ≤30s de geração).
import '../src/config.js';
import GtfsRt from 'gtfs-realtime-bindings';
import { getNetwork } from '../src/network.js';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8060';
const { FeedMessage } = GtfsRt.transit_realtime;

const errors = [];
const warnings = [];
const err = (rule, msg) => errors.push(`${rule}: ${msg}`);
const warn = (rule, msg) => warnings.push(`${rule}: ${msg}`);

const validPosix = (t) => t > 631152000 && t < Date.now() / 1000 + 7200; // 1990..+2h

function checkHeader(feed, name) {
  const h = feed.header;
  if (!['1.0', '2.0'].includes(h.gtfsRealtimeVersion))
    err('E048', `${name}: gtfs_realtime_version "${h.gtfsRealtimeVersion}"`);
  const ts = Number(h.timestamp);
  if (!ts) warn('W001', `${name}: header sem timestamp`);
  else if (!validPosix(ts)) err('E001', `${name}: header timestamp inválido ${ts}`);
  else if (Date.now() / 1000 - ts > 65)
    err('FRESH', `${name}: header com ${Math.round(Date.now() / 1000 - ts)}s (>65s)`);
}

async function main() {
  const net = await getNetwork();
  const tripIds = new Set(net.trips.map(t => t.id));
  const routeIds = new Set(net.routes.map(r => r.short_name));
  const stopIds = new Set(net.stops.map(s => s.code));
  const seqByTrip = net.seqByTrip;

  const fetchFeed = async (name) => {
    const res = await fetch(`${BACKEND}/gtfs/realtime/${name}`);
    if (!res.ok) { err('HTTP', `${name}: ${res.status}`); return null; }
    return FeedMessage.decode(Buffer.from(await res.arrayBuffer()));
  };

  // ---------- vehicle-positions ----------
  const vp = await fetchFeed('vehicle-positions');
  if (vp) {
    checkHeader(vp, 'vehicle-positions');
    for (const e of vp.entity) {
      const v = e.vehicle;
      if (!v) { err('E020', `${e.id}: entity sem vehicle`); continue; }
      if (!v.vehicle?.id) warn('W002', `${e.id}: sem vehicle.id`);
      const p = v.position;
      if (!p) err('E026', `${e.id}: sem position`);
      else {
        if (!(p.latitude >= -90 && p.latitude <= 90)) err('E026', `${e.id}: lat ${p.latitude}`);
        if (!(p.longitude >= -180 && p.longitude <= 180)) err('E027', `${e.id}: lng ${p.longitude}`);
      }
      const ts = Number(v.timestamp);
      if (!ts) warn('W001', `${e.id}: sem timestamp`);
      else if (!validPosix(ts)) err('E001', `${e.id}: timestamp ${ts}`);
      if (v.trip?.tripId && !tripIds.has(v.trip.tripId)) err('E003', `${e.id}: trip_id ${v.trip.tripId} não existe no GTFS`);
      if (v.trip?.routeId && !routeIds.has(v.trip.routeId)) err('E004', `${e.id}: route_id ${v.trip.routeId} não existe no GTFS`);
    }
  }

  // ---------- trip-updates ----------
  const tu = await fetchFeed('trip-updates');
  if (tu) {
    checkHeader(tu, 'trip-updates');
    for (const e of tu.entity) {
      const t = e.tripUpdate;
      if (!t) { err('E020', `${e.id}: entity sem trip_update`); continue; }
      if (!t.trip?.tripId) err('E003', `${e.id}: sem trip_id`);
      else if (!tripIds.has(t.trip.tripId)) err('E003', `${e.id}: trip_id ${t.trip.tripId} não existe`);
      if (t.trip?.routeId && !routeIds.has(t.trip.routeId)) err('E004', `${e.id}: route_id ${t.trip.routeId}`);
      const validSeqs = new Set((seqByTrip.get(t.trip?.tripId) ?? []).map(s => s.sequence));
      let prevSeq = -1;
      for (const stu of t.stopTimeUpdate ?? []) {
        if (stu.stopId && !stopIds.has(stu.stopId)) err('E011', `${e.id}: stop_id ${stu.stopId} não existe`);
        if (stu.stopSequence != null) {
          if (validSeqs.size && !validSeqs.has(stu.stopSequence))
            err('E022', `${e.id}: stop_sequence ${stu.stopSequence} não existe na viagem`);
          if (stu.stopSequence <= prevSeq)
            err('E002', `${e.id}: stop_time_updates fora de ordem (${prevSeq} → ${stu.stopSequence})`);
          prevSeq = stu.stopSequence;
        }
        const at = Number(stu.arrival?.time);
        if (at && !validPosix(at)) err('E001', `${e.id}: arrival.time ${at}`);
      }
    }
  }

  // ---------- service-alerts ----------
  const sa = await fetchFeed('service-alerts');
  if (sa) {
    checkHeader(sa, 'service-alerts');
    for (const e of sa.entity) {
      const a = e.alert;
      if (!a) { err('E020', `${e.id}: entity sem alert`); continue; }
      if (!a.headerText?.translation?.length) err('E029', `${e.id}: alerta sem header_text`);
      if (!a.informedEntity?.length) err('E033', `${e.id}: alerta sem informed_entity`);
      for (const ie of a.informedEntity ?? []) {
        if (ie.routeId && !routeIds.has(ie.routeId)) err('E004', `${e.id}: route_id ${ie.routeId}`);
        if (ie.stopId && !stopIds.has(ie.stopId)) err('E011', `${e.id}: stop_id ${ie.stopId}`);
      }
    }
  }

  const counts = {
    'vehicle-positions': vp?.entity.length ?? 0,
    'trip-updates': tu?.entity.length ?? 0,
    'service-alerts': sa?.entity.length ?? 0,
  };
  console.log('entidades:', JSON.stringify(counts));
  for (const w of warnings) console.log('WARN ', w);
  for (const e of errors) console.log('ERRO ', e);
  console.log(errors.length === 0
    ? `\nVÁLIDO — 0 erros, ${warnings.length} aviso(s)`
    : `\nINVÁLIDO — ${errors.length} erro(s)`);
  process.exit(errors.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
