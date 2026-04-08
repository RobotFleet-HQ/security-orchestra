// ─── Threshold alerts ─────────────────────────────────────────────────────────
// Express webhook receiver on POST /metrics.
// Payload: { site_id: string, metric: string, value: number }
// Evaluates incoming metric against configured thresholds in SQLite.
// Fires the configured orchestrator agent when a threshold is breached
// (respects per-threshold cooldown to prevent alert storms).

import { Router } from "express";
import { dbGet, dbRun, dbAll } from "./database.js";
import { callWorkflow } from "./orchestratorClient.js";
import { WEBHOOK_BEARER_TOKEN } from "./config.js";
import { ThresholdRow } from "./types.js";

function meetsThreshold(
  value: number,
  operator: ThresholdRow["operator"],
  threshold: number
): boolean {
  switch (operator) {
    case "gt":  return value >  threshold;
    case "lt":  return value <  threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
  }
}

function isCooledDown(lastFiredAt: string | null, cooldownMinutes: number): boolean {
  if (!lastFiredAt) return false;
  const elapsedMs = Date.now() - new Date(lastFiredAt).getTime();
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

export function createThresholdRouter(): Router {
  const router = Router();

  // Auth middleware for webhook endpoints
  function requireBearer(
    req: Parameters<Router>[0],
    res: Parameters<Router>[1],
    next: Parameters<Router>[2]
  ): void {
    if (!WEBHOOK_BEARER_TOKEN) { next(); return; }
    const auth = (req as { headers: Record<string, string> }).headers["authorization"] ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token !== WEBHOOK_BEARER_TOKEN) {
      (res as { status: (n: number) => { json: (o: unknown) => void } })
        .status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // POST /metrics — receive a metric event and evaluate thresholds
  router.post("/metrics", requireBearer, async (req, res) => {
    const { site_id, metric, value } = req.body as {
      site_id?: string; metric?: string; value?: number;
    };

    if (!site_id || !metric || value === undefined || typeof value !== "number") {
      res.status(400).json({ error: "Required: site_id (string), metric (string), value (number)" });
      return;
    }

    const threshold = await dbGet<ThresholdRow>(
      "SELECT * FROM thresholds WHERE site_id = ? AND metric = ?",
      [site_id, metric]
    );

    if (!threshold) {
      res.json({ matched: false, message: "No threshold configured for this metric" });
      return;
    }

    const breached = meetsThreshold(value, threshold.operator, threshold.value);
    if (!breached) {
      res.json({ matched: true, breached: false, value, threshold: threshold.value });
      return;
    }

    if (isCooledDown(threshold.last_fired_at, threshold.cooldown_minutes)) {
      console.log(`[threshold] ${site_id}/${metric} breached but still in cooldown`);
      res.json({ matched: true, breached: true, fired: false, reason: "cooldown active" });
      return;
    }

    // Breach confirmed and cooldown elapsed — fire the agent
    const firedAt = new Date().toISOString();
    console.log(`[threshold] BREACH: site=${site_id} metric=${metric} value=${value} ${threshold.operator} ${threshold.value} → firing ${threshold.agent_name}`);

    const agentResult = await callWorkflow(threshold.agent_name, {
      site_id,
      metric,
      value:     String(value),
      threshold: String(threshold.value),
    });

    // Update cooldown timestamp regardless of agent success
    await dbRun(
      "UPDATE thresholds SET last_fired_at = ? WHERE id = ?",
      [firedAt, threshold.id]
    );

    // Log the breach event
    await dbRun(
      `INSERT INTO threshold_events (site_id, metric, value, threshold, agent_name, fired_at, agent_response)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        site_id, metric, value, threshold.value,
        threshold.agent_name, firedAt,
        agentResult.ok ? JSON.stringify(agentResult.raw) : agentResult.error ?? null,
      ]
    );

    res.json({
      matched:    true,
      breached:   true,
      fired:      true,
      agent_name: threshold.agent_name,
      agent_ok:   agentResult.ok,
      agent_error: agentResult.ok ? undefined : agentResult.error,
    });
  });

  // POST /thresholds — register or update a threshold
  router.post("/thresholds", requireBearer, async (req, res) => {
    const { site_id, metric, operator, value, agent_name, cooldown_minutes } = req.body as {
      site_id?: string; metric?: string; operator?: string;
      value?: number; agent_name?: string; cooldown_minutes?: number;
    };

    if (!site_id || !metric || !operator || value === undefined || !agent_name) {
      res.status(400).json({ error: "Required: site_id, metric, operator (gt|lt|gte|lte), value, agent_name" });
      return;
    }
    if (!["gt", "lt", "gte", "lte"].includes(operator)) {
      res.status(400).json({ error: "operator must be: gt | lt | gte | lte" });
      return;
    }

    await dbRun(
      `INSERT INTO thresholds (site_id, metric, operator, value, agent_name, cooldown_minutes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, metric) DO UPDATE SET
         operator = excluded.operator,
         value = excluded.value,
         agent_name = excluded.agent_name,
         cooldown_minutes = excluded.cooldown_minutes`,
      [site_id, metric, operator, value, agent_name, cooldown_minutes ?? 60]
    );

    res.json({ ok: true, message: `Threshold registered: ${site_id}/${metric} ${operator} ${value}` });
  });

  // GET /thresholds?site_id=... — list configured thresholds
  router.get("/thresholds", requireBearer, async (req, res) => {
    const { site_id } = req.query as { site_id?: string };
    const rows = site_id
      ? await dbAll<ThresholdRow>("SELECT * FROM thresholds WHERE site_id = ?", [site_id])
      : await dbAll<ThresholdRow>("SELECT * FROM thresholds", []);
    res.json({ thresholds: rows });
  });

  return router;
}
