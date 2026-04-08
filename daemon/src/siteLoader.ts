// ─── Site loader ──────────────────────────────────────────────────────────────
// Syncs sites from DAEMON_SITES env var into the SQLite sites table on startup.

import { dbRun, dbAll } from "./database.js";
import { loadSitesFromEnv } from "./config.js";
import { SiteConfig } from "./types.js";

export async function syncSites(): Promise<SiteConfig[]> {
  const sites = loadSitesFromEnv();
  const now = new Date().toISOString();

  for (const site of sites) {
    await dbRun(
      `INSERT OR REPLACE INTO sites
         (id, name, components, claimed_tier, as_built_description, scan_interval_hours, contact_email, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        site.id,
        site.name,
        JSON.stringify(site.components),
        site.claimed_tier,
        site.as_built_description,
        site.scan_interval_hours ?? 24,
        site.contact_email,
        now,
      ]
    );
  }

  const rows = await dbAll<{
    id: string; name: string; components: string;
    claimed_tier: string; as_built_description: string;
    scan_interval_hours: number; contact_email: string;
  }>("SELECT * FROM sites", []);

  const loaded = rows.map((r) => ({
    ...r,
    components: JSON.parse(r.components) as SiteConfig["components"],
  }));

  console.log(`[siteLoader] ${loaded.length} site(s) loaded (${sites.length} from env, ${loaded.length - sites.length} from DB)`);
  return loaded;
}
