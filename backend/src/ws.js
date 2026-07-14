// WebSocket público: clientes assinam canais e recebem posições em tempo real.
// Protocolo: { "type": "subscribe", "channel": "route:{id}" | "stop:{code}" | "vehicle:{code}" }
// Canal stop:{code} é resolvido para as linhas que atendem o ponto e o evento
// chega enriquecido com o ETA daquele ponto.
import { subscribe } from './store.js';
import { getNetwork } from './network.js';
import { eta2 } from './eta2.js';
import { wsClientDelta } from './metrics.js';

export function registerWs(app) {
  app.get('/ws', { websocket: true }, (socket) => {
    wsClientDelta(1);
    const unsubs = [];
    const send = (obj) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(obj));
    };

    socket.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return send({ type: 'error', error: 'JSON inválido' }); }
      if (msg.type !== 'subscribe' || typeof msg.channel !== 'string')
        return send({ type: 'error', error: 'use {type:"subscribe",channel:"route:{id}|stop:{code}|vehicle:{code}"}' });

      const [kind, key] = msg.channel.split(':', 2);
      if (!['route', 'stop', 'vehicle'].includes(kind) || !key)
        return send({ type: 'error', error: 'canal inválido' });

      if (kind === 'stop') {
        // resolve o ponto → linhas que o atendem; enriquece evento com ETA do ponto
        const net = await getNetwork().catch(() => null);
        const stop = net?.stopByCode.get(key);
        if (!stop) return send({ type: 'error', error: 'ponto não encontrado' });
        const tripIds = net.tripsByStop.get(stop.id) ?? [];
        const routeIds = [...new Set(tripIds.map(t => net.tripById.get(t)?.route_id).filter(Boolean))];
        for (const rid of routeIds) {
          unsubs.push(subscribe(`route:${rid}`, (event) => {
            const seq = event.trip_id ? net.seqByTrip.get(event.trip_id) : null;
            const e = seq ? eta2(event.position, seq, net.stopById, stop.id, event.trip_id) : null;
            send({ ...event, channel: msg.channel, stop_eta: e });
          }));
        }
      } else {
        unsubs.push(subscribe(msg.channel, (event) => send({ ...event, channel: msg.channel })));
      }
      send({ type: 'subscribed', channel: msg.channel });
    });

    socket.on('close', () => { wsClientDelta(-1); for (const u of unsubs) u(); });
  });
}
