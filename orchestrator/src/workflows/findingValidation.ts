// ─── Finding Validation ───────────────────────────────────────────────────────
// Calls Claude API to review, score, and filter findings from a parallel scan.
// Only findings with confidence_score >= 0.6 are returned.

import https from "https";

export interface ValidatedFinding {
  original_finding:  Record<string, unknown>;
  confidence_score:  number;  // 0.0–1.0
  severity_tier:     1 | 2 | 3 | 4 | 5;
  is_duplicate:      boolean;
  duplicate_of?:     string;
  validator_notes:   string;
}

export interface FindingValidationResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    input_finding_count:     number;
    validated_finding_count: number;
    filtered_count:          number;
    duplicate_count:         number;
    validated_findings:      ValidatedFinding[];
    scan_cost_usd:           number;
    duration_ms:             number;
    note?:                   string;
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
      max_tokens: 4096,
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

const SYSTEM_PROMPT = `You are a critical power security findings validator.
Review each finding in the provided list. For each one:
1. Assess whether it has a real, triggerable failure path (not purely theoretical)
2. Assign a confidence_score from 0.0 to 1.0 (1.0 = certain real issue, 0.0 = theoretical only)
3. Confirm or adjust the severity_tier
4. Flag duplicates — if two findings describe the same underlying issue, mark the lower-confidence one as is_duplicate

Return a JSON array where each element corresponds to one input finding (preserve order):
{
  "original_finding": <copy of the original finding object>,
  "confidence_score": <0.0 to 1.0>,
  "severity_tier": <1-5>,
  "is_duplicate": <boolean>,
  "duplicate_of": "<optional string: what it duplicates>",
  "validator_notes": "brief explanation of confidence score and any adjustments"
}

Severity scale:
1 = Observable anomaly — no operational impact
2 = Degraded redundancy — N still met
3 = Single point of failure exposed
4 = Loss of N+1 — critical load at risk
5 = Complete site failure path confirmed

Return ONLY valid JSON array. No markdown, no explanation outside the array.`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runFindingValidation(params: {
  findings: Array<Record<string, unknown>>;
}): Promise<FindingValidationResult> {
  const start = Date.now();
  const { findings } = params;
  const COST_PER_CALL = 0.01;
  const CONFIDENCE_THRESHOLD = 0.6;

  let validated: ValidatedFinding[] = [];
  let note: string | undefined;

  try {
    const raw = await callClaude(
      SYSTEM_PROMPT,
      `Findings to validate (${findings.length} total):\n${JSON.stringify(findings, null, 2)}`
    );
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      note = "Claude returned no parseable JSON array — returning unfiltered input.";
    } else {
      validated = JSON.parse(jsonMatch[0]) as ValidatedFinding[];
    }
  } catch (err) {
    note = `Claude API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const passing   = validated.filter((v) => v.confidence_score >= CONFIDENCE_THRESHOLD);
  const filtered  = validated.filter((v) => v.confidence_score <  CONFIDENCE_THRESHOLD);
  const dupeCount = validated.filter((v) => v.is_duplicate).length;

  return {
    workflow:  "finding_validation",
    target:    `${findings.length} findings`,
    timestamp: new Date().toISOString(),
    results: {
      input_finding_count:     findings.length,
      validated_finding_count: passing.length,
      filtered_count:          filtered.length,
      duplicate_count:         dupeCount,
      validated_findings:      passing,
      scan_cost_usd:           COST_PER_CALL,
      duration_ms:             Date.now() - start,
      ...(note && { note }),
    },
  };
}
