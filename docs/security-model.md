# Security Orchestra — Security Model

This document describes the authorization model, trust boundaries, content
sanitization pipeline, and least-privilege credential scoping as implemented in the
current codebase. All claims are grounded in the source — see the referenced files
for canonical truth.

---

## 1. Tool-Level Authorization (which agents require which tier)

Agent access is gated by **credit cost per call** mapped to subscription tier. This is
enforced by `checkTierAccess()` in `orchestrator/src/index.ts` before any workflow
runs — before credit checks, before execution.

| Tier | Max credits/call | Accessible agents |
|---|---|---|
| `free` | 20 | Simple (5 cr) + Compliance (20 cr) agents |
| `starter` | 50 | Above + Complex Analysis (50 cr) agents |
| `pro` | 100 | All agents including Premium Reports (100 cr) |
| `enterprise` | 100 | All agents + highest rate limits |

**Premium agents (100 cr — Pro/Enterprise only):** `generator_sizing`,
`utility_interconnect`, `nc_utility_interconnect`, `demand_response`,
`incentive_finder`, `roi_calculator`, `tco_analyzer`, `fiber_connectivity`,
`site_scoring`, `solar_feasibility`, `energy_procurement`, `cybersecurity_controls`,
`compliance_checker`, `tier_certification_checker`.

**Tier access is checked on every request** regardless of transport (MCP, A2A, REST,
AG-UI, ACP). Unknown tiers fall back to `free` limits (`TIER_MAX_AGENT_COST[tier] ?? 20`).

---

## 2. Authentication Per Transport

### MCP / SSE transport (Claude Desktop, Claude Code, MCP clients)

`ORCHESTRATOR_API_KEY` environment variable is set at deploy time. The orchestrator
validates the incoming Bearer token against this single key at startup and stores
the result in module-level `authorizedUserId = "admin"`, `authorizedTier = "enterprise"`.
All MCP tool calls inherit this identity — there is no per-user key lookup in MCP mode.

**Implication:** MCP mode is a single-tenant trust boundary. Every MCP client that
knows the server URL and key is treated as an enterprise user. Do not expose the
SSE endpoint publicly without rate-limiting at the reverse proxy layer.

### REST, A2A, AG-UI, ACP, AGNTCY transports (HTTP)

Per-request API key validation via prefix lookup in `keys.db`:
1. Extract `Bearer sk_live_<32hex>_<6checksum>` from `Authorization` header.
2. Validate format against `API_KEY_REGEX = /^sk_live_[0-9a-f]{32}_[0-9a-f]{6}$/`.
3. Look up `key_prefix` (first 12 chars) in SQLite `api_keys` table.
4. Reject if `revoked = true` or `expires_at` is in the past.
5. Update `last_used` timestamp (fire-and-forget — not security-critical).

**Note:** HTTP routes use prefix lookup, not bcrypt re-verification of the full hash.
The prefix is the first 12 characters of the raw key (`sk_live_` + first 4 hex chars),
which provides ~48 bits of uniqueness — sufficient to identify the record but not to
derive the full key. Full bcrypt verification is only performed in
`validateApiKey()` (used during the MCP auth path if the DB mode is enabled).

---

## 3. Inter-Agent Trust — Can One Agent Call Another?

**No.** Agents do not call other agents at runtime. Every agent is an isolated
TypeScript function that takes structured parameters and returns a result. There is
no agent-to-agent HTTP call, no shared message bus, and no ambient capability that
one agent could use to invoke another.

Chains (`runChain()` in `index.ts`) are the only mechanism for sequential agent
execution, and they are orchestrated exclusively by the orchestrator:

```
Client → orchestrator.runChain() → dispatchWorkflow(step1) → dispatchWorkflow(step2) → ...
```

- Each step receives only the parameters extracted from the previous step's output
  via the `extractChainParams()` mapping — not the full result blob.
- No step can access other steps' raw results except through this explicit mapping.
- No step can initiate a new chain or call an arbitrary workflow.

**Trust boundary:** The orchestrator is the only principal that can fan out to
multiple agents. Agents themselves have no outbound call capability.

---

## 4. Content Sanitization Between Protocol Adapters

All inbound parameters — regardless of transport — pass through
`validateWorkflowParams()` in `orchestrator/src/validation.ts` before reaching any
agent. The sanitization pipeline is:

