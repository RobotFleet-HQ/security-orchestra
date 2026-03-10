import dns from "dns";

const dnsResolve = dns.promises;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredSubdomain {
  subdomain: string;
  ips:       string[];
  sources:   string[];
}

export interface SubdomainDiscoveryResult {
  workflow:   string;
  target:     string;
  timestamp:  string;
  results: {
    subdomains:        DiscoveredSubdomain[];
    total:             number;
    sources_used:      string[];
    source_breakdown:  Record<string, number>;
    duration_ms:       number;
    errors:            string[];
  };
}

// ─── Wordlist ─────────────────────────────────────────────────────────────────
// Common subdomain prefixes used in bruteforce enumeration.

const WORDLIST = [
  // Web / app
  "www", "web", "app", "m", "mobile", "portal", "dashboard",
  // APIs & services
  "api", "api2", "v1", "v2", "rest", "graphql", "ws", "gateway",
  // Infrastructure
  "cdn", "static", "assets", "img", "images", "media", "files",
  "s3", "storage", "upload", "download",
  // Auth & admin
  "admin", "panel", "manage", "login", "auth", "sso", "id",
  "accounts", "account", "user", "users",
  // Mail
  "mail", "smtp", "imap", "pop", "pop3", "webmail", "mx",
  // DNS
  "ns", "ns1", "ns2", "ns3", "dns", "dns1", "dns2",
  // Dev / CI
  "dev", "develop", "development", "staging", "stage",
  "test", "testing", "qa", "uat", "sandbox", "demo",
  "beta", "alpha", "preview", "canary",
  "git", "gitlab", "github", "ci", "build", "jenkins", "deploy",
  // Comms / support
  "blog", "forum", "community", "wiki", "docs", "help", "support",
  "status", "monitor", "metrics", "analytics",
  // Connectivity
  "vpn", "remote", "proxy", "lb", "edge",
  // Databases (internal-facing but sometimes exposed)
  "db", "database", "mysql", "pg", "postgres", "redis", "elastic",
  // Business / infra
  "shop", "store", "pay", "payment", "checkout", "cart",
  "internal", "intranet", "corp", "office",
  // Regions / multi-tenant
  "eu", "us", "uk", "au", "asia", "us-east", "us-west",
  // Versioned / misc
  "old", "new", "legacy", "beta2", "v3",
];

// ─── Certificate Transparency (crt.sh) ───────────────────────────────────────

interface CrtShEntry {
  name_value: string;
}

/**
 * Query crt.sh for all certificates ever issued for *.domain and domain.
 * Returns unique, validated subdomain strings (no wildcards).
 */
export async function queryCertTransparency(domain: string): Promise<string[]> {
  const url = `https://crt.sh/?q=%.${domain}&output=json`;

  let data: CrtShEntry[];
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "security-orchestra/1.0 (cert transparency lookup)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json() as CrtShEntry[];
  } catch (err) {
    throw new Error(`crt.sh query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const seen = new Set<string>();

  for (const entry of data) {
    // name_value may contain multiple newline-separated names
    for (const raw of entry.name_value.split("\n")) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      if (name.startsWith("*")) continue;                        // skip wildcards
      if (name === domain) continue;                            // skip apex
      if (!name.endsWith(`.${domain}`)) continue;               // must be a subdomain
      seen.add(name);
    }
  }

  return [...seen];
}

// ─── DNS resolution helpers ──────────────────────────────────────────────────

/**
 * Attempt to resolve a hostname to IPv4 addresses.
 * Returns the address list on success, null if the hostname does not exist.
 */
async function resolveHost(hostname: string): Promise<string[] | null> {
  try {
    return await dnsResolve.resolve4(hostname);
  } catch {
    return null;
  }
}

/**
 * Resolve a list of hostnames concurrently, at most `concurrency` at a time.
 */
async function resolveAll(
  hostnames: string[],
  concurrency = 20
): Promise<Map<string, string[]>> {
  const resolved = new Map<string, string[]>();

  for (let i = 0; i < hostnames.length; i += concurrency) {
    const batch = hostnames.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (h) => ({ host: h, ips: await resolveHost(h) }))
    );
    for (const { host, ips } of results) {
      if (ips !== null) resolved.set(host, ips);
    }
  }

  return resolved;
}

// ─── Bruteforce ───────────────────────────────────────────────────────────────

/**
 * Try each word in WORDLIST as a subdomain prefix and resolve via DNS.
 */
async function bruteforceSubdomains(
  domain: string
): Promise<DiscoveredSubdomain[]> {
  const candidates = WORDLIST.map((w) => `${w}.${domain}`);
  const resolved   = await resolveAll(candidates, 20);

  return [...resolved.entries()].map(([subdomain, ips]) => ({
    subdomain,
    ips,
    sources: ["bruteforce"],
  }));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runSubdomainDiscovery(
  domain: string
): Promise<SubdomainDiscoveryResult> {
  const t0     = Date.now();
  const errors: string[] = [];

  // ── 1. Certificate transparency ──────────────────────────────────────────
  let ctNames: string[] = [];
  try {
    ctNames = await queryCertTransparency(domain);
  } catch (err) {
    errors.push(`cert_transparency: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. Resolve CT names ───────────────────────────────────────────────────
  const ctResolved = await resolveAll(ctNames, 20);

  // ── 3. Bruteforce ─────────────────────────────────────────────────────────
  const bfResults = await bruteforceSubdomains(domain);

  // ── 4. Merge — union keyed by subdomain, accumulate sources ──────────────
  const merged = new Map<string, DiscoveredSubdomain>();

  // Add CT results
  for (const [subdomain, ips] of ctResolved.entries()) {
    merged.set(subdomain, { subdomain, ips, sources: ["cert_transparency"] });
  }

  // Merge bruteforce results (may overlap with CT)
  for (const bf of bfResults) {
    const existing = merged.get(bf.subdomain);
    if (existing) {
      if (!existing.sources.includes("bruteforce")) existing.sources.push("bruteforce");
    } else {
      merged.set(bf.subdomain, bf);
    }
  }

  // ── 5. Sort: multi-source first, then alphabetical ────────────────────────
  const subdomains = [...merged.values()].sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return a.subdomain.localeCompare(b.subdomain);
  });

  // ── 6. Build source breakdown ─────────────────────────────────────────────
  const breakdown: Record<string, number> = {
    cert_transparency: 0,
    bruteforce: 0,
  };
  for (const s of subdomains) {
    for (const src of s.sources) {
      breakdown[src] = (breakdown[src] ?? 0) + 1;
    }
  }

  const sourcesUsed = Object.entries(breakdown)
    .filter(([, n]) => n > 0)
    .map(([src]) => src);

  return {
    workflow:  "subdomain_discovery",
    target:    domain,
    timestamp: new Date().toISOString(),
    results: {
      subdomains,
      total:            subdomains.length,
      sources_used:     sourcesUsed,
      source_breakdown: breakdown,
      duration_ms:      Date.now() - t0,
      errors,
    },
  };
}
