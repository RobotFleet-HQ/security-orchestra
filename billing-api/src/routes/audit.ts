import { Router, Request, Response } from "express";
import sqlite3 from "sqlite3";
import path from "path";

const router = Router();

// billing-api/dist/routes/ → ../../../ = security-orchestra/
const AUDIT_DB_PATH =
  process.env.AUDIT_DB_PATH ??
  path.join(__dirname, "..", "..", "..", "audit.db");

const auditDb = new sqlite3.Database(
  AUDIT_DB_PATH,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error("[audit-route] Cannot open audit DB:", err.message,
        `\n  Path: ${AUDIT_DB_PATH}`);
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

interface AuditRow {
  id:          number;
  timestamp:   string;
  user_id:     string;
  action:      string;
  resource:    string | null;
  result:      string;
  details:     string | null;
  duration_ms: number | null;
}

function formatRow(row: AuditRow) {
  return {
    id:          row.id,
    timestamp:   row.timestamp,
    user_id:     row.user_id,
    action:      row.action,
    resource:    row.resource,
    result:      row.result,
    details:     row.details ? JSON.parse(row.details) : null,
    duration_ms: row.duration_ms,
  };
}

function queryAll(sql: string, params: unknown[]): Promise<AuditRow[]> {
  return new Promise((resolve, reject) => {
    auditDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as AuditRow[]);
    });
  });
}

// GET /audit/search?action=&result=&from=&to=&limit=&offset=
// Must be defined BEFORE /:userId so "search" isn't matched as a userId
router.get("/search", async (req: Request, res: Response) => {
  const {
    action,
    result,
    from,
    to,
    user_id,
    limit  = "50",
    offset = "0",
  } = req.query as Record<string, string>;

  const limitN  = Math.min(Math.max(1, parseInt(limit,  10) || 50),  500);
  const offsetN = Math.max(0, parseInt(offset, 10) || 0);

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (user_id) { conditions.push("user_id = ?");  params.push(user_id); }
  if (action)  { conditions.push("action = ?");   params.push(action);  }
  if (result)  { conditions.push("result = ?");   params.push(result);  }
  if (from)    { conditions.push("timestamp >= ?"); params.push(from);  }
  if (to)      { conditions.push("timestamp <= ?"); params.push(to);    }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limitN, offsetN);

  try {
    const rows = await queryAll(
      `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      params
    );

    // Count for pagination
    const countRows = await queryAll(
      `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
      params.slice(0, params.length - 2)   // exclude LIMIT/OFFSET
    );
    const total = (countRows[0] as unknown as { total: number }).total;

    return res.json({
      total,
      limit:  limitN,
      offset: offsetN,
      rows:   rows.map(formatRow),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

// GET /audit/:userId?limit=&offset=
router.get("/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { limit = "50", offset = "0" } = req.query as Record<string, string>;

  const limitN  = Math.min(Math.max(1, parseInt(limit,  10) || 50),  500);
  const offsetN = Math.max(0, parseInt(offset, 10) || 0);

  try {
    const rows = await queryAll(
      `SELECT * FROM audit_logs WHERE user_id = ?
       ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [userId, limitN, offsetN]
    );

    const countRows = await queryAll(
      `SELECT COUNT(*) AS total FROM audit_logs WHERE user_id = ?`,
      [userId]
    );
    const total = (countRows[0] as unknown as { total: number }).total;

    // Summary counts by action
    const summaryRows = await queryAll(
      `SELECT action, result, COUNT(*) AS count
       FROM audit_logs WHERE user_id = ?
       GROUP BY action, result ORDER BY count DESC`,
      [userId]
    );

    return res.json({
      user_id: userId,
      total,
      limit:   limitN,
      offset:  offsetN,
      summary: summaryRows,
      rows:    rows.map(formatRow),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

export default router;
