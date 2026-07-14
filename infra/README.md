# Infra — Bus Inteligente

Instância de produção: `https://directus-bus.candidatosinteligentes.com.br`
**Directus 11.17.4 · Postgres (com PostGIS) · provisionada em 2026-07-10 pelo goal 00.**

## Arquivos
| Arquivo | Função |
|---|---|
| [`scripts/bootstrap.py`](scripts/bootstrap.py) | Cria coleções, relações, papéis/permissões, flow de retenção, settings e seeds. **Idempotente** — pode re-executar. |
| [`schema/snapshot.yaml`](schema/snapshot.yaml) | Snapshot do schema (fonte de verdade versionada). |
| [`docker-compose.yml`](docker-compose.yml) | Referência para recriar o ambiente (dev/DR). |
| [`seeds/aracaju-pilot.json`](seeds/aracaju-pilot.json) | Linha-piloto Aracaju (ver avisos em `seeds/README.md`). |

## Provisionar do zero
```bash
# 1. subir os containers
DB_PASSWORD=... DIRECTUS_SECRET=... ADMIN_PASSWORD=... docker compose up -d

# 2. aplicar o schema versionado
npx directus schema apply ./schema/snapshot.yaml   # (dentro do container: npx directus ...)
#    ou, alternativamente, rodar o bootstrap completo (schema + permissões + seeds):
python scripts/bootstrap.py                        # lê config/.env na raiz
```

## O que o bootstrap criou (estado atual da produção)
- **10 coleções** (PRD §5): `agencies, routes, stops, trips, stop_times, vehicles, vehicle_positions, driver_assignments, service_alerts, qr_codes` — com `stops.geo` (PostGIS Point) e 12 relações m2o.
- **Papéis/policies**: `Public` (leitura filtrada: linhas ativas, alertas vigentes, posições ≤24h, veículos sem placa), `Driver` (grava posições; vê/gerencia a própria escala), `Operator` (CRUD operacional, acesso ao app Directus), `Administrator`.
- **Flow de retenção**: cron diário 03:00 expurga `vehicle_positions` com >30 dias.
- **Settings**: projeto "Bus Inteligente", idioma `pt-BR`, URL pública.
- **Seeds Aracaju**: SMTT, linha `CT-ATL` (Centro↔Atalaia), 8 pontos, 2 viagens (ida/volta) com horários, 2 veículos, 10 registros `qr_codes`.
- **Usuário de teste**: `motorista.teste@…` (role Driver) — token em `config/.env` → `DRIVER_TEST_TOKEN` (usado pelo simulador do goal 01).

## Pendências manuais (anotar no servidor)
1. **Índice composto** `vehicle_positions(vehicle_id, recorded_at)` — a API do Directus não cria índice composto; aplicar via SQL quando o volume crescer:
   ```sql
   CREATE INDEX idx_vp_vehicle_time ON vehicle_positions (vehicle_id, recorded_at DESC);
   ```
2. **WebSocket**: confirmado no ar em produção (`/websocket` → HTTP 101 em 2026-07-10). Falta apenas confirmar `CACHE_STORE=redis` no ambiente (necessário no goal 01).
3. **Rotacionar o token admin** (`DIRECTUS_TOKEN`) — foi trafegado em chat durante o setup.

## Verificação executada (DoD goal 00 — 2026-07-10)
- health 200 sem auth ✔ · 10 coleções ✔ · anônimo lê `stops` (8) ✔ · anônimo **não** grava posição (403) ✔ · driver grava posição (200) ✔ · snapshot exportado ✔
