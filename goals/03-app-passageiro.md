# Goal 03 — PWA do Passageiro (sem instalação, via QR)

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** PWA em `apps/passageiro/` (vanilla JS + Leaflet/OSM vendorizado — desvio justificado do MapLibre no README). Telas: ponto (QR), linha, embarcada (QR do veículo) e favoritos. Testada de ponta a ponta no navegador com simulador. Backend ganhou `GET /live/vehicle/{code}`. Lighthouse Accessibility **92**. Detalhes: `apps/passageiro/README.md`.

- **Camada:** Passageiro
- **Depende de:** 00, 01, 05
- **Referência PRD:** §6.2 (RF-P1…P10), §7 (fluxo QR)
- **Config:** [`../config/project.md`](../config/project.md)

## Objetivo
Passageiro escaneia o QR no ponto (ou no ônibus) com a **câmera nativa** e vê, em segundos, as chegadas em tempo real — **sem baixar app e sem login**.

## Escopo (tarefas)
1. **Acesso por QR**: rota `https://bus.candidatosinteligentes.com.br/p/{stop_code}` resolve o ponto, incrementa `qr_codes.scans` e serve a PWA. Carga < 3s em 4G (RF-P1).
2. **Tela do ponto**: nome do ponto, linhas que passam ali e **ETA da próxima chegada** por linha ("Linha 042 — chega em ~4 min") (RF-P2).
3. **Mapa ao vivo** (MapLibre + OSM): veículos se aproximando, atualizando via WebSocket ou polling 15–30s. Marcar "sinal perdido" se `stale` (RF-P3).
4. **Detalhe da linha**: trajeto, todos os pontos, veículos ativos da linha (RF-P4).
5. **Alertas** ativos do ponto/linha (RF-P5).
6. **Acessibilidade** WCAG 2.1 AA: contraste, leitor de tela, fonte grande, indicação de veículo acessível (RF-P6).
7. **Instalável opcional** (add-to-home), nunca obrigatório (RF-P7).
8. **Favoritos locais** em `localStorage`, sem conta (RF-P8).
9. **QR no veículo** (`/v/{vehicle_code}`): mostra linha atual, próximas paradas e ETA ao destino (RF-P9).
10. **PT-BR + degradação offline**: mostra último dado com aviso "desatualizado" se sem rede (RF-P10).

## Detalhes técnicos
- Framework leve (React ou Vue) com **app shell cacheável** (service worker) para repeat-visit < 1s.
- Uma chamada inicial: `GET /live/stop/{stop_code}` (goal 01) traz ponto + linhas + posições + alertas.
- Mobile-first; **sem tela de login**.
- Consumir tempo real do backend do goal 01 (WS com fallback de polling).

## Entregáveis
- PWA do passageiro publicada em `https://bus.candidatosinteligentes.com.br`.
- Rotas `/p/{stop_code}` e `/v/{vehicle_code}` funcionais.
- Lighthouse: PWA + Acessibilidade ≥ 90.

## Critérios de aceite (DoD)
- [x] Escanear o QR de um ponto abre a tela em < 3s, sem login/instalação (`/p/CARANGU` → tela com ETA em ~2s local; shell leve + SW cache; gzip no proxy anotado p/ produção).
- [x] A tela mostra linhas e ETA ("Linha CT-ATL sentido Orla de Atalaia: ~9 min") e o veículo **se move** no mapa em tempo real (transform do marcador mudou entre amostras de 9s via WS; pino do ponto fixo).
- [x] `stale`/sem rede mostra aviso: "⚠ sinal perdido" (posição >90s, também no aria-label) e banner "Sem conexão — mostrando dados de HH:MM" mantendo o último dado.
- [x] Alertas da gestão aparecem para o passageiro (alerta criado via API exibido na tela do ponto; removido após o teste).
- [x] Lighthouse Acessibilidade **92** ≥ 90 (best-practices 96; falhas restantes são internas do Leaflet).

## Fora de escopo
Login/conta de passageiro; trip planner multimodal; pagamento.
