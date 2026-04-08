// ─── Parallel Scan Orchestrator ───────────────────────────────────────────────
// Fans out configVulnHunter + complianceGapDetector concurrently across the
// top-N components from infrastructureRanker output, collects, deduplicates,
// and ranks all findings by severity_tier.

import { runConfigVulnHunter, ConfigFinding } from "./configVulnHunter.js";
import { runComplianceGapDetector, ComplianceGap } from "./complianceGapDetector.js";
import { RankedComponent } from "./infrastructureRanker.js";

export type ScanDepth = "quick" | "standard" | "deep";

const DEPTH_COMPONENT_LIMIT: Record<ScanDepth, number> = {
  quick:    3,
  standard: 5,
  deep:     Infinity,
};

// ─── Unified finding type for merged output ───────────────────────────────────

export interface MergedFinding {
  component_name:    string;
  source:            "config_vuln" | "compliance_gap";
  severity_tier:     1 | 2 | 3 | 4 | 5;
  finding_type:      string;  // misconfiguration_type or standard_reference
  detail:            string;  // impact or claimed vs actual
  remediation?:      string;
}

export interface ParallelScanOrchestratorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    site_name:          string;
    scan_depth:         ScanDepth;
    components_scanned: number;
    total_findings:     number;
    merged_findings:    MergedFinding[];
    scan_cost_usd:      number;
    duration_ms:        number;
    note?:              string;
  };
}

// ─── Deduplication key ────────────────────────────────────────────────────────

function dedupeKey(component_name: string, finding_type: string): string {
  return `${component_name.toLowerCase()}::${finding_type.toLowerCase()}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runParallelScanOrchestrator(params: {
  site_name:          string;
  ranked_components:  RankedComponent[];
  scan_depth:         ScanDepth;
}): Promise<ParallelScanOrchestratorResult> {
  const start = Date.now();
  const { site_name, ranked_components, scan_depth } = params;

  const limit     = DEPTH_COMPONENT_LIMIT[scan_depth];
  const selected  = ranked_components.slice(0, Math.min(ranked_components.length, limit));
  const notes: string[] = [];

  // ── Fan out: configVulnHunter + complianceGapDetector for each component ──
  const scanJobs = selected.map((component) =>
    Promise.allSettled([
      runConfigVulnHunter({
        component_name: component.name,
        component_type: component.type,
        config_data:    `Manufacturer: ${component.manufacturer}. Component type: ${component.type}.`,
        manufacturer:   component.manufacturer,
      }),
      runComplianceGapDetector({
        site_name,
        claimed_tier:           "Tier III",   // default; callers may override via chain params
        as_built_description:   `${component.name} (${component.type}) by ${component.manufacturer}.`,
        standards:              ["NFPA 110", "Uptime Institute Tier III", "ANSI/TIA-942"],
      }),
    ])
  );

  const allJobResults = await Promise.allSettled(scanJobs);

  // ── Collect and normalize findings ────────────────────────────────────────
  const rawFindings: MergedFinding[] = [];
  let totalScanCost = 0;

  allJobResults.forEach((jobResult, idx) => {
    const component = selected[idx];

    if (jobResult.status === "rejected") {
      notes.push(`Component "${component.name}" scan failed: ${String(jobResult.reason)}`);
      return;
    }

    const [configResult, complianceResult] = jobResult.value;

    // Config vulnerability findings
    if (configResult.status === "fulfilled") {
      totalScanCost += configResult.value.results.scan_cost_usd;
      for (const f of (configResult.value.results.findings as ConfigFinding[])) {
        rawFindings.push({
          component_name: component.name,
          source:         "config_vuln",
          severity_tier:  f.severity_tier,
          finding_type:   f.misconfiguration_type,
          detail:         f.impact,
          remediation:    f.remediation,
        });
      }
    } else {
      notes.push(`configVulnHunter failed for "${component.name}": ${String(configResult.reason)}`);
    }

    // Compliance gap findings
    if (complianceResult.status === "fulfilled") {
      totalScanCost += complianceResult.value.results.scan_cost_usd;
      for (const g of (complianceResult.value.results.gaps as ComplianceGap[])) {
        rawFindings.push({
          component_name: component.name,
          source:         "compliance_gap",
          severity_tier:  g.severity_tier,
          finding_type:   g.standard_reference,
          detail:         `Claimed: ${g.claimed} | Actual: ${g.actual}`,
        });
      }
    } else {
      notes.push(`complianceGapDetector failed for "${component.name}": ${String(complianceResult.reason)}`);
    }
  });

  // ── Deduplicate by (component_name + finding_type) ─────────────────────────
  const seen = new Set<string>();
  const dedupedFindings: MergedFinding[] = [];
  for (const f of rawFindings) {
    const key = dedupeKey(f.component_name, f.finding_type);
    if (!seen.has(key)) {
      seen.add(key);
      dedupedFindings.push(f);
    }
  }

  // ── Sort by severity_tier descending ──────────────────────────────────────
  dedupedFindings.sort((a, b) => b.severity_tier - a.severity_tier);

  return {
    workflow:  "parallel_scan_orchestrator",
    target:    site_name,
    timestamp: new Date().toISOString(),
    results: {
      site_name,
      scan_depth,
      components_scanned: selected.length,
      total_findings:     dedupedFindings.length,
      merged_findings:    dedupedFindings,
      scan_cost_usd:      totalScanCost,
      duration_ms:        Date.now() - start,
      ...(notes.length > 0 && { note: notes.join(" | ") }),
    },
  };
}
