# Goal 01 — Backend de tempo real (ingestão + broadcast)

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** Implementado em `backend/` (Node 20 + Fastify). Verificação DoD 8/8 PASS via `npm run verify`; detalhes em `backend/README.md`. Pendente de deploy no servidor (roda local; instância única in-memory — Redis/MQTT ficam para a escala, goal 06).

- **Camada:** Backend / Tempo real
- **Depende de:** 00
- **Referência PRD:** §4.2 (fluxo de dados), §8 (ETA), §9 (latência/escala)
- **Config:** [`../config/project.md`](../config/project.md)

## Objetivo
Criar o serviço que recebe posições dos motoristas, persiste, mantém a "última posição" em cache e **difunde em tempo real** para passageiro e gestão, seguindo o padrão GTFS-RT (frescor ≤ 30s, dado nunca > 90s sem aviso) e o princípio "consome 1x, publica para muitos".

## Escopo (tarefas)
1. **Endpoint de ingestão** (`POST /ingest/position`) autenticado como role `driver`:
   - Payload: `{ vehicle_id, trip_id?, lat, lng, speed, heading, recorded_at, occupancy? }`.
   - Aceita **lote** (array) para o buffer offline do motorista (PRD §6.1 RF-M5).
   - Valida faixa de lat/lng, heading 0–359, `recorded_at` não futuro; grava em `vehicle_positions` (Directus) e atualiza cache Redis `last_pos:{vehicle_id}`.
   - Rate limiting por veículo.
2. **Broadcast em tempo real**
   - Canal por linha e por ponto. Ao chegar posição, publica no Redis pub/sub e emite via WebSocket para inscritos.
   - MVP pode usar o **Realtime/Subscriptions do próprio Directus**; abstrair atrás de um cliente para permitir trocar por **MQTT** na escala (PRD §4.1 Opção B).
3. **API de leitura para clientes**
   - `GET /live/stop/{stop_code}` → linhas do ponto + próximas chegadas (ETA) + veículos próximos + alertas ativos (uma resposta, PRD §7 passo 4).
   - `GET /live/route/{route_id}` → todos os veículos ativos da linha + trajeto.
   - Marcar cada posição com `stale: true` se `recorded_at` > 90s.
4. **Fallback de polling**: as rotas de leitura devem servir bem clientes que fazem polling a cada 15–30s (cache curto).
5. **Ganchos de ETA**: expor `eta_seconds` por ponto usando o cálculo MVP (distância ao longo do trajeto ÷ velocidade média) — implementação detalhada no goal 06, aqui deixar a interface pronta.

## Detalhes técnicos
- Stack sugerida: Node.js (Fastify/Nest) como serviço "sidecar" do Directus, ou Directus **Custom Endpoints/Hooks** (extensão). Escolher e justificar no `backend/README.md`.
- Redis: `last_pos:{vehicle_id}` (TTL 120s), pub/sub `positions:{route_id}`.
- Todas as respostas de leitura são **públicas e somente-leitura**.

## Entregáveis
- Serviço de ingestão + broadcast rodando e documentado.
- Rotas `GET /live/stop/{code}` e `GET /live/route/{id}` + canal WebSocket.
- Simulador de motorista (script) que injeta posições ao longo do trajeto da linha piloto para testes.

## Critérios de aceite (DoD)
- [x] Uma posição enviada como `driver` aparece em `GET /live/stop/{code}` em ≤ 5s (WS) e ≤ 30s (polling) — **WS medido: 0,10s**; polling visível com ETA.
- [x] Envio em lote (buffer offline) é aceito e ordenado por `recorded_at` (testado com lote fora de ordem).
- [x] Posição com > 90s vem marcada `stale: true` (testado com posição de 3 min).
- [x] Ingestão anônima é rejeitada (401); rate limit responde 429 (3 req/s, burst 10, por veículo).
- [x] Simulador (`npm run simulator`) percorre a linha CT-ATL e as leituras `/live/route` mostram o veículo se movendo; ETA correto em ponto à frente.

## Fora de escopo
UI (goals 02–04); ETA avançado e export GTFS-RT (goal 06).