### Step 1 — Strip non-printable characters
```typescript
input.trim().replace(/[^\x20-\x7E]/g, "")
```
Removes null bytes, control characters, and any character outside printable ASCII.

### Step 2 — Injection pattern blocklist
Every string parameter is checked against:

| Pattern | Blocks |
|---|---|
| `/[;&\|`$(){}[\]<>]/` | Shell metacharacters / command injection |
| `/\.\.[\\/]/` | Path traversal |
| `/\r\|\n\|\0/` | Control characters (belt-and-suspenders after step 1) |
| `/\bOR\b\|\bAND\b\|\bUNION\b\|\bSELECT\b\|\bDROP\b\|\bINSERT\b/i` | SQL keyword injection |
| `/{{|}}|<%|%>/` | Template injection |
| `/javascript:/i` | javascript: URI |
| `/\s{2,}/` | Excessive whitespace (exfiltration vector) |

Any match causes an immediate `McpError(InvalidParams)` — the workflow never runs.

### Step 3 — Domain / IP / URL type validation
Fields expected to be domains, IPs, or URLs are validated with
`validator.isFQDN()` / `validator.isIP()` / `validator.isURL()` after the
blocklist check. Type-mismatch inputs are rejected before reaching agent logic.

### Step 4 — Numeric range coercion
Numeric parameters (`capacity_mw`, `load_kw`, etc.) are parsed with `parseFloat` /
`parseInt` and validated for domain-appropriate ranges (e.g. negative capacity is
rejected). Out-of-range values throw `INVALID_PARAMS`.

### Cross-protocol note
AG-UI, ACP, and A2A endpoints all feed into the same `validateWorkflowParams()` call
before `dispatchWorkflow()`. There is no protocol adapter that bypasses validation.
The MCP path goes through `typedArgs` extraction and then the same validation step.

---

## 5. Least-Privilege Credential Scoping Per Transport

| Transport | Credential type | Scope | Where validated |
|---|---|---|---|
| MCP / SSE | `ORCHESTRATOR_API_KEY` env var | Single shared identity (`admin`/`enterprise`) | Module-level at startup |
| REST `/workflow` | `Bearer sk_live_...` | Per-user, per-tier | Per-request prefix lookup in `keys.db` |
| A2A `POST /a2a` | `Bearer sk_live_...` | Per-user, per-tier | Per-request prefix lookup |
| AG-UI `POST /agui` | `Bearer sk_live_...` | Per-user, per-tier | Per-request prefix lookup |
| ACP `POST /acp/runs` | `Bearer sk_live_...` | Per-user, per-tier | Per-request prefix lookup |
| Admin dashboard | HTTP Basic auth | Single admin password (`ADMIN_PASSWORD` env) | Per-request in `requireAdmin` middleware |

**Key generation:** Keys are generated with `crypto.randomBytes(16)` (128 bits of
entropy) and stored as `bcrypt` hashes (`bcryptjs`, 10 rounds). The raw key is shown
once at generation time and never stored. The database only holds the hash and a
12-character prefix for lookup.

**Key revocation:** Setting `revoked = 1` in `api_keys` table immediately blocks the
key on all HTTP transports. MCP mode is unaffected (uses env-var, not the DB).

**Billing credentials:** The orchestrator communicates with the billing API via
internal service URL (`BILLING_API_URL`) with no additional credential — this is an
internal service-to-service call assumed to be on a private network. If exposed
publicly, add an internal shared secret header.

**Stripe webhooks:** The billing API validates `stripe-signature` using
`STRIPE_WEBHOOK_SECRET`. All Stripe webhook handlers call
`stripe.webhooks.constructEvent()` before processing any payload.

---

## 6. What Is NOT in Scope

- **mTLS between services:** orchestrator ↔ billing-api uses plain HTTP. Mitigation:
  deploy on the same internal network (Render private network or localhost).
- **Secrets in logs:** `log()` in the orchestrator does not redact API keys. Ensure
  your log aggregator does not index `Authorization` headers.
- **SSRF via agent parameters:** Agent parameters are domain/IP strings used as
  calculation inputs, not as fetch targets. No agent makes outbound HTTP calls using
  user-supplied hostnames. SSRF is not a current attack surface.
