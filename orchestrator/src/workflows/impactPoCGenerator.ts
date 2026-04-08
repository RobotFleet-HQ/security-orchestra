// ─── Impact PoC Generator ─────────────────────────────────────────────────────
// Calls Claude API to generate a specific reproducible failure scenario for a
// given finding. DEFENSIVE ONLY — describes failure conditions, not attack paths.

import https from "https";

export interface ImpactPoC {
  scenario_narrative:         string;
  trigger_steps:              string[];
  affected_systems:           string[];
  estimated_downtime_minutes: number;
  affected_load_kw:           number;
  severity_tier:              1 | 2 | 3 | 4 | 5;
}

export interface ImpactPoCGeneratorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    finding_summary: string;
    poc:             ImpactPoC | null;
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

const SYSTEM_PROMPT = `You are a critical power failure scenario specialist focused on DEFENSIVE analysis.
Your role is to help facility engineers understand what operational failures look like so they can
prepare, train, and prevent them. You describe failure conditions — never attack instructions.

Given a security or compliance finding, generate a specific reproducible failure scenario
that a facilities engineer could use for tabletop exercises and resilience planning.

Return a single JSON object (not an array) with these exact fields:
{
  "scenario_narrative": "one paragraph describing the failure sequence in operational terms",
  "trigger_steps": ["step 1 — what condition must exist", "step 2 — what event occurs", "..."],
  "affected_systems": ["UPS A", "Generator 1", "..."],
  "estimated_downtime_minutes": <number>,
  "affected_load_kw": <number>,
  "severity_tier": <integer 1-5>
}

Severity scale:
1 = Observable anomaly — no operational impact
2 = Degraded redundancy — N still met
3 = Single point of failure exposed
4 = Loss of N+1 — critical load at risk
5 = Complete site failure path confirmed

Return ONLY valid JSON object. No markdown, no explanation outside the object.`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runImpactPoCGenerator(params: {
  finding:       Record<string, unknown>;
  site_context:  string;
}): Promise<ImpactPoCGeneratorResult> {
  const start = Date.now();
  const { finding, site_context } = params;
  const COST_PER_CALL = 0.01;

  const findingSummary =
    (finding["misconfiguration_type"] as string) ??
    (finding["standard_reference"] as string) ??
    JSON.stringify(finding).substring(0, 120);

  const userMessage =
    `Site context: ${site_context}\n\n` +
    `Finding:\n${JSON.stringify(finding, null, 2)}`;

  let poc: ImpactPoC | null = null;
  let note: string | undefined;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userMessage);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      note = "Claude returned no parseable JSON object.";
    } else {
      poc = JSON.parse(jsonMatch[0]) as ImpactPoC;
    }
  } catch (err) {
    note = `Claude API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    workflow:  "impact_poc_generator",
    target:    findingSummary,
    timestamp: new Date().toISOString(),
    results: {
      finding_summary: findingSummary,
      poc,
      scan_cost_usd:   COST_PER_CALL,
      duration_ms:     Date.now() - start,
      ...(note && { note }),
    },
  };
}
