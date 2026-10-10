# syntax=docker/dockerfile:1
# Zaneva Dashboard — Next.js 16 (standalone) + Prisma 7. Untuk EasyPanel (build dari Dockerfile).

ARG NODE_VERSION=24

# ---------- 1. deps: install semua dependency (dev ikut, perlu untuk build) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ---------- 2. builder: generate Prisma client + next build ----------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts membaca DATABASE_URL saat generate; nilai dummy ini HANYA untuk build,
# tidak dipakai/ikut di image akhir (runtime memakai env dari EasyPanel).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build

# ---------- 3. runner: image akhir, minimal ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Jalan sebagai user non-root (user "node" bawaan image, uid 1000)
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Folder public hanya ada kalau project punya; abaikan kalau tidak ada.
RUN mkdir -p public && chown node:node public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
