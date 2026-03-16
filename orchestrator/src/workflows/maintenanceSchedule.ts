import { spawn } from "child_process";
import path from "path";

export interface MaintenanceScheduleParams {
  generator_count:  number;
  ups_count:        number;
  cooling_units:    number;
  tier:             number;
}

export interface MaintenanceScheduleResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "maintenance-schedule-agent", "maintenance_schedule.py");

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
        let errMsg = `Maintenance schedule agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runMaintenanceSchedule(params: MaintenanceScheduleParams): Promise<MaintenanceScheduleResult> {
  const { generator_count, ups_count, cooling_units, tier } = params;
  const t0 = Date.now();
  const args = [String(generator_count), String(ups_count), String(cooling_units), String(tier)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Maintenance schedule agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const totalHrs = typeof agentOutput["total_annual_pm_hours"] === "number" ? agentOutput["total_annual_pm_hours"] as number : 0;
  const fte = typeof agentOutput["technician_fte_required"] === "number" ? agentOutput["technician_fte_required"] as number : 0;
  const partsBudget = typeof agentOutput["annual_parts_budget"] === "number" ? agentOutput["annual_parts_budget"] as number : 0;
  return {
    workflow: "maintenance_schedule",
    target: `Tier ${tier}: ${generator_count}G+${ups_count}U+${cooling_units}C — ${totalHrs.toLocaleString()} hrs/yr, ${fte} FTE, $${partsBudget.toLocaleString()} parts`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
