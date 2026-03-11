import { spawn } from "child_process";
import path from "path";

export interface CoolingLoadParams {
  it_load_kw: number;
  ups_capacity_kw: number;
  room_sqft: number;
  ceiling_height_ft?: number;
  ambient_temp_f?: number;
}

export interface CoolingLoadResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  heat_sources_btu_hr: {
    it_equipment: number;
    ups_losses: number;
    lighting: number;
    building_envelope: number;
    miscellaneous: number;
    total: number;
  };
  cooling_requirements: {
    total_btu_hr: number;
    total_tons: number;
    design_tons_with_margin: number;
    btu_per_sqft: number;
    watts_per_sqft: number;
  };
  airflow: Record<string, unknown>;
  unit_selection: {
    selected_unit_size_tons: number;
    units_required_n: number;
    units_recommended_n_plus_1: number;
    total_installed_tons: number;
    redundancy_pct: number;
  };
  ashrae_compliance: Record<string, unknown>;
  recommendations: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "cooling-load-agent", "cooling_load.py"
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
        let errMsg = `Cooling load agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runCoolingLoad(params: CoolingLoadParams): Promise<CoolingLoadResult> {
  const { it_load_kw, ups_capacity_kw, room_sqft, ceiling_height_ft = 12, ambient_temp_f = 95 } = params;
  const t0 = Date.now();
  const args = [String(it_load_kw), String(ups_capacity_kw), String(room_sqft), String(ceiling_height_ft), String(ambient_temp_f)];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Cooling load returned non-JSON: ${raw.substring(0, 200)}`); }
  const cr = agentOutput.cooling_requirements;
  const us = agentOutput.unit_selection;
  const label = `${it_load_kw} kW IT — ${cr.design_tons_with_margin.toFixed(1)} tons (${us.units_recommended_n_plus_1} × ${us.selected_unit_size_tons}T units)`;
  return {
    workflow: "cooling_load",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
