// ─── Infrastructure Ranker ────────────────────────────────────────────────────
// Scores and ranks site components by attack surface using the Mythos rubric.

export interface ComponentInput {
  name:                 string;
  type:                 string;
  manufacturer:         string;
  internet_exposed:     boolean;
  handles_unauth_input: boolean;
  has_known_cves:       boolean;
  is_passive:           boolean;
}

export interface RankedComponent extends ComponentInput {
  score:     number;  // 1–5
  rationale: string;
}

export interface InfrastructureRankerResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    site_name:         string;
    ranked_components: RankedComponent[];
    highest_score:     number;
    component_count:   number;
    duration_ms:       number;
  };
}

// ─── Scoring rubric ───────────────────────────────────────────────────────────

function scoreComponent(c: ComponentInput): { score: number; rationale: string } {
  let score = 2; // baseline
  const reasons: string[] = [];

  if (c.internet_exposed) {
    score += 2;
    reasons.push("internet-exposed (+2)");
  }
  if (c.handles_unauth_input) {
    score += 1;
    reasons.push("accepts unauthenticated input (+1)");
  }
  if (c.has_known_cves) {
    score += 2;
    reasons.push("known CVEs present (+2)");
  }
  if (c.is_passive) {
    score -= 2;
    reasons.push("passive component (-2)");
  }

  score = Math.min(5, Math.max(1, score));
  const rationale =
    reasons.length > 0
      ? `${c.name} (${c.type}) scored ${score}: ${reasons.join(", ")}.`
      : `${c.name} (${c.type}) scored ${score}: baseline, no modifying factors.`;

  return { score, rationale };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runInfrastructureRanker(params: {
  site_name:  string;
  components: ComponentInput[];
}): Promise<InfrastructureRankerResult> {
  const start = Date.now();
  const { site_name, components } = params;

  const ranked: RankedComponent[] = components
    .map((c) => {
      const { score, rationale } = scoreComponent(c);
      return { ...c, score, rationale };
    })
    .sort((a, b) => b.score - a.score);

  const highestScore = ranked.length > 0 ? ranked[0].score : 0;

  return {
    workflow:  "infrastructure_ranker",
    target:    site_name,
    timestamp: new Date().toISOString(),
    results: {
      site_name,
      ranked_components: ranked,
      highest_score:     highestScore,
      component_count:   ranked.length,
      duration_ms:       Date.now() - start,
    },
  };
}
