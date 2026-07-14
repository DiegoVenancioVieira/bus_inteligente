// Gerador de QR Codes (goal 05): PNGs individuais + folha PDF para impressão.
// Os QR apontam para PUBLIC_URL/p/{stop_code} (pontos) e /v/{vehicle_code} (veículos).
// Correção de erro nível Q (resiste a desgaste no abrigo).
//
// Uso:
//   node scripts/qrcodes.js --route CT-ATL     # todos os pontos de uma linha (RF-Q4)
//   node scripts/qrcodes.js --stops CENTRO,VALADAO
//   node scripts/qrcodes.js --vehicles         # todos os veículos ativos
// Saída: ../infra/qrcodes/{code}.png + qr-sheet-{alvo}.pdf
import '../src/config.js';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'infra', 'qrcodes');
const DIRECTUS = process.env.DIRECTUS_URL.replace(/\/$/, '');
const PUBLIC = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN;

async function dget(path, query = {}) {
  const url = new URL(DIRECTUS + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()).data;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : null; };
  return { route: get('--route'), stops: get('--stops'), vehicles: a.includes('--vehicles') };
}

/** Garante registro em qr_codes (idempotente) e retorna os alvos. */
async function collectTargets({ route, stops, vehicles }) {
  const targets = []; // {type, code, title, subtitle, url}
  if (vehicles) {
    const vs = await dget('/items/vehicles', { limit: -1, fields: 'id,code,plate' });
    for (const v of vs) targets.push({
      type: 'vehicle', code: v.code, id: v.id,
      title: `Veículo ${v.code}`, subtitle: 'Escaneie para ver a linha e as próximas paradas',
      url: `${PUBLIC}/v/${v.code}`,
    });
  } else {
    let stopList;
    if (route) {
      const rs = await dget('/items/routes', { filter: { short_name: { _eq: route } }, fields: 'id,short_name,long_name' });
      if (!rs.length) throw new Error(`linha ${route} não encontrada`);
      const trips = await dget('/items/trips', { filter: { route_id: { _eq: rs[0].id } }, fields: 'id' });
      const st = await dget('/items/stop_times', {
        limit: -1, filter: { trip_id: { _in: trips.map(t => t.id) } }, fields: 'stop_id' });
      const ids = [...new Set(st.map(x => x.stop_id))];
      stopList = await dget('/items/stops', { limit: -1, filter: { id: { _in: ids } }, fields: 'id,code,name' });
    } else if (stops) {
      stopList = await dget('/items/stops', {
        limit: -1, filter: { code: { _in: stops.split(',') } }, fields: 'id,code,name' });
    } else {
      stopList = await dget('/items/stops', { limit: -1, fields: 'id,code,name' });
    }
    for (const s of stopList) targets.push({
      type: 'stop', code: s.code, id: s.id,
      title: s.name, subtitle: 'Escaneie e veja o ônibus chegando em tempo real',
      url: `${PUBLIC}/p/${s.code}`,
    });
  }

  // registra em qr_codes o que ainda não existir (RF-Q1)
  for (const t of targets) {
    const existing = await dget('/items/qr_codes', {
      limit: 1, filter: { public_code: { _eq: t.code } }, fields: 'id' });
    if (!existing.length) {
      await fetch(`${DIRECTUS}/items/qr_codes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: t.type, target_id: t.id, public_code: t.code, scans: 0 }),
      });
    }
  }
  return targets;
}

async function makePngs(targets) {
  for (const t of targets) {
    const buf = await QRCode.toBuffer(t.url, {
      errorCorrectionLevel: 'Q', width: 512, margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    writeFileSync(join(OUT_DIR, `${t.code}.png`), buf);
  }
}

/** Folha PDF A4, um cartaz por página (RF-Q2): QR grande + nome + código legível. */
async function makePdf(targets, label) {
  const file = join(OUT_DIR, `qr-sheet-${label}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const out = createWriteStream(file);
  doc.pipe(out);
  const W = doc.page.width; // 595pt

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (i > 0) doc.addPage();

    // faixa superior
    doc.rect(0, 0, W, 90).fill('#1565C0');
    doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(26)
      .text('Ônibus em tempo real', 0, 30, { align: 'center' });

    // nome do ponto/veículo
    doc.fill('#000000').font('Helvetica-Bold').fontSize(30)
      .text(t.title, 40, 120, { width: W - 80, align: 'center' });

    // QR central (~12cm — legível a >1m)
    const qrPng = await QRCode.toBuffer(t.url, { errorCorrectionLevel: 'Q', width: 1024, margin: 2 });
    const qrSize = 340;
    doc.image(qrPng, (W - qrSize) / 2, 210, { width: qrSize, height: qrSize });

    // código humano (fallback se o QR falhar)
    doc.font('Courier-Bold').fontSize(22).fill('#333333')
      .text(t.code, 0, 570, { align: 'center' });

    // instrução
    doc.font('Helvetica').fontSize(18).fill('#000000')
      .text(t.subtitle, 60, 615, { width: W - 120, align: 'center' });
    doc.font('Helvetica').fontSize(13).fill('#666666')
      .text('Aponte a câmera do celular para o código — não precisa instalar nada.',
        60, 660, { width: W - 120, align: 'center' });

    // rodapé
    doc.font('Helvetica-Bold').fontSize(12).fill('#1565C0')
      .text(`Bus Inteligente · Aracaju/SE · ${PUBLIC.replace('https://', '')}`, 0, 790, { align: 'center' });
  }
  doc.end();
  await new Promise((res) => out.on('finish', res));
  return { file, pages: targets.length };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const args = parseArgs();
  const targets = await collectTargets(args);
  if (!targets.length) { console.error('nenhum alvo encontrado'); process.exit(1); }

  await makePngs(targets);
  const label = args.route ?? (args.vehicles ? 'veiculos' : 'pontos');
  const { file, pages } = await makePdf(targets, label);

  console.log(`QR gerados: ${targets.length}`);
  for (const t of targets) console.log(`  ${t.code}  →  ${t.url}`);
  console.log(`PNGs em: ${OUT_DIR}`);
  console.log(`PDF (${pages} página(s)): ${file}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
