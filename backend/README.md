# Backend de tempo real — Bus Inteligente (goal 01)

Serviço **sidecar** do Directus: ingestão de posições GPS, cache de última posição, broadcast WebSocket e API pública de leitura. Node 20 + Fastify.

## Decisão de stack
Sidecar Node.js (e não extensão Directus) porque: (1) o rate limiting, o cache de rede e o fan-out WS ficam fora do ciclo de request do Directus; (2) a troca futura por MQTT (PRD §4.1-B) não toca o Directus; (3) deploy independente. A **autenticação é delegada ao Directus**: o token do motorista é repassado na escrita — quem não tem role `Driver` recebe 401/403 do próprio Directus (fonte única de permissões).

## Rodar
```bash
cd backend
npm install
npm start                 # porta 8060 (BACKEND_PORT para mudar); lê ../config/.env
npm run simulator         # move AJU-1001 pela linha CT-ATL (--interval 5 --speed 30 --loops 1)
npm run verify            # suíte DoD (requer servidor rodando)
```

## API
| Rota | Auth | Descrição |
|---|---|---|
| `GET /health` | — | status + alcance do Directus |
| `POST /ingest/position` | token Driver | objeto único **ou lote** (buffer offline). Valida faixas, ordena por `recorded_at`, rate limit 3 req/s (burst 10) por veículo → 429 |
| `GET /live/stop/{stop_code}` | pública | ponto + linhas + ETA por veículo + alertas ativos (uma chamada; cache 5s p/ polling) |
| `GET /live/route/{id\|short_name}` | pública | linha + trajeto (ida/volta) + veículos ativos + alertas |
| `GET /live/vehicle/{code}` | pública | visão embarcada (RF-P9): linha atual, posição, próximas paradas com ETA |
| `GET /live/fleet` | pública | frota inteira (RF-G1/G5): última posição por veículo + status (moving/stopped/stale/no_signal >5min) |
| `GET /gestao/` | login Operator | painel de gestão (goal 04, estático) |
| `WS /ws` | pública | `{"type":"subscribe","channel":"route:{id}"\|"stop:{code}"\|"vehicle:{code}"}` → eventos `position`; canal `stop:` chega com `stop_eta` |
| `/dx/*` | repassa Authorization | proxy allowlist → Directus (auth login/refresh, leituras da rede, escala do motorista). Mantém os apps na mesma origem |
| `GET /motorista/` | — | app do motorista (goal 02, estático) |
| `GET /p/{code}` · `/v/{code}` | pública | redirecionador dos QR (goal 05): conta o scan (serializado, sem corrida) e redireciona à PWA do passageiro |
| `GET /passageiro/` | — | PWA do passageiro (goal 03) |
| `GET /gtfs/static.zip` | pública | dataset GTFS estático (agency/routes/stops/trips/stop_times/calendar) |
| `GET /gtfs/realtime/{vehicle-positions\|trip-updates\|service-alerts}` | pública | feeds GTFS-Realtime protobuf (cache 15s; posições >90s excluídas). `?debug=json` para inspeção |
| `GET /metrics` | pública¹ | métricas Prometheus (ingestão, broadcast, WS, frota) |
| `GET /health/operational` · `POST /health/check-now` | pública¹ | alertas operacionais (linha com escala ativa sem transmissão; checagem a cada 60s; webhook opcional `ALERT_WEBHOOK_URL`) |

¹ Em produção, restrinja `/metrics` e `/health/*` no proxy à rede interna.

**ETA v2 (goal 06):** `src/eta2.js` aprende a velocidade média **por segmento do trajeto** com o histórico de 7 dias (recarrega a cada 5 min) e combina com a velocidade instantânea no segmento atual. Backtest (`npm run verify:goal06`): **MAE 209s vs 419s do v1 — ~50% melhor** em trajeto com velocidades variando por segmento. Treinar com dados sintéticos: `npm run seed:eta`.

**Validação GTFS-RT:** `npm run validate:gtfsrt` — regras centrais do MobilityData (E001–E048: referências cruzadas trip/route/stop, ordenação, timestamps, faixas). O validador oficial é Java sem binário publicado (build Maven); este script cobre o subconjunto estrutural + referencial com a mesma semântica.

Gerar QR: `npm run qrcodes -- --route CT-ATL` (ou `--vehicles`, `--stops A,B`) → PNGs + PDF em `infra/qrcodes/`. Verificação: `npm run verify:qr`.

Toda posição servida carrega `stale: true` quando `recorded_at` > **90s** (PRD §9).

## Arquitetura interna
```
ingest.js  → valida → Directus (token do motorista) → store.js (última posição + pub/sub)
                                                        ├→ ws.js (assinantes WS)
live.js    → network.js (cache 60s de linhas/pontos/viagens) + store.js → resposta com eta.js
```
`store.js` é in-memory (instância única) com interface estável — na escala, trocar por Redis pub/sub ou MQTT sem tocar nos consumidores. `eta.js` é o MVP (distância ao longo do trajeto ÷ velocidade); o goal 06 substitui a implementação mantendo a interface.

## Verificação DoD (2026-07-10) — 8/8 PASS
anônimo rejeitado (401) · driver grava (200) · **WS 0,10s** (≤5s) · lote fora de ordem aceito/ordenado · visível no polling `/live/stop` com ETA · `stale` marcado >90s · rate limit 429 · simulador percorre CT-ATL e o veículo se move nas leituras ao vivo.

## Deploy (produção)
Rodar no mesmo servidor do Directus (systemd ou container), expor via proxy reverso como `https://bus.candidatosinteligentes.com.br/api/*` e `wss://…/api/ws` (a PWA do goal 03 espera esses caminhos ou configuráveis).
