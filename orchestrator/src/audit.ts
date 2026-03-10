import sqlite3 from "sqlite3";
import path from "path";

// ─── Shared DB ────────────────────────────────────────────────────────────────
// audit.db lives at the repo root (security-orchestra/) so both the orchestrator
// and the billing-api can read from it via their own DB connections.
// orchestrator/dist/audit.js → __dirname = orchestrator/dist/ → ../../ = security-orchestra/

const AUDIT_DB_PATH =
  process.env.AUDIT_DB_PATH ??
  path.join(__dirname, "..", "..", "audit.db");

export const auditDb = new sqlite3.Database(AUDIT_DB_PATH, (err) => {
  if (err) {
    // Non-fatal — audit failures must never crash the main server
    console.error("[audit] Failed to open audit database:", err.message);
  }
});

auditDb.serialize(() => {
  auditDb.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      resource    TEXT,
      result      TEXT    NOT NULL,
      details     TEXT,
      duration_ms INTEGER
    )
  `);
  // Indexes for the query patterns used by the billing-api audit endpoints
  auditDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_logs(user_id)`);
  auditDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action)`);
  auditDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_result    ON audit_logs(result)`);
  auditDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)`);
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditResult = "success" | "failure" | "blocked";

export interface AuditEntry {
  user_id:     string;
  action:      string;
  resource?:   string;
  result:      AuditResult;
  details?:    Record<string, unknown>;
  duration_ms?: number;
}

export interface AuditRow {
  id:          number;
  timestamp:   string;
  user_id:     string;
  action:      string;
  resource:    string | null;
  result:      string;
  details:     string | null;
  duration_ms: number | null;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget — queues an audit insert and returns immediately.
 * Never throws; audit failures are logged to stderr but do not affect callers.
 */
export function logAudit(entry: AuditEntry): void {
  const timestamp = new Date().toISOString();
  const details   = entry.details ? JSON.stringify(entry.details) : null;

  auditDb.run(
    `INSERT INTO audit_logs (timestamp, user_id, action, resource, result, details, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      timestamp,
      entry.user_id,
      entry.action,
      entry.resource   ?? null,
      entry.result,
      details,
      entry.duration_ms ?? null,
    ],
    (err) => {
      if (err) console.error("[audit] Write failed:", err.message);
    }
  );
}

// ─── Read helpers (used by billing-api) ──────────────────────────────────────

export function auditDbAll(sql: string, params: unknown[]): Promise<AuditRow[]> {
  return new Promise((resolve, reject) => {
    auditDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as AuditRow[]);
    });
  });
}
