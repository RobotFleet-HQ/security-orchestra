# Security Orchestra — System Snapshot

Complete configuration backup as of 2026-03-16.

---

## Table of Contents

1. [Live URLs](#live-urls)
2. [GitHub Repository](#github-repository)
3. [Render Services](#render-services)
4. [Environment Variables — billing-api](#environment-variables--billing-api)
5. [Environment Variables — orchestrator](#environment-variables--orchestrator)
6. [Stripe Configuration](#stripe-configuration)
7. [SendGrid Configuration](#sendgrid-configuration)
8. [Database Schema](#database-schema)
9. [All 54 Agents](#all-54-agents)
10. [Key Commits & Deployment History](#key-commits--deployment-history)
11. [Known Limitations](#known-limitations)
12. [Emergency Recovery Procedures](#emergency-recovery-procedures)

---

## Live URLs

| Service        | URL                                                        |
|----------------|------------------------------------------------------------|
| Landing page   | `https://security-orchestra-billing.onrender.com/`         |
| Signup         | `https://security-orchestra-billing.onrender.com/signup`   |
| Credit top-up  | `https://security-orchestra-billing.onrender.com/credits.html` |
| Dashboard      | `https://security-orchestra-billing.onrender.com/dashboard`|
| Health check   | `https://security-orchestra-billing.onrender.com/health`   |
| Orchestrator   | `https://security-orchestra-orchestrator.onrender.com/`    |
| Orchestrator SSE | `https://security-orchestra-orchestrator.onrender.com/sse` |
| Stripe webhook | `https://security-orchestra-billing.onrender.com/webhooks/stripe` |

---

## GitHub Repository

- **Repo:** `https://github.com/RobotFleet-HQ/security-orchestra`
- **Main branch:** `main`
- **Auto-deploy:** Both Render services deploy on push to `main`

### Repository structure
```
security-orchestra/
├── billing-api/           — Billing/auth service (Node.js + Express)
│   ├── src/
│   ├── public/            — Static HTML pages
│   └── Dockerfile
├── orchestrator/          — MCP server + tool execution
│   ├── src/
│   └── Dockerfile
├── <agent>-agent/         — 54 Python agent directories
├── WORKFLOW.md            — This system's workflow documentation
├── SYSTEM_SNAPSHOT.md     — This file
└── docker-compose.yml     — Local development (if present)
```

---

## Render Services

### Service 1: billing-api

| Setting        | Value                                      |
|----------------|--------------------------------------------|
| Name           | security-orchestra-billing                 |
| Type           | Web Service                                |
| Runtime        | Docker                                     |
| Dockerfile     | `billing-api/Dockerfile`                   |
| Build context  | repo root (security-orchestra/)            |
| Port           | 3001                                       |
| Branch         | main                                       |
| Auto-deploy    | Yes                                        |
| Plan           | Free (ephemeral disk — see limitations)    |

### Service 2: orchestrator

| Setting        | Value                                      |
|----------------|--------------------------------------------|
| Name           | security-orchestra-orchestrator            |
| Type           | Web Service                                |
| Runtime        | Docker                                     |
| Dockerfile     | `orchestrator/Dockerfile`                  |
| Build context  | repo root (security-orchestra/)            |
| Port           | 3000                                       |
| Branch         | main                                       |
| Auto-deploy    | Yes                                        |
| Plan           | Free (spins down after 15 min inactivity)  |

---

## Environment Variables — billing-api

Set these in Render Dashboard → security-orchestra-billing → Environment.

```bash
# ── Database ──────────────────────────────────────────────────────────────────
# Optional: set to persist DB across deploys (requires Render Persistent Disk)
BILLING_DB_PATH=/data/billing.db

# ── Application ───────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=production
BASE_URL=https://security-orchestra-billing.onrender.com

# ── Stripe ────────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...          # or sk_test_... for testing
STRIPE_WEBHOOK_SECRET=whsec_...        # from Stripe Dashboard > Webhooks > endpoint secret
                                        # NOT the Stripe CLI secret

# Stripe Price IDs for subscription tiers (create in Stripe Dashboard > Products)
STRIPE_PRICE_STARTER=price_...         # $29/month Starter plan
STRIPE_PRICE_PRO=price_...             # $99/month Pro plan
STRIPE_PRICE_ENTERPRISE=price_...      # $499/month Enterprise plan

# Stripe Price IDs for credit packs (create as one-time prices)
CREDIT_PACK_100_PRICE_ID=price_...     # $10 / 100 credits
CREDIT_PACK_250_PRICE_ID=price_...     # $20 / 250 credits
CREDIT_PACK_500_PRICE_ID=price_...     # $35 / 500 credits
# Note: if price IDs not set, falls back to inline price_data

# ── SendGrid ──────────────────────────────────────────────────────────────────
SENDGRID_API_KEY=SG....                # SendGrid API key
SENDGRID_FROM_EMAIL=noreply@security-orchestra.com  # Must be verified sender

# ── Orchestrator communication ────────────────────────────────────────────────
ORCHESTRATOR_URL=https://security-orchestra-orchestrator.onrender.com
ORCHESTRATOR_ADMIN_KEY=<shared-secret> # Must match orchestrator's value

# ── Admin ─────────────────────────────────────────────────────────────────────
ADMIN_PASSWORD=<dashboard-password>    # For /dashboard basic auth

# ── Debugging (remove in production) ─────────────────────────────────────────
# STRIPE_SKIP_VERIFICATION=true        # Bypass webhook signature check
```

---

## Environment Variables — orchestrator

Set these in Render Dashboard → security-orchestra-orchestrator → Environment.

```bash
# ── Application ───────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production

# ── MCP Transport ─────────────────────────────────────────────────────────────
# Set to "http" for SSE (Render), "stdio" for local Claude Desktop
MCP_TRANSPORT=http

# ── Billing API ───────────────────────────────────────────────────────────────
BILLING_API_URL=https://security-orchestra-billing.onrender.com
BILLING_API_KEY=<internal-api-key>     # For billing-api authentication

# ── Admin ─────────────────────────────────────────────────────────────────────
ORCHESTRATOR_ADMIN_KEY=<shared-secret> # Must match billing-api's value
                                        # Protects /admin/provision-key endpoint
```

---

## Stripe Configuration

### Webhook endpoint

| Setting          | Value                                                              |
|------------------|--------------------------------------------------------------------|
| Endpoint URL     | `https://security-orchestra-billing.onrender.com/webhooks/stripe` |
| API version      | `2023-10-16`                                                       |
| Events to listen | `checkout.session.completed`                                       |
|                  | `customer.subscription.updated`                                    |
|                  | `customer.subscription.deleted`                                    |
|                  | `invoice.payment_succeeded`                                        |

### Getting the webhook secret

1. Stripe Dashboard → Developers → Webhooks
2. Click your endpoint
3. "Signing secret" → Reveal → copy `whsec_...`
4. Paste into `STRIPE_WEBHOOK_SECRET` in Render

**⚠️ Important:** The Stripe CLI (`stripe listen`) generates a DIFFERENT secret.
Always use the Dashboard endpoint secret for production.

### Products & Prices to create in Stripe

**Subscription products:**
```
Product: Security Orchestra Starter
  Price: $29.00 / month (recurring)
  → copy Price ID → STRIPE_PRICE_STARTER

Product: Security Orchestra Pro
  Price: $99.00 / month (recurring)
  → copy Price ID → STRIPE_PRICE_PRO

Product: Security Orchestra Enterprise
  Price: $499.00 / month (recurring)
  → copy Price ID → STRIPE_PRICE_ENTERPRISE
```

**One-time credit pack products:**
```
Product: Security Orchestra — 100 Credits
  Price: $10.00 (one-time)
  → copy Price ID → CREDIT_PACK_100_PRICE_ID

Product: Security Orchestra — 250 Credits
  Price: $20.00 (one-time)
  → copy Price ID → CREDIT_PACK_250_PRICE_ID

Product: Security Orchestra — 500 Credits
  Price: $35.00 (one-time)
  → copy Price ID → CREDIT_PACK_500_PRICE_ID
```

### Test vs Live mode

- Test keys: `sk_test_...`, `pk_test_...`
- Live keys: `sk_live_...`, `pk_live_...`
- Webhook secrets are per-environment (different for test and live)
- Test card: `4242 4242 4242 4242` / any future date / any CVC

---

## SendGrid Configuration

### Sender verification

The `SENDGRID_FROM_EMAIL` address must be verified in SendGrid:
1. SendGrid Dashboard → Settings → Sender Authentication
2. Either verify a single email address OR authenticate a domain
3. Domain authentication (`security-orchestra.com`) is recommended for production

### Email templates (all inline HTML — no SendGrid templates used)

All email HTML is defined in `billing-api/src/email.ts`. No external templates.

### API key permissions needed

SendGrid API key must have:
- Mail Send → Full Access

---

## Database Schema

### billing.db (billing-api)

```sql
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  tier                TEXT NOT NULL DEFAULT 'free',
  created_at          TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  verification_token  TEXT,
  ip_address          TEXT
);

CREATE TABLE credits (
  user_id         TEXT PRIMARY KEY,
  balance         INTEGER NOT NULL DEFAULT 0,
  total_purchased INTEGER NOT NULL DEFAULT 0,
  total_used      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE subscriptions (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  tier                   TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active',
  created_at             TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE support_tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### keys.db (orchestrator)

```sql
CREATE TABLE api_keys (
  id         TEXT PRIMARY KEY,   -- user_id
  key_hash   TEXT NOT NULL,      -- bcrypt(apiKey, 10)
  tier       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## All 54 Agents

### Power Infrastructure (12)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Generator Sizing | `generator_sizing` | 10 | `generator-sizing-agent/` |
| Utility Interconnect | `utility_interconnect` | 30 | `utility-interconnect-agent/` |
| NC Utility Interconnect | `nc_utility_interconnect` | 50 | `nc-utility-interconnect-agent/` |
| ATS Sizing | `ats_sizing` | 10 | *(in orchestrator)* |
| UPS Sizing | `ups_sizing` | 10 | *(in orchestrator)* |
| Fuel Storage | `fuel_storage` | 10 | *(in orchestrator)* |
| Cooling Load | `cooling_load` | 10 | *(in orchestrator)* |
| Power Density | `power_density` | 10 | *(in orchestrator)* |
| PUE Calculator | `pue_calculator` | 10 | `pue-calculator-agent/` |
| Redundancy Validator | `redundancy_validator` | 15 | *(in orchestrator)* |
| Harmonic Analysis | `harmonic_analysis` | 15 | `harmonic-analysis-agent/` |
| Voltage Drop | `voltage_drop` | 10 | `voltage-drop-agent/` |

### Network & Connectivity (6)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Network Topology | `network_topology` | 15 | `network-topology-agent/` |
| Bandwidth Sizing | `bandwidth_sizing` | 10 | `bandwidth-sizing-agent/` |
| Latency Calculator | `latency_calculator` | 10 | `latency-calculator-agent/` |
| IP Addressing | `ip_addressing` | 10 | `ip-addressing-agent/` |
| DNS Architecture | `dns_architecture` | 10 | `dns-architecture-agent/` |
| BGP Peering | `bgp_peering` | 15 | `bgp-peering-agent/` |

### Security & Access (6)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Physical Security | `physical_security` | 15 | `physical-security-agent/` |
| Biometric Design | `biometric_design` | 15 | `biometric-design-agent/` |
| Surveillance Coverage | `surveillance_coverage` | 15 | `surveillance-coverage-agent/` |
| Cybersecurity Controls | `cybersecurity_controls` | 20 | `cybersecurity-controls-agent/` |
| Compliance Checker | `compliance_checker` | 20 | `compliance-checker-agent/` |
| Fire Suppression | `fire_suppression` | 10 | `fire-suppression-agent/` |

### Mechanical / HVAC (6)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Chiller Sizing | `chiller_sizing` | 15 | `chiller-sizing-agent/` |
| CRAC vs CRAH | `crac_vs_crah` | 15 | `crac-vs-crah-agent/` |
| Airflow Modeling | `airflow_modeling` | 15 | `airflow-modeling-agent/` |
| Humidification | `humidification` | 10 | `humidification-agent/` |
| Economizer Analysis | `economizer_analysis` | 15 | `economizer-analysis-agent/` |
| Construction Cost | `construction_cost` | 10 | `construction-cost-agent/` |

### Site & Finance (8)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Site Scoring | `site_scoring` | 25 | `site-scoring-agent/` |
| ROI Calculator | `roi_calculator` | 10 | `roi-calculator-agent/` |
| TCO Analyzer | `tco_analyzer` | 15 | `tco-analyzer-agent/` |
| Water Availability | `water_availability` | 10 | `water-availability-agent/` |
| Noise Compliance | `noise_compliance` | 10 | `noise-compliance-agent/` |
| Incentive Finder | `incentive_finder` | 20 | `incentive-finder-agent/` |
| Permit Timeline | `permit_timeline` | 15 | `permit-timeline-agent/` |
| Fiber Connectivity | `fiber_connectivity` | 20 | `fiber-connectivity-agent/` |

### Project & Operations (6)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Construction Timeline | `construction_timeline` | 15 | `construction-timeline-agent/` |
| Commissioning Plan | `commissioning_plan` | 15 | `commissioning-plan-agent/` |
| Maintenance Schedule | `maintenance_schedule` | 10 | `maintenance-schedule-agent/` |
| Capacity Planning | `capacity_planning` | 15 | `capacity-planning-agent/` |
| SLA Calculator | `sla_calculator` | 10 | `sla-calculator-agent/` |
| Change Management | `change_management` | 10 | `change-management-agent/` |

### Energy & Sustainability (6)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| Carbon Footprint | `carbon_footprint` | 15 | `carbon-footprint-agent/` |
| Solar Feasibility | `solar_feasibility` | 20 | `solar-feasibility-agent/` |
| Battery Storage | `battery_storage` | 15 | `battery-storage-agent/` |
| Energy Procurement | `energy_procurement` | 20 | `energy-procurement-agent/` |
| Demand Response | `demand_response` | 15 | `demand-response-agent/` |
| Environmental Impact | `environmental_impact` | 15 | `environmental-impact-agent/` |

### Compliance & Standards (4)

| Agent | Tool Name | Credits | File |
|-------|-----------|---------|------|
| NFPA 110 Checker | `nfpa_110_checker` | 15 | *(in orchestrator)* |
| Subdomain Discovery | `subdomain_discovery` | 5 | *(in orchestrator)* |
| Asset Discovery | `asset_discovery` | 15 | *(in orchestrator)* |
| Vulnerability Assessment | `vulnerability_assessment` | 25 | *(in orchestrator)* |

---

## Key Commits & Deployment History

```
c0d3ede  feat: remove Credit Top-Ups section from landing page
a035c34  fix: register POST /credits/purchase as direct app.post() not sub-router
327f010  fix: register creditPurchaseRouter immediately after express.json()
ce5d39d  debug: add global request logger and 404 handler to billing-api
b95b932  fix: mount creditPurchaseRouter at /credits/purchase to fix 404
587fe6f  fix: POST /credits/purchase route and credits.html email field
ab0dacf  feat: add credits.html top-up page and update landing page purchase cards
4e92bf4  debug: add step-by-step logging around email sending in webhook
f4c0c5c  fix: create user in webhook if missing (paid signup race condition)
c5cd3b2  fix: retry provision-key on 429/503 (Render idle spin-up throttling)
e11e950  debug: skip-verification bypass + body probe middleware
7404400  debug: add extensive webhook logging and /webhook-test endpoint
6ccd1f4  fix: resolve Stripe webhook signature verification failure
e8b4898  fix: replace localhost fallback URLs and add success/cancel pages
4f6e1a9  fix: update orchestrator Dockerfile with all 51 agent directories
cadc0a6  feat: credit top-ups, tier upgrades, and low-credit warnings
12f1e8b  feat: automated signup, email verification, and fraud prevention
bd32b2a  feat: add 26 new agents (Phase 2) — complete 54-tool fleet
36e0a44  feat: add 7 new data center agents — complete fleet expansion to 12 tools
7fe8b4a  Add construction_cost agent
e78d2f8  Add pue_calculator agent
9d1c7b1  Add nc_utility_interconnect agent
25e394b  Remove trademark names from public-facing descriptions
81dfa38  Initial commit - orchestrator, billing-api, 2 data center agents
```

---

## Known Limitations

### 1. Free-tier cold starts (5+ min email delay)
- **Problem:** Both Render free-tier services spin down after 15 minutes of inactivity.
  When a user signs up and the orchestrator is cold, `provisionApiKey()` hits 429/503.
  The retry logic waits up to ~15 seconds (4 attempts × backoff), but sometimes the
  orchestrator needs 30–60 seconds to fully wake up, causing key provisioning to fail.
- **Symptom:** User verifies email but never receives API key.
- **Workaround:** Email sends `sendUpgradeConfirmation` as fallback (no key).
  Manual recovery: see Emergency Recovery below.
- **Permanent fix:** Upgrade both services to Render Starter ($7/mo each) for always-on.

### 2. Ephemeral SQLite database
- **Problem:** Render free-tier has no persistent disk. Every deploy wipes `billing.db`
  and `keys.db`, losing all users, credits, and API keys.
- **Symptom:** Users who signed up before a deploy have to re-register. API keys stop working.
- **Workaround:** Webhook recreates users from Stripe session data if missing.
  But API keys in keys.db are permanently lost on orchestrator redeploy.
- **Permanent fix:**
  - Add Render Persistent Disk ($0.25/GB/mo) at `/data`
  - Set `BILLING_DB_PATH=/data/billing.db`
  - Set similar env var for orchestrator's keys.db path

### 3. No API key recovery
- **Problem:** API keys are stored as bcrypt hashes. Plaintext is never stored.
  If a user loses their key (or the DB is wiped), there's no way to retrieve it.
- **Workaround:** Provision a new key manually (see Emergency Recovery).

### 4. In-memory rate limiting
- **Problem:** Low-credit warning deduplication uses an in-memory Map.
  Resets on every service restart/deploy.
- **Impact:** User could receive multiple low-credit warnings after a deploy.
- **Fix:** Store last-warning timestamp in billing.db.

### 5. No subscription management UI
- **Problem:** Users can't cancel, pause, or change their subscription from the platform.
- **Workaround:** Cancellation is handled entirely through Stripe's customer portal or manually.

### 6. Stripe webhook retry risk
- **Problem:** If the webhook handler throws an error, Stripe retries for up to 3 days.
  The handler catches errors and returns 200 to prevent infinite retries, but this means
  some failures are silently dropped.
- **Impact:** Possible missed credit top-ups or tier upgrades.

---

## Emergency Recovery Procedures

### Procedure 1: User lost API key (DB wipe or key lost)

```bash
# 1. Provision a new key via curl
curl -X POST https://security-orchestra-orchestrator.onrender.com/admin/provision-key \
  -H "Content-Type: application/json" \
  -H "x-admin-key: <ORCHESTRATOR_ADMIN_KEY>" \
  -d '{"userId": "<user-id>", "tier": "<free|starter|pro|enterprise>"}'

# Response: { "apiKey": "sk_live_..." }

# 2. Email the key to the user manually
# (or add a /admin/resend-key endpoint)
```

### Procedure 2: Manually add credits to a user

```bash
curl -X POST https://security-orchestra-billing.onrender.com/credits/<userId>/add \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

### Procedure 3: Recreate user after DB wipe

```bash
# Get user's payment info from Stripe Dashboard
# Then create user manually:
curl -X POST https://security-orchestra-billing.onrender.com/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "tier": "starter"
  }'
```

### Procedure 4: Force webhook replay

1. Stripe Dashboard → Developers → Webhooks → your endpoint
2. Click the failed event
3. "Resend" button
4. Check Render logs for `[webhook]` output

### Procedure 5: Verify billing-api is working

```bash
# Health check
curl https://security-orchestra-billing.onrender.com/health
# Expected: {"status":"ok","service":"billing-api"}

# Test route registration
curl -X POST https://security-orchestra-billing.onrender.com/credits/purchase \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","pack":"100"}'
# Expected: 404 (user not found) or checkoutUrl — NOT Express 404
```

### Procedure 6: Check orchestrator is awake

```bash
# Ping orchestrator (wakes it up if sleeping)
curl https://security-orchestra-orchestrator.onrender.com/health
# Wait 30-60 seconds if first request after sleep
```

### Procedure 7: Full system recovery after complete DB wipe

1. Push a commit to trigger fresh deployment (both services)
2. New empty DBs will be created
3. Existing Stripe customers: their next tool use or manual webhook replay will recreate their records
4. API keys: all existing keys are invalid (stored hash is gone) — users need new keys
5. Notify affected users, provision new keys via Procedure 1
6. **Prevent future:** Set up Render Persistent Disk before next incident

---

*Last updated: 2026-03-16*
*Platform version: commit c0d3ede*
