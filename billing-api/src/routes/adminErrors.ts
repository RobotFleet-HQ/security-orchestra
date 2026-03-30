import { Router, Request, Response, NextFunction } from "express";
import sqlite3 from "sqlite3";
import path from "path";

const router = Router();

// ─── Audit DB connection ──────────────────────────────────────────────────────

const AUDIT_DB_PATH =
  process.env.AUDIT_DB_PATH ??
  path.join(__dirname, "..", "..", "..", "audit.db");

const auditDb = new sqlite3.Database(
  AUDIT_DB_PATH,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error("[admin-errors] Cannot open audit DB:", err.message);
    }
  }
);

auditDb.serialize(() => {
  auditDb.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      action      TEXT NOT NULL,
      resource    TEXT,
      result      TEXT NOT NULL,
      details     TEXT,
      duration_ms INTEGER
    )
  `);
});

function auditAll<T>(sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    auditDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(503).send("Admin endpoints disabled — set ADMIN_PASSWORD env var.");
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    res.status(401).send("Authentication required.");
    return;
  }
  const decoded  = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
  if (password !== adminPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    res.status(401).send("Invalid credentials.");
    return;
  }
  next();
}

router.use(requireAdmin);

// ─── Shared row formatter ─────────────────────────────────────────────────────

interface RawRow {
  id:          number;
  timestamp:   string;
  user_id:     string;
  action:      string;
  resource:    string | null;
  result:      string;
  details:     string | null;
  duration_ms: number | null;
}

// Returns a normalized event shape with transport extracted from details.
function formatEvent(row: RawRow) {
  let details: Record<string, unknown> | null = null;
  try {
    if (row.details) details = JSON.parse(row.details);
  } catch { /* ignore */ }

  return {
    id:          row.id,
    timestamp:   row.timestamp,
    user_id:     row.user_id || null,
    agent_id:    row.resource ?? null,
    action:      row.action,
    result:      row.result,
    error_message: (details?.message ?? details?.error ?? null) as string | null,
    transport:   (details?.transport ?? null) as string | null,
    duration_ms: row.duration_ms ?? null,
  };
}

// ─── GET /admin/errors — last 100 failed events grouped by type ───────────────

// Chain timeout threshold — chains running longer than this are considered timed-out.
const CHAIN_TIMEOUT_MS = 30_000;

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [
      failedCallRows,
      timedOutChainRows,
      staleRefusalRows,
      billingFailureRows,
    ] = await Promise.all([

      // failed_calls: auth failures, validation errors, rate-limit, tier blocks,
      // workflow errors — anything result=failure or result=blocked that is NOT
      // a billing-specific action (those go in billing_failures).
      auditAll<RawRow>(
        `SELECT id, timestamp, user_id, action, resource, result, details, duration_ms
         FROM audit_logs
         WHERE (result = 'failure' OR result = 'blocked')
           AND action NOT IN ('credit_check_error', 'credit_deduct_error', 'billing_error')
         ORDER BY timestamp DESC
         LIMIT 100`,
        []
      ),

      // timed_out_chains: chain executions that ran over CHAIN_TIMEOUT_MS.
      // Chains always complete (partial results kept) — "timed out" here means
      // duration exceeded the threshold, not a hard timeout.
      auditAll<RawRow>(
        `SELECT id, timestamp, user_id, action, resource, result, details, duration_ms
         FROM audit_logs
         WHERE action IN ('chain_complete', 'agui_chain_complete', 'acp_run_complete')
           AND duration_ms IS NOT NULL
           AND duration_ms > ?
         ORDER BY timestamp DESC
         LIMIT 100`,
        [CHAIN_TIMEOUT_MS]
      ),

      // stale_refusals: requests rejected because stale_risk = "high" with no override.
      // NOTE: as of 2026-03-30, stale_risk: "high" is informational only — no hard
      // refusals exist. This group will always be empty until a refusal policy is added.
      auditAll<RawRow>(
        `SELECT id, timestamp, user_id, action, resource, result, details, duration_ms
         FROM audit_logs
         WHERE action = 'stale_data_refusal'
         ORDER BY timestamp DESC
         LIMIT 100`,
        []
      ),

      // billing_failures: credit check/deduct errors and billing API unreachable events.
      auditAll<RawRow>(
        `SELECT id, timestamp, user_id, action, resource, result, details, duration_ms
         FROM audit_logs
         WHERE action IN ('credit_check_error', 'credit_deduct_error', 'billing_error')
            OR (result = 'failure' AND action LIKE 'credit%')
         ORDER BY timestamp DESC
         LIMIT 100`,
        []
      ),
    ]);

    return res.json({
      chain_timeout_threshold_ms: CHAIN_TIMEOUT_MS,
      stale_refusals_note: "stale_risk:'high' is informational only — no refusal policy is active",
      failed_calls:     failedCallRows.map(formatEvent),
      timed_out_chains: timedOutChainRows.map(formatEvent),
      stale_refusals:   staleRefusalRows.map(formatEvent),
      billing_failures: billingFailureRows.map(formatEvent),
    });
  } catch (err) {
    // If audit.db is unavailable, return empty groups rather than a 500.
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({
      error:            `audit.db unavailable: ${msg}`,
      failed_calls:     [],
      timed_out_chains: [],
      stale_refusals:   [],
      billing_failures: [],
    });
  }
});

export default router;
