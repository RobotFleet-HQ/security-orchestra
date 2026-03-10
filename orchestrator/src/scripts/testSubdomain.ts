/**
 * Test script: runs the real subdomain_discovery workflow against example.com
 * and compares it against the old mock output.
 */

import { runSubdomainDiscovery, queryCertTransparency } from "../workflows/subdomain.js";

const TARGET = process.argv[2] ?? "example.com";

// ─── Old mock output (for comparison) ────────────────────────────────────────

const MOCK_RESULT = {
  subdomains: [
    `www.${TARGET}`, `api.${TARGET}`, `mail.${TARGET}`,
    `dev.${TARGET}`, `staging.${TARGET}`, `vpn.${TARGET}`,
  ],
  total: 6,
  sources: ["dns_bruteforce", "certificate_transparency", "shodan"],
  note: "Mock data — replace with real discovery tools",
};

// ─── Formatting helpers ───────────────────────────────────────────────────────

function bar(char = "─", width = 62) { return char.repeat(width); }

function printSection(title: string) {
  console.log(`\n${bar()}`);
  console.log(` ${title}`);
  console.log(bar());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSubdomain Discovery: mock vs real`);
  console.log(`Target: ${TARGET}`);

  // ── Step 1: Show mock ────────────────────────────────────────────────────
  printSection("BEFORE — Mock output (old hardcoded data)");
  console.log(`\n  Total subdomains : ${MOCK_RESULT.total}`);
  console.log(`  Sources claimed  : ${MOCK_RESULT.sources.join(", ")}`);
  console.log(`  Note             : ${MOCK_RESULT.note}`);
  console.log(`\n  Subdomains:`);
  for (const s of MOCK_RESULT.subdomains) {
    console.log(`    • ${s}  (no IPs — mock)`);
  }

  // ── Step 2: Run real implementation ─────────────────────────────────────
  printSection("AFTER — Real implementation (live DNS + crt.sh)");
  console.log(`\n  Running... (this may take 15-30s)`);
  console.log(`  Sources: certificate transparency (crt.sh) + DNS bruteforce`);

  const t0 = Date.now();
  let result;
  try {
    result = await runSubdomainDiscovery(TARGET);
  } catch (err) {
    console.error(`\n  FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const { subdomains, total, source_breakdown, sources_used, duration_ms, errors } = result.results;

  console.log(`\n  Completed in ${duration_ms}ms`);
  console.log(`  Total discovered : ${total}`);
  console.log(`  Sources used     : ${sources_used.join(", ")}`);
  console.log(`  Source breakdown :`);
  for (const [src, count] of Object.entries(source_breakdown)) {
    console.log(`    ${src.padEnd(22)} ${count}`);
  }
  if (errors.length) {
    console.log(`\n  Errors during scan:`);
    for (const e of errors) console.log(`    ! ${e}`);
  }

  if (total === 0) {
    console.log(`\n  No subdomains resolved. This is normal for domains with`);
    console.log(`  strict DNS configurations or if crt.sh returned no results.`);
  } else {
    console.log(`\n  Discovered subdomains:`);
    const colW = Math.max(...subdomains.map(s => s.subdomain.length)) + 2;
    for (const s of subdomains) {
      const ips = s.ips.join(", ");
      const srcBadges = s.sources.map(src =>
        src === "cert_transparency" ? "[CT]" : "[BF]"
      ).join("");
      console.log(`    • ${s.subdomain.padEnd(colW)} ${ips.padEnd(18)} ${srcBadges}`);
    }
  }

  // ── Step 3: Diff ─────────────────────────────────────────────────────────
  printSection("COMPARISON");

  const mockSet = new Set(MOCK_RESULT.subdomains);
  const realSet = new Set(subdomains.map(s => s.subdomain));

  const onlyInMock = [...mockSet].filter(s => !realSet.has(s));
  const onlyInReal = [...realSet].filter(s => !mockSet.has(s));
  const inBoth     = [...mockSet].filter(s => realSet.has(s));

  console.log(`\n  Mock total  : ${MOCK_RESULT.total} (all invented, 0 verified)`);
  console.log(`  Real total  : ${total} (all DNS-verified, real IPs)`);
  console.log(`\n  In mock but NOT real (fake subdomains) : ${onlyInMock.length}`);
  for (const s of onlyInMock) console.log(`    ✗  ${s}`);
  console.log(`\n  In real but NOT mock (genuinely found) : ${onlyInReal.length}`);
  for (const s of onlyInReal.slice(0, 20)) {
    const entry = subdomains.find(x => x.subdomain === s);
    console.log(`    +  ${s}  [${entry?.ips.join(", ")}]`);
  }
  if (onlyInReal.length > 20) {
    console.log(`    ... and ${onlyInReal.length - 20} more`);
  }
  if (inBoth.length) {
    console.log(`\n  In both mock and real                 : ${inBoth.length}`);
    for (const s of inBoth) {
      const entry = subdomains.find(x => x.subdomain === s);
      console.log(`    =  ${s}  [${entry?.ips.join(", ")}]`);
    }
  }

  // ── Step 4: Key differences ──────────────────────────────────────────────
  printSection("KEY DIFFERENCES");
  console.log(`
  Mock                           Real
  ─────────────────────────────  ─────────────────────────────────────
  Hardcoded list of 6 names      ${total} DNS-verified subdomains
  No IP addresses                Real IPv4 addresses for each host
  Fake sources (shodan etc.)     Actual sources: crt.sh + DNS resolve
  Instant (0ms)                  ${duration_ms}ms (live network queries)
  Same result every time         Changes as DNS / certs change
  Note says "Mock data"          Production-ready output
`);
}

main().catch(err => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
