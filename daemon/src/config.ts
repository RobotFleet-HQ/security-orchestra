// ─── Environment config ────────────────────────────────────────────────────────

import { SiteConfig } from "./types.js";

export const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "https://security-orchestra-orchestrator.onrender.com";

export const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY ?? "";

export const DAEMON_DB_PATH = process.env.DAEMON_DB_PATH ?? "./daemon.db";

// node-cron expression for daily digest (default 06:00 UTC)
export const DIGEST_CRON = process.env.DIGEST_CRON ?? "0 6 * * *";

// How often to poll NVD + CISA KEV (minutes)
export const CVE_POLL_INTERVAL_MINUTES = parseInt(
  process.env.CVE_POLL_INTERVAL_MINUTES ?? "60",
  10
);

export const NVD_API_KEY = process.env.NVD_API_KEY ?? "";

export const GMAIL_USER =
  process.env.GMAIL_USER ?? "contact.securityorchestra@gmail.com";

export const PORT = parseInt(process.env.PORT ?? "3002", 10);

export const WEBHOOK_BEARER_TOKEN = process.env.WEBHOOK_BEARER_TOKEN ?? "";

// ─── Site loader ──────────────────────────────────────────────────────────────

const DEFAULT_SITES: SiteConfig[] = [
  {
    id:                   "site-001",
    name:                 "Test Site",
    contact_email:        "contact.securityorchestra@gmail.com",
    components:           [],
    claimed_tier:         "free",
    as_built_description: "Default test site",
    scan_interval_hours:  24,
  },
];

function sanitizeSitesJson(raw: string): string {
  return raw
    .trim()
    // Strip newlines, carriage returns, and tabs
    .replace(/[\n\r\t]/g, "")
    // Replace smart/curly quotes with straight equivalents
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

export function loadSitesFromEnv(): SiteConfig[] {
  const raw = process.env.DAEMON_SITES;
  if (!raw?.trim()) {
    console.log("[config] DAEMON_SITES parse failed — using default test site");
    return DEFAULT_SITES;
  }
  try {
    const parsed = JSON.parse(sanitizeSitesJson(raw)) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn("[config] DAEMON_SITES is not a JSON array — using default test site");
      return DEFAULT_SITES;
    }
    return parsed as SiteConfig[];
  } catch (err) {
    console.warn("[config] DAEMON_SITES parse failed — using default test site:", (err as Error).message);
    return DEFAULT_SITES;
  }
}

// Guard: warn at startup if critical vars are missing
export function validateConfig(): void {
  if (!ORCHESTRATOR_API_KEY) {
    console.warn("[config] ORCHESTRATOR_API_KEY not set — orchestrator calls will fail auth");
  }
  if (!WEBHOOK_BEARER_TOKEN) {
    console.warn("[config] WEBHOOK_BEARER_TOKEN not set — webhook endpoint is unauthenticated");
  }
  if (!process.env.GMAIL_APP_PASSWORD) {
    console.warn("[config] GMAIL_APP_PASSWORD not set — daily digest emails will fail");
  }
}
