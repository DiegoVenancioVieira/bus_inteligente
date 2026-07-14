# Goals — Bus Inteligente

Este diretório quebra o [PRD](../PRD.md) em **metas independentes** para execução com **FABLE 5** + `/goal`.

## Como usar
1. Config compartilhada: [`../config/project.md`](../config/project.md). Segredos: `../config/.env`.
2. Rode cada goal na ordem abaixo (respeita dependências). Ex.: `/goal goals/00-infra-directus.md`.
3. Cada arquivo é **autocontido**: objetivo, escopo, detalhes técnicos, entregáveis e critérios de aceite (DoD). Onde precisar de contexto, aponta para a seção do PRD.

## Ordem de execução e dependências

| # | Goal | Depende de | Camada |
|---|---|---|---|
| 00 | [infra-directus](00-infra-directus.md) | — | Backend / DB |
| 01 | [backend-realtime](01-backend-realtime.md) | 00 | Backend / Tempo real |
| 02 | [app-motorista](02-app-motorista.md) | 00, 01 | Motorista |
| 03 | [app-passageiro](03-app-passageiro.md) | 00, 01, 05 | Passageiro |
| 04 | [painel-gestao](04-painel-gestao.md) | 00, 01 | Gestão |
| 05 | [qrcode-service](05-qrcode-service.md) | 00 | QR Code |
| 06 | [observabilidade-eta](06-observabilidade-eta.md) | 01, 04 | Escala / Interop |

## Regras invioláveis (valem para todos os goals)
- Não quebrar o schema Directus de [PRD §5](../PRD.md#5-modelo-de-dados-coleções-directus) sem migração versionada.
- Leitura pública é **somente-leitura e filtrada**; escrita de posição só por role `driver`.
- Nenhum dado de posição servido com > **90s** de defasagem sem marcação "sinal perdido".
- Passageiro: **sem login e sem instalação obrigatória**.
- HTTPS em tudo; segredos só em `config/.env`.
