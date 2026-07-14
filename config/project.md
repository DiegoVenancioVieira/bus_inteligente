# Configuração do projeto — Bus Inteligente

Valores compartilhados por todos os goals. Referencie este arquivo em qualquer goal.

## Ambiente

| Chave | Valor |
|---|---|
| Cidade piloto | Aracaju / Sergipe / Brasil |
| Timezone (IANA) | `America/Maceio` |
| Locale padrão | `pt-BR` |
| URL pública (passageiro + gestão) | `https://bus.candidatosinteligentes.com.br` |
| Padrão de URL do QR (ponto) | `https://bus.candidatosinteligentes.com.br/p/{stop_code}` |
| Padrão de URL do QR (veículo) | `https://bus.candidatosinteligentes.com.br/v/{vehicle_code}` |
| Directus (API/DB/Auth/Realtime) | **`http://192.168.0.118:8057`** (VPS local, projeto "Directus - BUS"). ⚠️ o antigo `directus-bus.candidatosinteligentes.com.br` NÃO é o correto |
| Token estático Directus | Variável `DIRECTUS_TOKEN` em `config/.env` |
| **Banco do Directus** | **SQLite (sem suporte espacial)** — o campo `geo` foi removido do schema; o app usa `lat`/`lng`. O `bootstrap.py` detecta e remove `geo` automaticamente em bancos sem espacial. |

## Endpoints Directus úteis
- REST base: `https://directus-bus.candidatosinteligentes.com.br/items/{collection}`
- Auth: `POST /auth/login` (motorista/operador/admin)
- Realtime (WebSocket): `wss://directus-bus.candidatosinteligentes.com.br/websocket`
- Health: `GET /server/health` · Info: `GET /server/info`

