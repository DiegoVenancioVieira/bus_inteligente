# Goal 00 — Infra & Directus (fundação)

> **STATUS: ✅ CONCLUÍDO em 2026-07-10.** Executado por `infra/scripts/bootstrap.py` (idempotente). Verificação DoD abaixo; detalhes em `infra/README.md`. Pendências manuais não-bloqueantes: índice composto SQL + rotação do token admin (ver `infra/README.md`).

- **Camada:** Backend / Banco de dados
- **Depende de:** — (primeiro goal)
- **Referência PRD:** §4 (arquitetura), §5 (modelo de dados), §9 (não-funcionais)
- **Config:** [`../config/project.md`](../config/project.md) · segredos em `../config/.env`

## Objetivo
Colocar a instância **Directus** no ar em `https://directus-bus.candidatosinteligentes.com.br` (hoje HTTP 503 "no available server"), criar todo o schema de coleções, papéis/permissões e seeds da cidade de **Aracaju/SE**, deixando a API pronta para os demais goals.

## Escopo (tarefas)
1. **Subir a instância**
   - Provisionar Directus (Docker) com **Postgres** (com **PostGIS** para consultas espaciais) e **Redis** (cache + pub/sub).
   - Corrigir o **certificado TLS** (Let's Encrypt válido) — hoje a store do Windows rejeita (`SEC_E_UNTRUSTED_ROOT`).
   - Validar: `GET /server/health` → 200 e `GET /server/ping` → `pong`.
2. **Criar coleções** exatamente conforme PRD §5: `agencies`, `routes`, `stops`, `trips`, `stop_times`, `vehicles`, `vehicle_positions`, `driver_assignments`, `service_alerts`, `qr_codes`.
   - `stops.geo` e `vehicle_positions` com campos geográficos (point) via PostGIS.
   - Índices: `stops.code` (único), `vehicles.code` (único), `qr_codes.public_code` (único), `vehicle_positions(vehicle_id, recorded_at)`.
3. **Papéis e permissões** (PRD §5.11)
   - `Public`: leitura filtrada de `routes`, `stops`, `service_alerts`, `qr_codes` e **última** `vehicle_positions`. Nada de escrita.
   - `Driver`: escreve `vehicle_positions`; lê própria `driver_assignments` e `service_alerts`.
   - `Operator`: CRUD operacional + `service_alerts`.
   - `Admin`: total.
4. **Retenção**: Flow/cron para expurgar `vehicle_positions` bruto após 7–30 dias.
5. **Seeds Aracaju/SE**: carregar a linha-piloto de [`../infra/seeds/aracaju-pilot.json`](../infra/seeds/aracaju-pilot.json) (corredor **Terminal do Centro ↔ Orla de Atalaia**: 1 agência SMTT, linha `CT-ATL`, 8 pontos, 2 viagens ida/volta com `stop_times`, 2 veículos). **Atenção:** coordenadas são aproximadas — ver avisos de validação em [`../infra/seeds/README.md`](../infra/seeds/README.md) antes do go-live.
6. **Migração versionada**: exportar o schema (`npx directus schema snapshot`) para `infra/schema/snapshot.yaml` no repositório.

## Detalhes técnicos
- Timezone da agência: `America/Maceio`.
- Usar o token estático (`DIRECTUS_TOKEN`) para automação de schema/seed.
- Habilitar **WebSocket/Realtime** do Directus (`wss://…/websocket`) — será usado pelo goal 01.
- Coordenadas de Aracaju para seeds (referência do centro): lat `-10.9472`, lng `-37.0731`.

## Entregáveis
- Instância Directus acessível por HTTPS válido, health 200.
- Schema completo + índices + permissões por papel.
- Seeds de Aracaju carregados.
- `infra/schema/snapshot.yaml` + `infra/docker-compose.yml` versionados.
- `infra/README.md` com passos de provisionamento/restore.

## Critérios de aceite (DoD)
- [x] `GET /server/health` retorna 200 com TLS confiável.
- [x] As 10 coleções existem com os campos, tipos e índices do PRD §5 (índice composto de `vehicle_positions` fica como SQL manual — ver `infra/README.md`).
- [x] Requisição **anônima** a `GET /items/stops` retorna pontos; a `POST /items/vehicle_positions` é **negada** (403 verificado).
- [x] Requisição com role `driver` **consegue** gravar em `vehicle_positions` (200 verificado com usuário `motorista.teste`).
- [x] Seeds de Aracaju consultáveis (8 pontos, 1 linha, 2 viagens, 2 veículos, 10 QR codes).
- [x] `schema snapshot` versionado em `infra/schema/snapshot.yaml` (replay em ambiente limpo documentado em `infra/README.md`; não executado — sem ambiente limpo disponível).

## Fora de escopo
Export GTFS-Realtime (goal 06), lógica de ETA (goal 06), UIs.
