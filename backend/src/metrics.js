// Observabilidade (PRD §9): contadores em formato Prometheus text 0.0.4,
// sem dependências. Instrumenta ingestão, broadcast e WS; frota via /live/fleet.
const counters = {
  ingest_requests_total: 0,
  ingest_positions_total: 0,
  ingest_rejected_total: 0,
  ingest_rate_limited_total: 0,
  broadcast_events_total: 0,
  qr_scans_total: 0,
};
let wsClients = 0;
let broadcastLatencyMsSum = 0;
let broadcastLatencyMsCount = 0;

export const inc = (name, n = 1) => { if (name in counters) counters[name] += n; };
export const wsClientDelta = (d) => { wsClients += d; };
export const observeBroadcastLatency = (ms) => {
  broadcastLatencyMsSum += ms; broadcastLatencyMsCount += 1;
};

export function registerMetrics(app, { fleetSnapshot }) {
  app.get('/metrics', async (req, reply) => {
    const fleet = await fleetSnapshot().catch(() => null);
    const lines = [];
    const emit = (name, help, type, value, labels = '') => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`,
        `${name}${labels} ${value}`);
    };
    for (const [k, v] of Object.entries(counters)) {
      emit(k, k.replaceAll('_', ' '), 'counter', v);
    }
    emit('ws_clients', 'clientes WebSocket conectados', 'gauge', wsClients);
    emit('broadcast_latency_ms_avg', 'latência média ingest→publish (ms)', 'gauge',
      broadcastLatencyMsCount ? (broadcastLatencyMsSum / broadcastLatencyMsCount).toFixed(2) : 0);
    if (fleet) {
      const by = (s) => fleet.vehicles.filter(v => v.status === s).length;
      emit('vehicles_moving', 'veículos em rota', 'gauge', by('moving'));
      emit('vehicles_stopped', 'veículos parados com sinal', 'gauge', by('stopped'));
      emit('vehicles_stale', 'veículos com sinal fraco (>90s)', 'gauge', by('stale'));
      emit('vehicles_no_signal', 'veículos sem sinal (>5min)', 'gauge', by('no_signal'));
    }
    reply.type('text/plain; version=0.0.4');
    return lines.join('\n') + '\n';
  });
}
