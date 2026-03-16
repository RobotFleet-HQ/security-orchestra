import { spawn } from "child_process";
import path from "path";

export interface EnvironmentalImpactParams {
  generator_count: number;
  generator_kw: number;
  site_acres: number;
  proximity_to_wetlands_ft?: number;
  state?: string;
}

export interface EnvironmentalImpactResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: Record<string, unknown> & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  air_quality: {
    nox_tons_per_year_total: number;
    co_tons_per_year_total: number;
    pm25_tons_per_year_total: number;
    title_v_required: boolean;
    air_permit_type: "Title V" | "State Minor Source" | "Permit by Rule";
    annual_operating_hours_assumed: number;
  };
  stormwater: {
    estimated_impervious_acres: number;
    retention_pond_acre_feet: number;
    npdes_permit_required: boolean;
    cgp_construction_permit_required: boolean;
  };
  wetlands: {
    proximity_ft: number;
    section_404_required: boolean;
    buffer_review_required: boolean;
    mitigation_required: boolean;
  };
  nepa_review: {
    review_type: "EIS" | "EA" | "Categorical Exclusion";
    estimated_months: number;
    federal_nexus_assumed: boolean;
  };
  permits_required: Array<{
    permit: string;
    agency: string;
    estimated_months: number;
    cost_estimate: number;
  }>;
  total_compliance_cost_estimate: number;
  risk_flags: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "environmental-impact-agent", "environmental_impact.py"
);

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      if (code === 0) { resolve(Buffer.concat(stdout).toString("utf8").trim()); }
      else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Environmental impact agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runEnvironmentalImpact(params: EnvironmentalImpactParams): Promise<EnvironmentalImpactResult> {
  const { generator_count, generator_kw, site_acres, proximity_to_wetlands_ft, state } = params;
  const t0 = Date.now();
  const args = [
    String(generator_count),
    String(generator_kw),
    String(site_acres),
    String(proximity_to_wetlands_ft ?? 1000),
    state ?? "VA",
  ];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Environmental impact agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const air_permit_type = agentOutput.air_quality.air_permit_type;
  const permits_count = agentOutput.permits_required.length;
  const label = `${generator_count} × ${generator_kw} kW on ${site_acres} ac — ${air_permit_type}, ${permits_count} permits`;
  return {
    workflow: "environmental_impact",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
