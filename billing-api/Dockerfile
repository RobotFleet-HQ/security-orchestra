# ── Billing API Dockerfile ────────────────────────────────────────────────────
# Build context MUST be the repo root (security-orchestra/).
#
# Local build:
#   cd security-orchestra/
#   docker build -f billing-api/Dockerfile -t billing-api .

FROM node:20-slim

WORKDIR /app

# ── Node dependencies (cached layer) ─────────────────────────────────────────
COPY billing-api/package*.json ./billing-api/
RUN cd billing-api && npm ci --omit=dev

# ── TypeScript build ──────────────────────────────────────────────────────────
COPY billing-api/tsconfig.json ./billing-api/
COPY billing-api/src/           ./billing-api/src/
RUN cd billing-api && npx tsc

# ── Persistent volume mount point for SQLite database ─────────────────────────
# Mount a Railway volume at /data to persist billing.db across deploys
RUN mkdir -p /data

WORKDIR /app/billing-api

EXPOSE 3001

CMD ["node", "dist/index.js"]
