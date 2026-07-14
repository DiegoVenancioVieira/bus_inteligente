# Goal 05 — Serviço de QR Code

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** Gerador CLI em `backend/scripts/qrcodes.js` (`npm run qrcodes -- --route CT-ATL | --vehicles | --stops A,B`), redirecionador `/p/{code}` e `/v/{code}` no backend com contagem de scans serializada (sem corrida), página provisória do passageiro em `apps/passageiro/` (o goal 03 entrega a definitiva). Saídas em `infra/qrcodes/` (PNGs 512px EC-Q + folhas PDF A4). Verificação: `npm run verify:qr` — 6/6 PASS, incluindo decodificação real dos PNGs (scan simulado com jsQR).

- **Camada:** QR Code
- **Depende de:** 00
- **Referência PRD:** §6.4 (RF-Q1…Q4), §7 (fluxo QR)
- **Config:** [`../config/project.md`](../config/project.md)

## Objetivo
Gerar, imprimir e rastrear QR Codes estáveis para pontos e veículos, apontando para as URLs públicas — a porta de entrada do passageiro (sem app).

## Escopo (tarefas)
1. **Geração** (RF-Q1): para cada `stop` → QR para `https://bus.candidatosinteligentes.com.br/p/{stop_code}`; para cada `vehicle` → `/v/{vehicle_code}`. Registrar em `qr_codes`.
2. **Redirecionador/contador**: rota `/p/{code}` e `/v/{code}` que resolve o alvo, incrementa `qr_codes.scans` e serve a PWA (RF-Q3).
3. **Folha de impressão** (RF-Q2): exportar **PDF** com QR + nome do ponto/linha para colar no abrigo (layout limpo, alto contraste, tamanho legível a ~1m).
4. **Geração em lote** (RF-Q4): gerar QR de todos os pontos de uma linha de uma vez.
5. **Estabilidade** (RF-Q3): o `public_code` não muda ao editar o ponto; QR permanece válido.

## Detalhes técnicos
- Biblioteca de QR com correção de erro nível **M/Q** (resiste a desgaste no abrigo).
- `public_code` curto, URL-safe, único (ver convenções em `config/project.md`).
- PDF via gerador server-side; incluir nome do ponto + code legível abaixo do QR (fallback humano).
- O contador de scans alimenta o KPI "pontos mais escaneados" do goal 04.

## Entregáveis
- Serviço/CLI de geração (individual e em lote).
- Redirecionador com contagem de scans.
- Exportação de folha PDF pronta para impressão.

## Critérios de aceite (DoD)
- [x] Gerar QR de todos os pontos de uma linha em lote produz um PDF imprimível (`qr-sheet-CT-ATL.pdf`, 8 páginas A4: faixa azul, nome do ponto, QR ~12cm, código humano, instruções).
- [x] Escanear com a câmera nativa abre a PWA do ponto correto — **provado por decodificação real dos 10 PNGs (jsQR)** apontando para `PUBLIC_URL/p|v/{code}` + redirect 302 testado.
- [x] Cada scan incrementa `qr_codes.scans` (2 scans simultâneos = +2; contagem serializada por flusher único — corrida read-modify-write detectada no teste e corrigida).
- [x] Editar o nome do ponto **não** invalida o QR (redirect e live seguem funcionando na hora; nome novo propaga em ≤60s pelo cache stale-while-revalidate).

## Fora de escopo
Design gráfico do abrigo; a PWA em si (goal 03).
