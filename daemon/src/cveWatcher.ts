// ─── CVE Watcher ──────────────────────────────────────────────────────────────
// Polls NVD (NIST) and CISA KEV for new ICS/SCADA CVEs.
// Deduplicates by cve_id in SQLite, then fires ics-scada-cve-intelligence
// via the orchestrator for any new ICS-relevant CVE.

import https from "https";
import { dbGet, dbRun, dbAll } from "./database.js";
import { callWorkflow } from "./orchestratorClient.js";
import { NVD_API_KEY, CVE_POLL_INTERVAL_MINUTES } from "./config.js";
import { SiteConfig } from "./types.js";
import { CveRow } from "./types.js";

// ─── ICS keyword pre-filter ───────────────────────────────────────────────────
const ICS_KEYWORDS = [
  "scada", "ics", "plc", "modbus", "dnp3", "iec 61850",
  "schneider", "siemens", "abb power", "cummins", "caterpillar emcp",
  "comap", "basler electric", "sel-", "powercommand", "inteligen",
  "ecostruxure", "sicam", "siprotec",
];

function isIcsScada(text: string): boolean {
  const lower = text.toLowerCase();
  return ICS_KEYWORDS.some((k) => lower.includes(k));
}

// ─── NVD API ──────────────────────────────────────────────────────────────────

interface NvdCveItem {
  cve: {
    id:           string;
    published:    string;
    descriptions: Array<{ lang: string; value: string }>;
    metrics?: {
      cvssMetricV31?: Array<{ cvssData: { baseScore: number } }>;
      cvssMetricV30?: Array<{ cvssData: { baseScore: number } }>;
    };
  };
}

interface NvdResponse {
  vulnerabilities?: NvdCveItem[];
  totalResults?:    number;
}

// ─── NVD backoff helper ───────────────────────────────────────────────────────
const NVD_BACKOFF_BASE_MS  = 60_000;  // 60 s base on first 429
const NVD_BACKOFF_MAX_MS   = 900_000; // 15 min cap
const NVD_MAX_RETRIES      = 4;

function nvdBackoffMs(attempt: number): number {
  const base  = NVD_BACKOFF_BASE_MS * Math.pow(2, attempt);
  const capped = Math.min(base, NVD_BACKOFF_MAX_MS);
  // ±20% jitter
  return Math.round(capped * (0.8 + Math.random() * 0.4));
}

