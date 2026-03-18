# Security Orchestra

![A2A Compatible](https://img.shields.io/badge/A2A-Compatible-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green)
![Registry](https://img.shields.io/badge/MCP_Registry-Listed-purple)

A monetized, production-ready security automation platform built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Claude (or any MCP client) connects to the orchestrator and runs real security workflows against authorized targets — with credit-based billing, per-tier rate limiting, input validation, and a full audit trail on every request.

---

## Protocol Support

- ✅ **MCP (Model Context Protocol)** — Claude Desktop and all MCP clients
- ✅ **A2A (Agent2Agent Protocol)** — Agent-to-agent discovery and task delegation

| | URL |
|---|---|
| Agent Card | `https://security-orchestra-orchestrator.onrender.com/.well-known/agent.json` |
| A2A Endpoint | `https://security-orchestra-orchestrator.onrender.com/a2a` |
| MCP Registry | `io.github.RobotFleet-HQ/security-orchestra` |

---

## What It Does

Security Orchestra exposes a set of security workflows (subdomain discovery, asset mapping, vulnerability assessment) as MCP tools. When a workflow is invoked:

1. **Auth** — the client's API key is verified against bcrypt hashes in SQLite
2. **Rate limit** — the request is checked against per-tier sliding-window limits
3. **Validation** — all inputs are sanitized and checked against injection blocklists
4. **Credit gate** — the billing API confirms the user has enough credits
5. **Execution** — the workflow runs against the target
6. **Deduction** — credits are deducted from the user's balance
7. **Audit** — every event at every step is written to a shared audit log

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  MCP Client (Claude Desktop / Claude Code)                       │
└─────────────────────────┬───────────────────────────────────────┘
                          │ stdio (MCP protocol)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  orchestrator/          (Node.js MCP server)                     │
│                                                                  │
│  Auth ──► Rate Limit ──► Validation ──► Credit Gate ──► Execute │
│                                                                  │
│  keys.db  (API key hashes — bcrypt)                              │
└──────────────┬────────────────────────────────────────┬─────────┘
               │ HTTP (credit check / deduct)           │ write
               ▼                                        ▼
┌──────────────────────────────┐            ┌───────────────────┐
│  billing-api/                │            │  audit.db         │
│  (Express HTTP server)       │◄───────────│  (shared SQLite)  │
│                              │  read      └───────────────────┘
│  billing.db                  │
│  ├─ users                    │
│  ├─ subscriptions            │
│  └─ credits                  │
│                              │
│  Stripe webhooks             │
└──────────────────────────────┘
```

| Service | Transport | Port | Database |
|---|---|---|---|
| `orchestrator` | stdio (MCP) | — | `keys.db`, `audit.db` |
| `billing-api` | HTTP | 3001 | `billing.db`, `audit.db` (read) |

---

## Pricing Tiers

| Tier | Monthly Price | Credits | Rate Limit |
|---|---|---|---|
| Free | $0 | 100 | 10/min · 100/hr · 500/day |
| Starter | $29 | 500 | 60/min · 1,000/hr · 5,000/day |
| Pro | $99 | 2,000 | 300/min · 5,000/hr · 50,000/day |
| Enterprise | $499 | 10,000 | 1,000/min · 20,000/hr · 200,000/day |

## Workflow Credit Costs

| Workflow | Credits |
|---|---|
| `subdomain_discovery` | 5 |
| `asset_discovery` | 15 |
| `vulnerability_assessment` | 25 |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- A [Stripe](https://stripe.com) account (for paid tiers — optional for local dev)
- The [Stripe CLI](https://stripe.com/docs/stripe-cli) (for webhook testing)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd security-orchestra

cd orchestrator && npm install && npm run build && cd ..
cd billing-api  && npm install && npm run build && cd ..
```

### 2. Configure the orchestrator

```bash
cd orchestrator
cp .env.example .env
```

Generate an API key for yourself:

```bash
npm run generate-key myuser free
# ========================================
#   API Key Generated (shown only once!)
# ========================================
#   User  : myuser
#   Tier  : free
#   Key   : sk_live_abc123...
# ========================================
```

Copy the key into `orchestrator/.env`:

```
ORCHESTRATOR_API_KEY=sk_live_abc123...
BILLING_API_URL=http://localhost:3001
```

### 3. Configure the billing API

```bash
cd billing-api
cp .env.example .env
# Fill in STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (or leave blank for local dev without Stripe)
```

### 4. Start both services

In two separate terminals:

```bash
# Terminal 1
cd orchestrator && npm start

# Terminal 2
cd billing-api && npm start
```

### 5. Connect Claude Desktop

Add the following to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "security-orchestra": {
      "command": "node",
      "args": ["/absolute/path/to/security-orchestra/orchestrator/dist/index.js"],
      "env": {
        "ORCHESTRATOR_API_KEY": "sk_live_your_key_here",
        "BILLING_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the `get_capabilities` and `execute_workflow` tools available.

---

## Deployment

### Environment variables to harden for production

| Variable | Production value |
|---|---|
| `ORCHESTRATOR_API_KEY` | A freshly generated key — never reuse dev keys |
| `BILLING_API_URL` | Your billing-api's public HTTPS URL |
| `STRIPE_SECRET_KEY` | `sk_live_...` (not `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | From your Stripe dashboard webhook endpoint |
| `BASE_URL` | Your billing-api's public URL (e.g. `https://api.yourapp.com`) |

### Running with pm2

```bash
npm install -g pm2

# Billing API
cd billing-api
pm2 start dist/index.js --name billing-api

# Orchestrator (started per-client by Claude Desktop — no pm2 needed)
```

### Stripe webhook endpoint

Register `https://your-billing-api/webhooks/stripe` in the Stripe dashboard and select:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`

---

## Repository Structure

```
security-orchestra/
├── audit.db                  # Shared audit log (gitignored — created at runtime)
├── .gitignore
├── README.md
│
├── orchestrator/             # MCP server — handles tool calls from Claude
│   ├── src/
│   │   ├── index.ts          # Server entry point, request pipeline
│   │   ├── auth.ts           # API key generation and validation
│   │   ├── database.ts       # SQLite helpers, schema
│   │   ├── billing.ts        # Billing API client (credit check / deduct)
│   │   ├── validation.ts     # Input sanitization and injection blocking
│   │   ├── rateLimit.ts      # Sliding-window rate limiter
│   │   ├── audit.ts          # Audit log writer
│   │   └── scripts/
│   │       ├── generateKey.ts
│   │       ├── testValidation.ts
│   │       ├── testRateLimit.ts
│   │       └── testAudit.ts
│   ├── .env.example
│   └── package.json
│
└── billing-api/              # HTTP API — users, credits, Stripe, audit queries
    ├── src/
    │   ├── index.ts          # Express server entry point
    │   ├── database.ts       # SQLite helpers, schema, TIERS config
    │   └── routes/
    │       ├── users.ts      # POST /users, GET /users/:id
    │       ├── credits.ts    # GET/POST /credits/:id
    │       ├── checkout.ts   # POST /checkout, GET /checkout/tiers
    │       ├── webhooks.ts   # POST /webhooks/stripe
    │       └── audit.ts      # GET /audit/:userId, GET /audit/search
    ├── .env.example
    └── package.json
```

---

## Contributing

1. Fork the repository and create a feature branch
2. Make your changes with tests where applicable
3. Run the test suite before opening a PR:
   ```bash
   cd orchestrator
   node dist/scripts/testValidation.js
   node dist/scripts/testRateLimit.js
   node dist/scripts/testAudit.js
   ```
4. Open a pull request with a clear description of the change and why

### Adding a new workflow

1. Add the workflow function in `orchestrator/src/index.ts`
2. Register it in the `WORKFLOWS` map with a `credits` cost
3. Add a validation case in `orchestrator/src/validation.ts`
4. Add the cost to `WORKFLOW_COSTS` in `orchestrator/src/billing.ts`
5. Update this README's workflow table

---

## License

MIT
