# Security Orchestra — CLAUDE.md

## Project Overview

Security Orchestra is a TypeScript monorepo that exposes **67 specialized AI agents** as individually callable MCP (Model Context Protocol) tools for data center critical power infrastructure. Users connect via Smithery or Claude Desktop and call tools like `generator_sizing`, `nfpa_110_checker`, `get_grid_telemetry`, etc. Access is gated by API keys and a per-call credit billing system.

The two deployed services are:
- **orchestrator** — the MCP server. Handles tool routing, auth, credit gating, rate limiting, and audit logging.
- **billing-api** — Express REST API for user signup, Stripe payments, credit management, and email delivery.

Both run on Render (free tier). Smithery proxies MCP clients through `https://security-orchestra--robotfleet-hq.run.tools` to the orchestrator.

---

## Monorepo Structure

```
security-orchestra/
├── orchestrator/          # MCP server — primary service
│   ├── src/
│   │   ├── index.ts       # Entry point: WORKFLOWS registry, CHAINS registry,
│   │   │                  #   ListToolsRequestSchema, CallToolRequestSchema
│   │   ├── billing.ts     # WORKFLOW_COSTS map, checkCredits(), deductCredits()
│   │   ├── validation.ts  # validateWorkflowParams() — one switch case per workflow
│   │   ├── canonical.ts   # AGENT_METADATA, toCanonical(), CanonicalResponse type
│   │   ├── audit.ts       # logAudit(), SQLite audit.db writer
│   │   ├── rateLimit.ts   # enforceRateLimit() — in-memory per-user/tier
│   │   ├── auth.ts        # API key hashing and verification
│   │   ├── database.ts    # keys.db SQLite (API key storage)
│   │   ├── health-monitor.ts
│   │   └── workflows/     # One .ts file per workflow (56 files)
│   ├── dist/              # Compiled JS — Render runs node dist/index.js
│   ├── tsconfig.json      # target: ES2020, module: commonjs, strict: true
│   └── package.json
├── billing-api/           # Billing REST API — secondary service
│   ├── src/
│   │   ├── index.ts       # Express app: all routes, startup, admin endpoints
│   │   ├── email.ts       # Gmail SMTP (primary) + SendGrid (fallback)
│   │   ├── database.ts    # billing.db SQLite: users, subscriptions, credits,
│   │   │                  #   failed_deliveries
│   │   └── routes/
│   │       └── signup.ts  # POST /signup: disposable domain check, IP rate limit
│   └── package.json
├── smithery.yaml          # Smithery server config (points to orchestrator /mcp)
├── mcp.json               # Static tool list (informational only — Smithery reads live endpoint)
└── CLAUDE.md              # This file
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5, strict mode, ES2020, CommonJS modules |
| MCP SDK | `@modelcontextprotocol/sdk` — StreamableHTTP + SSE transports |
| HTTP server | Express 5.x (orchestrator), Express 4.x (billing-api) |
| Database | SQLite3 (callback style, wrapped in Promises) — `audit.db`, `billing.db`, `keys.db` |
| Payments | Stripe SDK v14 (billing-api) |
| Email | nodemailer + Gmail SMTP (primary), @sendgrid/mail (fallback) |
| Deployment | Render (both services), GitHub → auto-deploy on push to `main` |
| Registry | Smithery (`registry.smithery.ai`) — re-publish after tool count changes |
| Package manager | pnpm (workspace), npm (per-service) |

---

## Build & Development Commands

### Orchestrator
```bash
cd orchestrator
npm install
npx tsc --noEmit          # type-check only (run before every commit)
npx tsc                   # compile to dist/ (required before Render deploys)
npm run build             # same as npx tsc
npm run start             # node dist/index.js (production)
```

### Billing API
```bash
cd billing-api
npm install
npm run build             # npx tsc
npm run start             # node dist/index.js
npm run dev               # ts-node src/index.ts (local dev, no compile needed)
```

### No linting or formatting tools are configured. The only code quality gate is `npx tsc --noEmit`.

---

## Deployment

Both services auto-deploy on every push to `main`. Render runs `npm run build && npm run start`.

**Critical:** `dist/` is gitignored. Render builds the TypeScript on every deploy — do NOT commit compiled JS.

**After changing tool count** (adding/removing workflows or chains), re-publish to Smithery:
```bash
curl -X PUT "https://registry.smithery.ai/servers/robotfleet-hq%2Fsecurity-orchestra/releases" \
  -H "Authorization: Bearer <SMITHERY_API_KEY>" \
  -F 'payload={"type":"external","upstreamUrl":"https://security-orchestra-orchestrator.onrender.com/mcp","configSchema":{"type":"object","properties":{"apiKey":{"type":"string"}},"required":["apiKey"]}}'
