import { spawn } from "child_process";
import path from "path";

export type RackCoolingType = "air" | "liquid" | "hybrid";

export interface PowerDensityParams {
  total_it_load_kw: number;
  rack_count: number;
  cabinet_height_u?: number;
  cooling_type?: RackCoolingType;
  target_density_kw_per_rack?: number;
}

export interface PowerDensityResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  current_density: {
    kw_per_rack: number;
    classification: string;
    total_load_kw: number;
    rack_count: number;
  };
  target_density_analysis: Record<string, unknown>;
  airflow_requirements: Record<string, unknown>;
  pdu_recommendations: {
    pdus_per_rack: number;
    circuit_amperage: number;
    circuit_type: string;
    branch_circuits_per_pdu: number;
    total_pdus_required: number;
  };
  breaker_sizing: Record<string, unknown>;
  cabinet_capacity: Record<string, unknown>;
  expansion_capacity: Record<string, unknown>;
  recommendations: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "power-density-agent", "power_density.py"
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
        let errMsg = `Power density agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runPowerDensity(params: PowerDensityParams): Promise<PowerDensityResult> {
  const { total_it_load_kw, rack_count, cabinet_height_u = 42, cooling_type = "air", target_density_kw_per_rack = 10 } = params;
  const t0 = Date.now();
  const args = [String(total_it_load_kw), String(rack_count), String(cabinet_height_u), cooling_type, String(target_density_kw_per_rack)];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Power density returned non-JSON: ${raw.substring(0, 200)}`); }
  const cd = agentOutput.current_density;
  const label = `${rack_count} racks × ${cd.kw_per_rack.toFixed(1)} kW/rack = ${total_it_load_kw} kW total (${cd.classification})`;
  return {
    workflow: "power_density",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
