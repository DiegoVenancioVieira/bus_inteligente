# PRD — Bus Inteligente

**Produto:** Plataforma de acompanhamento de localização de ônibus público em tempo real
**Versão do documento:** 1.0
**Data:** 2026-07-10
**Autor:** Diego Venâncio Vieira
**Status:** Pronto para desenvolvimento (destinado a execução via modelo **FABLE 5** + comando `/goal`)

### Configuração do ambiente (valores reais)

| Item | Valor |
|---|---|
| **Cidade piloto** | Aracaju / Sergipe / Brasil |
| **Timezone (IANA)** | `America/Maceio` (UTC−3, sem horário de verão) |
| **URL pública (passageiro/gestão)** | `https://bus.candidatosinteligentes.com.br` |
| **URL do QR do ponto** | `https://bus.candidatosinteligentes.com.br/p/{stop_code}` |
| **Directus (API/DB/Auth)** | `https://directus-bus.candidatosinteligentes.com.br` |
| **Token Directus** | Ver `config/.env` (NÃO versionar). Placeholder em `config/.env.example`. |

> **Estado atual (2026-07-10):** instância Directus **no ar** (health `ok`, TLS confiável), token com acesso **Administrator**, banco **limpo** (sem coleções de usuário). Próxima tarefa: criar schema + permissões + seeds — ver `goals/00-infra-directus.md`.

---

## 0. Como usar este PRD com FABLE 5 / `/goal`

Este documento é a fonte única de verdade. Ele foi escrito para ser fatiado em **metas (`/goal`)** independentes e executáveis. Cada seção "Camada" (§6) e cada fase do roadmap (§11) mapeia diretamente para um ou mais goals.

**Ordem sugerida de execução dos goals:**

1. `goal:infra-directus` — Provisionar instância Directus + modelagem de coleções (§5).
2. `goal:backend-realtime` — Serviço de ingestão de posição (GPS) + broadcast em tempo real (§4, §5).
3. `goal:app-motorista` — App do motorista / dispositivo embarcado (§6.1).
4. `goal:app-passageiro` — PWA do passageiro sem instalação, acesso via QR Code (§6.2).
5. `goal:painel-gestao` — Painel de gestão/operação (§6.3).
6. `goal:qrcode-service` — Geração e gestão de QR Codes de pontos e veículos (§7).
7. `goal:observabilidade` — Métricas, alertas, ETA e qualidade de dados (§8, §9).

**Contrato para o desenvolvedor (humano ou IA):** nenhum goal pode quebrar o schema Directus definido em §5 sem uma migração versionada. Todo endpoint em tempo real deve respeitar os limites de latência de §9.

---

## 1. Visão geral

**Problema:** Passageiros do transporte público não sabem onde está o ônibus nem quanto falta para ele chegar, o que gera longas esperas, insegurança e baixa adesão ao transporte coletivo.

**Solução:** Uma plataforma que rastreia a posição dos ônibus em tempo real e a entrega ao passageiro **sem exigir instalação de aplicativo** — basta escanear um QR Code no ponto de ônibus (ou dentro do veículo) para ver, na hora, quais linhas passam ali, onde estão os veículos e a previsão de chegada (ETA).

**Proposta de valor por público:**

| Público | Ganho principal |
|---|---|
| Passageiro | Ver o ônibus chegando em tempo real sem baixar app; decidir se sai de casa agora. |
| Motorista | App simples que transmite localização automaticamente e recebe avisos da operação. |
| Gestão / Operação | Visão de frota ao vivo, cumprimento de horários, indicadores e histórico. |

**Princípios de design:**

1. **Zero fricção para o passageiro** — QR Code → PWA → informação, sem login, sem download.
2. **Padrões abertos** — compatibilidade com **GTFS** (estático) e **GTFS-Realtime** (tempo real) para interoperar com Google Maps, Moovit etc. no futuro.
3. **Backend headless** — todo o dado vive no **Directus**; apps são clientes.
4. **Tempo real de verdade** — posição do veículo com no máximo 30s de defasagem.

---

## 2. Benchmark — o que já existe de melhor (base de referência)

Levantamento das melhores práticas e produtos consolidados, usados como base de arquitetura e UX.

