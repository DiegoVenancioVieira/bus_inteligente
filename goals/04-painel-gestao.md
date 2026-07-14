# Goal 04 — Painel de Gestão

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** SPA em `apps/gestao/` (servida em `/gestao/`), 5 abas: Mapa, Escala, Alertas, KPIs, Replay. CRUD base delegado à UI do Directus (RF-G2, documentado). Backend: novo `GET /live/fleet` + proxy ampliado. KPIs de atraso/cumprimento de horário ficam para o goal 06 (dependem do ETA v2) — anotado na UI. Ver `apps/gestao/README.md`.

- **Camada:** Gestão / Operação
- **Depende de:** 00, 01
- **Referência PRD:** §6.3 (RF-G1…G8)
- **Config:** [`../config/project.md`](../config/project.md)

## Objetivo
Dar à operação uma visão de frota ao vivo, cadastros, escala, avisos e indicadores.

## Escopo (tarefas)
1. **Mapa de frota ao vivo** (RF-G1): todos os veículos ativos, cor por linha, status (em rota / parado / sem sinal).
2. **Cadastros** (RF-G2): CRUD de linhas, pontos, viagens, veículos, motoristas — pode reusar a UI do próprio Directus para o CRUD base.
3. **Escala** (RF-G3): atribuir motorista↔veículo↔viagem (`driver_assignments`).
4. **Emissão de alertas** (RF-G4): criar `service_alerts` por linha/ponto/sistema — refletem na PWA do passageiro e no app do motorista.
5. **Monitor de saúde** (RF-G5): destacar veículos sem transmitir há > X min.
6. **KPIs** (RF-G6): veículos ativos, atraso médio, cumprimento de horário, pontos mais escaneados (`qr_codes.scans`).
7. **Histórico/replay** (RF-G7): reproduzir o trajeto de um veículo numa janela de tempo.

## Detalhes técnicos
- SPA web (React/Vue) autenticada como `operator`/`admin`, consumindo o backend do goal 01 (WS) + Directus REST.
- Mapa com MapLibre + OSM, reusando os canais em tempo real.
- Replay a partir do histórico `vehicle_positions`.
- Seguir o guia de dataviz do projeto para os KPIs (consistência, acessibilidade em claro/escuro).

## Entregáveis
- Painel com mapa ao vivo, escala, alertas, KPIs e replay.
- Acesso restrito por papel.

## Critérios de aceite (DoD)
- [x] Todos os veículos ativos aparecem no mapa em tempo real (marcador do simulador se movendo; tabela com status/velocidade/idade).
- [x] Criar um alerta na gestão o faz aparecer na PWA do passageiro (ciclo completo testado: publicar → visível em `/live/stop` → encerrar → some).
- [x] Veículo sem sinal é destacado (AJU-1002 "sem sinal, 48 min atrás", chip vermelho, borda vermelha no mapa; limiar 5 min).
- [x] Replay reproduz o trajeto de um veículo numa janela escolhida (8 posições → polyline + marcador animado com timestamps).
- [x] KPIs corretos validados contra dados conhecidos (1 transmitindo=simulador; 1 sem sinal=AJU-1002; 1 aviso; scans CENTRO=10/VALADAO=7 rastreáveis aos testes). Atraso médio/cumprimento → goal 06.

## Fora de escopo
Export GTFS-RT e ETA avançado (goal 06); bilhetagem.
