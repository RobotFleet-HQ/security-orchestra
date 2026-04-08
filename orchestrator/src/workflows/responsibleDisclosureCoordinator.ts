// ─── Responsible Disclosure Coordinator ──────────────────────────────────────
// Generates commitment hashes for validated findings and produces a structured
// 90-day disclosure package for responsible disclosure coordination.

import crypto from "crypto";

export type DisclosureStatus = "pending" | "disclosed" | "patched";

export interface DisclosureFindingEntry {
  finding:              Record<string, unknown>;
  commitment_hash:      string;   // SHA-256(finding JSON + disclosure_date + site_contact)
  disclosure_deadline:  string;   // ISO 8601 — disclosure_date + 90 days
  disclosure_status:    DisclosureStatus;
}

export interface SeveritySummary {
  tier_1: number;
  tier_2: number;
  tier_3: number;
  tier_4: number;
  tier_5: number;
}

export interface ResponsibleDisclosureCoordinatorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    site_contact:       string;
    disclosure_date:    string;
    disclosure_deadline: string;
    total_findings:     number;
    severity_summary:   SeveritySummary;
    disclosure_package: DisclosureFindingEntry[];
    duration_ms:        number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeCommitmentHash(
  finding:         Record<string, unknown>,
  disclosureDate:  string,
  siteContact:     string
): string {
  const payload = JSON.stringify(finding) + disclosureDate + siteContact;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildSeveritySummary(findings: Array<Record<string, unknown>>): SeveritySummary {
  const summary: SeveritySummary = { tier_1: 0, tier_2: 0, tier_3: 0, tier_4: 0, tier_5: 0 };
  for (const f of findings) {
    const tier = Number(f["severity_tier"] ?? f["combined_severity_tier"] ?? 0);
    if (tier === 1) summary.tier_1++;
    else if (tier === 2) summary.tier_2++;
    else if (tier === 3) summary.tier_3++;
    else if (tier === 4) summary.tier_4++;
    else if (tier === 5) summary.tier_5++;
  }
  return summary;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runResponsibleDisclosureCoordinator(params: {
  findings:         Array<Record<string, unknown>>;
  site_contact:     string;
  disclosure_date:  string;  // ISO 8601
}): Promise<ResponsibleDisclosureCoordinatorResult> {
  const start = Date.now();
  const { findings, site_contact, disclosure_date } = params;

  const deadline = addDays(disclosure_date, 90);

  const disclosurePackage: DisclosureFindingEntry[] = findings.map((finding) => ({
    finding,
    commitment_hash:     computeCommitmentHash(finding, disclosure_date, site_contact),
    disclosure_deadline: deadline,
    disclosure_status:   "pending" as DisclosureStatus,
  }));

  const severitySummary = buildSeveritySummary(findings);

  return {
    workflow:  "responsible_disclosure_coordinator",
    target:    site_contact,
    timestamp: new Date().toISOString(),
    results: {
      site_contact,
      disclosure_date,
      disclosure_deadline: deadline,
      total_findings:      findings.length,
      severity_summary:    severitySummary,
      disclosure_package:  disclosurePackage,
      duration_ms:         Date.now() - start,
    },
  };
}
