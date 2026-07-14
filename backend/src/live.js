// API pública de leitura (RF-P2/P3/P4, RF-G1): /live/stop/{code} e /live/route/{id}.
// Cache curto para suportar polling de 15–30s de muitos clientes.
import { read } from './directus.js';
import { getNetwork } from './network.js';
import { getLastPosition, withStale } from './store.js';
import { eta2, refreshModel } from './eta2.js';
import { config } from './config.js';

const liveCache = new Map(); // key -> { at, payload }
function cached(key, builder) {
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < config.liveCacheTtlMs) return hit.payload;
  return null;
}
function keep(key, payload) {
  liveCache.set(key, { at: Date.now(), payload });
  return payload;
}

async function activeAlerts({ routeId, stopId }) {
  const or = [{ scope: { _eq: 'system' } }];
  if (routeId) or.push({ _and: [{ scope: { _eq: 'route' } }, { route_id: { _eq: routeId } }] });
  if (stopId) or.push({ _and: [{ scope: { _eq: 'stop' } }, { stop_id: { _eq: stopId } }] });
  const res = await read('/items/service_alerts', {
    limit: 20,
    fields: 'id,scope,title,message,severity,active_from,active_to',
    filter: {
      _and: [
        { active_from: { _lte: '$NOW' } },
        { _or: [{ active_to: { _null: true } }, { active_to: { _gte: '$NOW' } }] },
        { _or: or },
      ],
    },
  });
  return res.ok ? res.data : [];
}

/** Últimas posições dos veículos com viagem ativa numa linha (cache → fallback Directus). */
async function routeVehiclePositions(net, routeId) {
  const tripIds = net.trips.filter(t => t.route_id === routeId).map(t => t.id);
  const out = [];
  const seenVehicles = new Set();

  // 1. cache em memória (tempo real)
  for (const v of net.vehicleById.values()) {
    const p = getLastPosition(v.id);
    if (p && p.trip_id && tripIds.includes(p.trip_id)) {
      out.push({ vehicle: { id: v.id, code: v.code, features: v.features }, position: withStale(p) });
      seenVehicles.add(v.id);
    }
  }
  // 2. fallback: última posição persistida (ex.: após restart do serviço)
  if (out.length === 0 && tripIds.length) {
    const res = await read('/items/vehicle_positions', {
      limit: 50, sort: '-recorded_at',
      fields: 'vehicle_id,trip_id,lat,lng,speed,heading,recorded_at',
      filter: { trip_id: { _in: tripIds } },
    });
    if (res.ok) {
      for (const p of res.data) {
        if (seenVehicles.has(p.vehicle_id)) continue;
        seenVehicles.add(p.vehicle_id);
        const v = net.vehicleById.get(p.vehicle_id);
        out.push({ vehicle: v ? { id: v.id, code: v.code, features: v.features } : { id: p.vehicle_id },
                   position: withStale(p) });
      }
    }
  }
  return out;
}

