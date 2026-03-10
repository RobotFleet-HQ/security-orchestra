# Deployment Guide — Security Orchestra on Railway

Two services are deployed independently from the same repository:

| Service | Directory | Port | Transport |
|---|---|---|---|
| **billing-api** | `billing-api/` | 3001 | HTTP (Express) |
| **orchestrator** | `orchestrator/` | 3000 | HTTP/SSE (MCP) when `PORT` set; stdio locally |

---

## Prerequisites

- Railway account at [railway.app](https://railway.app)
- Repository pushed to GitHub
- Stripe account (for billing-api webhooks)
- Railway CLI: `npm install -g @railway/cli` then `railway login`

---

## Part 1 — Deploy billing-api

### 1.1 Create the service

1. In Railway dashboard → **New Project** → **Deploy from GitHub repo**
2. Select your repository
3. Railway auto-detects the repo — click **Add Service** → **GitHub Repo**
4. In the service settings → **Source** tab:
   - **Root Directory**: `/` (leave blank — repo root)
   - **Dockerfile Path**: `billing-api/Dockerfile`
   - **Watch Paths**: `billing-api/**`

### 1.2 Set environment variables

In the service → **Variables** tab, add:

```
NODE_ENV=production
PORT=3001
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
BILLING_DB_PATH=/data/billing.db
```

> Get `STRIPE_WEBHOOK_SECRET` after completing step 1.4.

### 1.3 Attach a persistent volume

SQLite needs persistent storage — Railway's default filesystem is ephemeral.

1. Service → **Volumes** tab → **Add Volume**
2. **Mount Path**: `/data`
3. Railway provisions a persistent disk; billing.db will survive redeployments

### 1.4 Configure Stripe webhook

After first deploy (Railway provides a public URL):

```bash
# Get the service URL from Railway dashboard, e.g.:
# https://billing-api-production-xxxx.up.railway.app

stripe listen --forward-to https://billing-api-production-xxxx.up.railway.app/webhooks/stripe
```

Or in Stripe dashboard → **Webhooks** → **Add endpoint**:
- URL: `https://billing-api-production-xxxx.up.railway.app/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_succeeded`

Copy the **Signing secret** → add as `STRIPE_WEBHOOK_SECRET` env var in Railway.

### 1.5 Verify

```bash
curl https://billing-api-production-xxxx.up.railway.app/health
# {"status":"ok","service":"billing-api"}
```

---

## Part 2 — Deploy orchestrator

### 2.1 Create the service

1. In the same Railway project → **Add Service** → **GitHub Repo** (same repo)
2. Service settings → **Source** tab:
   - **Root Directory**: `/` (leave blank — repo root)
   - **Dockerfile Path**: `orchestrator/Dockerfile`
   - **Watch Paths**: `orchestrator/**,generator-sizing-agent/**,utility-interconnect-agent/**`

### 2.2 Set environment variables

```
NODE_ENV=production
PORT=3000
BILLING_API_URL=https://billing-api-production-xxxx.up.railway.app
KEYS_DB_PATH=/data/keys.db
AUDIT_DB_PATH=/data/audit.db
```

> `ORCHESTRATOR_API_KEY` is NOT set here — it's used by clients connecting to the
> orchestrator. See step 2.4 for generating and configuring it.

### 2.3 Attach a persistent volume

1. Service → **Volumes** → **Add Volume**
2. **Mount Path**: `/data`
3. keys.db and audit.db will persist across redeployments

### 2.4 Seed an initial API key

After first deploy, open a Railway shell to generate the first API key:

```bash
railway run --service orchestrator node dist/scripts/generateKey.js
```

This prints a key like `sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

Save it — it cannot be retrieved again. Set it as `ORCHESTRATOR_API_KEY` in your
local `.env` (for local development) or in Claude Desktop's MCP config.

### 2.5 Verify

```bash
curl https://orchestrator-production-xxxx.up.railway.app/health
# {"status":"ok","service":"orchestrator","uptime":42.3}
```

---

## Part 3 — Connect Claude Desktop (remote)

When the orchestrator is deployed on Railway it uses **HTTP/SSE transport** (MCP
over Server-Sent Events). Configure Claude Desktop to connect remotely:

**`~/Library/Application Support/Claude/claude_desktop_config.json`** (macOS)
**`%APPDATA%\Claude\claude_desktop_config.json`** (Windows)

```json
{
  "mcpServers": {
    "security-orchestra": {
      "type": "sse",
      "url": "https://orchestrator-production-xxxx.up.railway.app/sse",
      "headers": {
        "Authorization": "Bearer sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

> **Note**: The SSE transport does not currently use the `Authorization` header
> from the MCP connection — auth is handled via the `ORCHESTRATOR_API_KEY`
> environment variable set at startup. The header is included for future
> per-request auth support.

---

## Part 4 — Local development (stdio)

For local development, the orchestrator uses **stdio transport** (no `PORT` set):

```bash
# .env
ORCHESTRATOR_API_KEY=sk_live_...
BILLING_API_URL=https://billing-api-production-xxxx.up.railway.app
# KEYS_DB_PATH and AUDIT_DB_PATH default to orchestrator/keys.db and security-orchestra/audit.db
```

**`claude_desktop_config.json`** (local):

```json
{
  "mcpServers": {
    "security-orchestra": {
      "command": "node",
      "args": ["/absolute/path/to/security-orchestra/orchestrator/dist/index.js"],
      "env": {
        "ORCHESTRATOR_API_KEY": "sk_live_...",
        "BILLING_API_URL": "https://billing-api-production-xxxx.up.railway.app"
      }
    }
  }
}
```

---

## Environment Variable Reference

### billing-api

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | Yes (Railway sets it) | `3001` | HTTP listen port |
| `STRIPE_SECRET_KEY` | Yes | — | Stripe secret key (`sk_live_` or `sk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | — | Stripe webhook signing secret (`whsec_`) |
| `BILLING_DB_PATH` | Recommended | `dist/../billing.db` | Absolute path to billing SQLite file |
| `NODE_ENV` | Recommended | — | Set to `production` |

### orchestrator

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | Yes (Railway sets it) | stdio mode | HTTP/SSE listen port; omit for local stdio |
| `ORCHESTRATOR_API_KEY` | Yes | — | API key for this client; generated via `generateKey.js` |
| `BILLING_API_URL` | Yes | — | Full URL of the billing-api service |
| `KEYS_DB_PATH` | Recommended | `dist/../keys.db` | Absolute path to API keys SQLite file |
| `AUDIT_DB_PATH` | Recommended | `../../audit.db` | Absolute path to audit log SQLite file |
| `NODE_ENV` | Recommended | — | Set to `production` |

---

## Local Docker builds (optional)

```bash
# From the repo root (security-orchestra/):

# Build billing-api
docker build -f billing-api/Dockerfile -t billing-api .

# Build orchestrator
docker build -f orchestrator/Dockerfile -t orchestrator .

# Run billing-api
docker run -p 3001:3001 \
  -v $(pwd)/data:/data \
  -e BILLING_DB_PATH=/data/billing.db \
  -e STRIPE_SECRET_KEY=sk_test_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  billing-api

# Run orchestrator (HTTP/SSE mode)
docker run -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e PORT=3000 \
  -e KEYS_DB_PATH=/data/keys.db \
  -e AUDIT_DB_PATH=/data/audit.db \
  -e BILLING_API_URL=http://host.docker.internal:3001 \
  orchestrator
```

---

## Railway CLI quick-reference

```bash
# Link local repo to Railway project
railway link

# Deploy manually
railway up --service billing-api
railway up --service orchestrator

# Tail logs
railway logs --service billing-api
railway logs --service orchestrator

# Open a shell in the running container
railway shell --service orchestrator

# Run a one-off command (e.g. generate API key)
railway run --service orchestrator node dist/scripts/generateKey.js

# Set an env variable from CLI
railway variables set STRIPE_SECRET_KEY=sk_live_... --service billing-api
```

---

## Architecture diagram

```
Claude Desktop / Claude Code
        │  SSE (HTTPS)
        ▼
┌─────────────────────────────┐
│   orchestrator (Railway)    │  :3000
│                             │
│  Auth → Rate Limit          │
│  → Validation → Credits     │──── HTTP ────►  billing-api (Railway) :3001
│  → Workflow dispatch        │                       │
│    ├─ subdomain discovery   │              billing.db (volume /data)
│    ├─ generator sizing      │
│    └─ utility interconnect  │
│                             │
│  keys.db, audit.db (/data)  │
└─────────────────────────────┘
        │
        ▼  child_process.spawn
  Python agents (in image)
  generator-sizing-agent/
  utility-interconnect-agent/
```

---

## SQLite persistence notes

Railway volumes are durable (survive restarts and redeployments) but are
**single-instance only** — if you scale a service to multiple replicas, each
replica gets its own volume and databases will diverge. For multi-replica
deployments, migrate to PostgreSQL:

- Replace SQLite with `pg` / `postgres` package
- Use Railway's managed PostgreSQL plugin
- Railway provides `DATABASE_URL` automatically when the plugin is added
