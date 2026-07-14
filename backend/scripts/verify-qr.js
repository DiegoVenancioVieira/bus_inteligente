// Verificação DoD goal 05: decodifica os PNGs gerados (scan simulado com jsQR)
// e testa o redirecionador + contagem de scans + estabilidade após edição do ponto.
import '../src/config.js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QR_DIR = join(__dirname, '..', '..', 'infra', 'qrcodes');
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8060';
const DIRECTUS = process.env.DIRECTUS_URL.replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN;
const PUBLIC = process.env.PUBLIC_URL.replace(/\/$/, '');

const results = [];
const check = (label, passed, extra = '') =>
  results.push({ label: label + (extra ? ` — ${extra}` : ''), passed });

function decodePng(file) {
  const png = PNG.sync.read(readFileSync(file));
  const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return qr?.data ?? null;
}

async function dget(path, query = {}) {
  const url = new URL(DIRECTUS + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return (await res.json()).data;
}
async function dpatch(path, body) {
  return fetch(DIRECTUS + path, { method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
}

async function main() {
  // 1. todos os PNGs decodificam para a URL esperada (scan simulado)
  const pngs = readdirSync(QR_DIR).filter(f => f.endsWith('.png'));
  let decodedOk = 0;
  for (const f of pngs) {
    const code = f.replace('.png', '');
    const decoded = decodePng(join(QR_DIR, f));
    const qrRow = await dget('/items/qr_codes', {
      limit: 1, filter: { public_code: { _eq: code } }, fields: 'target_type' });
    const prefix = qrRow[0]?.target_type === 'vehicle' ? 'v' : 'p';
    if (decoded === `${PUBLIC}/${prefix}/${code}`) decodedOk++;
    else console.log(`  decode divergente em ${f}: ${decoded}`);
  }
  check(`QRs decodificam para a URL correta (${decodedOk}/${pngs.length})`, decodedOk === pngs.length);

  // 2. redirecionador: /p/CENTRO → 302 para a PWA do ponto certo
  const r = await fetch(`${BACKEND}/p/CENTRO`, { redirect: 'manual' });
  const loc = r.headers.get('location');
  check('GET /p/CENTRO → 302 para a PWA do ponto', r.status === 302 && loc === '/passageiro/?stop=CENTRO', `${r.status} → ${loc}`);

  // 3. cada scan incrementa qr_codes.scans
  const before = (await dget('/items/qr_codes', {
    limit: 1, filter: { public_code: { _eq: 'VALADAO' } }, fields: 'scans' }))[0].scans;
  await fetch(`${BACKEND}/p/VALADAO`, { redirect: 'manual' });
  await fetch(`${BACKEND}/p/VALADAO`, { redirect: 'manual' });
  await new Promise(res => setTimeout(res, 4000)); // aguarda o flusher (2s) gravar
  const after = (await dget('/items/qr_codes', {
    limit: 1, filter: { public_code: { _eq: 'VALADAO' } }, fields: 'scans' }))[0].scans;
  check('scans incrementados a cada acesso', after === before + 2, `${before} → ${after}`);

  // 4a. editar o nome do ponto NÃO invalida o QR (validade imediata)
  const stop = (await dget('/items/stops', {
    limit: 1, filter: { code: { _eq: 'CENTRO' } }, fields: 'id,name' }))[0];
  await dpatch(`/items/stops/${stop.id}`, { name: 'Terminal do Centro (RENOMEADO TESTE)' });
  const r2 = await fetch(`${BACKEND}/p/CENTRO`, { redirect: 'manual' });
  const live = await fetch(`${BACKEND}/live/stop/CENTRO`);
  const liveBody = await live.json();
  check('QR permanece válido logo após renomear o ponto',
    r2.status === 302 && live.ok && liveBody.stop?.code === 'CENTRO',
    `redirect ${r2.status}, live ${live.status}`);

  // 4b. o novo nome propaga após o cache de rede (60s) expirar.
  // O cache é stale-while-revalidate: a 1ª leitura pós-expiração dispara a
  // atualização e ainda serve o antigo; a leitura seguinte vê o novo.
  await new Promise(res => setTimeout(res, 66_000));
  await fetch(`${BACKEND}/live/stop/CENTRO`);            // gatilho da revalidação
  await new Promise(res => setTimeout(res, 7_000));      // revalida + expira cache live (5s)
  const live2 = await fetch(`${BACKEND}/live/stop/CENTRO`);
  const liveBody2 = await live2.json();
  await dpatch(`/items/stops/${stop.id}`, { name: stop.name }); // restaura
  check('novo nome visível após expirar o cache (60s)',
    live2.ok && liveBody2.stop?.name?.includes('RENOMEADO'),
    `"${liveBody2.stop?.name?.slice(0, 45)}"`);

  // 5. 404 para código inexistente
  const r404 = await fetch(`${BACKEND}/p/NAOEXISTE`, { redirect: 'manual' });
  check('código inexistente → 404', r404.status === 404, `HTTP ${r404.status}`);

  console.log('\n===== DoD goal 05 =====');
  let ok = true;
  for (const x of results) { console.log(`${x.passed ? 'PASS' : 'FAIL'}  ${x.label}`); if (!x.passed) ok = false; }
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