export function registerLive(app) {
  // ---- tela do ponto (uma chamada, PRD §7 passo 4) ------------------------
  app.get('/live/stop/:code', async (req, reply) => {
    const code = req.params.code;
    const hit = cached(`stop:${code}`);
    if (hit) return reply.send(hit);

    const net = await getNetwork();
    refreshModel(net).catch(() => {});   // mantém o modelo ETA v2 aquecido
    const stop = net.stopByCode.get(code);
    if (!stop) return reply.code(404).send({ error: 'ponto não encontrado' });

    const tripIds = net.tripsByStop.get(stop.id) ?? [];
    const arrivals = [];
    const routesSeen = new Map();

    for (const tripId of tripIds) {
      const trip = net.tripById.get(tripId);
      const route = net.routeById.get(trip?.route_id);
      if (!route || route.status !== 'active') continue;
      if (!routesSeen.has(route.id)) {
        routesSeen.set(route.id, {
          route: { id: route.id, short_name: route.short_name, long_name: route.long_name, color: route.color },
          arrivals: [],
        });
      }
      const seq = net.seqByTrip.get(tripId) ?? [];
      const positions = await routeVehiclePositions(net, route.id);
      for (const { vehicle, position } of positions) {
        if (position.trip_id !== tripId) continue;
        const e = eta2(position, seq, net.stopById, stop.id, tripId);
        if (!e) continue; // veículo já passou deste ponto
        routesSeen.get(route.id).arrivals.push({
          trip_id: tripId, headsign: trip.headsign, direction: trip.direction,
          vehicle, position, ...e,
        });
      }
    }
    for (const r of routesSeen.values()) {
      r.arrivals.sort((a, b) => a.eta_seconds - b.eta_seconds);
      arrivals.push(r);
    }

    const payload = {
      stop: { id: stop.id, code: stop.code, name: stop.name,
              lat: Number(stop.lat), lng: Number(stop.lng), accessibility: stop.accessibility },
      lines: arrivals,
      alerts: await activeAlerts({ stopId: stop.id, routeId: arrivals[0]?.route?.id }),
      generated_at: new Date().toISOString(),
    };
    return reply.send(keep(`stop:${code}`, payload));
  });

  // ---- frota inteira (RF-G1/G5: mapa de gestão + monitor de saúde) ---------
  app.get('/live/fleet', async (req, reply) => {
    const hit = cached('fleet');
    if (hit) return reply.send(hit);

    const net = await getNetwork();

    // última posição por veículo: cache em memória → fallback banco
    const positions = new Map();
    for (const v of net.vehicleById.values()) {
      const p = getLastPosition(v.id);
      if (p) positions.set(v.id, p);
    }
    if (positions.size < net.vehicleById.size) {
      const res = await read('/items/vehicle_positions', {
        limit: 200, sort: '-recorded_at',
        fields: 'vehicle_id,trip_id,lat,lng,speed,heading,recorded_at',
      });
      if (res.ok) for (const p of res.data) {
        if (!positions.has(p.vehicle_id)) positions.set(p.vehicle_id, p);
      }
    }

    const NO_SIGNAL_MS = 5 * 60_000;
    const vehicles = [];
    for (const v of net.vehicleById.values()) {
      const raw = positions.get(v.id) ?? null;
      const position = withStale(raw);
      const trip = raw?.trip_id ? net.tripById.get(raw.trip_id) : null;
      const route = trip ? net.routeById.get(trip.route_id) : null;
      const age = raw ? Date.now() - new Date(raw.recorded_at).getTime() : Infinity;
      let status;
      if (!raw || age > NO_SIGNAL_MS) status = 'no_signal';
      else if (position.stale) status = 'stale';
      else if ((Number(raw.speed) || 0) <= 3) status = 'stopped';
      else status = 'moving';
      vehicles.push({
        vehicle: { id: v.id, code: v.code, capacity: v.capacity, features: v.features, status: v.status },
        route: route ? { id: route.id, short_name: route.short_name, color: route.color } : null,
        trip: trip ? { id: trip.id, headsign: trip.headsign, direction: trip.direction } : null,
        position, status,
        age_seconds: raw ? Math.round(age / 1000) : null,
      });
    }

    const payload = { vehicles, generated_at: new Date().toISOString() };
    return reply.send(keep('fleet', payload));
  });

  // ---- visão embarcada do veículo (RF-P9: QR dentro do ônibus) -------------
  app.get('/live/vehicle/:code', async (req, reply) => {
    const code = req.params.code;
    const hit = cached(`vehicle:${code}`);
    if (hit) return reply.send(hit);

    const net = await getNetwork();
    const vehicle = net.vehicleByCode.get(code);
    if (!vehicle) return reply.code(404).send({ error: 'veículo não encontrado' });

    let position = getLastPosition(vehicle.id);
    if (!position) {
      const res = await read('/items/vehicle_positions', {
        limit: 1, sort: '-recorded_at',
        fields: 'vehicle_id,trip_id,lat,lng,speed,heading,recorded_at',
        filter: { vehicle_id: { _eq: vehicle.id } },
      });
      position = res.ok ? res.data?.[0] ?? null : null;
    }

    const trip = position?.trip_id ? net.tripById.get(position.trip_id) : null;
    const route = trip ? net.routeById.get(trip.route_id) : null;
    const seq = trip ? net.seqByTrip.get(trip.id) ?? [] : [];

    // próximas paradas com ETA (as que ainda estão à frente)
    const nextStops = [];
    if (position && seq.length) {
      refreshModel(net).catch(() => {});
      for (const st of seq) {
        const s = net.stopById.get(st.stop_id);
        const e = eta2(position, seq, net.stopById, st.stop_id, trip?.id);
        if (e) nextStops.push({ code: s.code, name: s.name, sequence: st.sequence, ...e });
      }
      nextStops.sort((a, b) => a.sequence - b.sequence);
    }

    const payload = {
      vehicle: { id: vehicle.id, code: vehicle.code, features: vehicle.features },
      route: route ? { id: route.id, short_name: route.short_name, long_name: route.long_name, color: route.color } : null,
      trip: trip ? { id: trip.id, headsign: trip.headsign, direction: trip.direction } : null,
      position: withStale(position),
      next_stops: nextStops,
      alerts: route ? await activeAlerts({ routeId: route.id }) : [],
      generated_at: new Date().toISOString(),
    };
    return reply.send(keep(`vehicle:${code}`, payload));
  });

  // ---- visão da linha (RF-P4 / RF-G1) -------------------------------------
  app.get('/live/route/:id', async (req, reply) => {
    const id = req.params.id;
    const hit = cached(`route:${id}`);
    if (hit) return reply.send(hit);

    const net = await getNetwork();
    const route = net.routeById.get(id) ??
      net.routes.find(r => r.short_name === id); // aceita short_name também
    if (!route) return reply.code(404).send({ error: 'linha não encontrada' });

    const directions = net.trips
      .filter(t => t.route_id === route.id)
      .map(t => ({
        trip_id: t.id, headsign: t.headsign, direction: t.direction,
        stops: (net.seqByTrip.get(t.id) ?? []).map(st => {
          const s = net.stopById.get(st.stop_id);
          return { code: s.code, name: s.name, lat: Number(s.lat), lng: Number(s.lng),
                   sequence: st.sequence, scheduled_time: st.scheduled_time };
        }),
      }));

    const payload = {
      route: { id: route.id, short_name: route.short_name, long_name: route.long_name, color: route.color },
      directions,
      vehicles: await routeVehiclePositions(net, route.id),
      alerts: await activeAlerts({ routeId: route.id }),
      generated_at: new Date().toISOString(),
    };
    return reply.send(keep(`route:${id}`, payload));
  });
}
