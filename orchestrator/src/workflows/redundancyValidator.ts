import { spawn } from "child_process";
import path from "path";

export type RedundancyDesignType = "N" | "N+1" | "2N" | "2N+1";

export interface RedundancyValidatorParams {
  design_type: RedundancyDesignType;
  total_load_kw: number;
  generator_count: number;
  generator_capacity_kw: number;
  ups_count: number;
  ups_capacity_kw: number;
  cooling_units: number;
  has_bypass?: boolean;
}

export interface RedundancyValidatorResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  capacity_analysis: Record<string, unknown>;
  redundancy_assessment: {
    claimed_design_type: string;
    actual_generator_redundancy: string;
    actual_ups_redundancy: string;
    actual_cooling_redundancy: string;
    concurrent_maintainability: boolean;
    fault_tolerant: boolean;
  };
  tier_assessment: {
    claimed_design_type: string;
    achieved_tier: string;
    uptime_pct: number;
    downtime_hrs_per_year: number;
    downtime_minutes_per_year: number;
    tier_certification_ready: boolean;
    gaps_to_next_tier: string[];
  };
  spof_analysis: {
    spofs_found: number;
    critical_spofs: Array<{ component: string; description: string; severity: string }>;
    has_critical_spofs: boolean;
  };
  validation_checks: Array<{ check: string; status: string; detail: string }>;
  remediation_steps: string[];
  compliance_notes: Record<string, unknown>;
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "redundancy-validator-agent", "redundancy_validator.py"
);

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child = spawn(python, [AGENT_PATH, ...args], { timeout: 15_000 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      if (code === 0) { resolve(Buffer.concat(stdout).toString("utf8").trim()); }
      else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Redundancy validator agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runRedundancyValidator(params: RedundancyValidatorParams): Promise<RedundancyValidatorResult> {
  const {
    design_type, total_load_kw, generator_count, generator_capacity_kw,
    ups_count, ups_capacity_kw, cooling_units, has_bypass = false
  } = params;
  const t0 = Date.now();
  const args = [
    design_type, String(total_load_kw), String(generator_count),
    String(generator_capacity_kw), String(ups_count), String(ups_capacity_kw),
    String(cooling_units), has_bypass ? "true" : "false"
  ];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Redundancy validator returned non-JSON: ${raw.substring(0, 200)}`); }
  const ta = agentOutput.tier_assessment;
  const sp = agentOutput.spof_analysis;
  const label = `${design_type} design — ${ta.achieved_tier} (${ta.uptime_pct}% uptime, ${sp.spofs_found} SPOFs)`;
  return {
    workflow: "redundancy_validator",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