### 2.1 Padrão de dados: GTFS + GTFS-Realtime (Google)
- **GTFS estático:** define linhas (`routes`), viagens (`trips`), pontos (`stops`), horários (`stop_times`), agências. É o padrão mundial de transporte público.
- **GTFS-Realtime:** três tipos de feed — **VehiclePositions** (posição do veículo), **TripUpdates** (atrasos/ETA), **ServiceAlerts** (avisos). Serializado em **Protocol Buffers**.
- **Regras de frescor (adotadas neste projeto):** dado de posição/viagem não pode ter mais de **90s**; feed atualizado a cada **≤30s**; alertas até **10min**; sempre via **HTTPS**.
- **Padrão de escala:** o feed é consumido **uma vez** pelo backend e distribuído a N clientes — não se consulta a fonte por usuário.

### 2.2 Apps de referência (UX)
- **Moovit / Transit / Citymapper / Google Maps (transporte):** mapa com veículos ao vivo, ETA por ponto, lista de próximas partidas, alertas de serviço.
- **Transport for NSW, Singapura (LTA), Southampton (UK):** **QR Code em cada ponto** que abre a página de chegadas daquele ponto **sem app** — modelo direto que este projeto adota. Estudos de caso mostram maior aceitação do tempo de espera e sensação de segurança.

### 2.3 Transporte em tempo real (infra)
- **MQTT / WebSocket** para difundir posição a milhares de clientes com baixa latência e baixo consumo em rede móvel (recomendado quando a frota escala para centenas de veículos).
- **Backend consome uma vez, publica para muitos** (pub/sub), com cache de última posição por veículo.

**Decisão:** este produto **nasce compatível com GTFS/GTFS-Realtime**, com UX inspirada em Moovit/Transit e modelo de acesso por QR Code inspirado em NSW/Singapura, tendo o **Directus** como camada de dados e API.

