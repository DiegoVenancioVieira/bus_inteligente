# Seeds — Linha-piloto de Aracaju

Insumo consumido pelo [`goals/00-infra-directus.md`](../../goals/00-infra-directus.md) para popular o Directus.

## Arquivo
- [`aracaju-pilot.json`](aracaju-pilot.json) — 1 agência (SMTT Aracaju), 1 linha (`CT-ATL`), 8 pontos, 2 viagens (ida/volta) com `stop_times`, 2 veículos.

## Corredor
**Terminal do Centro ↔ Orla de Atalaia** — eixo icônico e de alta demanda de Aracaju, bom para o piloto (Centro → orla marítima).

## ⚠️ Validação obrigatória antes do go-live
- As **coordenadas são aproximadas** (landmarks reais), destinadas a bootstrap e testes do fluxo em tempo real.
- Antes de **gerar/imprimir QR de produção** e antes de operar de verdade:
  1. Confirmar a **numeração oficial** da linha na SMTT (`short_name` atual `CT-ATL` é provisório).
  2. Fazer o **snap dos pontos** ao itinerário oficial (posição real de cada abrigo).
  3. Conferir os **horários** (`scheduled_time`) contra a tabela oficial.
- Fonte oficial: https://smtt.aracaju.se.gov.br/itinerario-e-horario-de-onibus/

## Mapeamento para o schema (PRD §5)
`agencies → routes → stops → trips → stop_times → vehicles`. Os `code` de pontos e veículos são **URL-safe e estáveis** (usados nos QR: `/p/{stop_code}`, `/v/{vehicle_code}`).
