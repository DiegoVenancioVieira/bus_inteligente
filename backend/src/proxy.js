// Proxy /dx/* → Directus, com allowlist estrita. Permite que os apps (motorista,
// gestão) falem só com este backend (mesma origem), como na topologia de produção.
// A autorização real é do Directus: o header Authorization é repassado intacto —
// quem não tem a role certa recebe 401/403 do próprio Directus.
import { config } from './config.js';

const READ_COLLECTIONS = new Set([
  'vehicles', 'routes', 'trips', 'stop_times', 'stops',
  'service_alerts', 'driver_assignments',
  'qr_codes',            // gestão: KPI de scans (público também lê)
  'vehicle_positions',   // gestão: replay (leitura pública limitada a 24h; operador vê tudo)
]);

// escrita permitida por coleção (o Directus ainda valida a role)
const WRITE_COLLECTIONS = new Set(['driver_assignments', 'service_alerts']);

async function forward(req, reply, method, path) {
  const url = new URL(config.directusUrl + path);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
    },
    body: ['POST', 'PATCH', 'DELETE'].includes(method) && req.body !== undefined
      ? JSON.stringify(req.body) : undefined,
  });
  const text = await res.text();
  reply.code(res.status).header('content-type', 'application/json');
  return reply.send(text || '{}');
}

export function registerProxy(app) {
  app.post('/dx/auth/login', (req, reply) => forward(req, reply, 'POST', '/auth/login'));
  app.post('/dx/auth/refresh', (req, reply) => forward(req, reply, 'POST', '/auth/refresh'));
  app.get('/dx/users/me', (req, reply) => forward(req, reply, 'GET', '/users/me'));
  // gestão: listar motoristas p/ escala (permissão fina fica na policy Operator)
  app.get('/dx/users', (req, reply) => forward(req, reply, 'GET', '/users'));

  app.get('/dx/items/:collection', (req, reply) => {
    if (!READ_COLLECTIONS.has(req.params.collection))
      return reply.code(403).send({ error: 'coleção não permitida' });
    return forward(req, reply, 'GET', `/items/${req.params.collection}`);
  });

  app.post('/dx/items/:collection', (req, reply) => {
    if (!WRITE_COLLECTIONS.has(req.params.collection))
      return reply.code(403).send({ error: 'coleção não permitida' });
    return forward(req, reply, 'POST', `/items/${req.params.collection}`);
  });
  app.patch('/dx/items/:collection/:id', (req, reply) => {
    if (!WRITE_COLLECTIONS.has(req.params.collection))
      return reply.code(403).send({ error: 'coleção não permitida' });
    return forward(req, reply, 'PATCH', `/items/${req.params.collection}/${req.params.id}`);
  });
  app.delete('/dx/items/:collection/:id', (req, reply) => {
    if (!WRITE_COLLECTIONS.has(req.params.collection))
      return reply.code(403).send({ error: 'coleção não permitida' });
    return forward(req, reply, 'DELETE', `/items/${req.params.collection}/${req.params.id}`);
  });
}
