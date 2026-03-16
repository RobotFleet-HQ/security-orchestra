import { spawn } from "child_process";
import path from "path";

export interface SolarFeasibilityParams {
  facility_sqft:         number;
  it_load_kw:            number;
  state:                 string;
  roof_available_sqft?:  number;
}

export interface SolarFeasibilityResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "solar-feasibility-agent", "solar_feasibility.py");

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child  = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      if (code === 0) { resolve(Buffer.concat(stdout).toString("utf8").trim()); }
      else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Solar feasibility agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runSolarFeasibility(params: SolarFeasibilityParams): Promise<SolarFeasibilityResult> {
  const { facility_sqft, it_load_kw, state, roof_available_sqft } = params;
  const t0 = Date.now();
  const args: string[] = [String(facility_sqft), String(it_load_kw), state];
  if (roof_available_sqft !== undefined) args.push(String(roof_available_sqft));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Solar feasibility agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const systemKw = typeof agentOutput["system_capacity_kw"] === "number" ? agentOutput["system_capacity_kw"] as number : 0;
  const offsetPct = typeof agentOutput["energy_offset_pct"] === "number" ? agentOutput["energy_offset_pct"] as number : 0;
  const payback = typeof agentOutput["simple_payback_years"] === "number" ? agentOutput["simple_payback_years"] as number : 0;
  return {
    workflow: "solar_feasibility",
    target: `${state}: ${systemKw.toFixed(0)} kW system, ${offsetPct.toFixed(1)}% offset, ${payback.toFixed(1)}yr payback`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