function getNvdRaw(pubStartDate: string, pubEndDate: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      pubStartDate, pubEndDate,
      resultsPerPage: "100",
      keywordSearch:  "ICS SCADA industrial control",
    });
    const headers: Record<string, string> = {
      "User-Agent": "SecurityOrchestraDaemon/1.0",
    };
    if (NVD_API_KEY) headers["apiKey"] = NVD_API_KEY;

    const req = https.request(
      {
        hostname: "services.nvd.nist.gov",
        path:     `/rest/json/cves/2.0?${params.toString()}`,
        method:   "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function getNvd(pubStartDate: string, pubEndDate: string): Promise<NvdResponse> {
  for (let attempt = 0; attempt <= NVD_MAX_RETRIES; attempt++) {
    const { status, body } = await getNvdRaw(pubStartDate, pubEndDate);

    if (status === 200) {
      try {
        return JSON.parse(body) as NvdResponse;
      } catch {
        throw new Error("NVD response parse failed");
      }
    }

    if (status === 429 || status === 503) {
      if (attempt === NVD_MAX_RETRIES) {
        throw new Error(`NVD rate limited after ${NVD_MAX_RETRIES} retries (HTTP ${status})`);
      }
      const delay = nvdBackoffMs(attempt);
      console.warn(`[cveWatcher] NVD HTTP ${status} — retry ${attempt + 1}/${NVD_MAX_RETRIES} in ${Math.round(delay / 1000)}s`);
      await new Promise<void>((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`NVD unexpected HTTP ${status}: ${body.substring(0, 200)}`);
  }
  throw new Error("NVD: exhausted retries");
}

// ─── CISA KEV API ─────────────────────────────────────────────────────────────

interface KevEntry {
  cveID:          string;
  dateAdded:      string;
  shortDescription: string;
  vulnerabilityName: string;
}

interface KevCatalog {
  vulnerabilities: KevEntry[];
}

function getCisaKev(): Promise<KevCatalog> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.cisa.gov",
        path:     "/sites/default/files/feeds/known_exploited_vulnerabilities.json",
        method:   "GET",
        headers:  { "User-Agent": "SecurityOrchestraDaemon/1.0" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as KevCatalog);
          } catch (e) {
            reject(new Error("CISA KEV response parse failed"));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ─── Fire agent for new ICS CVEs ──────────────────────────────────────────────

async function fireIcsCveAgent(newCves: CveRow[], sites: SiteConfig[]): Promise<void> {
  // Build installed_equipment list from all site components
  const equipment = sites.flatMap((s) =>
    s.components.map((c) => ({
      manufacturer:    c.manufacturer,
      model:           c.name,
      firmware_version: "unknown",
    }))
  );

  if (equipment.length === 0) {
    console.log("[cveWatcher] No equipment to scan — skipping agent call");
    return;
  }

  console.log(`[cveWatcher] Firing ics-scada-cve-intelligence for ${newCves.length} new CVE(s)`);
  const result = await callWorkflow("ics-scada-cve-intelligence", {
    installed_equipment: JSON.stringify(equipment),
  });

  const firedAt = new Date().toISOString();
  for (const cve of newCves) {
    await dbRun("UPDATE cve_records SET fired_at = ? WHERE cve_id = ?", [firedAt, cve.cve_id]);
  }

  if (result.ok) {
    console.log("[cveWatcher] ics-scada-cve-intelligence completed successfully");
  } else {
    console.warn("[cveWatcher] ics-scada-cve-intelligence failed:", result.error);
  }
}

// ─── Poll cycle ───────────────────────────────────────────────────────────────

async function pollNvd(): Promise<number> {
  // Look back 2× the poll interval to avoid missing CVEs near window boundaries
  const lookbackMs = CVE_POLL_INTERVAL_MINUTES * 2 * 60 * 1000;
  const endDate    = new Date();
  const startDate  = new Date(endDate.getTime() - lookbackMs);
  const fmt        = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "+00:00");

  let newCount = 0;
  try {
    const nvd = await getNvd(fmt(startDate), fmt(endDate));
    for (const item of nvd.vulnerabilities ?? []) {
      const { id, published, descriptions, metrics } = item.cve;
      const desc = descriptions.find((d) => d.lang === "en")?.value ?? "";
      if (!isIcsScada(desc + " " + id)) continue;

      const existing = await dbGet<{ cve_id: string }>(
        "SELECT cve_id FROM cve_records WHERE cve_id = ?", [id]
      );
      if (existing) continue;

      const cvss =
        metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ??
        metrics?.cvssMetricV30?.[0]?.cvssData.baseScore ??
        null;

      await dbRun(
        `INSERT INTO cve_records (cve_id, source, published_at, description, cvss_score, is_ics_scada, raw_json)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [id, "nvd", published, desc.substring(0, 500), cvss, JSON.stringify(item)]
      );
      newCount++;
    }
  } catch (err) {
    console.warn("[cveWatcher] NVD poll error:", (err as Error).message);
  }
  return newCount;
}

async function pollCisaKev(): Promise<number> {
  let newCount = 0;
  try {
    const kev = await getCisaKev();
    // Only process entries added in the last 7 days to avoid seeding the full catalog
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const entry of kev.vulnerabilities) {
      if (entry.dateAdded < cutoff) continue;
      const desc = entry.shortDescription + " " + entry.vulnerabilityName;
      if (!isIcsScada(desc + " " + entry.cveID)) continue;

      const existing = await dbGet<{ cve_id: string }>(
        "SELECT cve_id FROM cve_records WHERE cve_id = ?", [entry.cveID]
      );
      if (existing) continue;

      await dbRun(
        `INSERT INTO cve_records (cve_id, source, published_at, description, cvss_score, is_ics_scada, raw_json)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [entry.cveID, "cisa_kev", entry.dateAdded, desc.substring(0, 500), null, JSON.stringify(entry)]
      );
      newCount++;
    }
  } catch (err) {
    console.warn("[cveWatcher] CISA KEV poll error:", (err as Error).message);
  }
  return newCount;
}

export async function pollCves(sites: SiteConfig[]): Promise<void> {
  const nvdNew = await pollNvd();
  const kevNew = await pollCisaKev();
  const total  = nvdNew + kevNew;

  if (total === 0) {
    console.log("[cveWatcher] Poll complete — no new ICS/SCADA CVEs");
    return;
  }

  console.log(`[cveWatcher] ${total} new CVE(s) found (NVD: ${nvdNew}, KEV: ${kevNew})`);

  const unfired = await dbAll<CveRow>(
    "SELECT * FROM cve_records WHERE is_ics_scada = 1 AND fired_at IS NULL",
    []
  );
  if (unfired.length > 0 && sites.length > 0) {
    await fireIcsCveAgent(unfired, sites);
  }
}

export function startCveWatcher(sites: SiteConfig[]): void {
  // Run once immediately, then on interval
  pollCves(sites).catch((e) =>
    console.error("[cveWatcher] Initial poll error:", (e as Error).message)
  );

  setInterval(
    () => pollCves(sites).catch((e) =>
      console.error("[cveWatcher] Poll error:", (e as Error).message)
    ),
    CVE_POLL_INTERVAL_MINUTES * 60 * 1000
  );

  console.log(`[cveWatcher] Started — polling every ${CVE_POLL_INTERVAL_MINUTES} min`);
}
