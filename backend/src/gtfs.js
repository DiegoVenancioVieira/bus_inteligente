// Interoperabilidade GTFS (PRD §2.1, RF-G8):
//  - GET /gtfs/static.zip                       dataset estático (agency, routes, stops, trips, stop_times, calendar)
//  - GET /gtfs/realtime/vehicle-positions       protobuf GTFS-RT
//  - GET /gtfs/realtime/trip-updates            protobuf GTFS-RT (ETA v2)
//  - GET /gtfs/realtime/service-alerts          protobuf GTFS-RT
// Regras de frescor: feeds RT montados sob demanda com cache 15s (≤30s exigido);
// posições >90s NÃO entram no feed (o timestamp por entidade marca o frescor).
import GtfsRt from 'gtfs-realtime-bindings';
import archiver from 'archiver';   // v5 fixado: CJS estável (v7+ mudou a API p/ classes ESM)
import { PassThrough } from 'node:stream';
import { getNetwork } from './network.js';
import { getLastPosition } from './store.js';
import { read } from './directus.js';
import { eta2, refreshModel } from './eta2.js';
import { config } from './config.js';

const { FeedMessage } = GtfsRt.transit_realtime;

const csv = (rows) => rows.map(r => r.map(v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}).join(',')).join('\n') + '\n';

// ---------------------------------------------------------------- estático
async function buildStaticFiles() {
  const net = await getNetwork();
  const agencies = await read('/items/agencies', { limit: -1, fields: 'id,name,timezone' });
  const ag = agencies.data?.[0] ?? { name: 'Bus Inteligente', timezone: 'America/Maceio' };

  const files = {};
  files['agency.txt'] = csv([
    ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
    ['1', ag.name, config.publicUrl || 'https://example.com', ag.timezone, 'pt']]);

  files['stops.txt'] = csv([
    ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
    ...net.stops.map(s => [s.code, s.name, Number(s.lat).toFixed(6), Number(s.lng).toFixed(6)])]);

  files['routes.txt'] = csv([
    ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'],
    ...net.routes.map(r => [r.short_name, '1', r.short_name, r.long_name ?? '', 3,
      (r.color ?? '#1565C0').replace('#', '')])]);

  files['calendar.txt'] = csv([
    ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    ['diario', 1, 1, 1, 1, 1, 1, 1, '20260101', '20271231']]);

  files['trips.txt'] = csv([
    ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id'],
    ...net.trips.map(t => [net.routeById.get(t.route_id)?.short_name ?? t.route_id, 'diario',
      t.id, t.headsign ?? '', t.direction === 'volta' ? 1 : 0])]);

  const stRows = [];
  for (const [tripId, seq] of net.seqByTrip) {
    for (const st of seq) {
      const stop = net.stopById.get(st.stop_id);
      const time = st.scheduled_time ?? '';
      stRows.push([tripId, time, time, stop.code, st.sequence]);
    }
  }
  files['stop_times.txt'] = csv([
    ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], ...stRows]);

  files['feed_info.txt'] = csv([
    ['feed_publisher_name', 'feed_publisher_url', 'feed_lang'],
    ['Bus Inteligente Aracaju', config.publicUrl || 'https://example.com', 'pt']]);
  return files;
}

// ---------------------------------------------------------------- realtime
const rtCache = new Map(); // path -> { at, buf }
async function cachedFeed(key, builder) {
  const hit = rtCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.buf;
  const msg = await builder();
  const buf = Buffer.from(FeedMessage.encode(FeedMessage.create(msg)).finish());
  rtCache.set(key, { at: Date.now(), buf });
  return buf;
}

const header = () => ({
  gtfsRealtimeVersion: '2.0',
  incrementality: 0, // FULL_DATASET
  timestamp: Math.floor(Date.now() / 1000),
});

/** posições frescas (<90s) por veículo com viagem ativa */
function freshPositions(net) {
  const out = [];
  for (const v of net.vehicleById.values()) {
    const p = getLastPosition(v.id);
    if (!p || !p.trip_id) continue;
    const age = Date.now() - new Date(p.recorded_at).getTime();
    if (age > config.staleAfterSeconds * 1000) continue;
    out.push({ vehicle: v, position: p });
  }
  return out;
}

