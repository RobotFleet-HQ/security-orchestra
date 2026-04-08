// ─── Mythos Severity Tiers ────────────────────────────────────────────────────
// Five-tier classification for data center security findings.
// Tier 1 = lowest impact, Tier 5 = full site failure path confirmed.

export type SeverityTier = 1 | 2 | 3 | 4 | 5;

export const SEVERITY_TIERS: Record<SeverityTier, string> = {
  1: "Observable anomaly — no operational impact",
  2: "Degraded redundancy — N still met",
  3: "Single point of failure exposed",
  4: "Loss of N+1 — critical load at risk",
  5: "Complete site failure path confirmed with PoC",
};

/**
 * Returns the highest severity tier present in a findings array.
 * Each finding must have a numeric `severity` field (1–5).
 * Returns undefined if the array is empty or no valid tiers are found.
 */
export function scoreSeverity(
  findings: Array<{ severity?: unknown }>
): SeverityTier | undefined {
  let highest: SeverityTier | undefined;
  for (const f of findings) {
    const s = Number(f.severity);
    if (s >= 1 && s <= 5 && Number.isInteger(s)) {
      if (highest === undefined || s > highest) {
        highest = s as SeverityTier;
      }
    }
  }
  return highest;
}
