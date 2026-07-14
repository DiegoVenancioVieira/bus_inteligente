# Deploy — Bus Inteligente

O **Directus já roda no seu Coolify** (`directus-bus.candidatosinteligentes.com.br`). Falta publicar o **backend Node** (uma única aplicação: API realtime + PWA passageiro + app motorista + painel gestão).

---

## ⚡ VPS sem domínio (só IP) — leia primeiro

A VPS já tem **Coolify + Traefik + 2 Directus + ~15 apps**. Análise do `docker ps`:

**Portas do host já ocupadas:** 80, 443, 8080 (traefik/coolify-proxy) · 8000 (coolify) · 6001-6002 (realtime) · 5678 (n8n) · 8055 e 8056 (dois Directus) · 9090 (taiga) · 3001, 3002, 3004, 3005, 3006, 3008, 3010 · 8100.
**➡️ A porta `8060` do nosso backend está LIVRE — sem conflito.**

### A pegadinha do "só IP + HTTP"
Navegadores tratam `http://IP` como **contexto inseguro** e bloqueiam:
- **`navigator.geolocation`** → o **app do motorista não captura GPS real** (só o modo simulado funciona). ❌ quebra o piloto real.
- **Service Worker** → sem offline/instalar-na-tela. (o app ainda abre e funciona online)
- Passageiro e gestão funcionam normalmente sobre HTTP (não dependem de GPS).

### Solução recomendada: HTTPS grátis via `sslip.io` (sem comprar domínio)
`sslip.io` resolve qualquer `qualquer-coisa-<IP>.sslip.io` para o próprio IP. O Traefik do Coolify emite um **Let's Encrypt real** para esse host — HTTPS de verdade, GPS funciona, sem domínio próprio.

1. No Coolify: **+ New → Application →** seu repositório → Build Pack **Dockerfile** → Port **8060**.
2. **Domain:** `https://bus-187-77-62-124.sslip.io` (troque pelos octetos do IP da VPS com hífens).
3. **Env vars:** `DIRECTUS_URL`, `DIRECTUS_TOKEN`, `PUBLIC_URL=https://bus-187-77-62-124.sslip.io`, `TZ=America/Maceio`.
4. **Deploy.** O Traefik roteia por Host header no 443 que ele já ocupa — **nenhuma porta nova exposta, zero conflito**. WebSocket funciona automático.

### Alternativa rápida: HTTP puro na porta 8060 (sem Coolify)
Para testar por dentro / rede local, sem GPS de motorista:
```bash
git clone <repo> && cd bus_inteligente
cp .env.deploy.example .env      # edite DIRECTUS_TOKEN e PUBLIC_URL=http://SEU_IP:8060
docker compose up -d --build
# acesse http://SEU_IP:8060  (passageiro e gestão OK; motorista só com GPS simulado)
```
O `docker-compose.yml` na raiz já mapeia só a porta 8060 (livre).

### Regenerar os QR após definir o PUBLIC_URL
Os QR de `infra/qrcodes/` foram gerados apontando para o domínio antigo. Com o `PUBLIC_URL` novo, regenere:
```bash
docker exec bus-inteligente npm run qrcodes -- --route CT-ATL
# ou localmente com PUBLIC_URL no config/.env
```

### DIRECTUS_URL na mesma VPS
Como o Directus está nesta VPS, `DIRECTUS_URL=https://directus-bus.candidatosinteligentes.com.br` funciona (sai e volta pelo Traefik). Para cortar a volta, conecte o container à rede do Coolify e use a URL interna do serviço Directus (`http://<container-directus>:8055`). Para o piloto, a URL pública já basta.

---

## Deploy com domínio próprio (referência)

Quando tiver o domínio `bus.candidatosinteligentes.com.br`:

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
