# Deploy no Coolify — Bus Inteligente

O **Directus já roda no seu Coolify** (`directus-bus.candidatosinteligentes.com.br`). Falta publicar o **backend Node** (uma única aplicação: API realtime + PWA passageiro + app motorista + painel gestão) no domínio público.

## Visão do que vai ao ar

```
https://bus.candidatosinteligentes.com.br
 ├── /              → redireciona à PWA do passageiro
 ├── /passageiro/   PWA (destino dos QR)
 ├── /p/{code} /v/{code}   redirecionadores dos QR impressos
 ├── /motorista/    app do motorista
 ├── /gestao/       painel de operação
 ├── /live/* /ingest/* /ws  API realtime (REST + WebSocket)
 ├── /gtfs/*        GTFS estático + Realtime
 └── /metrics /health/*     observabilidade (restringir!)
```

## Passo a passo

### 1. Suba o repositório para o GitHub
O Coolify constrói a partir do git. Na raiz do projeto:
```bash
git init
git add .
git commit -m "Bus Inteligente v1"
gh repo create bus_inteligente --private --source=. --push
```
O `.gitignore` já protege `config/.env` (tokens/senhas ficam fora do repo).

### 2. DNS
Crie um registro **A** para `bus.candidatosinteligentes.com.br` apontando para o IP do servidor Coolify (**187.77.62.124** — o mesmo do Directus). Se o DNS é wildcard `*.candidatosinteligentes.com.br`, já está pronto.

### 3. Crie a aplicação no Coolify
1. **+ New** → **Application** → **Private Repository (GitHub App)** (ou Public) → selecione `bus_inteligente`, branch `main`.
2. **Build Pack:** `Dockerfile` (o `Dockerfile` está na raiz do repo).
3. **Port:** `8060` (Ports Exposes).
4. **Domain:** `https://bus.candidatosinteligentes.com.br` — o Coolify emite o certificado Let's Encrypt sozinho via Traefik.
5. **Environment Variables** (aba Environment):
   | Variável | Valor |
   |---|---|
   | `DIRECTUS_URL` | `https://directus-bus.candidatosinteligentes.com.br` |
   | `DIRECTUS_TOKEN` | *(token de serviço do Directus — gere um NOVO, ver §6)* |
   | `PUBLIC_URL` | `https://bus.candidatosinteligentes.com.br` |
   | `TZ` | `America/Maceio` |
   | `ALERT_WEBHOOK_URL` | *(opcional — webhook p/ alertas operacionais)* |
6. **Health check** (aba Healthcheck): path `/health`, porta `8060`.
7. **Deploy**. WebSocket funciona sem configuração extra (Traefik faz upgrade automático).

> **Dica (rede interna):** como Directus e backend estão no mesmo Coolify, você pode usar a URL interna do container do Directus em `DIRECTUS_URL` (ex.: `http://<nome-do-serviço>:8055`, aba "Service Stack" do Directus) — corta a volta pela internet. Funciona dos dois jeitos.

### 4. Gzip/Brotli (recomendado)
Na aplicação → **Advanced** → habilite **Gzip Compression** (ou adicione o middleware `compress` do Traefik em Custom Labels). A PWA cai de ~200KB para ~60KB.

### 5. Restrinja observabilidade (recomendado)
`/metrics` e `/health/operational` são públicos por padrão. Opções:
- Custom Label Traefik com `ipAllowList` para a rede interna; **ou**
- deixar como está no piloto (não expõem dados pessoais, só contadores).

### 6. Pós-deploy (checklist)
- [ ] **Rotacionar o token admin do Directus** (Settings → Users → token) e atualizar `DIRECTUS_TOKEN` no Coolify — o token atual trafegou em chat durante o setup.
- [ ] Testar o fluxo real: `https://bus.candidatosinteligentes.com.br/p/CENTRO` deve abrir a PWA com as chegadas.
- [ ] `curl https://bus.candidatosinteligentes.com.br/health` → `{"status":"ok"}`.
- [ ] Escanear um QR impresso de `infra/qrcodes/` com o celular (agora funcionam publicamente).
- [ ] Validar coordenadas dos pontos na SMTT antes de colar cartazes nos abrigos (`infra/seeds/README.md`).
- [ ] Auto-deploy: habilite o webhook do GitHub no Coolify para publicar a cada push.

## Atualizações futuras
`git push` → Coolify reconstrói e publica (com o webhook ativo). O schema do Directus é versionado em `infra/schema/snapshot.yaml`; mudanças de schema usam `npx directus schema apply` ou re-execução do `infra/scripts/bootstrap.py` (idempotente).
