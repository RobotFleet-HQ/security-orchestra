import { spawn } from "child_process";
import path from "path";

export type UpsRedundancy = "N" | "N+1" | "2N";
export type UpsVoltage = 208 | 480;
export type BatteryType = "VRLA" | "Li-ion";

export interface UpsSizingParams {
  load_kw: number;
  runtime_minutes: number;
  redundancy?: UpsRedundancy;
  voltage?: UpsVoltage;
  battery_type?: BatteryType;
}

export interface UpsSizingResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  ups_sizing: {
    load_kva: number;
    design_kva_with_headroom: number;
    selected_module_kva: number;
    module_count: number;
    configuration: string;
    configuration_description: string;
    total_installed_kva: number;
  };
  battery_sizing: {
    dc_bus_voltage_v: number;
    required_ah_per_string: number;
    selected_ah_per_string: number;
    cells_per_string: number;
    parallel_strings: number;
    total_battery_units: number;
    total_energy_kwh: number;
    battery_type: string;
    depth_of_discharge_pct: number;
  };
  runtime_analysis: {
    at_100pct_load_minutes: number;
    at_75pct_load_minutes: number;
    at_50pct_load_minutes: number;
    design_runtime_minutes: number;
  };
  cost_estimate: Record<string, unknown>;
  installation_notes: string[];
  compliance_standards: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "ups-sizing-agent", "ups_sizing.py"
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
        let errMsg = `UPS sizing agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runUpsSizing(params: UpsSizingParams): Promise<UpsSizingResult> {
  const { load_kw, runtime_minutes, redundancy = "N+1", voltage = 480, battery_type = "VRLA" } = params;
  const t0 = Date.now();
  const args = [String(load_kw), String(runtime_minutes), redundancy, String(voltage), battery_type];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`UPS sizing returned non-JSON: ${raw.substring(0, 200)}`); }
  const s = agentOutput.ups_sizing;
  const label = `${s.selected_module_kva} kVA UPS × ${s.module_count} (${s.configuration}) — ${runtime_minutes} min runtime`;
  return {
    workflow: "ups_sizing",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
