import { spawn } from "child_process";
import path from "path";

export type TankType = "above_ground" | "underground" | "day_tank";
export type FuelJurisdiction = "epa" | "california" | "nfpa30";

export interface FuelStorageParams {
  generator_kw: number;
  target_runtime_hours: number;
  tank_type?: TankType;
  jurisdiction?: FuelJurisdiction;
}

export interface FuelStorageResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  fuel_requirements: {
    consumption_gph: number;
    required_gallons_no_margin: number;
    design_gallons_with_10pct_margin: number;
    selected_tank_size_gallons: number;
    number_of_tanks: number;
    actual_runtime_hours: number;
  };
  tank_specification: Record<string, unknown>;
  regulatory_requirements: {
    spcc_plan_required: boolean;
    spcc_threshold_note: string;
    secondary_containment_gallons: number;
    containment_note: string;
    underground_registration: boolean;
    applicable_regulations: string[];
  };
  piping_specification: Record<string, unknown>;
  day_tank_recommendation: Record<string, unknown>;
  installation_notes: string[];
  fire_separation_ft: number;
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "fuel-storage-agent", "fuel_storage.py"
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
        let errMsg = `Fuel storage agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runFuelStorage(params: FuelStorageParams): Promise<FuelStorageResult> {
  const { generator_kw, target_runtime_hours, tank_type = "above_ground", jurisdiction = "epa" } = params;
  const t0 = Date.now();
  const args = [String(generator_kw), String(target_runtime_hours), tank_type, jurisdiction];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Fuel storage returned non-JSON: ${raw.substring(0, 200)}`); }
  const fr = agentOutput.fuel_requirements;
  const label = `${generator_kw} kW — ${fr.selected_tank_size_gallons.toLocaleString()} gal ${tank_type.replace("_", " ")} (${fr.actual_runtime_hours.toFixed(1)} hr runtime)`;
  return {
    workflow: "fuel_storage",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
