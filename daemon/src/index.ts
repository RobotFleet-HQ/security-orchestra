// ─── Security Orchestra Daemon ────────────────────────────────────────────────
// Always-on monitoring service. Four components:
//   1. Cron scheduler   — runs mythos-quick-scan per site on schedule
//   2. CVE watcher      — polls NVD + CISA KEV for new ICS/SCADA CVEs
//   3. Threshold alerts — webhook receiver fires agents on metric breaches
//   4. Daily digest     — emails overnight findings summary at DIGEST_CRON

import express from "express";
import { initDb, dbGet } from "./database.js";
import { syncSites } from "./siteLoader.js";
import { validateConfig, PORT } from "./config.js";
import { startScheduler } from "./scheduler.js";
import { startCveWatcher } from "./cveWatcher.js";
import { createThresholdRouter } from "./thresholdAlerts.js";
import { startDailyDigest } from "./dailyDigest.js";

const START_TIME = Date.now();

async function main(): Promise<void> {
  console.log("[daemon] Starting Security Orchestra Daemon...");
  validateConfig();

  // Init SQLite schema
  await initDb();

  // Load sites from env → DB
  const sites = await syncSites();

  // ── Start all four monitoring components ────────────────────────────────────
  startScheduler(sites);
  startCveWatcher(sites);
  startDailyDigest(sites);

  // ── HTTP server: webhook receiver + health ───────────────────────────────────
  const app = express();
  app.use(express.json());

  // Health check — required by Render Background Worker monitoring
  app.get("/health", async (_req, res) => {
    let dbOk = false;
    try {
      await dbGet("SELECT 1", []);
      dbOk = true;
    } catch { /* ignore */ }

    res.json({
      status:      dbOk ? "ok" : "degraded",
      service:     "sro-daemon",
      uptime_s:    Math.round((Date.now() - START_TIME) / 1000),
      sites_loaded: sites.length,
    });
  });

  // Threshold webhook routes (/metrics, /thresholds)
  app.use("/", createThresholdRouter());

  // 404 catch-all
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  app.listen(PORT, () => {
    console.log(`[daemon] HTTP server listening on port ${PORT}`);
  });

  console.log("[daemon] All components started. Monitoring active.");
}

main().catch((err) => {
  console.error("[daemon] Fatal startup error:", err);
  process.exit(1);
});
