# Security Orchestra — System Workflow

Complete reference for how the platform works end-to-end.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Customer Journey — Free Signup](#customer-journey--free-signup)
3. [Customer Journey — Paid Signup](#customer-journey--paid-signup)
4. [Customer Journey — Credit Top-Up](#customer-journey--credit-top-up)
5. [Component Deep Dives](#component-deep-dives)
6. [Automated Flows & Timelines](#automated-flows--timelines)
7. [API Key Lifecycle](#api-key-lifecycle)
8. [Credit System](#credit-system)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [Common Issues & Solutions](#common-issues--solutions)
11. [Marketing & Distribution](#marketing--distribution)

---

## Architecture Overview

```
User / Claude Desktop
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              billing-api (Render Web Service)           │
│              Port 3001 — billing.db (SQLite)            │
│                                                         │
│  Routes:                                                │
│  POST /signup          → create user, send email        │
│  GET  /verify          → activate account               │
│  POST /credits/purchase → Stripe checkout               │
│  POST /webhooks/stripe  → handle Stripe events          │
│  GET  /dashboard        → admin dashboard               │
│  GET  /                 → landing page (HTML)           │
│  Static: /credits.html, /signup.html                   │
└─────────────┬───────────────────────────────────────────┘
              │  POST /admin/provision-key
              │  (x-admin-key header)
              ▼
┌─────────────────────────────────────────────────────────┐
│            orchestrator (Render Web Service)            │
│            Port 3000 — keys.db (SQLite)                 │
│                                                         │
│  HTTP mode (SSE):                                       │
│  GET  /sse              → MCP SSE transport             │
│  POST /messages         → MCP messages                  │
│  POST /admin/provision-key → generate + store API key   │
│                                                         │
│  54 MCP tools registered (data center agents)           │
└─────────────────────────────────────────────────────────┘
              │
              ▼
        Claude Desktop
        (MCP client via SSE)
```

### External Services

| Service  | Purpose                          |
|----------|----------------------------------|
| Stripe   | Payments, webhooks, subscriptions|
| SendGrid | Transactional emails             |
| Render   | Cloud hosting (both services)    |
| GitHub   | Source control, CI/CD            |

---

## Customer Journey — Free Signup

**Timeline: ~2 minutes from signup to API key in inbox**

### Step 1 — User fills out signup form
- URL: `https://security-orchestra-billing.onrender.com/signup`
  (or `/signup.html` served as static file)
- User enters email, selects "Free" tier
- Clicks "Sign Up"

### Step 2 — POST /signup
```
billing-api/src/routes/signup.ts
```
- Validates email format
- Checks disposable email domains (30+ blocked: mailinator, tempmail, etc.)
- Checks IP abuse: max 1 free signup per IP per 30 days
- Creates user record in `billing.db`:
  ```sql
  INSERT INTO users (id, email, tier, created_at, verification_status, ip_address, verification_token)
  VALUES (uuid, email, 'free', now, 'pending', ip, token)
  ```
- Creates credit record: `INSERT INTO credits (user_id, balance) VALUES (id, 0)`
- Sends verification email via SendGrid

### Step 3 — Verification email arrives
- Subject: "Verify your Security Orchestra account"
- Contains button linking to: `https://security-orchestra-billing.onrender.com/verify?token=<token>`
- Token expires: 24 hours

### Step 4 — User clicks verification link
```
GET /verify?token=<token>
billing-api/src/routes/verify.ts
```
- Looks up user by `verification_token`
- Marks `verification_status = 'verified'`, clears token
- Calls `provisionApiKey(userId, 'free')` — POST to orchestrator

### Step 5 — API key provisioned
```
billing-api/src/provisionKey.ts
orchestrator/src/index.ts → POST /admin/provision-key
```
- billing-api POSTs `{ userId, tier: 'free' }` to orchestrator
- Orchestrator generates key: `sk_live_<32-char-random>`
- Stores bcrypt hash (10 rounds) in `keys.db`
- Returns plaintext key **once** — never stored in billing-api
- Up to 4 retry attempts with exponential backoff (1.5s → 3s → 6s)
  for Render free-tier cold-start (429/503 responses)

### Step 6 — API key email sent
```
billing-api/src/email.ts → sendApiKeyEmail()
```
- Subject: "Your Security Orchestra API Key"
- Contains the plaintext API key
- Contains Claude Desktop config snippet
- Key is **not shown again** — user must save it

### Step 7 — User configures Claude Desktop
```json
{
  "mcpServers": {
    "security-orchestra": {
      "url": "https://security-orchestra-orchestrator.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer sk_live_YOUR_KEY"
      }
    }
  }
}
```
Config file location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Step 8 — User runs tools
- Claude Desktop connects via SSE to orchestrator
- Each tool call validates API key (bcrypt compare), checks credit balance
- Credits deducted per tool run
- Free tier: 100 credits at signup (no monthly renewal)

---

## Customer Journey — Paid Signup

**Timeline: ~5 minutes from signup to API key in inbox**

### Steps 1–2 — Same as free, but tier = starter/pro/enterprise

`POST /signup` with `{ email, tier: "starter" }` → Stripe checkout instead of verification email

### Step 3 — Stripe checkout
- billing-api creates Stripe Checkout Session (mode: `subscription`)
- Metadata: `{ user_id, tier, email }`
- User redirected to `https://checkout.stripe.com/...`

### Step 4 — Payment completed
- Stripe fires `checkout.session.completed` webhook
- POST to `https://security-orchestra-billing.onrender.com/webhooks/stripe`

### Step 5 — Webhook handler
```
billing-api/src/routes/webhooks.ts → handleCheckoutCompleted()
```

Three-path user resolution (handles Render ephemeral filesystem):
1. Look up by `metadata.user_id` → normal case
2. Fall back to email lookup → handles DB reset between signup and payment
3. Create fresh user from `session.customer_details.email` → handles direct Stripe payment

Then:
- Updates `users.tier` and sets `verification_status = 'verified'`
- Adds tier credits to `credits.balance`
- Records subscription in `subscriptions` table
- Calls `provisionApiKey()` with retry
- Sends API key email via SendGrid

### Credit amounts by tier

| Tier       | Price  | Credits | Renewal      |
|------------|--------|---------|--------------|
| Free       | $0     | 100     | One-time     |
| Starter    | $29/mo | 500     | Monthly      |
| Pro        | $99/mo | 2,000   | Monthly      |
| Enterprise | $499/mo| 10,000  | Monthly      |

### Step 6 — Monthly renewal (invoice.payment_succeeded)
```
webhooks.ts → handleInvoicePaid()
```
- Looks up active subscription by `stripe_customer_id`
- Adds tier's monthly credits to balance (does NOT reset to 0)
- No email sent for renewals

---

## Customer Journey — Credit Top-Up

**Timeline: ~2 minutes**

### Step 1 — User visits credits page
- URL: `/credits.html?pack=250` (or `?pack=100`, `?pack=500`)
- Pack pre-selected from URL param
- Email pre-filled from `?email=` URL param (used in low-credit warning emails)

### Step 2 — User submits form
```javascript
POST /credits/purchase
{ "email": "user@example.com", "pack": "250" }
```
```
billing-api/src/routes/creditPurchase.ts → handleCreditPurchase()
```
- Looks up user by email (must have existing account)
- Resolves Stripe Price ID from env var (`CREDIT_PACK_250_PRICE_ID`)
- Falls back to inline `price_data` if env var not set
- Creates Stripe Checkout Session (mode: `payment`, one-time)
- Returns `{ checkoutUrl: "https://checkout.stripe.com/..." }`
- Frontend redirects to Stripe

### Step 3 — Payment completed
- Stripe fires `checkout.session.completed`
- Webhook reads `metadata.purchase_type === "credit_pack"`
- Adds credits to balance
- Sends purchase confirmation email

### Credit pack pricing

| Pack | Credits | Price |
|------|---------|-------|
| 100  | 100     | $10   |
| 250  | 250     | $20   |
| 500  | 500     | $35   |

---

## Component Deep Dives

### billing-api

**Purpose:** Customer management, payments, credit tracking
**Location:** `billing-api/` directory
**Runtime:** Node.js + Express + TypeScript (compiled to `dist/`)
**Database:** SQLite at `billing.db` (or `$BILLING_DB_PATH`)
**Port:** 3001

Key files:
```
billing-api/
├── src/
│   ├── index.ts          — Express app, middleware, route registration
│   ├── database.ts       — SQLite init, migrations, dbGet/dbRun helpers
│   ├── email.ts          — SendGrid helpers (5 email types)
│   ├── provisionKey.ts   — HTTP client to orchestrator with retry
│   └── routes/
│       ├── signup.ts         — POST /signup
│       ├── verify.ts         — GET /verify, GET /verify/resend
│       ├── creditPurchase.ts — POST /credits/purchase
│       ├── credits.ts        — GET/POST /credits/:userId
│       ├── checkout.ts       — Stripe checkout session creation
│       ├── webhooks.ts       — POST /webhooks/stripe
│       ├── subscription.ts   — POST /subscription/upgrade
│       ├── users.ts          — User CRUD
│       ├── dashboard.ts      — Admin dashboard
│       ├── audit.ts          — Audit log
│       └── support.ts        — Support tickets
├── public/
│   ├── signup.html       — Signup form
│   ├── credits.html      — Credit top-up form
│   ├── success.html      — Generic success page
│   └── cancel.html       — Payment cancelled page
└── Dockerfile
```

**Middleware order (critical — do not reorder):**
```
1. Global request logger     → logs [req] METHOD /path
2. /webhooks express.raw()   → raw body BEFORE json for Stripe sig verification
3. express.json()            → parse JSON bodies
4. app.post("/credits/purchase") → direct handler (not sub-router)
5. express.static(public/)   → serve HTML files
6. Routes (signup, verify, credits, etc.)
7. 404 handler               → JSON 404 with logging
8. Error handler             → JSON 500
```

### orchestrator

**Purpose:** MCP server, API key management, tool execution
**Location:** `orchestrator/` directory
**Runtime:** Node.js + TypeScript
**Database:** SQLite at `keys.db`
**Port:** 3000

Key files:
```
orchestrator/
├── src/
│   ├── index.ts        — Express + MCP server setup, /admin/provision-key
│   ├── auth.ts         — API key generation, validation
│   ├── database.ts     — keys.db init, storeApiKey, validateApiKey
│   ├── billing.ts      — Credit check/deduct via billing-api HTTP calls
│   ├── validation.ts   — Input validation helpers
│   └── workflows/      — 54 TypeScript workflow wrappers
└── Dockerfile
```

**`/admin/provision-key` endpoint:**
```
POST /admin/provision-key
Headers: x-admin-key: <ORCHESTRATOR_ADMIN_KEY>
Body: { userId: string, tier: string }

Response: { apiKey: "sk_live_..." }
```
- Protected by shared secret (`ORCHESTRATOR_ADMIN_KEY`)
- Generates 32-char random key with `sk_live_` prefix
- Stores bcrypt hash in `keys.db`
- Returns plaintext key exactly once

**MCP connection flow:**
```
Claude Desktop → GET /sse (SSE connection established)
             ← MCP handshake (tools list sent)
Claude Desktop → POST /messages (tool call)
             → validate API key (bcrypt compare against keys.db)
             → check credits (GET billing-api/credits/:userId)
             → execute Python agent subprocess
             → deduct credits (POST billing-api/credits/:userId/deduct)
             ← tool result JSON
```

### webhooks

**Critical requirement:** Raw body must reach handler before `express.json()` parses it.

```
billing-api/src/index.ts:

app.use(
  "/webhooks",
  express.raw({ type: "*/*" }),   // captures raw Buffer
  probeMiddleware,                 // logs buffer state for debugging
  webhooksRouter                   // handles events
);
```

**Stripe signature verification:**
```typescript
event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
```
- `req.body` must be the original `Buffer` (not parsed JSON)
- `STRIPE_WEBHOOK_SECRET` must match the endpoint secret from Stripe Dashboard
  (NOT the Stripe CLI `whsec_` secret — those are different)

**Environment variable bypass for testing:**
```
STRIPE_SKIP_VERIFICATION=true
```
Skips signature check — remove after debugging.

### email.ts — Email types

| Function                      | Trigger                        | Subject                              |
|-------------------------------|--------------------------------|--------------------------------------|
| `sendVerificationEmail`       | Free signup                    | "Verify your Security Orchestra..."  |
| `sendApiKeyEmail`             | Verification / paid webhook    | "Your Security Orchestra API Key"    |
| `sendLowCreditWarning`        | Balance < 50 credits           | "Low Credit Warning"                 |
| `sendCreditPurchaseConfirmation` | Credit pack purchased       | "{N} credits added"                  |
| `sendUpgradeConfirmation`     | Tier upgrade (no API key)      | "Plan upgraded to {tier}"            |

---

## Automated Flows & Timelines

### Flow 1: Free Signup (Happy Path)
```
T+0:00  User submits signup form
T+0:01  billing-api creates user (verification_status=pending)
T+0:01  billing-api calls SendGrid → verification email queued
T+1:00  User receives verification email (SendGrid delivery: ~1 min)
T+1:01  User clicks verify link
T+1:02  billing-api marks user verified
T+1:02  billing-api calls orchestrator /admin/provision-key
        (attempt 1 — if orchestrator is warm: ~200ms)
        (attempt 1 — if orchestrator is cold: 429/503, retry after 1.5s)
        (attempt 2 — orchestrator waking up: ~5s)
T+1:08  API key provisioned
T+1:08  billing-api calls SendGrid → API key email queued
T+2:08  User receives API key email
```

### Flow 2: Paid Signup (Happy Path)
```
T+0:00  User submits signup form (tier=starter)
T+0:01  billing-api creates Stripe checkout session
T+0:01  User redirected to Stripe
T+2:00  User completes payment
T+2:01  Stripe fires checkout.session.completed webhook
T+2:02  billing-api webhook handler:
        - Finds/creates user
        - Adds 500 credits
        - Records subscription
T+2:02  billing-api calls orchestrator (with retry)
T+2:07  API key provisioned
T+2:07  API key email sent
T+3:07  User receives API key
```

### Flow 3: Low Credit Warning
```
Tool call executes → credits deducted → balance checked
If balance < 50:
  orchestrator → fire-and-forget POST billing-api/credits/:id/low-credit-warning
  billing-api → check: was warning sent in last 24h? (in-memory Map)
  If not: SendGrid → low credit warning email with top-up links
```

### Flow 4: Monthly Renewal
```
Stripe billing cycle runs
→ invoice.payment_succeeded webhook
→ billing-api adds tier credits to existing balance
→ no email sent
```

---

## API Key Lifecycle

```
1. GENERATION (orchestrator/src/auth.ts)
   crypto.randomBytes(24).toString('hex') → "sk_live_" + 48-char hex

2. STORAGE (orchestrator/src/database.ts)
   bcrypt.hash(plainKey, 10) → stored in keys.db
   { id: userId, key_hash: hash, tier, created_at }

3. DELIVERY
   Returned once to billing-api → emailed to user
   Never stored in billing.db
   Never logged (only prefix logged: sk_live_xxxx...)

4. VALIDATION (per MCP tool call)
   User sends: Authorization: Bearer sk_live_...
   Orchestrator: bcrypt.compare(incomingKey, stored_hash)
   If match: lookup userId, tier, check credits

5. REVOCATION
   Not yet implemented — delete row from keys.db manually
```

---

## Credit System

### How credits work

Credits are stored in `billing.db` → `credits` table:
```sql
CREATE TABLE credits (
  user_id       TEXT PRIMARY KEY,
  balance       INTEGER NOT NULL DEFAULT 0,
  total_purchased INTEGER NOT NULL DEFAULT 0,
  total_used    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
```

### Per-tool credit costs

| Category              | Cost     |
|-----------------------|----------|
| Generator Sizing      | 10       |
| Utility Interconnect  | 30       |
| NC Utility Interconnect | 50     |
| Site Scoring          | 25       |
| Vulnerability Assessment | 25    |
| Cybersecurity Controls | 20      |
| Compliance Checker    | 20       |
| Incentive Finder      | 20       |
| Energy Procurement    | 20       |
| Solar Feasibility     | 20       |
| Fiber Connectivity    | 20       |
| Redundancy Validator  | 15       |
| Harmonic Analysis     | 15       |
| Network Topology      | 15       |
| BGP Peering           | 15       |
| Physical Security     | 15       |
| Biometric Design      | 15       |
| Surveillance Coverage | 15       |
| Chiller Sizing        | 15       |
| CRAC vs CRAH          | 15       |
| Airflow Modeling      | 15       |
| Economizer Analysis   | 15       |
| Carbon Footprint      | 15       |
| Battery Storage       | 15       |
| Demand Response       | 15       |
| Environmental Impact  | 15       |
| TCO Analyzer          | 15       |
| Commissioning Plan    | 15       |
| Capacity Planning     | 15       |
| Permit Timeline       | 15       |
| Construction Timeline | 15       |
| NFPA 110 Checker      | 15       |
| Most other tools      | 10       |
| Subdomain Discovery   | 5        |

### Deduction flow
```
orchestrator/src/billing.ts:
  1. GET billing-api/credits/:userId → check balance
  2. If balance < cost → return 402 with purchase links
  3. Execute tool
  4. POST billing-api/credits/:userId/deduct { amount, reason }
```

---

## Troubleshooting Guide

### "User gets 402 Insufficient Credits"

1. Check balance: `GET /credits/:userId`
2. If balance = 0 and user just paid: webhook may have failed
   - Check Render logs for `[webhook]` entries
   - Manually add credits: `POST /credits/:userId/add { "amount": 500 }`
3. If webhook shows `[webhook] User not found`: DB was wiped on redeploy
   - Recreate user manually via API
   - Or check Stripe dashboard for payment confirmation

### "User never received API key email"

1. Check Render logs for `[webhook-email]` or `[verify]` entries
2. Look for: `[email] SendGrid initialised` → key is set
3. Look for: `[webhook-email] Step 5a: sendApiKeyEmail completed`
4. If Step 3 logs but not Step 4: provision-key returned null
   - Check orchestrator logs for `/admin/provision-key` errors
5. If Step 4 logs but SendGrid error: check SENDGRID_FROM_EMAIL is verified
   - Must be a verified sender in SendGrid dashboard
6. Manual workaround: provision key via curl, email manually

### "Stripe webhook returns 400 - signature verification failed"

Causes (in order of likelihood):
1. **Wrong secret**: `STRIPE_WEBHOOK_SECRET` in Render env is the Stripe Dashboard
   endpoint secret (starts with `whsec_`). NOT the Stripe CLI secret.
2. **Body was pre-parsed**: Check that `/webhooks` uses `express.raw()` BEFORE
   `express.json()`. Look for `[webhook] req.body is NOT a Buffer` in logs.
3. **Wrong endpoint**: Verify the webhook endpoint URL in Stripe Dashboard
   matches `https://security-orchestra-billing.onrender.com/webhooks/stripe`

**Quick test — bypass verification:**
```
STRIPE_SKIP_VERIFICATION=true  (Render env var)
```
Remove after confirming event handling works.

### "POST /credits/purchase returns 404"

1. Check Render logs — do you see `[req] POST /credits/purchase`?
   - If NO: request isn't reaching the service — check URL
   - If YES: check for `[credits/purchase] handler invoked`
2. Verify deployment completed in Render dashboard
3. Route is registered as: `app.post("/credits/purchase", handleCreditPurchase)`
   in `billing-api/src/index.ts` immediately after `express.json()`

### "Orchestrator returns 429 on /admin/provision-key"

This is Render free-tier cold-start throttling, not application rate limiting.
- `provisionKey.ts` retries up to 4 times with exponential backoff
- Logs: `[provision-key] attempt 1 failed (429), retrying in 1500ms`
- If all 4 attempts fail: API key email not sent, user needs manual key delivery
- Long-term fix: upgrade orchestrator to Render paid tier (always-on)

### "Database wiped after deploy"

Render free-tier has ephemeral filesystem — SQLite is wiped on every deploy.

**Permanent fix:** Add Render Persistent Disk
1. Render Dashboard → billing-api service → Disks
2. Add disk: mount path `/data`, size 1GB
3. Set env var: `BILLING_DB_PATH=/data/billing.db`
4. `billing-api/src/database.ts` reads this env var for DB path

The webhook handler has a safety net: it recreates users from Stripe session data
if they're missing from the DB.

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Email not received | SendGrid unverified sender | Verify sender in SendGrid dashboard |
| Email not received | SENDGRID_API_KEY not set in Render | Add env var |
| API key not emailed | Orchestrator cold-start timeout | Keys auto-retry; wait 30s, check logs |
| Webhook 500 | STRIPE_WEBHOOK_SECRET wrong | Copy exact secret from Stripe Dashboard endpoint |
| Credits not added | Webhook fired but user not found | Webhook creates user from Stripe data — check logs |
| 404 on /credits/purchase | Wrong service URL | Must hit billing-api, not orchestrator |
| Tool returns "unauthorized" | Wrong API key in config | Re-check claude_desktop_config.json |
| Tool returns "insufficient credits" | Balance depleted | Top-up at /credits.html |
| Orchestrator SSE disconnects | Render free-tier sleep | Upgrade to paid tier or ping service |

---

## Marketing & Distribution

### Registry publishing commands

#### MCP Registry (registry.mcp.so)

```bash
# Republish after any change to server.json or agent card
npx mcp-publisher publish .mcp/server.json
```

Current listing: `io.github.RobotFleet-HQ/security-orchestra` v1.0.0

#### A2A Registry (a2aregistry.org)

```powershell
# Republish / update registration
Invoke-RestMethod -Uri "https://api.a2aregistry.org/agents" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body (Get-Content .mcp/a2a-registration.json -Raw)
```

Current listing ID: `b424dc02-bfc2-44b1-98d5-6219e1be4237`

#### Smithery

```bash
# Republish after adding configSchema to publish payload
npx smithery mcp publish
```

Current status: `@robotfleet-hq/security-orchestra` — scan fix pending.
Issue: Smithery scanner requires `configSchema` in the publish payload to know
the server needs auth before connecting. Without it, the scan attempt fails at
the MCP handshake stage.

### Submitted directories — status

| Directory | Submitted | Status |
|-----------|-----------|--------|
| registry.mcp.so (Official MCP Registry) | 2026-03-17 | Live — `io.github.RobotFleet-HQ/security-orchestra` |
| a2aregistry.org | 2026-03-18 | Live — ID `b424dc02-bfc2-44b1-98d5-6219e1be4237` |
| PulseMCP | 2026-03-17 | Auto-pickup in progress |
| Smithery | 2026-03-17 | Listed — tools scan pending (configSchema fix needed) |

### LinkedIn post template

Template location: `.mcp/linkedin-post-template.md`

Use after any major capability launch (new agents, new protocol support, new registry listings).
Key points to include: number of agents (54), supported protocols (MCP + A2A), registry links,
and a concrete use-case example (e.g. generator sizing for a specific MW load).
