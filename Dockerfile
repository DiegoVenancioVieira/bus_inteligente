# Bus Inteligente — backend Node (serve API realtime + PWA passageiro + motorista + gestão)
# Build context: raiz do repositório (o backend serve ../apps como estático).
FROM node:20-alpine

WORKDIR /app/backend

# dependências primeiro (cache de camada)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# código + apps estáticos
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY apps /app/apps

ENV NODE_ENV=production \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8060 \
    TZ=America/Maceio

# Configuração via variáveis de ambiente (Coolify):
#   DIRECTUS_URL, DIRECTUS_TOKEN, PUBLIC_URL  (obrigatórias)
#   ALERT_WEBHOOK_URL                          (opcional)
# config/.env não vai para a imagem (ver .dockerignore) — config.js usa o ambiente.

EXPOSE 8060

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8060/health || exit 1

CMD ["node", "src/server.js"]
