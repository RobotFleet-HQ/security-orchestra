# Security Orchestra

50+ specialized AI agents & 8 compound chains for data center critical power infrastructure.

[![Smithery](https://smithery.ai/badge/@RobotFleet-HQ/security-orchestra)](https://smithery.ai/servers/@RobotFleet-HQ/security-orchestra)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green)](https://modelcontextprotocol.io)
[![A2A Compatible](https://img.shields.io/badge/A2A-Compatible-blue)](https://google.github.io/A2A/)
[![Transport](https://img.shields.io/badge/Transport-SSE%20%7C%20stdio-orange)](https://security-orchestra-orchestrator.onrender.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Agents](https://img.shields.io/badge/Tools-50plus-purple)](https://github.com/RobotFleet-HQ/security-orchestra)

---

## Installation

### Claude Desktop (hosted)

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

### Claude Code (CLI)

```bash
claude mcp add security-orchestra https://security-orchestra-orchestrator.onrender.com --transport sse
```

### npx (Smithery)

```bash
npx -y @smithery/cli@latest mcp add robotfleet-hq/security-orchestra
```

Install via [Smithery](https://smithery.ai/servers/@RobotFleet-HQ/security-orchestra).

Restart your MCP client. All tools are immediately available.

---

## What It Does

Security Orchestra provides deterministic, standards-based calculations for every phase of data center infrastructure — from site selection to commissioning. Every agent returns structured JSON with citations to applicable codes (NEC, NFPA, IEEE, ASHRAE, Uptime Institute).

### Tool Categories

| Category | Agents | Standards |
|---|---|---|
| **Generator Sizing** | `generator_sizing`, `fuel_storage`, `demand_response` | NEC, NFPA 110, NFPA 30 |
| **NFPA 110 Compliance** | `nfpa_110_checker` | NFPA 110 Level 1 & Level 2 |
| **UPS / ATS Sizing** | `ups_sizing`, `ats_sizing`, `battery_storage` | IEEE 485, IEEE 1184, NEC 700/701/702 |
| **PUE & Efficiency** | `pue_calculator`, `economizer_analysis` | ASHRAE TC 9.9 |
| **Cooling Load** | `cooling_load`, `chiller_sizing`, `crac_vs_crah`, `airflow_modeling`, `humidification` | ASHRAE |
| **ROI / TCO** | `roi_calculator`, `tco_analyzer`, `construction_cost`, `incentive_finder` | — |
| **Tier Certification** | `tier_certification`, `redundancy_validator`, `compliance_checker` | Uptime Institute Tier I-IV |
| **Utility Interconnect** | `utility_interconnect`, `nc_utility_interconnect`, `energy_procurement` | Utility-specific |
| **Network Design** | `network_topology`, `bandwidth_sizing`, `bgp_peering`, `dns_architecture`, `ip_addressing`, `fiber_connectivity`, `latency_calculator` | — |
| **Physical Security** | `physical_security`, `biometric_design`, `surveillance_coverage`, `cybersecurity_controls` | NIST CSF, SOC 2, ISO 27001 |
| **Site & Construction** | `site_scoring`, `construction_timeline`, `permit_timeline`, `environmental_impact`, `water_availability`, `noise_compliance` | NEPA, local codes |
| **Sustainability** | `carbon_footprint`, `solar_feasibility`, `energy_procurement` | GHG Protocol, IRA |
| **Operations** | `sla_calculator`, `capacity_planning`, `maintenance_schedule`, `change_management`, `commissioning_plan` | NFPA, OEM specs |

### Compound Chains (8)

Chains run multiple agents sequentially and return a combined result:

| Chain | Pipeline |
|---|---|
| `chain_full_power_analysis` | Generator > NFPA 110 > UPS > ROI |
| `chain_emergency_power_package` | UPS > ATS > Generator > Fuel Storage > NFPA 110 |
| `chain_site_readiness` | Site Scoring > Tier Cert > Utility Interconnect > Compliance |
| `chain_full_site_analysis` | Site Scoring > Tier Cert > Utility > Permits > Cost > Timeline |
| `chain_tco_deep_dive` | PUE > Cooling Load > TCO Analyzer |
| `chain_cooling_optimization` | Cooling > Chiller > CRAC vs CRAH > Airflow > Economizer |
| `chain_nc_power_package` | NC Utility Interconnect > Generator > NFPA 110 > UPS |
| `chain_sustainability_package` | Carbon > Solar > Battery > Energy Procurement > Environmental |

---

## Supported Protocols

Security Orchestra exposes every tool across six agent-communication protocols:

| Protocol | Status | Endpoint | Use Case |
|---|---|---|---|
| **MCP** (Model Context Protocol) | Live | SSE: `/sse`, stdio via npx | Claude Desktop, Claude Code, Cursor, any MCP client |
| **A2A** (Agent2Agent) | Live | `/.well-known/agent.json`, `/a2a` | Google agent-to-agent discovery and task delegation |
| **OpenAI Agents SDK** | Live | `POST /openai/run` | OpenAI-compatible tool-call format |
| **AG-UI** | Live | `POST /agui` | CopilotKit streaming agent UI |
| **ACP** (Agent Communication Protocol) | Live | `POST /acp/runs` | IBM BeeAI agent communication |
| **AGNTCY / OASF** | Live | Per-agent ACP endpoints + OASF manifests | Cisco AGNTCY interoperability |

---

## Live Endpoints

| | URL |
|---|---|
| **MCP (SSE)** | `https://security-orchestra-orchestrator.onrender.com` |
| **Agent Card (A2A)** | `https://security-orchestra-orchestrator.onrender.com/.well-known/agent.json` |
| **A2A Tasks** | `https://security-orchestra-orchestrator.onrender.com/a2a` |
| **Health** | `https://security-orchestra-orchestrator.onrender.com/health` |
| **Landing Page** | [security-orchestra-landing](https://robotfleet-hq.github.io/security-orchestra-landing/) |
| **Smithery** | [smithery.ai/@RobotFleet-HQ/security-orchestra](https://smithery.ai/servers/@RobotFleet-HQ/security-orchestra) |

---

## Response Contract

Every tool call returns a `CanonicalResponse` — same shape regardless of protocol:

```jsonc
{
  "agent_id":          "generator_sizing",
  "agent_version":     "1.0",
  "protocol_version":  "1.0",
  "execution_context": "deterministic_calc",

  "status": "success",
  "result": { /* structured data */ },

  "data_freshness": {
    "validated_at":  "2026-03-28",
    "standards_ref": ["NFPA 110:2022"],
    "stale_risk":    "medium"
  },

  "a2a": {
    "task_id":           "uuid-v4",
    "input_tokens_used": 0,
    "credits_consumed":  5,
    "callable_by": ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"]
  }
}
```

### Latency

All 50+ individual agents are **deterministic TypeScript calculations** — no LLM calls, no external I/O.

| Context | Description | Latency |
|---|---|---|
| `deterministic_calc` | All 50+ individual agents | < 100 ms |
| `multi_agent_chain` | All 8 compound chains | 0.5-5 s |
| `cached` | Cached result | < 10 ms |

---

## All 50+ Agents

### Power & Electrical

| Agent | What it does |
|---|---|
| `generator_sizing` | Size generators for data center loads with NEC/NFPA compliance |
| `ups_sizing` | Size UPS systems per IEEE 485/1184 — VRLA or Li-ion, N/N+1/2N configs |
| `ats_sizing` | Size automatic transfer switches per NEC 700/701/702 |
| `fuel_storage` | Design diesel fuel storage per NFPA 30 — tanks, containment, SPCC |
| `nfpa_110_checker` | Validate emergency generator compliance per NFPA 110 |
| `harmonic_analysis` | Analyze THD in power distribution per IEEE 519 |
| `voltage_drop` | Calculate voltage drop per NEC 210.19 |
| `power_density` | Analyze rack power density and PDU sizing per NEC 645 |
| `battery_storage` | Design BESS for backup, peak shaving, demand response |
| `demand_response` | Model utility demand response program participation |

### Cooling & Mechanical

| Agent | What it does |
|---|---|
| `cooling_load` | Calculate cooling load per ASHRAE TC 9.9 |
| `pue_calculator` | Calculate PUE with optimization recommendations |
| `chiller_sizing` | Size water-cooled and air-cooled chillers |
| `crac_vs_crah` | Compare CRAC vs CRAH — cost, efficiency, constraints |
| `airflow_modeling` | Model hot/cold aisle containment and CFM requirements |
| `economizer_analysis` | Analyze free-cooling potential by climate zone |
| `humidification` | Design humidification systems per ASHRAE A1 envelope |

### Network & Connectivity

| Agent | What it does |
|---|---|
| `network_topology` | Design spine-leaf network topology |
| `bandwidth_sizing` | Size north-south and east-west bandwidth |
| `dns_architecture` | Design DNS — authoritative, recursive, anycast, DNSSEC |
| `ip_addressing` | Plan IP addressing and VLAN architecture |
| `bgp_peering` | Design BGP peering and route reflector architecture |
| `fiber_connectivity` | Analyze fiber routes and carrier diversity |
| `latency_calculator` | Calculate propagation latency by medium and hop count |

### Site & Construction

| Agent | What it does |
|---|---|
| `site_scoring` | Score candidate sites across power, connectivity, risk, cost |
| `construction_cost` | Estimate $/MW construction costs with regional factors |
| `construction_timeline` | Phase-by-phase schedule with regulatory modifiers |
| `permit_timeline` | Model permitting timelines across jurisdictions |
| `environmental_impact` | Assess NOx/PM2.5/CO2 emissions per EPA AP-42 |
| `water_availability` | Assess water supply, stress risk, and recycled water options |
| `noise_compliance` | Analyze generator noise vs local ordinances |
| `incentive_finder` | Find federal/state incentives, IRA credits, utility rebates |

### Utility & Interconnect

| Agent | What it does |
|---|---|
| `utility_interconnect` | Analyze utility interconnect for 9 major US utilities |
| `nc_utility_interconnect` | North Carolina-specific utility interconnect analysis |
| `energy_procurement` | Evaluate PPA, direct access, and retail energy strategies |
| `solar_feasibility` | Analyze on-site solar PV — capacity, IRA credits, payback |
| `carbon_footprint` | Calculate Scope 1/2/3 emissions per GHG Protocol |

### Compliance & Certification

| Agent | What it does |
|---|---|
| `redundancy_validator` | Validate against Uptime Institute Tier I-IV standards |
| `tier_certification` | Assess tier certification readiness with gap analysis |
| `compliance_checker` | Check SOC 2, ISO 27001, NIST CSF, PCI DSS, FedRAMP |

### Physical Security

| Agent | What it does |
|---|---|
| `physical_security` | Design layered physical security per Uptime tier standards |
| `biometric_design` | Design biometric access control — FAR/FRR, throughput |
| `surveillance_coverage` | Calculate CCTV coverage, storage, and retention |
| `cybersecurity_controls` | Map controls to NIST CSF and CIS benchmarks |

### Financial & Operations

| Agent | What it does |
|---|---|
| `roi_calculator` | Calculate NPV, IRR, payback using DCF analysis |
| `tco_analyzer` | Analyze total cost of ownership over facility life |
| `sla_calculator` | Model SLA availability against tier benchmarks |
| `capacity_planning` | Forecast capacity runway and expansion triggers |
| `maintenance_schedule` | Build annual PM schedules per NFPA and OEM specs |
| `change_management` | Design change management process per tier class |
| `commissioning_plan` | Generate commissioning plans per ASHRAE Guideline 1.2 |
| `fire_suppression` | Design clean agent fire suppression per NFPA 2001/75 |

---

## Architecture

```
+------------------------------------------------------+
|  MCP Client (Claude Desktop / Claude Code / Cursor)  |
+-------------------------+----------------------------+
                          | SSE (MCP protocol)
                          v
+------------------------------------------------------+
|  orchestrator/  (Node.js on Render)                  |
|                                                      |
|  Auth > Rate Limit > Validation > Credit Gate > Run  |
|                                                      |
|  50+ agents & 8 chains                    |
|  Protocols: MCP, A2A, OpenAI, AG-UI, ACP, AGNTCY   |
+----------+----------------------------+--------------+
           | HTTP (credit check/deduct) | write
           v                            v
+--------------------+       +--------------------+
|  billing-api/      |       |  audit.db          |
|  (Express HTTP)    |       |  (SQLite)          |
|  Stripe webhooks   |       +--------------------+
+--------------------+
```

---

## Pricing

| Tier | Monthly | Credits | Rate Limit |
|---|---|---|---|
| Free | $0 | 100 | 10/min |
| Starter | $29 | 500 | 60/min |
| Pro | $99 | 2,000 | 300/min |
| Enterprise | $499 | 10,000 | 1,000/min |

Get a free API key: [Sign up](https://security-orchestra-billing.onrender.com/signup.html)

---

## Self-Hosting

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
git clone https://github.com/RobotFleet-HQ/security-orchestra
cd security-orchestra

# Build
cd orchestrator && npm install && npm run build && cd ..
cd billing-api  && npm install && npm run build && cd ..

# Configure
cd orchestrator && cp .env.example .env
npm run generate-key myuser free   # generates sk_live_... key

# Run
cd orchestrator && npm start       # Terminal 1
cd billing-api  && npm start       # Terminal 2
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
├── orchestrator/              # MCP server — 50+ agents & 8 chains
│   └── src/
│       ├── index.ts           # Entry point, tool registry
│       ├── auth.ts            # API key auth
│       ├── rateLimit.ts       # Sliding-window rate limiter
│       ├── validation.ts      # Input sanitization
│       ├── billing.ts         # Credit check/deduct
│       ├── canonical.ts       # CanonicalResponse shape
│       └── audit.ts           # Audit log
├── billing-api/               # HTTP API — users, credits, Stripe
├── [agent]-agent/             # 50+ individual agent modules
├── smithery.yaml              # Smithery registry config
├── mcp.json                   # MCP registry manifest
└── LICENSE                    # MIT
```

---

## Security

- API key authentication on all tool calls
- Input validation and sanitization on every request
- Sliding-window rate limiting per key and tier
- Audit logging of all tool invocations
- No LLM calls in individual agents — deterministic calculations only
- Credit-gated access prevents abuse

---

## License

MIT — [RobotFleet HQ](https://github.com/RobotFleet-HQ)
