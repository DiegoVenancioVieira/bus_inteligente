// Serviço de tempo real — Bus Inteligente (goal 01)
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { registerIngest } from './ingest.js';
import { registerLive } from './live.js';
import { registerWs } from './ws.js';
import { registerProxy } from './proxy.js';
import { registerQr } from './qr.js';
import { registerGtfs } from './gtfs.js';
import { registerMetrics } from './metrics.js';
import { registerMonitor } from './monitor.js';
import { getNetwork } from './network.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, {
  origin: [config.publicUrl, /localhost/, /127\.0\.0\.1/].filter(Boolean),
  methods: ['GET', 'POST'],
});
await app.register(websocket);

// raiz do domínio público → PWA do passageiro
app.get('/', (req, reply) => reply.redirect('/passageiro/', 302));

app.get('/health', async () => {
  const net = await getNetwork().catch(() => null);
  return {
    status: net ? 'ok' : 'degraded',
    directus: net ? 'ok' : 'unreachable',
    stops: net?.stops.length ?? 0,
    routes: net?.routes.length ?? 0,
    time: new Date().toISOString(),
  };
});

registerIngest(app);
registerLive(app);
registerWs(app);
registerProxy(app);
registerQr(app);
registerGtfs(app);
registerMonitor(app);
registerMetrics(app, {
  fleetSnapshot: async () => {
    const res = await app.inject({ method: 'GET', url: '/live/fleet' });
    return res.json();
  },
});

// App do motorista (goal 02) — servido na mesma origem
await app.register(fastifyStatic, {
  root: join(__dirname, '..', '..', 'apps', 'motorista'),
  prefix: '/motorista/',
});

// PWA do passageiro (goal 03; página provisória do goal 05)
await app.register(fastifyStatic, {
  root: join(__dirname, '..', '..', 'apps', 'passageiro'),
  prefix: '/passageiro/',
  decorateReply: false,
});

// Painel de gestão (goal 04)
await app.register(fastifyStatic, {
  root: join(__dirname, '..', '..', 'apps', 'gestao'),
  prefix: '/gestao/',
  decorateReply: false,
});

app.listen({ port: config.port, host: config.host })
  .then(() => console.log(`bus-inteligente backend em http://localhost:${config.port}`))
  .catch((err) => { console.error(err); process.exit(1); });
