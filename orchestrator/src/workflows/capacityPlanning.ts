import { spawn } from "child_process";
import path from "path";

export interface CapacityPlanningParams {
  current_load_kw:              number;
  current_capacity_kw:          number;
  growth_rate_pct_per_year:     number;
  design_life_years?:           number;
}

export interface CapacityPlanningResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "capacity-planning-agent", "capacity_planning.py");

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
        let errMsg = `Capacity planning agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runCapacityPlanning(params: CapacityPlanningParams): Promise<CapacityPlanningResult> {
  const { current_load_kw, current_capacity_kw, growth_rate_pct_per_year, design_life_years } = params;
  const t0 = Date.now();
  const args: string[] = [String(current_load_kw), String(current_capacity_kw), String(growth_rate_pct_per_year)];
  if (design_life_years !== undefined) args.push(String(design_life_years));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Capacity planning agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const utilization = typeof agentOutput["current_utilization_pct"] === "number" ? agentOutput["current_utilization_pct"] as number : 0;
  const years80 = typeof agentOutput["years_to_80pct_utilization"] === "number" ? agentOutput["years_to_80pct_utilization"] as number : 0;
  const risk = typeof agentOutput["capacity_planning_risk"] === "string" ? agentOutput["capacity_planning_risk"] as string : "unknown";
  return {
    workflow: "capacity_planning",
    target: `${current_load_kw} kW / ${current_capacity_kw} kW (${utilization}%) @ ${growth_rate_pct_per_year}%/yr — ${years80.toFixed(1)}yr to 80%, risk: ${risk}`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