**Fontes:**
- [GTFS Realtime Overview — Google for Developers](https://developers.google.com/transit/gtfs-realtime)
- [GTFS Realtime Best Practices — MobilityData](https://github.com/MobilityData/GTFS_Realtime_Best-Practices)
- [GTFS Realtime Best Practices (Google/transit)](https://github.com/google/transit/blob/master/gtfs-realtime/best-practices/best-practices.md)
- [QR Codes at Every Bus Stop across the EU — European Citizens' Initiative Forum](https://citizens-initiative-forum.europa.eu/citizens-experiences/blogs/qr-codes-every-bus-stop-across-eu-transforming-public-transport-real_en)
- [Disseminating real-time bus arrival information via QR code (Southampton) — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0966692313001245)
- [Track My Shuttle: Real-Time Updates — BusWhere](https://www.buswhere.com/track-my-shuttle-to-provide-real-time-updates/)

---

## 3. Escopo, personas e camadas

### 3.1 Personas
- **Passageiro (Ana, 34):** quer saber quanto falta para o ônibus da linha dela. Não quer baixar nada. Usa o celular no ponto.
- **Motorista (Carlos, 45):** dirige o veículo; precisa que o rastreio seja automático e não atrapalhe a direção.
- **Operador/Gestor (Marina, 38):** monitora a frota, verifica atrasos, emite avisos, gera relatórios.
- **Administrador (TI/config):** cadastra linhas, pontos, veículos, usuários e gera QR Codes.

### 3.2 Camadas do produto (cada uma é um goal)
1. **App do Motorista** — captura e transmite GPS; recebe escala e avisos.
2. **PWA do Passageiro** — consumo via QR Code, sem instalação.
3. **Painel de Gestão** — monitoramento, cadastro e relatórios.
4. **Backend / Directus** — dados, API, autenticação, tempo real.
5. **Serviço de QR Code** — geração/impressão/gestão de códigos de pontos e veículos.

---

## 4. Arquitetura técnica

```
┌─────────────────┐        GPS (a cada 5–15s)        ┌──────────────────────┐
│  App Motorista  │ ───────────────────────────────▶ │  Ingestão Realtime    │
│  (PWA/Nativo)   │                                   │  (WebSocket/MQTT +    │
└─────────────────┘                                   │   REST fallback)      │
                                                       └──────────┬───────────┘
┌─────────────────┐                                              │ grava posição
│ Painel Gestão   │ ◀── REST/WebSocket ──┐                       ▼
│  (Web SPA)      │                       │            ┌──────────────────────┐
└─────────────────┘                       ├──────────▶ │      DIRECTUS         │
                                          │            │  (DB + API + Auth +   │
┌─────────────────┐   QR → URL curta      │            │   Flows/Webhooks)     │
│ PWA Passageiro  │ ◀── REST/WebSocket ───┘            │  Postgres + Redis     │
│ (sem instalação)│                                    └──────────┬───────────┘
└─────────────────┘                                              │
                                          Export GTFS-RT ◀───────┘ (feed protobuf p/ Google/Moovit)
```

### 4.1 Stack recomendada
- **Banco de dados / API / Auth:** **Directus** (instância própria a ser provisionada no servidor). Postgres como DB relacional; **Redis** para cache de última posição e pub/sub.
- **Camada de tempo real:**
  - **Opção A (recomendada p/ início):** WebSocket nativo do Directus (Realtime/Subscriptions) para clientes leves.
  - **Opção B (escala):** broker **MQTT** dedicado (ex.: EMQX/Mosquitto) para posição de veículos quando a frota crescer; um worker sincroniza MQTT → Directus.
- **Frontend Passageiro:** **PWA** (React ou Vue) — leve, mobile-first, sem tela de login, cacheável, funciona no navegador do celular ao abrir o QR.
- **Frontend Motorista:** **PWA instalável** (add-to-home) ou wrapper leve (Capacitor) para acesso a GPS em background. Começa como PWA.
- **Frontend Gestão:** SPA web (pode reusar a UI do próprio Directus para CRUD + um painel de mapa customizado).
- **Mapa:** MapLibre GL + tiles OpenStreetMap (evita custo/lock-in do Google Maps).
- **URL curta / QR:** cada ponto e veículo tem um código público estável; o QR aponta para `https://bus.candidatosinteligentes.com.br/p/{stop_code}`.

### 4.2 Fluxo de dados em tempo real
1. App do motorista lê GPS do dispositivo a cada **5–15s** e envia `{vehicle_id, lat, lng, speed, heading, trip_id, timestamp}`.
2. Serviço de ingestão valida, grava em `vehicle_positions` (Directus) e atualiza o **cache de última posição** (Redis).
3. Clientes (passageiro/gestão) recebem atualização via WebSocket **ou** fazem polling de fallback a cada 15–30s.
4. Um worker calcula **ETA** por ponto (§8) e, opcionalmente, publica um feed **GTFS-Realtime** (protobuf) para terceiros.

---

## 5. Modelo de dados (coleções Directus)

Nomenclatura alinhada ao GTFS onde possível, para exportação futura.

### 5.1 `agencies` (empresa operadora)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| name | string | |
| timezone | string | ex.: America/Maceio (Aracaju/SE) |
| contact | json | telefone, e-mail |

### 5.2 `routes` (linhas)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| agency_id | m2o → agencies | |
| short_name | string | ex.: "042" |
| long_name | string | ex.: "Terminal Centro ↔ Bairro Norte" |
| color | string (hex) | cor da linha no mapa |
| type | enum | bus (extensível) |
| status | enum | active / inactive |

### 5.3 `stops` (pontos de ônibus)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| code | string (único) | **usado no QR Code** (curto e estável) |
| name | string | ex.: "Praça da Sé" |
| lat | decimal | |
| lng | decimal | |
| geo | geometry (point) | para consultas espaciais |
| accessibility | json | rampa, piso tátil etc. |

### 5.4 `trips` (viagens — instância de uma linha em um sentido/horário)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| route_id | m2o → routes | |
| headsign | string | destino exibido |
| direction | enum | ida / volta |
| service_days | json | dias de operação |

### 5.5 `stop_times` (sequência de pontos de uma viagem + horário previsto)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| trip_id | m2o → trips | |
| stop_id | m2o → stops | |
| sequence | integer | ordem no trajeto |
| scheduled_time | time | horário planejado (se houver tabela) |

### 5.6 `vehicles` (veículos/frota)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| code | string (único) | prefixo/placa; **usado no QR do veículo** |
| agency_id | m2o → agencies | |
| plate | string | |
| capacity | integer | |
| features | json | ar-condicionado, acessível |
| status | enum | in_service / garage / maintenance |

### 5.7 `vehicle_positions` (posições em tempo real — alto volume)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| vehicle_id | m2o → vehicles | |
| trip_id | m2o → trips (nullable) | viagem ativa |
| lat / lng | decimal | |
| speed | decimal | km/h |
| heading | integer | 0–359° |
| occupancy | enum (nullable) | vazio/médio/cheio (futuro) |
| recorded_at | timestamp | hora do GPS |
| received_at | timestamp | hora que o servidor recebeu |

> **Retenção:** manter posição bruta por **7–30 dias**; a "última posição" fica em Redis para leitura rápida. Histórico agregado vai para `trip_history`.

### 5.8 `driver_assignments` (escala motorista↔veículo↔viagem)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| driver_id | m2o → directus_users | |
| vehicle_id | m2o → vehicles | |
| trip_id | m2o → trips (nullable) | |
| shift_start / shift_end | timestamp | |
| status | enum | scheduled / active / finished |

### 5.9 `service_alerts` (avisos ao passageiro)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| scope | enum | route / stop / system |
| route_id / stop_id | m2o (nullable) | |
| title / message | string / text | |
| severity | enum | info / warning / critical |
| active_from / active_to | timestamp | |

### 5.10 `qr_codes` (rastreamento de QR gerados)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| target_type | enum | stop / vehicle |
| target_id | uuid | |
| public_code | string (único) | vai na URL |
| scans | integer | contador (analytics) |
| generated_at | timestamp | |

### 5.11 Papéis (Directus Roles)
- **Public (sem login):** leitura de `routes`, `stops`, `vehicle_positions` (última), `service_alerts`, `qr_codes` (resolução). **Somente leitura**, filtrado.
- **Driver:** escreve `vehicle_positions`; lê própria `driver_assignments`; lê `service_alerts`.
- **Operator:** CRUD operacional + emissão de alertas.
- **Admin:** tudo, incluindo geração de QR e cadastro base.

---

## 6. Requisitos funcionais por camada

### 6.1 App do Motorista (`goal:app-motorista`)

**Objetivo:** transmitir a posição do veículo de forma automática e confiável, com o mínimo de interação.

**RF-M1 — Login simples:** motorista entra com usuário/PIN. Sessão longa.
**RF-M2 — Iniciar turno:** seleciona (ou confirma pré-atribuído) veículo + linha/viagem. Cria `driver_assignments` ativo.
**RF-M3 — Transmissão de GPS:** ao iniciar turno, o app envia posição a cada **5–15s** automaticamente, inclusive com tela bloqueada / em background.
**RF-M4 — Indicador de status:** tela mostra "Transmitindo ✅ / Sem sinal ⚠️", velocidade e próxima parada.
**RF-M5 — Buffer offline:** sem rede, o app **acumula posições** e envia em lote ao reconectar (com `recorded_at` correto).
**RF-M6 — Encerrar turno:** finaliza `driver_assignments`, para de transmitir.
**RF-M7 — Receber avisos:** recebe `service_alerts` da operação (ex.: "desviar da Rua X").
**RF-M8 — Botão de pânico (fase 2):** envia alerta prioritário à gestão.
**RF-M9 — Baixo consumo:** otimizar bateria/dados (envio em lote adaptativo; reduz frequência parado).

### 6.2 PWA do Passageiro (`goal:app-passageiro`) — **sem instalação**

**Objetivo:** o passageiro escaneia o QR Code no ponto e vê imediatamente as chegadas, **sem baixar app e sem login**.

**RF-P1 — Acesso por QR:** ao escanear, abre `…/p/{stop_code}` no navegador. Carrega em **< 3s** em 4G.
**RF-P2 — Tela do ponto:** mostra nome do ponto, lista de **linhas que passam ali** e, para cada uma, o **ETA da próxima chegada** ("Linha 042 — chega em 4 min").
**RF-P3 — Mapa ao vivo:** mostra o(s) veículo(s) se aproximando em um mapa, atualizando em tempo real (WebSocket) ou a cada 15–30s.
**RF-P4 — Detalhe da linha:** tocar numa linha mostra o trajeto, todos os pontos e todos os veículos ativos daquela linha.
**RF-P5 — Alertas:** exibe `service_alerts` ativos do ponto/linha (atraso, desvio).
**RF-P6 — Acessibilidade:** contraste AA, leitor de tela, fontes grandes, feedback de veículo acessível.
**RF-P7 — Instalável opcional:** oferece "adicionar à tela inicial" (PWA), mas **nunca obrigatório**.
**RF-P8 — Favoritar (opcional, local):** salvar pontos/linhas no `localStorage`, sem conta.
**RF-P9 — QR no veículo:** escanear o QR **dentro do ônibus** mostra a linha atual, próximas paradas e ETA até o destino.
**RF-P10 — Multilíngue e offline-graceful:** PT-BR default; se sem rede, mostra último dado com aviso "desatualizado".

### 6.3 Painel de Gestão (`goal:painel-gestao`)

**Objetivo:** operar e monitorar a frota.

**RF-G1 — Mapa de frota ao vivo:** todos os veículos ativos no mapa, cor por linha, status (em rota / parado / sem sinal).
**RF-G2 — Cadastros:** CRUD de linhas, pontos, viagens, veículos, motoristas (via Directus).
**RF-G3 — Escala:** atribuir motorista↔veículo↔viagem (`driver_assignments`).
**RF-G4 — Emissão de alertas:** criar `service_alerts` por linha/ponto/sistema.
**RF-G5 — Monitor de saúde:** veículos sem transmitir há > X min destacados.
**RF-G6 — Indicadores (KPIs):** nº de veículos ativos, atraso médio, cumprimento de horário, pontos mais escaneados (via `qr_codes.scans`).
**RF-G7 — Histórico/replay:** reproduzir o trajeto de um veículo em uma janela de tempo.
**RF-G8 — Exportação GTFS/GTFS-RT (fase 2):** gerar feed para Google Maps/Moovit.

### 6.4 Serviço de QR Code (`goal:qrcode-service`)

**RF-Q1 — Geração:** para cada `stop` e `vehicle`, gerar QR apontando para a URL pública estável.
**RF-Q2 — Folha de impressão:** exportar PDF com QR + nome do ponto/linha para colar no abrigo.
**RF-Q3 — Estável e rastreável:** o código não muda se o ponto for editado; cada scan incrementa `qr_codes.scans` (via redirecionador `/p/{code}`).
**RF-Q4 — Lote:** gerar QR em massa para todos os pontos de uma linha.

---

## 7. Fluxo do QR Code (detalhado)

**Passageiro no ponto:**
1. Escaneia o QR com a **câmera nativa** do celular (sem app dedicado).
2. Abre `https://bus.candidatosinteligentes.com.br/p/AB123` (URL curta e estável).
3. O redirecionador resolve `AB123` → `stop_id`, incrementa `scans`, serve a PWA.
4. PWA busca em uma chamada: dados do ponto + linhas + últimas posições + alertas.
5. Tela renderiza ETA e mapa ao vivo. Passageiro **não fez login nem instalou nada**.

**Requisitos:** o QR deve funcionar mesmo se o ponto for renomeado; URL HTTPS; página cacheável (shell PWA) para abrir rápido; graceful degradation se sem sinal.

---

## 8. Cálculo de ETA (previsão de chegada)

- **Fase 1 (MVP):** ETA por **distância ao longo do trajeto / velocidade média** entre a posição atual do veículo e o ponto alvo (usando a geometria da rota e `stop_times.sequence`).
- **Fase 2:** ETA considerando velocidade instantânea, histórico do horário/dia e trânsito.
- **Regra de confiança:** exibir ETA como faixa amigável ("~4 min", "chegando") e nunca mostrar dado com > 90s de defasagem sem marcar como "sinal perdido".
- Publicar como `TripUpdates` no feed GTFS-Realtime (fase 2).

---

## 9. Requisitos não-funcionais

| Categoria | Requisito |
|---|---|
| **Latência** | Posição do veículo visível ao passageiro em ≤ 5s (WebSocket) / ≤ 30s (polling). Feed nunca com dado > 90s sem aviso. |
| **Frescor** | Atualização de posição a cada ≤ 30s (alinhado a GTFS-RT). |
| **Desempenho** | PWA passageiro carrega em < 3s em 4G; interativa em < 1s no repeat visit (cache). |
| **Escala** | Suportar N veículos e milhares de leitores simultâneos com o padrão "consome 1x, publica p/ muitos" (Redis pub/sub; MQTT quando crescer). |
| **Disponibilidade** | 99,5% no MVP. Fallback de polling se WebSocket cair. |
| **Segurança** | HTTPS em tudo; escrita de posição só por role `driver` autenticado; leitura pública somente-leitura e filtrada; rate limiting na ingestão. |
| **Privacidade** | Não coletar dados pessoais do passageiro; sem login obrigatório; favoritos só no dispositivo. Motorista ciente do rastreio (LGPD). |
| **Acessibilidade** | WCAG 2.1 AA na PWA do passageiro. |
| **Bateria/dados (motorista)** | Envio em lote adaptativo; consumo otimizado. |
| **Interoperabilidade** | Schema compatível com GTFS; export GTFS-Realtime planejado. |
| **Observabilidade** | Logs de ingestão, métricas de veículos sem sinal, contagem de scans, alertas de saúde. |

---

## 10. Fora de escopo (v1)
- Bilhetagem / pagamento de passagem.
- Rota multi-modal / trip planner completo (deixar para integração via GTFS com Google/Moovit).
- Previsão de lotação por sensores (só `occupancy` manual/estimado na fase 2).
- App nativo publicado nas lojas para passageiro (a proposta é justamente **não exigir instalação**).

---

## 11. Roadmap por fases (mapeado para goals)

### Fase 0 — Fundação (`goal:infra-directus`)
- Provisionar instância **Directus** no servidor (Postgres + Redis).
- Criar coleções de §5, papéis/permissões e seeds de teste (1 linha, 5 pontos, 2 veículos).
- **Entregável:** API Directus funcional com dados de exemplo.

### Fase 1 — Tempo real + Motorista (`goal:backend-realtime`, `goal:app-motorista`)
- Serviço de ingestão de posição + cache Redis + WebSocket.
- PWA do motorista transmitindo GPS com buffer offline.
- **Entregável:** um veículo real aparece se movendo no painel.

### Fase 2 — Passageiro por QR (`goal:app-passageiro`, `goal:qrcode-service`)
- PWA passageiro sem instalação, acesso por QR do ponto, mapa ao vivo, ETA MVP.
- Geração e impressão de QR de pontos.
- **Entregável:** escanear QR no ponto mostra o ônibus chegando.

### Fase 3 — Gestão (`goal:painel-gestao`)
- Painel de frota ao vivo, escala, alertas, KPIs, replay.
- **Entregável:** operação monitora e comunica em tempo real.

### Fase 4 — Escala e interoperabilidade (`goal:observabilidade`)
- MQTT para frota grande, ETA avançado, export GTFS-Realtime, botão de pânico, ocupação.
- **Entregável:** feed público consumível por Google Maps/Moovit.

---

## 12. Critérios de aceite (Definition of Done por camada)

**Motorista:** iniciar turno → posição chega ao servidor a cada ≤15s → sobrevive a 2 min sem rede (buffer) → encerrar turno para a transmissão.
**Passageiro:** escanear QR de um ponto → em < 3s ver as linhas e o ETA → ver o veículo se mover no mapa em tempo real → tudo sem login e sem instalar app.
**Gestão:** ver todos os veículos ativos no mapa em tempo real → emitir um alerta que aparece na PWA do passageiro → identificar veículo sem sinal.
**Backend/Directus:** schema de §5 criado e versionado → permissões por papel corretas (público só leitura) → nenhum dado de posição servido com > 90s sem marcação.
**QR:** gerar QR de todos os pontos de uma linha em lote → cada scan contabilizado → QR permanece válido após editar o ponto.

---

## 13. Glossário
- **GTFS:** General Transit Feed Specification — padrão de dados estáticos de transporte.
- **GTFS-Realtime:** extensão para dados ao vivo (posição, atrasos, alertas), em Protocol Buffers.
- **ETA:** Estimated Time of Arrival (previsão de chegada).
- **PWA:** Progressive Web App — app que roda no navegador, sem loja, instalável opcionalmente.
- **Directus:** plataforma headless (DB + API REST/GraphQL + Auth + Realtime) usada como backend.
- **MQTT:** protocolo leve de mensageria pub/sub para tempo real em escala.
- **Headsign:** letreiro de destino exibido no ônibus.
