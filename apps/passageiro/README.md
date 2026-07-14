# PWA do Passageiro — Bus Inteligente (goal 03)

App **sem instalação e sem login**: o passageiro escaneia o QR no ponto (`/p/{code}`) ou no ônibus (`/v/{code}`) e cai direto na informação. Vanilla JS sem build, servida pelo backend em `/passageiro/`.

## Telas (roteadas por query string)
| URL | Tela |
|---|---|
| `?stop={code}` | **Ponto** (destino do QR do abrigo): linhas + ETA grande, mapa ao vivo, alertas, favorito ☆ |
| `?route={id\|short_name}&from={stop}` | **Linha**: trajeto no mapa, dois sentidos com todas as paradas e horários, veículos ativos |
| `?vehicle={code}` | **Embarcada** (QR dentro do ônibus): linha atual, próximas paradas com ETA |
| (sem params) | **Início**: favoritos salvos no aparelho (`localStorage`, sem conta) |

## Tempo real e resiliência
- **WebSocket** no canal do ponto/linha move o marcador do veículo no mapa ao vivo; se o WS cair, entra **polling de 20s** automaticamente; refresh completo a cada 30s (alertas/ETA).
- Posição >90s → **"⚠ sinal perdido"** (também no `aria-label`).
- Sem rede → banner **"Sem conexão — mostrando dados de HH:MM"**, mantendo o último dado (service worker cacheia o shell e o último `/live/*`).

## Mapa
**Leaflet + tiles OpenStreetMap** (vendorizado em `vendor/`, sem CDN). O PRD sugeria MapLibre GL; optei por Leaflet com raster OSM: ~145KB vs ~800KB, mantendo o requisito real (OSM, zero lock-in, carga <3s em 4G). Marcadores de veículo giram pelo `heading` e ficam cinza quando `stale`.

## Acessibilidade (RF-P6)
Lighthouse **Accessibility 92** (DoD ≥90). `lang=pt-BR`, `aria-live` no conteúdo, `aria-pressed` no favorito, cards de linha navegáveis por teclado (Enter/espaço), indicação de veículo ♿ acessível e ❄ ar-condicionado, contraste AA nos temas claro/escuro (`prefers-color-scheme`).

## Produção
- QR já redireciona para cá (goal 05). Após o deploy, servir com **gzip/brotli no proxy** (Lighthouse Performance local = 57 sem compressão; o shell comprimido fica ~60KB).
- Política de tiles do OSM é adequada para piloto; em produção com volume, contratar tile provider (MapTiler/Stadia) ou self-host — trocar 1 linha em `map.js`.