## Estado da infraestrutura (última atualização: 2026-07-14 — Directus CORRIGIDO)
- **Directus correto: `http://192.168.0.118:8057`** (Directus 11.17.4, **SQLite**), reprovisionado do zero em 2026-07-14. Alcançável desta máquina (mesma LAN). O `directus-bus.candidatosinteligentes.com.br` usado nos goals 00-06 era o instância ERRADA.
- **Schema provisionado**: 10 coleções do PRD §5 + 12 relações m2o. **SEM campo `geo`** (SQLite não tem espacial; app usa lat/lng). Snapshot atualizado em `infra/schema/snapshot.yaml`.
- Armadilhas resolvidas nesta migração: (1) campo `geo` quebrava toda leitura de `stops` (`st_astext` inexistente no SQLite) → `bootstrap.py` agora detecta e remove; (2) `stop_times` da 1ª tentativa nasceram com `stop_id` nulo (resposta 500 fazia o upsert retornar None) → viagens apagadas e recriadas corretas.
- **Papéis**: Public (leitura filtrada), Driver (grava posições), Operator (CRUD), Administrator. Verificado: anônimo lê stops, anônimo NÃO grava posição (403), driver grava (200).
- **Retenção**: flow diário 03:00 expurga `vehicle_positions` >30 dias.
- **Seeds Aracaju** carregados: SMTT, linha `CT-ATL`, 8 pontos, 2 viagens, 2 veículos, 10 `qr_codes`.
- **Usuário de teste**: `motorista.teste@…` (Driver) — token em `config/.env` (`DRIVER_TEST_TOKEN`).
- Settings: projeto "Bus Inteligente", `pt-BR`.
- **Pendências manuais**: índice composto `vehicle_positions(vehicle_id, recorded_at)` via SQL; confirmar Redis/WebSocket env em produção; **rotacionar token admin**.
- **Goal 01 CONCLUÍDO (2026-07-10):** backend de tempo real em `backend/` (Node 20 + Fastify, porta 8060). Ingestão `POST /ingest/position` (auth delegada ao Directus via token do motorista), leitura pública `GET /live/stop/{code}` e `GET /live/route/{id|short_name}`, WebSocket `/ws` (canais `route:`/`stop:`/`vehicle:`), ETA MVP, `stale` >90s, rate limit, simulador (`npm run simulator`) e suíte DoD (`npm run verify` — 8/8 PASS, WS 0,10s). **Pendente**: deploy no servidor (proxy `https://bus.candidatosinteligentes.com.br/api/*`).
- **Goal 02 CONCLUÍDO (2026-07-10):** app do motorista em `apps/motorista/` (PWA vanilla, servida pelo backend em `/motorista/`). Login e-mail+PIN com sessão longa (refresh automático), turno via `driver_assignments`, GPS adaptativo 5s/15s, fila IndexedDB com flush em lote, Wake Lock, avisos (poll 60s), GPS simulado para demo/desktop. Backend ganhou proxy `/dx/*` (allowlist) e static serving. Teste e2e no navegador: DoD 5/5 (cadência 2–4s; buffer offline 2min em ordem; encerramento fecha escala e para transmissão; alertas exibidos). Credenciais de teste em `config/.env` (`DRIVER_TEST_PASSWORD`).
- **Goal 05 CONCLUÍDO (2026-07-10):** QR Codes — CLI `npm run qrcodes` (lote por linha/veículos), PNGs EC-Q + folha PDF A4 em `infra/qrcodes/`, redirecionador `/p/{code}`|`/v/{code}` com contagem de scans serializada, página provisória do passageiro em `apps/passageiro/`. DoD 6/6 (`npm run verify:qr`), com decodificação real dos QR via jsQR. Fluxo completo testado no navegador: /p/CENTRO → 302 → página com chegadas ao vivo.
- **Goal 03 CONCLUÍDO (2026-07-10):** PWA do passageiro em `apps/passageiro/` — telas ponto/linha/embarcada/favoritos, mapa Leaflet+OSM vendorizado (desvio do MapLibre justificado no README), WS com fallback polling 20s, "sinal perdido" >90s, banner offline com último dado, favoritos localStorage, Lighthouse a11y 92. Backend: novo `GET /live/vehicle/{code}`. DoD 5/5 testado no navegador com simulador.
- **Goal 04 CONCLUÍDO (2026-07-10):** painel de gestão em `apps/gestao/` (`/gestao/`) — Mapa da frota ao vivo (`GET /live/fleet`, status em rota/parado/sinal fraco/sem sinal >5min), Escala, Alertas (ciclo completo até o passageiro), KPIs validados, Replay animado. CRUD base = UI do Directus (Operator tem app_access). Proxy `/dx` ampliado (qr_codes, vehicle_positions, service_alerts write, /dx/users com permissão fina role-Driver). Credenciais: `operador.teste@…` / `OPERATOR_TEST_PASSWORD` em `config/.env`. DoD 5/5.
- **Goal 06 CONCLUÍDO (2026-07-10) — TODOS OS 7 GOALS ENTREGUES:** ETA v2 por segmento (~50% mais preciso, backtest MAE 209s vs 419s), GTFS estático (`/gtfs/static.zip`) + GTFS-RT protobuf (3 feeds, 0 erros na validação de regras MobilityData — oficial Java sem binário, desvio documentado), `/metrics` Prometheus (12 métricas), `/health/operational` com alerta de linha sem transmissão (+ webhook `ALERT_WEBHOOK_URL`). Scripts: `seed:eta`, `verify:goal06` (9/9), `validate:gtfsrt`. MQTT adiado por design.
- **PENDÊNCIA ÚNICA PARA PRODUÇÃO: deploy do backend no Coolify** — guia completo em **`DEPLOY.md`** (raiz do repo): Dockerfile pronto e testado, passos do Coolify (build pack Dockerfile, porta 8060, domínio, env vars), DNS, gzip, checklist pós-deploy (rotacionar token admin, testar `/p/CENTRO`, validar coordenadas SMTT).

## Convenções
- Código de ponto (`stops.code`) e de veículo (`vehicles.code`): curtos, estáveis, URL-safe (A–Z, 0–9), únicos.
- Toda escrita de posição exige role `driver` autenticado. Leitura pública é somente-leitura e filtrada.
- Nenhum dado de posição servido ao passageiro pode ter > 90s sem marcação "sinal perdido".
