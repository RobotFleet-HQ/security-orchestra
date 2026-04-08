// ─── Cron scheduler ───────────────────────────────────────────────────────────
// Runs mythos-quick-scan on each site according to scan_interval_hours.
// Uses node-cron running every hour; each tick checks whether each site
// is due for a scan based on last ran_at in scan_results.

import cron from "node-cron";
import { dbGet, dbRun } from "./database.js";
import { callChain } from "./orchestratorClient.js";
import { SiteConfig } from "./types.js";

interface LastScan { ran_at: string }

async function isDue(site: SiteConfig): Promise<boolean> {
  const last = await dbGet<LastScan>(
    "SELECT ran_at FROM scan_results WHERE site_id = ? ORDER BY ran_at DESC LIMIT 1",
    [site.id]
  );
  if (!last) return true;
  const elapsedMs = Date.now() - new Date(last.ran_at).getTime();
  const intervalMs = site.scan_interval_hours * 60 * 60 * 1000;
  return elapsedMs >= intervalMs;
}

async function runScan(site: SiteConfig): Promise<void> {
  const ranAt = new Date().toISOString();
  console.log(`[scheduler] Starting scan for site: ${site.name} (${site.id})`);

  const result = await callChain("mythos-quick-scan", {
    site_name:            site.name,
    components:           JSON.stringify(site.components),
    scan_depth:           "quick",
    claimed_tier:         site.claimed_tier,
    as_built_description: site.as_built_description,
  });

  if (result.ok) {
    await dbRun(
      "INSERT INTO scan_results (site_id, ran_at, status, findings) VALUES (?, ?, ?, ?)",
      [site.id, ranAt, "success", JSON.stringify(result.raw)]
    );
    console.log(`[scheduler] Scan OK for ${site.name} — steps_completed: ${result.steps_completed ?? "?"}`);
  } else {
    await dbRun(
      "INSERT INTO scan_results (site_id, ran_at, status, error) VALUES (?, ?, ?, ?)",
      [site.id, ranAt, "error", result.error ?? "unknown error"]
    );
    console.warn(`[scheduler] Scan FAILED for ${site.name}: ${result.error}`);
  }
}

export function startScheduler(sites: SiteConfig[]): void {
  if (sites.length === 0) {
    console.log("[scheduler] No sites configured — skipping scheduler");
    return;
  }

  // Check every 15 minutes whether any site is due
  cron.schedule("*/15 * * * *", async () => {
    for (const site of sites) {
      try {
        if (await isDue(site)) {
          await runScan(site);
        }
      } catch (err) {
        console.error(`[scheduler] Unhandled error for site ${site.id}:`, (err as Error).message);
      }
    }
  });

  console.log(`[scheduler] Started — watching ${sites.length} site(s), checking every 15 min`);
}
