// ─── Failure Chain Analyst ────────────────────────────────────────────────────
// Calls Claude API to identify failure chains where multiple low-severity
// findings combine into a higher-severity failure path.

import https from "https";

export interface FailureChain {
  components:            string[];
  individual_severities: number[];
  combined_severity_tier: 1 | 2 | 3 | 4 | 5;
  trigger_conditions:    string;
  blast_radius:          string;
  chain_narrative:       string;
}

export interface FailureChainAnalystResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    site_name:    string;
    chains:       FailureChain[];
    chain_count:  number;
    highest_combined_severity: number;
    scan_cost_usd: number;
    duration_ms:  number;
    note?:        string;
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
      max_tokens: 3000,
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

const SYSTEM_PROMPT = `You are a failure chain analyst for critical power infrastructure.
Your task is to take a list of security and compliance findings and identify chains where
multiple individually low-severity findings combine into a higher-severity failure path.

Look for: cascading dependencies, shared single-points-of-failure, concurrent fault scenarios,
and latent conditions that become critical only in combination.

Return a JSON array of failure chains. Each chain MUST have these exact fields:
{
  "components": ["component_a", "component_b"],
  "individual_severities": [2, 2],
  "combined_severity_tier": <integer 1-5>,
  "trigger_conditions": "what must occur to activate this chain",
  "blast_radius": "what systems/loads are affected if this chain triggers",
  "chain_narrative": "one paragraph explaining the full failure sequence"
}

Severity scale:
1 = Observable anomaly — no operational impact
2 = Degraded redundancy — N still met
3 = Single point of failure exposed
4 = Loss of N+1 — critical load at risk
5 = Complete site failure path confirmed

Sort output by combined_severity_tier descending.
Return ONLY valid JSON array. No markdown, no explanation outside the array.
If no chains identified, return [].`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runFailureChainAnalyst(params: {
  site_name: string;
  findings:  Array<Record<string, unknown>>;
}): Promise<FailureChainAnalystResult> {
  const start = Date.now();
  const { site_name, findings } = params;
  const COST_PER_CALL = 0.01;

  const userMessage =
    `Site: ${site_name}\n\n` +
    `Findings (${findings.length} total):\n${JSON.stringify(findings, null, 2)}`;

  let chains: FailureChain[] = [];
  let note: string | undefined;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userMessage);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      note = "Claude returned no parseable JSON array — treating as zero chains.";
    } else {
      const parsed = JSON.parse(jsonMatch[0]) as FailureChain[];
      chains = parsed.sort((a, b) => b.combined_severity_tier - a.combined_severity_tier);
    }
  } catch (err) {
    note = `Claude API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const highest = chains.reduce((max, c) => Math.max(max, c.combined_severity_tier ?? 0), 0);

  return {
    workflow:  "failure_chain_analyst",
    target:    site_name,
    timestamp: new Date().toISOString(),
    results: {
      site_name,
      chains,
      chain_count:               chains.length,
      highest_combined_severity: highest,
      scan_cost_usd:             COST_PER_CALL,
      duration_ms:               Date.now() - start,
      ...(note && { note }),
    },
  };
}
