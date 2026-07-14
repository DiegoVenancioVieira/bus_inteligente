# Painel de Gestão — Bus Inteligente (goal 04)

SPA vanilla JS servida pelo backend em `/gestao/`, autenticada como **Operator** (Directus via proxy `/dx`). Login de teste: `operador.teste@bus.candidatosinteligentes.com.br` / senha em `config/.env` (`OPERATOR_TEST_PASSWORD`).

## Abas
| Aba | Função |
|---|---|
| **Mapa** (RF-G1/G5) | Frota ao vivo via `GET /live/fleet` + WS por linha. Status por veículo: `em rota` / `parado` / `sinal fraco` (>90s) / **`sem sinal` (>5min, destacado)**. Tabela com velocidade e idade da última posição |
| **Escala** (RF-G3) | Criar/encerrar `driver_assignments` (motorista↔veículo↔viagem). A lista de motoristas vem de uma permissão fina: Operator lê `directus_users` filtrado à role Driver, só campos de identificação |
| **Alertas** (RF-G4) | Publicar avisos (sistema/linha/ponto, severidade) que aparecem na PWA do passageiro e no app do motorista; encerrar define `active_to` |
| **KPIs** (RF-G6) | Veículos transmitindo, sem sinal, avisos ativos, scans de QR (total + top), posições 24h. *Atraso médio/cumprimento de horário ficam para o ETA v2 (goal 06)* |
| **Replay** (RF-G7) | Veículo + janela de tempo → trajeto (polyline) + reprodução animada com timestamps |

## CRUD base (RF-G2)
Linhas, pontos, viagens, veículos e usuários são geridos na **UI do próprio Directus** (`https://directus-bus.candidatosinteligentes.com.br`) — a role Operator tem `app_access` e CRUD nas 10 coleções. O painel não duplica formulários que o Directus já dá de graça.

## Backend
- Novo `GET /live/fleet` (público — agrega dados já públicos): última posição por veículo (cache → fallback banco), status calculado, idade do sinal.
- Proxy `/dx` ampliado: leitura de `qr_codes`/`vehicle_positions`, escrita de `service_alerts`, `GET /dx/users` — as permissões reais continuam no Directus.

## Verificação (2026-07-10)
Frota com AJU-1001 "em rota, 60 km/h, agora" e AJU-1002 "**sem sinal**, 48 min atrás"; marcador movendo em tempo real; alerta criado no painel apareceu em `GET /live/stop/*` do passageiro e sumiu ao encerrar; escala criada e removida; KPIs conferidos contra dados conhecidos (scans CENTRO=10/VALADAO=7, 1 transmitindo, 1 sem sinal); replay reproduziu 8 posições com marcador animado.
