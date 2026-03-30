# Security Orchestra

[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green)](https://modelcontextprotocol.io)
[![A2A Compatible](https://img.shields.io/badge/A2A-Compatible-blue)](https://google.github.io/A2A/)
[![Transport](https://img.shields.io/badge/Transport-SSE-orange)](https://security-orchestra-orchestrator.onrender.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Agents](https://img.shields.io/badge/Agents-64-purple)](https://github.com/RobotFleet-HQ/security-orchestra)

**56 specialized agents + 8 compound chains = 64 total callable tools via MCP.** Generator sizing, PUE calculations, network topology, cooling load analysis, redundancy validation, site scoring, and more — all accessible to Claude or any MCP client over SSE.

---

## Quick Connect (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "security-orchestra": {
      "url": "https://security-orchestra-orchestrator.onrender.com",
      "transport": "sse"
    }
  }
}
```

Restart Claude Desktop. All 64 tools (56 specialized agents + 8 compound chains) are immediately available.

---

## Live Endpoint

| | URL |
|---|---|
| **MCP SSE** | `https://security-orchestra-orchestrator.onrender.com` |
| **Agent Card (A2A)** | `https://security-orchestra-orchestrator.onrender.com/.well-known/agent.json` |
| **A2A Endpoint** | `https://security-orchestra-orchestrator.onrender.com/a2a` |
| **MCP Registry ID** | `io.github.RobotFleet-HQ/security-orchestra` |

---

## Protocol Support

| Protocol | Status | Use Case |
|---|---|---|
| **MCP** (Model Context Protocol) | ✅ Live | Claude Desktop, Claude Code, any MCP client |
| **A2A** (Agent2Agent Protocol) | ✅ Live | Agent-to-agent discovery and task delegation |
| **AG-UI** | ✅ Live | Streaming agent UI — `POST /agui` |
| **ACP / BeeAI** | ✅ Live | IBM agent communication — `POST /acp/runs` |
| **AGNTCY / OASF** | ✅ Live | Per-agent ACP endpoints + OASF manifests |
| **OpenAI Agents SDK** | ✅ Live | Tool-call format — `POST /openai/run` |

---

## Response Contract

Every workflow and chain call — regardless of transport (MCP, A2A, REST, AG-UI, ACP) — returns a `CanonicalResponse` payload. The response shape is defined in [`orchestrator/src/canonical.ts`](orchestrator/src/canonical.ts).

```jsonc
{
  "agent_id":         "generator_sizing",   // exact workflow/chain key
  "agent_version":    "1.0",
  "protocol_version": "1.0",

  "status": "success",                      // "success" | "error"
  "result": { /* workflow-specific data */ },

  // Present only when status === "error"
  "error_code":    "WORKFLOW_FAILED",
  "error_message": "Human-readable description",

  "data_freshness": {
    "last_validated": "2026-03-28",         // ISO date of last logic audit
    "standards_refs": ["NFPA 110:2022"],    // authoritative sources
    "stale_risk":     "medium",             // "low" | "medium" | "high"
    "pricing_note":   "Cost estimates based on 2026 Q1 market data. Verify current pricing before procurement."
    //                ↑ only present when agent result contains pricing data
  },

  "a2a": {
    "task_id":           "uuid-v4",
    "input_tokens_used": 0,
    "credits_consumed":  5,
    "callable_by": ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"]
  }
}
```

**Chain calls** (`POST /chain`) return the same shape with `agent_id: "chain:<chain_id>"` and `result` containing `{ chain, steps_completed, results[], summary }`.

**Knowledge freshness:** `stale_risk` reflects data volatility — `high` means pricing or utility rates that change quarterly, `low` means physics-based constants. See [`VALIDATION_CHECKLIST.md`](VALIDATION_CHECKLIST.md) for per-agent validation cadence.

---

## All 52 Agents

### Power & Electrical

| Agent | What it does |
|---|---|
| `generator_sizing` | Size generators for data center loads with industry-standard NEC/NFPA compliance |
| `ups_sizing` | Size UPS systems per IEEE 485 and 1184 — VRLA or Li-ion, N/N+1/2N configs |
| `ats_sizing` | Size automatic transfer switches per NEC Articles 700, 701, 702 |
| `fuel_storage` | Design diesel fuel storage per NFPA 30 — tank size, containment, SPCC thresholds |
| `nfpa_110_checker` | Validate emergency generator compliance per NFPA 110 Level 1 and Level 2 |
| `harmonic_analysis` | Analyze harmonic distortion and THD in power distribution systems |
| `voltage_drop` | Calculate voltage drop across electrical distribution circuits |
| `power_density` | Analyze rack power density, PDU sizing, NEC 645 branch circuit requirements |
| `battery_storage` | Design battery energy storage systems for backup and demand management |
| `demand_response` | Analyze utility demand response programs and curtailment opportunities |

### Cooling & Mechanical

| Agent | What it does |
|---|---|
| `cooling_load` | Calculate data center cooling load per ASHRAE TC 9.9 — tons, CRAC/CRAH sizing |
| `pue_calculator` | Calculate PUE and efficiency metrics with optimization recommendations |
| `chiller_sizing` | Size chiller systems for cooling plant infrastructure |
| `crac_vs_crah` | Compare CRAC vs CRAH cooling — cost, efficiency, failure modes |
| `airflow_modeling` | Model airflow patterns — hot/cold aisle containment, CFD estimates |
| `economizer_analysis` | Analyze free cooling / economizer feasibility by climate and location |
| `humidification` | Design humidification systems per ASHRAE environmental classes |

### Network & Connectivity

| Agent | What it does |
|---|---|
| `network_topology` | Design data center network topology — leaf-spine, core-distribution-access |
| `bandwidth_sizing` | Calculate network bandwidth requirements for projected workloads |
| `dns_architecture` | Design DNS architecture — authoritative, recursive, anycast |
| `ip_addressing` | Plan IP addressing and subnetting for large-scale infrastructure |
| `bgp_peering` | Analyze BGP peering configurations, AS relationships, route policies |
| `fiber_connectivity` | Design fiber connectivity — dark fiber routes, carrier diversity |
| `latency_calculator` | Calculate network latency, propagation delay, RTT between sites |

### Site & Construction

| Agent | What it does |
|---|---|
| `site_scoring` | Score potential data center sites — power, water, risk, fiber, incentives |
| `construction_cost` | Estimate $/MW construction costs with regional factors and tier breakdown |
| `construction_timeline` | Plan construction timelines — civil, electrical, mechanical, commissioning |
| `permit_timeline` | Model permitting timelines across federal, state, and local jurisdictions |
| `environmental_impact` | Assess environmental impact — NEPA, wetlands, stormwater permitting |
| `water_availability` | Analyze water availability and rights for cooling water supply |
| `noise_compliance` | Analyze generator and cooling noise levels against local ordinances |
| `incentive_finder` | Find utility incentives, tax credits, and government grants by location |

### Utility & Interconnect

| Agent | What it does |
|---|---|
| `utility_interconnect` | Analyze utility interconnect for 9 major US utilities — timeline and cost |
| `nc_utility_interconnect` | North Carolina utility interconnect — detailed timeline, cost, regulatory |
| `energy_procurement` | Evaluate PPA, direct access, and retail energy procurement strategies |
| `solar_feasibility` | Analyze on-site solar feasibility — capacity, payback, interconnect |
| `carbon_footprint` | Calculate Scope 1/2/3 emissions and carbon intensity per kWh |

### Compliance & Certification

| Agent | What it does |
|---|---|
| `redundancy_validator` | Validate redundancy design against Uptime Institute Tier I–IV standards |
| `tier_certification` | Assess Uptime Institute tier certification readiness and gap analysis |
| `compliance_checker` | Check regulatory and standards compliance — NERC CIP, SOC 2, ISO 27001 |

### Physical Security

| Agent | What it does |
|---|---|
| `physical_security` | Design layered physical security — mantrap, barriers, access zones |
| `biometric_design` | Design biometric access control systems — fingerprint, iris, multi-factor |
| `surveillance_coverage` | Calculate camera coverage — FOV, overlap, blind spot analysis |
| `cybersecurity_controls` | Assess cybersecurity controls — NIST CSF, CIS Controls mapping |

### Financial & Operations

| Agent | What it does |
|---|---|
| `roi_calculator` | Calculate ROI for data center investments — CapEx, OpEx, payback period |
| `tco_analyzer` | Analyze total cost of ownership over 10–20 year facility life |
| `sla_calculator` | Model SLA uptime tiers — nines, MTTR, annual downtime budgets |
| `capacity_planning` | Plan capacity growth — power, space, cooling, network expansion |
| `maintenance_schedule` | Create preventive maintenance schedules per NFPA and manufacturer specs |
| `change_management` | Plan and track infrastructure change management workflows |
| `commissioning_plan` | Create commissioning plans — integrated system testing, acceptance criteria |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  MCP Client (Claude Desktop / Claude Code / any MCP) │
└───────────────────────┬──────────────────────────────┘
                        │ SSE (MCP protocol)
                        ▼
┌──────────────────────────────────────────────────────┐
│  orchestrator/  (Node.js MCP server on Render)        │
│                                                       │
│  Auth → Rate Limit → Validation → Credit Gate → Run  │
│                                                       │
│  56 specialized agents + 8 compound chains = 64 tools │
└──────────┬────────────────────────────────┬──────────┘
           │ HTTP (credit check / deduct)   │ write
           ▼                                ▼
┌────────────────────┐           ┌────────────────────┐
│  billing-api/      │           │  audit.db           │
│  (Express HTTP)    │           │  (shared SQLite)    │
│  billing.db        │           └────────────────────┘
│  ├─ users          │
│  ├─ subscriptions  │
│  └─ credits        │
│  Stripe webhooks   │
└────────────────────┘
```

| Service | Transport | URL |
|---|---|---|
| `orchestrator` | SSE (MCP) | `https://security-orchestra-orchestrator.onrender.com` |
| `billing-api` | HTTP | Separate Render service |

---

## Pricing Tiers

| Tier | Monthly | Credits | Rate Limit |
|---|---|---|---|
| Free | $0 | 100 | 10/min · 100/hr · 500/day |
| Starter | $29 | 500 | 60/min · 1,000/hr · 5,000/day |
| Pro | $99 | 2,000 | 300/min · 5,000/hr · 50,000/day |
| Enterprise | $499 | 10,000 | 1,000/min · 20,000/hr · 200,000/day |

---

## Self-Hosting

### Prerequisites

- Node.js 18+
- npm 9+
- Stripe account (optional — for paid tiers only)

### Install

```bash
git clone https://github.com/RobotFleet-HQ/security-orchestra
cd security-orchestra
cd orchestrator && npm install && npm run build && cd ..
cd billing-api  && npm install && npm run build && cd ..
```

### Configure

```bash
# Orchestrator
cd orchestrator && cp .env.example .env
npm run generate-key myuser free   # generates sk_live_... key

# Billing API
cd billing-api && cp .env.example .env
# Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
```

### Run

```bash
# Terminal 1
cd orchestrator && npm start

# Terminal 2
cd billing-api && npm start
```

### Connect Claude Desktop (self-hosted)

```json
{
  "mcpServers": {
    "security-orchestra": {
      "command": "node",
      "args": ["/path/to/security-orchestra/orchestrator/dist/index.js"],
      "env": {
        "ORCHESTRATOR_API_KEY": "sk_live_your_key",
        "BILLING_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

---

## Repository Structure

```
security-orchestra/
├── orchestrator/              # MCP server — 56 specialized agents + 8 compound chains = 64 total callable tools
│   └── src/
│       ├── index.ts           # Entry point, tool registry
│       ├── auth.ts            # API key auth (bcrypt)
│       ├── rateLimit.ts       # Sliding-window rate limiter
│       ├── validation.ts      # Input sanitization
│       ├── billing.ts         # Credit check/deduct
│       └── audit.ts           # Audit log writer
├── billing-api/               # HTTP API — users, credits, Stripe
├── [agent]-agent/             # 56 individual agent modules
└── mcp.json                   # MCP registry manifest
```

---

## License

MIT — [RobotFleet HQ](https://github.com/RobotFleet-HQ)
