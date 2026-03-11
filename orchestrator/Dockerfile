# ── Orchestrator Dockerfile ───────────────────────────────────────────────────
# Build context MUST be the repo root (security-orchestra/), not this directory.
# Railway sets the build context to the repository root automatically.
#
# Local build:
#   cd security-orchestra/
#   docker build -f orchestrator/Dockerfile -t orchestrator .

FROM node:20-slim

# Python 3 is required by generator-sizing-agent and utility-interconnect-agent
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Node dependencies (cached layer) ─────────────────────────────────────────
COPY orchestrator/package*.json ./orchestrator/
RUN cd orchestrator && npm ci

# ── TypeScript build ──────────────────────────────────────────────────────────
COPY orchestrator/tsconfig.json ./orchestrator/
COPY orchestrator/src/           ./orchestrator/src/
RUN cd orchestrator && npx tsc

# ── Python agents ─────────────────────────────────────────────────────────────
COPY generator-sizing-agent/          ./generator-sizing-agent/
COPY utility-interconnect-agent/      ./utility-interconnect-agent/
COPY nc-utility-interconnect-agent/   ./nc-utility-interconnect-agent/
COPY pue-calculator-agent/            ./pue-calculator-agent/

# ── Persistent volume mount point for SQLite databases ────────────────────────
# Mount a Railway volume at /data to persist keys.db and audit.db across deploys
RUN mkdir -p /data

WORKDIR /app/orchestrator

# PORT is injected by Railway; when set, the server uses HTTP/SSE transport
EXPOSE 3000

CMD ["npm", "start"]
