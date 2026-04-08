// ─── Config Vulnerability Hunter ─────────────────────────────────────────────
// Calls Claude API to analyze component configuration data for security
// misconfigurations against NFPA 110, EPA RICE NESHAP, and Tier Standards.

import https from "https";

export interface ConfigFinding {
  location:             string;
  misconfiguration_type: string;
  impact:               string;
  remediation:          string;
  severity_tier:        1 | 2 | 3 | 4 | 5;
}

export interface ConfigVulnHunterResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    component_name:  string;
    component_type:  string;
    manufacturer:    string;
    findings:        ConfigFinding[];
    finding_count:   number;
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

const SYSTEM_PROMPT = `You are a critical power infrastructure security auditor specializing in data center configurations.
Analyze configuration data for misconfigurations against:
- NFPA 110 (Emergency and Standby Power Systems)
- EPA RICE NESHAP (40 CFR Part 63 Subpart ZZZZ)
- Uptime Institute Tier Standards

For each misconfiguration found, respond with a JSON array of findings.
Each finding MUST have these exact fields:
{
  "location": "where in the config this occurs",
  "misconfiguration_type": "short label",
  "impact": "what failure this enables",
  "remediation": "specific corrective action",
  "severity_tier": <integer 1-5>
}

Severity scale:
1 = Observable anomaly — no operational impact
2 = Degraded redundancy — N still met
3 = Single point of failure exposed
4 = Loss of N+1 — critical load at risk
5 = Complete site failure path confirmed

Return ONLY valid JSON array. No markdown, no explanation outside the array.
If no issues found, return [].`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runConfigVulnHunter(params: {
  component_name: string;
  component_type: string;
  config_data:    string;
  manufacturer:   string;
}): Promise<ConfigVulnHunterResult> {
  const start = Date.now();
  const { component_name, component_type, config_data, manufacturer } = params;
  const COST_PER_CALL = 0.01;

  const userMessage =
    `Component: ${component_name}\n` +
    `Type: ${component_type}\n` +
    `Manufacturer: ${manufacturer}\n\n` +
    `Configuration data:\n${config_data}`;

  let findings: ConfigFinding[] = [];
  let note: string | undefined;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userMessage);
    // Extract JSON array from response (strip any accidental markdown fences)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      note = "Claude returned no parseable JSON array — treating as zero findings.";
    } else {
      findings = JSON.parse(jsonMatch[0]) as ConfigFinding[];
    }
  } catch (err) {
    note = `Claude API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const highest = findings.reduce((max, f) => Math.max(max, f.severity_tier ?? 0), 0);

  return {
    workflow:  "config_vuln_hunter",
    target:    component_name,
    timestamp: new Date().toISOString(),
    results: {
      component_name,
      component_type,
      manufacturer,
      findings,
      finding_count:    findings.length,
      highest_severity: highest,
      scan_cost_usd:    COST_PER_CALL,
      duration_ms:      Date.now() - start,
      ...(note && { note }),
    },
  };
}
