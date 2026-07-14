# Goal 06 — ETA avançado, observabilidade e interoperabilidade

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** ETA v2 (velocidade aprendida por segmento, `backend/src/eta2.js`) ligado em todas as superfícies (live, WS, GTFS-RT). Feeds GTFS-Realtime (protobuf) + GTFS estático (zip) públicos. Métricas Prometheus em `/metrics`, monitor de saúde em `/health/operational` (+ webhook opcional). MQTT adiado conforme previsto ("quando crescer"). Verificação: `npm run verify:goal06` (9/9) + `npm run validate:gtfsrt` (0 erros). Nota sobre o validador oficial no DoD abaixo.

- **Camada:** Escala / Interop
- **Depende de:** 01, 04
- **Referência PRD:** §8 (ETA), §9 (observabilidade/escala), §2.1 (GTFS-RT)
- **Config:** [`../config/project.md`](../config/project.md)

## Objetivo
Elevar a qualidade das previsões, dar visibilidade operacional e abrir o dado para o ecossistema (Google Maps/Moovit) via GTFS-Realtime.

## Escopo (tarefas)
1. **ETA avançado** (PRD §8 fase 2): usar velocidade instantânea + histórico por horário/dia + posição ao longo do trajeto. Exibir faixa amigável ("~4 min", "chegando"); nunca ETA com dado > 90s sem marcação.
2. **Export GTFS-Realtime** (protobuf): feeds `VehiclePositions`, `TripUpdates`, `ServiceAlerts` em endpoints públicos HTTPS, atualizados a cada ≤ 30s. Validar com o GTFS-RT validator do MobilityData.
3. **Export GTFS estático**: gerar `routes/trips/stops/stop_times` a partir do Directus para publicar o dataset da cidade.
4. **Observabilidade** (PRD §9): métricas de ingestão, veículos sem sinal, latência de broadcast, contagem de scans; dashboards e **alertas de saúde** (ex.: linha sem nenhum veículo transmitindo).
5. **Escala (opcional/quando crescer)**: introduzir broker **MQTT** (EMQX/Mosquitto) para posição, com worker MQTT→Directus, mantendo a mesma API de leitura.

## Detalhes técnicos
- Feed GTFS-RT em Protocol Buffers; respeitar regras de frescor (posição/trip ≤ 90s; alertas ≤ 10min).
- Métricas exportáveis (Prometheus) + painel; alertas por limiar.
- Manter compatibilidade do schema com GTFS (já modelado no PRD §5).

## Entregáveis
- ETA v2 em produção.
- Endpoints GTFS-RT + dataset GTFS estático publicados e válidos.
- Dashboard de observabilidade + alertas de saúde.

## Critérios de aceite (DoD)
- [x] Feed GTFS-RT válido — **0 erros/0 avisos com feeds populados** via `npm run validate:gtfsrt`, que implementa as regras centrais do MobilityData (E001/E002/E003/E004/E011/E022/E026/E027/E048, W001/W002 + frescor). *Desvio documentado:* o validador oficial Java não publica binários (só build Maven, indisponível nesta máquina); a validação usa as mesmas regras com referência cruzada contra o GTFS estático.
- [x] ETA v2 mais preciso que o MVP — backtest com viagem de velocidades variáveis por segmento (12→50 km/h): **MAE v2=209s vs v1=419s (~50% de melhora, n=126 previsões)**.
- [x] Alerta dispara quando linha com escala ativa fica sem veículos transmitindo (testado: disparou, e limpou ao encerrar a escala). Log estruturado + `/health/operational` + webhook opcional.
- [x] Nenhum dado servido > 90s sem marcação (`stale` verificado na frota; feeds GTFS-RT **excluem** posições >90s).

## Fora de escopo
Trip planner próprio; bilhetagem; previsão de lotação por sensores.
