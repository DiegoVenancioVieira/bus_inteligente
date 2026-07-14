// Redirecionador de QR Codes (RF-Q3): /p/{stop_code} e /v/{vehicle_code}.
// Resolve o alvo em qr_codes, conta o scan e redireciona para a PWA do passageiro.
// O public_code é estável: editar o ponto não o muda.
//
// Contagem: scans simultâneos são acumulados em memória e gravados por um único
// flusher (evita corrida read-modify-write). Instância única, como o resto do
// backend (PRD §4.1); na escala, mover o contador para Redis INCR.
import { read, dx } from './directus.js';
import { config } from './config.js';
import { inc } from './metrics.js';

const pending = new Map(); // public_code -> { qrId, delta }
let flushing = false;

async function flushScans() {
  if (flushing || pending.size === 0) return;
  flushing = true;
  try {
    for (const [code, entry] of [...pending]) {
      pending.delete(code);
      const res = await read('/items/qr_codes', {
        limit: 1, fields: 'id,scans', filter: { public_code: { _eq: code } } });
      const row = res.ok ? res.data?.[0] : null;
      if (!row) continue;
      await dx('PATCH', `/items/qr_codes/${row.id}`, {
        token: config.directusToken,
        body: { scans: (row.scans ?? 0) + entry.delta },
      });
    }
  } finally {
    flushing = false;
  }
}
setInterval(flushScans, 2_000).unref();

async function resolveAndCount(publicCode, expectedType) {
  const res = await read('/items/qr_codes', {
    limit: 1,
    fields: 'id,target_type,target_id,public_code',
    filter: { public_code: { _eq: publicCode } },
  });
  const qr = res.ok ? res.data?.[0] : null;
  if (!qr || qr.target_type !== expectedType) return null;
  const entry = pending.get(publicCode) ?? { qrId: qr.id, delta: 0 };
  entry.delta += 1;
  pending.set(publicCode, entry);
  inc('qr_scans_total');
  return qr;
}

export function registerQr(app) {
  app.get('/p/:code', async (req, reply) => {
    const qr = await resolveAndCount(req.params.code, 'stop');
    if (!qr) return reply.code(404).type('text/html')
      .send('<h1>Ponto não encontrado</h1><p>QR Code inválido ou desativado.</p>');
    return reply.redirect(`/passageiro/?stop=${encodeURIComponent(req.params.code)}`, 302);
  });

  app.get('/v/:code', async (req, reply) => {
    const qr = await resolveAndCount(req.params.code, 'vehicle');
    if (!qr) return reply.code(404).type('text/html')
      .send('<h1>Veículo não encontrado</h1><p>QR Code inválido ou desativado.</p>');
    return reply.redirect(`/passageiro/?vehicle=${encodeURIComponent(req.params.code)}`, 302);
  });
}
