# Security Orchestra — Failure Paths

This document describes real system behavior for every non-happy-path scenario, with
actual `CanonicalResponse` shapes for each. All shapes are accurate to the current
`orchestrator/src/canonical.ts` contract.

---

## 1. Timeout / Workflow Error

All 56 individual agents are pure TypeScript calculations with no I/O — they do not
time out. If a workflow throws an unhandled exception (e.g. a calculation receives
out-of-range input it cannot handle), the MCP handler wraps it as an
`ErrorCode.InternalError` and the response takes the error shape below.

**MCP transport response:**
```jsonc
{
  "agent_id":          "generator_sizing",
  "agent_version":     "1.0",
  "protocol_version":  "1.0",
  "execution_context": "deterministic_calc",
  "status":            "error",
  "result":            null,
  "error_code":        "WORKFLOW_FAILED",
  "error_message":     "Workflow error: load_kw must be a positive number",
  "data_freshness": {
    "validated_at":  "2026-03-28",
    "standards_ref": ["NFPA 110:2022", "IEEE 446:1987"],
    "stale_risk":    "medium"
  },
  "a2a": {
    "task_id":           "uuid-v4",
    "input_tokens_used": 0,
    "credits_consumed":  0,
    "callable_by": ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"]
  }
}
```

**Notes:**
- Credits are **not** deducted on workflow error — deduction only happens after a
  successful `dispatchWorkflow()` call.
- The audit log records `action: "workflow_error", result: "failure"`.
- HTTP transports (A2A, ACP, AG-UI) return HTTP 500 with the same payload wrapped
  in the protocol envelope.

---

## 2. Partial Chain Completion

Chains run each step inside a `try/catch`. A failing step records `error` in its slot
and execution **continues** for all remaining steps. The chain always returns
`status: "success"` — the caller must inspect `steps_completed` and individual step
`error` fields to detect partial failure.

**Example:** 8-step chain where step 3 (`ups_sizing`) fails:

```jsonc
{
  "agent_id":          "chain:full_power_analysis",
  "agent_version":     "1.0",
  "protocol_version":  "1.0",
  "execution_context": "multi_agent_chain",
  "status":            "success",
  "result": {
    "chain":            "full_power_analysis",
    "steps_completed":  7,
    "results": [
      { "step": "generator_sizing", "result": { /* ... */ } },
      { "step": "nfpa_110_checker", "result": { /* ... */ } },
      { "step": "ups_sizing",       "result": null,          "error": "ups_capacity_kw must be > 0" },
      { "step": "ats_sizing",       "result": { /* ... */ } },
      // ...remaining steps
    ],
    "summary": "generator_sizing: OK\nnfpa_110_checker: OK\nups_sizing: FAILED — ups_capacity_kw must be > 0\nats_sizing: OK\n..."
  },
  "data_freshness": { "validated_at": "2026-03-28", "standards_ref": [], "stale_risk": "low" },
  "a2a": { "task_id": "uuid-v4", "input_tokens_used": 0, "credits_consumed": 500, "callable_by": ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"] }
}
```

**Key behaviors:**
- `steps_completed` counts only steps with no `error` field.
- Credits for the full chain are charged regardless of partial failure — the chain ran.
- `summary` is a human-readable newline-delimited log of each step's outcome.
- To treat partial failure as fatal, callers should check `steps_completed < total_steps`.

---

## 3. Stale-Data Warning (`stale_risk: "high"`)

`stale_risk: "high"` is **informational only** — the system does not refuse to run
high-risk agents. Every response includes `data_freshness` with the risk level so
callers can decide whether to proceed.

Agents with `stale_risk: "high"` (utility rates, incentives, construction costs,
carbon grids, etc.) include a `pricing_note` when they return pricing data:

```jsonc
{
  "agent_id":          "utility_interconnect",
  "execution_context": "deterministic_calc",
  "status":            "success",
  "result": { /* interconnect analysis */ },
  "data_freshness": {
    "validated_at":  "2026-03-28",
    "standards_ref": ["FERC Order 2023", "IEEE 1547:2018"],
    "stale_risk":    "high",
    "pricing_note":  "Cost estimates based on 2026 Q1 market data. Verify current pricing before procurement."
  }
}
```

**There is no `override` parameter.** If a caller wants to suppress the warning in
downstream UI, it should filter `pricing_note` from its own presentation layer.

**Recommended consumer behavior for `stale_risk: "high"`:**
- Display `pricing_note` verbatim to end users.
- Do not pass results directly into procurement or financial systems without manual
  review.
- Re-run the agent after any quarterly STALENESS update (see `VALIDATION_CHECKLIST.md`).

---

## 4. Degraded Mode — Billing API Unreachable

When `BILLING_API_URL` is set but the billing service is down, `checkCredits()` throws
an `McpError(InternalError, "Billing API error...")`. The request is **rejected** — no
workflow runs.

```jsonc
// MCP error response (not a CanonicalResponse — thrown before dispatchWorkflow)
{
  "code":    -32603,
  "message": "Billing API error checking credits: ECONNREFUSED"
}
```

**HTTP transports** (A2A / ACP / REST):
```json
{ "error": "Billing API error checking credits: ECONNREFUSED" }
```
HTTP status: 500.

**When `BILLING_API_URL` is not set** (development / self-hosted without billing):
- The orchestrator starts with a `WARN` log in development; exits with code 1 in
  `NODE_ENV=production` (added 2026-03-29).
- In development, all requests proceed with no credit checks — effectively unlimited.

**No automatic degraded-mode fallback** exists. If billing is required for your
deployment, monitor `BILLING_API_URL` health and circuit-break at your load balancer
rather than relying on orchestrator-level fallback.

---

## 5. Retry Strategy

**Rate-limit exceeded** — the orchestrator returns the retry window in the error:

```jsonc
// MCP
{ "code": -32600, "message": "Rate limit exceeded: 10/min. Retry in 42s." }

// HTTP (A2A / ACP / REST)
// HTTP 429 with headers:
//   X-RateLimit-Limit: 10
//   X-RateLimit-Remaining: 0
//   X-RateLimit-Reset: <epoch seconds>
//   Retry-After: 42
```

Callers should:
1. Parse `Retry-After` (HTTP) or extract seconds from the MCP message.
2. Wait the full retry window before re-submitting — the in-process rate limiter uses
   a sliding window, so early retries will continue to fail.
3. Do **not** retry on `WORKFLOW_FAILED` errors — these indicate invalid input, not
   transient failure.

**Billing errors** (`ECONNREFUSED`, `502`, `503` from billing API) are transient.
Retry with exponential back-off: 1 s → 2 s → 4 s → give up after 3 attempts and
surface to the caller.

**Insufficient credits** (HTTP 402 from billing):
- Do not retry — the balance will not change until credits are purchased.
- The error message includes purchase URLs.

**Workflow errors** (`WORKFLOW_FAILED`):
- Do not retry — fix input parameters first.
- See `error_message` for the specific validation failure.

---

## Error Code Reference

| `error_code`        | Meaning | Retryable? |
|---|---|---|
| `WORKFLOW_FAILED`   | Unhandled exception inside workflow logic | No — fix params |
| `INVALID_PARAMS`    | Input validation failed | No — fix params |
| `RATE_LIMITED`      | Sliding-window rate limit exceeded | Yes — after `Retry-After` |
| `INSUFFICIENT_CREDITS` | Balance < required credits | No — buy credits first |
| `BILLING_ERROR`     | Billing API unreachable | Yes — exponential back-off |
| `AUTH_FAILED`       | Invalid or revoked API key | No |
| `CHAIN_NOT_FOUND`   | Unknown chain ID | No — fix chain ID |
| `WORKFLOW_NOT_FOUND`| Unknown workflow name | No — fix workflow name |