```
Smithery API key: `d23d7a5f-349f-4876-8068-bd33050cf122`

---

## Environment Variables

### Orchestrator (`orchestrator/.env`)
| Variable | Purpose |
|---|---|
| `ORCHESTRATOR_API_KEY` | MCP client auth key. Sets `userId=admin`, `tier=enterprise` (env-var mode). |
| `BILLING_API_URL` | URL of billing-api. Unset = skip credit checks (local dev). |
| `ORCHESTRATOR_ADMIN_KEY` | Shared secret for `POST /admin/provision-key` (called by billing-api after signup). |
| `AUDIT_DB_PATH` | Path to shared `audit.db`. Must match billing-api's `AUDIT_DB_PATH`. |
| `DATABASE_PATH` | Path to `keys.db` (API key hashes). |
| `EIA_API_KEY` | Free key from `eia.gov/opendata`. **Not yet set in Render — uses DEMO_KEY which rate-limits.** Register and add this. |
| `WEBHOOK_SECRET` | HMAC-SHA256 signing secret for async chain callbacks. |
| `ADMIN_PASSWORD` | Password for `/admin/dashboard-data` endpoint. |

### Billing API (`billing-api/.env`)
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret (`sk_test_...` or `sk_live_...`). |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`). |
| `GMAIL_USER` | `contact.securityorchestra@gmail.com` |
| `GMAIL_APP_PASSWORD` | 16-char Gmail App Password. When set, all email goes via Gmail SMTP. |
| `SENDGRID_API_KEY` | Fallback when Gmail fails. Free tier: 100/day. |
| `SENDGRID_FROM_EMAIL` | FROM address. Default: `GMAIL_USER`. |
| `ORCHESTRATOR_URL` | `https://security-orchestra-orchestrator.onrender.com` |
| `ORCHESTRATOR_ADMIN_KEY` | Must match orchestrator's `ORCHESTRATOR_ADMIN_KEY`. |
| `BILLING_ADMIN_SECRET` | Guards `DELETE /admin/user` and `GET /admin/failed-deliveries`. Render value: `a1d1487f5a428e0d68085e6a71792c3c698923c34af65e78ecfd3421f49032e1` |
| `BILLING_DB_PATH` | Path to `billing.db`. |
| `AUDIT_DB_PATH` | Must match orchestrator's `AUDIT_DB_PATH`. |
| `SIGNUP_RATE_LIMIT_PER_IP` | Max signups per IP per hour. Default: 10. |

---

## Adding a New Workflow

Every new workflow requires changes in **4 files**. Miss any one and the tool will either not appear in `tools/list` or fail at runtime.

### 1. `orchestrator/src/workflows/<camelCaseName>.ts`
Create the workflow implementation. Export a single `run<Name>(params)` function returning:
```typescript
{
  workflow:  string;   // workflow name
  target:    string;   // primary input value
  timestamp: string;   // new Date().toISOString()
  results:   { ...workflowSpecificFields, duration_ms: number }
}
```

### 2. `orchestrator/src/billing.ts` — add to `WORKFLOW_COSTS`
```typescript
my_new_workflow: 5,   // Simple=5 | Compliance=20 | Complex=50 | Premium=100
```

### 3. `orchestrator/src/index.ts` — three edits
**a) Import at top:**
```typescript
import { runMyNewWorkflow } from "./workflows/myNewWorkflow.js";
```
**b) Add to `WORKFLOWS` registry** (before the closing `};`):
```typescript
my_new_workflow: {
  description: "...",
  params: ["param1", "param2"],
  credits: WORKFLOW_COSTS.my_new_workflow,
  version: "1.0", last_validated: "YYYY-MM-DD",
  standards_refs: ["NFPA 110-2022"],
  stale_risk: "low",
},
```
**c) Add switch case in `executeWorkflow()`:**
```typescript
case "my_new_workflow": {
  if (!args.param1) throw new McpError(ErrorCode.InvalidParams, "Missing: param1");
  const result = await runMyNewWorkflow({ param1: args.param1, ... });
  log("info", `my_new_workflow complete in ${result.results.duration_ms}ms`);
  return result as unknown as WorkflowResult;
}
```

### 4. `orchestrator/src/validation.ts` — add switch case in `validateWorkflowParams()`
```typescript
case "my_new_workflow": {
  const val = sanitizeInput(params.param1 ?? "");
  if (!val) throw new McpError(ErrorCode.InvalidParams, "400: param1 is required");
  clean.param1 = val;
  break;
}
```

**After adding:** run `npx tsc --noEmit` to confirm zero type errors, then push. Render auto-deploys. Then re-publish to Smithery (tool count changed).

---

## Adding a New Chain

Chains are declared in the `CHAINS` registry in `index.ts` only — no new files needed.