async function vehiclePositionsFeed() {
  const net = await getNetwork();
  return {
    header: header(),
    entity: freshPositions(net).map(({ vehicle, position }) => {
      const trip = net.tripById.get(position.trip_id);
      const route = trip ? net.routeById.get(trip.route_id) : null;
      return {
        id: `vp-${vehicle.code}`,
        vehicle: {
          trip: trip ? { tripId: trip.id, routeId: route?.short_name } : undefined,
          vehicle: { id: vehicle.id, label: vehicle.code },
          position: {
            latitude: Number(position.lat), longitude: Number(position.lng),
            bearing: position.heading ?? undefined,
            speed: position.speed != null ? Number(position.speed) / 3.6 : undefined, // m/s
          },
          timestamp: Math.floor(new Date(position.recorded_at).getTime() / 1000),
        },
      };
    }),
  };
}

async function tripUpdatesFeed() {
  const net = await getNetwork();
  await refreshModel(net);
  const entities = [];
  for (const { vehicle, position } of freshPositions(net)) {
    const trip = net.tripById.get(position.trip_id);
    if (!trip) continue;
    const route = net.routeById.get(trip.route_id);
    const seq = net.seqByTrip.get(trip.id) ?? [];
    const updates = [];
    for (const st of seq) {
      const e = eta2(position, seq, net.stopById, st.stop_id, trip.id);
      if (!e) continue;
      updates.push({
        stopId: net.stopById.get(st.stop_id).code,
        stopSequence: st.sequence,
        arrival: { time: Math.floor(Date.now() / 1000) + e.eta_seconds, uncertainty: 60 },
      });
    }
    if (!updates.length) continue;
    entities.push({
      id: `tu-${vehicle.code}`,
      tripUpdate: {
        trip: { tripId: trip.id, routeId: route?.short_name },
        vehicle: { id: vehicle.id, label: vehicle.code },
        stopTimeUpdate: updates,
        timestamp: Math.floor(new Date(position.recorded_at).getTime() / 1000),
      },
    });
  }
  return { header: header(), entity: entities };
}

async function serviceAlertsFeed() {
  const net = await getNetwork();
  const res = await read('/items/service_alerts', {
    limit: 50, fields: 'id,scope,route_id,stop_id,title,message,severity,active_from,active_to',
    filter: { _and: [
      { active_from: { _lte: '$NOW' } },
      { _or: [{ active_to: { _null: true } }, { active_to: { _gte: '$NOW' } }] }] },
  });
  const sevMap = { info: 5, warning: 6, critical: 7 }; // INFORMATION/WARNING/SEVERE
  return {
    header: header(),
    entity: (res.ok ? res.data : []).map(a => ({
      id: `al-${a.id}`,
      alert: {
        activePeriod: [{
          start: Math.floor(new Date(a.active_from).getTime() / 1000),
          ...(a.active_to ? { end: Math.floor(new Date(a.active_to).getTime() / 1000) } : {}),
        }],
        informedEntity: a.scope === 'route' && a.route_id
          ? [{ routeId: net.routeById.get(a.route_id)?.short_name }]
          : a.scope === 'stop' && a.stop_id
            ? [{ stopId: net.stopById.get(a.stop_id)?.code }]
            : [{ agencyId: '1' }],
        headerText: { translation: [{ text: a.title, language: 'pt' }] },
        descriptionText: { translation: [{ text: a.message ?? '', language: 'pt' }] },
        severityLevel: sevMap[a.severity] ?? 5,
      },
    })),
  };
}

// ---------------------------------------------------------------- rotas
export function registerGtfs(app) {
  app.get('/gtfs/static.zip', async (req, reply) => {
    const files = await buildStaticFiles();
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    archive.pipe(stream);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    archive.finalize();
    reply.type('application/zip')
      .header('content-disposition', 'attachment; filename="gtfs-bus-inteligente.zip"');
    return reply.send(stream);
  });

  const rt = (path, builder) => app.get(path, async (req, reply) => {
    const buf = await cachedFeed(path, builder);
    if (req.query.debug === 'json') {   // inspeção humana
      return reply.send(FeedMessage.toObject(FeedMessage.decode(buf), { longs: Number }));
    }
    reply.type('application/x-protobuf');
    return reply.send(buf);
  });
  rt('/gtfs/realtime/vehicle-positions', vehiclePositionsFeed);
  rt('/gtfs/realtime/trip-updates', tripUpdatesFeed);
  rt('/gtfs/realtime/service-alerts', serviceAlertsFeed);
}
