// ─── Compliance Gap Detector ──────────────────────────────────────────────────
// Calls Claude API to compare claimed tier/compliance against as-built
// architecture and identify every gap between claimed and actual.

import https from "https";

export interface ComplianceGap {
  standard_reference: string;
  claimed:            string;
  actual:             string;
  severity_tier:      1 | 2 | 3 | 4 | 5;
}

export interface ComplianceGapDetectorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    site_name:       string;
    claimed_tier:    string;
    standards:       string[];
    gaps:            ComplianceGap[];
    gap_count:       number;
    highest_severity: number;
    scan_cost_usd:   number;
    duration_ms:     number;
    note?:           string;
  };
}

// ─── Claude API helper ────────────────────────────────────────────────────────

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  error?:  { message: string };
}

function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    const body = JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userMessage }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path:     "/v1/messages",
        method:   "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
          "User-Agent":        "SecurityOrchestraAgent/1.0",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const parsed = JSON.parse(raw) as AnthropicResponse;
            if (parsed.error) { reject(new Error(parsed.error.message)); return; }
            const text = parsed.content?.find((b) => b.type === "text")?.text ?? "";
            resolve(text);
          } catch (e) {
            reject(new Error(`Invalid JSON from Anthropic API: ${raw.substring(0, 200)}`));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const SYSTEM_PROMPT = `You are a compliance gap analyst specializing in data centers and critical power infrastructure.
Your task is to compare a site's claimed tier and standards compliance against its actual as-built architecture.
Find every delta between what is claimed and what the architecture can actually support.

Standards to check include (but are not limited to): Uptime Institute Tier I–IV, ANSI/TIA-942, NFPA 110, NEC, ASHRAE TC 9.9, ISO/IEC 24764.

For each gap found, respond with a JSON array.
Each gap MUST have these exact fields:
{
  "standard_reference": "e.g. Uptime Institute Tier III §3.2",
  "claimed": "what the site claims to provide",
  "actual": "what the architecture actually provides",
  "severity_tier": <integer 1-5>
}

Severity scale:
1 = Observable anomaly — no operational impact
2 = Degraded redundancy — N still met
3 = Single point of failure exposed
4 = Loss of N+1 — critical load at risk
5 = Complete site failure path confirmed

Return ONLY valid JSON array. No markdown, no explanation outside the array.
If no gaps found, return [].`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runComplianceGapDetector(params: {
  site_name:           string;
  claimed_tier:        string;
  as_built_description: string;
  standards:           string[];
}): Promise<ComplianceGapDetectorResult> {
  const start = Date.now();
  const { site_name, claimed_tier, as_built_description, standards } = params;
  const COST_PER_CALL = 0.01;

  const userMessage =
    `Site: ${site_name}\n` +
    `Claimed Tier: ${claimed_tier}\n` +
    `Standards to verify: ${standards.join(", ")}\n\n` +
    `As-built architecture description:\n${as_built_description}`;

  let gaps: ComplianceGap[] = [];
  let note: string | undefined;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userMessage);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      note = "Claude returned no parseable JSON array — treating as zero gaps.";
    } else {
      gaps = JSON.parse(jsonMatch[0]) as ComplianceGap[];
    }
  } catch (err) {
    note = `Claude API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const highest = gaps.reduce((max, g) => Math.max(max, g.severity_tier ?? 0), 0);

  return {
    workflow:  "compliance_gap_detector",
    target:    site_name,
    timestamp: new Date().toISOString(),
    results: {
      site_name,
      claimed_tier,
      standards,
      gaps,
      gap_count:        gaps.length,
      highest_severity: highest,
      scan_cost_usd:    COST_PER_CALL,
      duration_ms:      Date.now() - start,
      ...(note && { note }),
    },
  };
}