```typescript
my_chain: {
  name: "My Chain",
  description: "Step A → Step B → Step C. What the chain accomplishes end-to-end.",
  credits: 10,
  steps: ["workflow_a", "workflow_b", "workflow_c"],
},
```

If the chain needs custom parameter forwarding between steps, add a case in `extractChainParams()` in `index.ts`.

---

## Tool Count & Smithery

The `ListToolsRequestSchema` handler dynamically builds the tool list from `WORKFLOWS` + `CHAINS` registries. The formula is:

```
tool count = len(WORKFLOWS) + len(CHAINS) + 1 (get_capabilities)
```

Current: **56 workflows + 9 chains + 1 = 66 tools** (Smithery shows 67 — off by one on `get_capabilities` counting, harmless).

Smithery's registry caches the old tool count until you re-publish. Always re-publish after any tool count change.

---

## Coding Standards

- **TypeScript strict** — no `any` types. Use `unknown` and narrow with guards.
- **Early returns / guard clauses** — avoid nesting. Check params at the top of functions.
- **No hallucinated API endpoints** — every external API call must be verified against the live endpoint (EIA, NWS, Stripe, SendGrid).
- **Workflow files are pure computation** — no Express, no MCP SDK imports. Only `https` (Node built-in) for external calls.
- **Credits tier convention:**
  - Simple (lookup/calculation): 5
  - Compliance (standards-based analysis): 20
  - Complex (multi-factor analysis): 50
  - Premium (detailed reports/engineering analysis): 100
- **Error handling in workflows:** Never throw — return structured results with a `note` field describing errors. Let the MCP layer throw `McpError`.
- **`last_validated` dates** must be set to today's date when creating a new workflow. Flag any `stale_risk: "high"` workflow if it's been > 90 days.

---

## Common Gotchas

- **`dist/` is gitignored.** If you edit `src/` and push without running `npx tsc`, Render will deploy stale compiled JS. Always run `npx tsc --noEmit` and then `npx tsc` before pushing changes to `index.ts`, `billing.ts`, or `validation.ts`.

- **Three files must stay in sync for every workflow:** `WORKFLOWS` registry (index.ts), `WORKFLOW_COSTS` (billing.ts), `validateWorkflowParams` switch (validation.ts). A missing case in validation.ts causes `400: Unknown workflow` at runtime even though `tools/list` shows the tool.

- **DEMO_KEY rate limits.** `EIA_API_KEY` is not set in Render — the server uses `DEMO_KEY` which has a very low hourly call quota. Under real traffic this will fail. Register a free key at `eia.gov/opendata` and set `EIA_API_KEY` in Render's orchestrator env vars.

- **Billing API `admin` user has no credits.** The orchestrator runs in env-var auth mode (`userId=admin`, `tier=enterprise`) but `admin` is not a real user in `billing.db`. If `BILLING_API_URL` is set in Render, every tool call by the admin key will fail with `User not found`. This is the expected behavior for production — real users sign up via `/signup` and get a unique API key.

- **NWS API requires `User-Agent` header.** Without it, api.weather.gov returns `403`. Always set `User-Agent: SecurityOrchestraAgent/1.0` in weather API calls.

- **Smithery proxies through `run.tools`.** The URL `https://security-orchestra--robotfleet-hq.run.tools` is Smithery's OAuth-gated proxy — it requires a bearer token. Test the MCP protocol directly against `https://security-orchestra-orchestrator.onrender.com/mcp`.

- **Email transport fallback.** Gmail SMTP is primary (`GMAIL_APP_PASSWORD` must be set correctly — it's a 16-char App Password, not the Gmail account password). On auth failure, billing-api immediately falls back to SendGrid (100/day limit). Failed deliveries are logged in `failed_deliveries` table.

- **pnpm workspace** is configured but both services use their own `npm install` independently. Run `npm install` inside `orchestrator/` or `billing-api/` directly, not from root.

---

## Git Workflow

- Push directly to `main` — there are no branch protection rules.
- Render auto-deploys on every push.
- Conventional commit prefixes: `feat`, `fix`, `chore`, `docs`.
- After pushing, verify deploy with: `curl https://security-orchestra-orchestrator.onrender.com/health`

---

## Live Service URLs

| Service | URL |
|---|---|
| Orchestrator (MCP) | `https://security-orchestra-orchestrator.onrender.com/mcp` |
| Orchestrator health | `https://security-orchestra-orchestrator.onrender.com/health` |
| Billing API | `https://security-orchestra-billing.onrender.com` |
| Billing signup | `https://security-orchestra-billing.onrender.com/signup.html` |
| Smithery listing | `https://smithery.ai/servers/robotfleet-hq/security-orchestra` |
| Smithery proxy | `https://security-orchestra--robotfleet-hq.run.tools` |
| GitHub repo | `https://github.com/RobotFleet-HQ/security-orchestra` |
