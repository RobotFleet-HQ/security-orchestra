# Billing API

The HTTP service that handles user management, credit tracking, Stripe payments, and audit log queries for Security Orchestra. The orchestrator calls it before and after every workflow execution to check and deduct credits.

---

## What It Does

- **Users** — create accounts, look up profiles and credit balances
- **Credits** — check balance, deduct per workflow execution, add credits manually
- **Checkout** — create Stripe checkout sessions for tier upgrades
- **Webhooks** — receive Stripe events and automatically top up credits on payment
- **Audit** — query the shared audit log written by the orchestrator

---

## Prerequisites

- **Node.js 18+**
- **npm 9+**
- A [Stripe](https://stripe.com) account — required for paid tier checkouts
- The [Stripe CLI](https://stripe.com/docs/stripe-cli) — required to receive webhook events locally

---

## Installation

```bash
cd billing-api
npm install
npm run build
```

---

## Environment Setup

```bash
cp .env.example .env
```

Open `.env` and fill in the values:

```dotenv
PORT=3001
BASE_URL=http://localhost:3001
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
BILLING_DB_PATH=./billing.db
AUDIT_DB_PATH=../audit.db
```

See [`.env.example`](.env.example) for full descriptions of every variable.

---

## Stripe Setup

### 1. Get your API keys

Log in to the [Stripe Dashboard](https://dashboard.stripe.com/apikeys) and copy your **Secret key** (`sk_test_...` for development).

```dotenv
STRIPE_SECRET_KEY=sk_test_51...
```

### 2. Set up a webhook endpoint (local development)

Install the Stripe CLI and log in:

```bash
stripe login
```

Start the local webhook listener and print the signing secret:

```bash
stripe listen --forward-to localhost:3001/webhooks/stripe
# > Ready! Your webhook signing secret is whsec_abc123...
```

Copy the signing secret into `.env`:

```dotenv
STRIPE_WEBHOOK_SECRET=whsec_abc123...
```

### 3. Webhook endpoint (production)

In the [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), create an endpoint:

- **URL:** `https://your-billing-api.com/webhooks/stripe`
- **Events to listen for:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`

Copy the **Signing secret** from the dashboard into `STRIPE_WEBHOOK_SECRET`.

---

## Running

```bash
# Production (requires npm run build first)
npm start

# Development (runs TypeScript directly — no build step needed)
npm run dev
```

Server starts on `http://localhost:3001`:

```
Connected to billing.db
Billing API running on http://localhost:3001
Stripe configured: true
```

---

## API Reference

### Health

```
GET /health
```

```json
{ "status": "ok", "service": "billing-api" }
```

---

### Users

#### Create a user

```
POST /users
Content-Type: application/json

{ "email": "user@example.com", "tier": "free" }
```

Valid tiers: `free` · `starter` · `pro` · `enterprise`

```json
{
  "id": "31f8ce69-...",
  "email": "user@example.com",
  "tier": "free",
  "credits": 100,
  "created_at": "2026-03-09T19:26:47.918Z"
}
```

#### Get a user

```
GET /users/:userId
```

```json
{
  "id": "31f8ce69-...",
  "email": "user@example.com",
  "tier": "free",
  "tier_label": "Free",
  "credits": {
    "balance": 95,
    "total_purchased": 100,
    "total_used": 5
  },
  "created_at": "2026-03-09T19:26:47.918Z"
}
```

---

### Credits

#### Check balance

```
GET /credits/:userId
```

```json
{
  "user_id": "31f8ce69-...",
  "tier": "free",
  "balance": 95,
  "total_purchased": 100,
  "total_used": 5,
  "updated_at": "2026-03-09T19:30:00.000Z"
}
```

#### Deduct credits (called by the orchestrator after successful workflow execution)

```
POST /credits/:userId/deduct
Content-Type: application/json

{ "amount": 5, "reason": "subdomain_discovery" }
```

Returns `402 Payment Required` if balance is insufficient:

```json
{ "error": "Insufficient credits", "balance": 3, "required": 5 }
```

On success:

```json
{ "user_id": "...", "deducted": 5, "reason": "subdomain_discovery", "balance": 90 }
```

#### Add credits (admin / manual top-up)

```
POST /credits/:userId/add
Content-Type: application/json

{ "amount": 500 }
```

---

### Checkout

#### List pricing tiers

```
GET /checkout/tiers
```

```json
{
  "tiers": [
    { "id": "free",       "label": "Free",              "price_cents": 0,     "price_usd": "0.00",   "credits": 100   },
    { "id": "starter",    "label": "Starter ($29)",      "price_cents": 2900,  "price_usd": "29.00",  "credits": 500   },
    { "id": "pro",        "label": "Pro ($99)",           "price_cents": 9900,  "price_usd": "99.00",  "credits": 2000  },
    { "id": "enterprise", "label": "Enterprise ($499)",   "price_cents": 49900, "price_usd": "499.00", "credits": 10000 }
  ]
}
```

#### Create a checkout session

```
POST /checkout
Content-Type: application/json

{
  "user_id": "31f8ce69-...",
  "tier": "pro",
  "success_url": "https://yourapp.com/success",
  "cancel_url":  "https://yourapp.com/cancel"
}
```

```json
{
  "checkout_url": "https://checkout.stripe.com/pay/cs_test_...",
  "session_id":   "cs_test_...",
  "tier":         "pro",
  "credits":      2000,
  "price_cents":  9900
}
```

Redirect the user to `checkout_url`. When payment completes, Stripe fires `checkout.session.completed` and the webhook handler upgrades the user's tier and credits automatically.

---

### Webhooks

```
POST /webhooks/stripe
```

This endpoint must receive the **raw** (unparsed) request body for signature verification. It is already configured correctly — do not add `express.json()` middleware to this route.

Events handled:

| Event | Effect |
|---|---|
| `checkout.session.completed` | Upgrades user tier, adds purchased credits |
| `customer.subscription.updated` | Updates subscription status |
| `customer.subscription.deleted` | Marks subscription cancelled, downgrades to free |
| `invoice.payment_succeeded` | Tops up credits for recurring billing cycle |

---

### Audit Log

The audit log is written by the orchestrator and queried here. Start the orchestrator at least once so `audit.db` is created before using these endpoints.

#### Recent activity for a user

```
GET /audit/:userId?limit=50&offset=0
```

```json
{
  "user_id": "31f8ce69-...",
  "total": 42,
  "limit": 50,
  "offset": 0,
  "summary": [
    { "action": "workflow_complete", "result": "success", "count": 12 },
    { "action": "rate_limit_ok",     "result": "success", "count": 12 },
    { "action": "validation_failure","result": "failure",  "count": 2  }
  ],
  "rows": [ ... ]
}
```

#### Search / filter events

```
GET /audit/search?action=validation_failure&result=failure&from=2026-03-01&to=2026-03-31&limit=20
```

Query parameters:

| Parameter | Description |
|---|---|
| `user_id` | Filter to a specific user |
| `action` | Filter by action (e.g. `workflow_complete`, `credit_insufficient`) |
| `result` | `success` · `failure` · `blocked` |
| `from` | ISO 8601 start timestamp (inclusive) |
| `to` | ISO 8601 end timestamp (inclusive) |
| `limit` | Max rows to return (default `50`, max `500`) |
| `offset` | Pagination offset (default `0`) |

---

## Testing the Payment Flow

### 1. Create a test user

```bash
curl -s -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","tier":"free"}' | jq .
```

### 2. Create a checkout session

```bash
curl -s -X POST http://localhost:3001/checkout \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<id from step 1>","tier":"starter"}' | jq .
```

Open the `checkout_url` in your browser. Use Stripe's test card:

```
Card number:  4242 4242 4242 4242
Expiry:       Any future date
CVC:          Any 3 digits
```

### 3. Observe webhook delivery

While the CLI listener is running (`stripe listen --forward-to ...`) you'll see:

```
2026-03-09 19:30:00  --> checkout.session.completed [evt_...]
2026-03-09 19:30:00  <-- [POST] /webhooks/stripe [200]
```

### 4. Verify the upgrade

```bash
curl -s http://localhost:3001/users/<id> | jq .credits
```

The balance should now reflect the purchased tier's credit allocation.

---

## Troubleshooting

### `Webhook signature verification failed`
- The `STRIPE_WEBHOOK_SECRET` in `.env` does not match the secret for the endpoint receiving events
- For local testing, copy the secret printed by `stripe listen --print-secret`, not the dashboard secret

### `Cannot open audit DB`
- The orchestrator must run at least once to create `audit.db` before billing-api can query it
- Confirm `AUDIT_DB_PATH` in both services resolves to the same file

### `Stripe configured: false` at startup
- `STRIPE_SECRET_KEY` is missing from `.env`
- Checkout and webhook endpoints will fail; the rest of the API works without Stripe

### Credits not added after Stripe payment
1. Confirm the Stripe CLI listener is running and forwarding to the correct URL
2. Check the `POST /webhooks/stripe` response code in the CLI output — should be `200`
3. Confirm `metadata.user_id` and `metadata.tier` are present on the checkout session (they are set automatically by `POST /checkout`)
4. Query the audit log: `GET /audit/:userId?action=credit_deduct` to see if the webhook fired
