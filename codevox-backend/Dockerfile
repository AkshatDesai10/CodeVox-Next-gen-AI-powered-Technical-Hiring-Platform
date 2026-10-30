# CodeVox backend — NestJS 11 production image
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
RUN useradd --system --uid 1001 nestjs \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl docker.io \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=nestjs:nestjs /app/dist ./dist
COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/package.json ./package.json
COPY --from=builder --chown=nestjs:nestjs /app/sql ./sql
RUN mkdir -p local-uploads local-recordings \
  && chown -R nestjs:nestjs local-uploads local-recordings
USER nestjs
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/main.js"]
