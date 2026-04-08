// ─── ICS/SCADA CVE Intelligence ───────────────────────────────────────────────
// Calls Claude API to identify known CVEs for installed critical power equipment.
// Covers: Schneider Electric, ABB, Siemens, Cummins PowerCommand, Caterpillar
// EMCP, Basler Electric, ComAp, Schweitzer Engineering (SEL).

import https from "https";

export interface InstalledEquipment {
  manufacturer:      string;
  model:             string;
  firmware_version:  string;
}

export interface EquipmentCve {
  cve_id:         string;
  cvss_score:     number;
  exploitability: "low" | "medium" | "high" | "critical";
  patch_available: boolean;
  workaround:     string;
}

export interface EquipmentCveEntry {
  equipment: InstalledEquipment;
  cves:      EquipmentCve[];
}

export interface IcsScdaCveIntelligenceResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    equipment_cve_map:     EquipmentCveEntry[];
    total_equipment:       number;
    total_cves_found:      number;
    critical_cve_count:    number;
    unpatched_cve_count:   number;
    scan_cost_usd:         number;
    duration_ms:           number;
    note?:                 string;
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

const SYSTEM_PROMPT = `You are an ICS/SCADA CVE intelligence analyst specializing in critical power equipment.
You have deep knowledge of vulnerabilities in:
- Schneider Electric (APC, Galaxy, Modicon, EcoStruxure)
- ABB (PowerStore, REF, REM series)
- Siemens (SICAM, SIPROTEC, SINEMA)
- Cummins PowerCommand (PCC 1302, 2100, 3300, 3200)
- Caterpillar EMCP (EMCP 4.1, 4.2, 4.3, 4.4)
- Basler Electric (BE1-11, DECS series)
- ComAp (InteliGen, InteliSys, InteliLite)
- Schweitzer Engineering Laboratories (SEL-300G, SEL-3505, SEL-651R)

For each piece of equipment provided, identify known CVEs. Use your training data knowledge.
If specific CVEs are unknown for a model, indicate that and provide general vulnerability classes for that platform.

Return a JSON array where each element is:
{
  "equipment": { "manufacturer": "...", "model": "...", "firmware_version": "..." },
  "cves": [
    {
      "cve_id": "CVE-YYYY-NNNNN or 'GENERIC-<category>' if no specific CVE",
      "cvss_score": <0.0-10.0>,
      "exploitability": "low|medium|high|critical",
      "patch_available": <boolean>,
      "workaround": "specific recommended workaround or mitigation"
    }
  ]
}

Return ONLY valid JSON array. No markdown, no explanation outside the array.
If no CVEs known for a device, return an empty cves array for that equipment entry.`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runIcsScdaCveIntelligence(params: {
  installed_equipment: InstalledEquipment[];
}): Promise<IcsScdaCveIntelligenceResult> {
  const start = Date.now();
  const { installed_equipment } = params;
  const COST_PER_CALL = 0.01;

  const targetLabel = installed_equipment
    .map((e) => `${e.manufacturer} ${e.model}`)
    .join(", ")
    .substring(0, 80);

  let cveMap: EquipmentCveEntry[] = [];
  let note: string | undefined;

  try {
    const raw = await callClaude(
      SYSTEM_PROMPT,
      `Equipment inventory (${installed_equipment.length} items):\n${JSON.stringify(installed_equipment, null, 2)}`
    );
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      note = "Claude returned no parseable JSON array — returning empty CVE map.";
    } else {
      cveMap = JSON.parse(jsonMatch[0]) as EquipmentCveEntry[];
    }
  } catch (err) {
    note = `Claude API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const allCves      = cveMap.flatMap((e) => e.cves);
  const totalCves    = allCves.length;
  const criticalCves = allCves.filter((c) => c.exploitability === "critical").length;
  const unpatchedCves = allCves.filter((c) => !c.patch_available).length;

  return {
    workflow:  "ics_scada_cve_intelligence",
    target:    targetLabel,
    timestamp: new Date().toISOString(),
    results: {
      equipment_cve_map:   cveMap,
      total_equipment:     installed_equipment.length,
      total_cves_found:    totalCves,
      critical_cve_count:  criticalCves,
      unpatched_cve_count: unpatchedCves,
      scan_cost_usd:       COST_PER_CALL,
      duration_ms:         Date.now() - start,
      ...(note && { note }),
    },
  };
}
