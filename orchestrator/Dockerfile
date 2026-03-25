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

# ── Static assets ─────────────────────────────────────────────────────────────
COPY orchestrator/public/        ./orchestrator/public/

# ── Python agents ─────────────────────────────────────────────────────────────
# Power infrastructure
COPY generator-sizing-agent/          ./generator-sizing-agent/
COPY utility-interconnect-agent/      ./utility-interconnect-agent/
COPY nc-utility-interconnect-agent/   ./nc-utility-interconnect-agent/
COPY pue-calculator-agent/            ./pue-calculator-agent/
COPY construction-cost-agent/         ./construction-cost-agent/
COPY nfpa-110-checker-agent/          ./nfpa-110-checker-agent/
COPY ats-sizing-agent/                ./ats-sizing-agent/
COPY ups-sizing-agent/                ./ups-sizing-agent/
COPY fuel-storage-agent/              ./fuel-storage-agent/
COPY cooling-load-agent/              ./cooling-load-agent/
COPY power-density-agent/             ./power-density-agent/
COPY redundancy-validator-agent/      ./redundancy-validator-agent/
# Phase 1 agents
COPY demand-response-agent/           ./demand-response-agent/
COPY environmental-impact-agent/      ./environmental-impact-agent/
COPY fire-suppression-agent/          ./fire-suppression-agent/
COPY incentive-finder-agent/          ./incentive-finder-agent/
COPY noise-compliance-agent/          ./noise-compliance-agent/
COPY permit-timeline-agent/           ./permit-timeline-agent/
COPY roi-calculator-agent/            ./roi-calculator-agent/
COPY tco-analyzer-agent/              ./tco-analyzer-agent/
COPY fiber-connectivity-agent/        ./fiber-connectivity-agent/
COPY harmonic-analysis-agent/         ./harmonic-analysis-agent/
COPY site-scoring-agent/              ./site-scoring-agent/
COPY voltage-drop-agent/              ./voltage-drop-agent/
COPY water-availability-agent/        ./water-availability-agent/
# Phase 2 agents — Network/Connectivity
COPY network-topology-agent/          ./network-topology-agent/
COPY bandwidth-sizing-agent/          ./bandwidth-sizing-agent/
COPY latency-calculator-agent/        ./latency-calculator-agent/
COPY ip-addressing-agent/             ./ip-addressing-agent/
COPY dns-architecture-agent/          ./dns-architecture-agent/
COPY bgp-peering-agent/               ./bgp-peering-agent/
# Phase 2 agents — Security/Access
COPY physical-security-agent/         ./physical-security-agent/
COPY biometric-design-agent/          ./biometric-design-agent/
COPY surveillance-coverage-agent/     ./surveillance-coverage-agent/
COPY cybersecurity-controls-agent/    ./cybersecurity-controls-agent/
COPY compliance-checker-agent/        ./compliance-checker-agent/
# Phase 2 agents — HVAC/Mechanical
COPY chiller-sizing-agent/            ./chiller-sizing-agent/
COPY crac-vs-crah-agent/              ./crac-vs-crah-agent/
COPY airflow-modeling-agent/          ./airflow-modeling-agent/
COPY humidification-agent/            ./humidification-agent/
COPY economizer-analysis-agent/       ./economizer-analysis-agent/
# Phase 2 agents — Project/Operations
COPY construction-timeline-agent/     ./construction-timeline-agent/
COPY commissioning-plan-agent/        ./commissioning-plan-agent/
COPY maintenance-schedule-agent/      ./maintenance-schedule-agent/
COPY capacity-planning-agent/         ./capacity-planning-agent/
COPY sla-calculator-agent/            ./sla-calculator-agent/
COPY change-management-agent/         ./change-management-agent/
# Phase 2 agents — Energy/Sustainability
COPY carbon-footprint-agent/          ./carbon-footprint-agent/
COPY solar-feasibility-agent/         ./solar-feasibility-agent/
COPY battery-storage-agent/           ./battery-storage-agent/
COPY energy-procurement-agent/        ./energy-procurement-agent/

# ── Persistent volume mount point for SQLite databases ────────────────────────
# Mount a Railway volume at /data to persist keys.db and audit.db across deploys
RUN mkdir -p /data

WORKDIR /app/orchestrator

# PORT is injected by Railway; when set, the server uses HTTP/SSE transport
EXPOSE 3000

CMD ["npm", "start"]
