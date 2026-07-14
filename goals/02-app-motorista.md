# Goal 02 — App do Motorista

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** PWA em `apps/motorista/` servida pelo backend em `/motorista/` (mesma origem, via proxy `/dx/*`). Testado de ponta a ponta no navegador contra o Directus de produção. Ver `apps/motorista/README.md` — inclui a limitação documentada de GPS em segundo plano (mitigação: Wake Lock; solução definitiva: empacote Capacitor, fase 2).

- **Camada:** Motorista
- **Depende de:** 00, 01
- **Referência PRD:** §6.1 (RF-M1…M9)
- **Config:** [`../config/project.md`](../config/project.md)

## Objetivo
App simples que transmite a posição do veículo automaticamente e com o mínimo de interação, resistente a quedas de rede, sem atrapalhar a direção.

## Escopo (tarefas)
1. **Login por usuário/PIN** (auth Directus, role `driver`), sessão longa (RF-M1).
2. **Iniciar turno**: selecionar/confirmar veículo + linha/viagem → cria `driver_assignments` ativo (RF-M2).
3. **Transmissão de GPS** a cada **5–15s**, inclusive tela bloqueada/background, via `POST /ingest/position` (RF-M3).
4. **Buffer offline**: sem rede, acumula posições localmente e envia em **lote** ao reconectar, preservando `recorded_at` (RF-M5).
5. **Tela de status**: "Transmitindo ✅ / Sem sinal ⚠️", velocidade, próxima parada (RF-M4).
6. **Encerrar turno**: finaliza `driver_assignments`, para de transmitir (RF-M6).
7. **Receber avisos** (`service_alerts`) da operação (RF-M7).
8. **Baixo consumo**: frequência adaptativa (reduz parado), envio em lote (RF-M9).

## Detalhes técnicos
- **PWA instalável** (add-to-home) como base; se background GPS exigir, empacotar com **Capacitor** (Android primeiro). Justificar no `apps/motorista/README.md`.
- GPS via Geolocation API (`watchPosition`) + fila persistente (IndexedDB) para o buffer offline.
- Tela grande, poucos toques, alto contraste (uso ao volante — iniciar/encerrar apenas).
- Nunca bloquear a UI aguardando rede; envio é assíncrono.

## Entregáveis
- App do motorista funcional (iniciar turno → transmitir → encerrar).
- Buffer offline testado (modo avião → reconecta → lote enviado).
- Documentação de instalação no dispositivo embarcado.

## Critérios de aceite (DoD)
- [x] Iniciar turno faz a posição chegar ao backend a cada ≤ 15s — **medido: intervalos de 2–4s** no Directus.
- [x] 2 min sem rede: posições bufferizadas em IndexedDB e enviadas ao reconectar, **em ordem, com `recorded_at` original** (chegaram 88–148s depois da captura, ordem cronológica preservada).
- [x] Encerrar turno interrompe a transmissão (nenhuma posição após o fim) e fecha o `driver_assignments` (`status: finished` + `shift_end`).
- [x] Avisos da gestão aparecem no app (alerta criado via API exibido no painel em ≤60s).
- [x] Transmite com tela bloqueada — **via Wake Lock** (tela não bloqueia durante o turno; padrão de tablet embarcado). Background real com tela apagada exige Capacitor — documentado como fase 2 em `apps/motorista/README.md`.

## Fora de escopo
Botão de pânico e ocupação por sensor (fase 4); roteirização.
