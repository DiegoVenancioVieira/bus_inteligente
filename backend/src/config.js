// Config — lê config/.env da raiz do projeto (ou variáveis de ambiente já definidas)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '..', 'config', '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`Config ausente: ${name} (defina em config/.env)`); process.exit(1); }
  return v;
}

export const config = {
  directusUrl: required('DIRECTUS_URL').replace(/\/$/, ''),
  directusToken: required('DIRECTUS_TOKEN'), // usado só para LEITURA server-side
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  port: Number(process.env.BACKEND_PORT || 8060),
  host: process.env.BACKEND_HOST || '0.0.0.0',

  // Regras de frescor (PRD §9 / GTFS-RT)
  staleAfterSeconds: 90,
  lastPositionTtlMs: 24 * 60 * 60 * 1000, // última posição some do cache após 24h

  // Rate limit de ingestão (por veículo)
  rateLimit: { burst: 10, perSecond: 3 },

  // Cache de dados estáticos (linhas/pontos/viagens)
  staticCacheTtlMs: 60_000,
  // Cache curto das respostas /live (fallback de polling)
  liveCacheTtlMs: 5_000,

  // ETA MVP
  etaMinSpeedKmh: 5,     // abaixo disso usa a média
  etaAvgSpeedKmh: 20,    // velocidade média urbana assumida
};
