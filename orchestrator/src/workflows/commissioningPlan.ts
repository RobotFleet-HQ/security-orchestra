import { spawn } from "child_process";
import path from "path";

export interface CommissioningPlanParams {
  capacity_mw:      number;
  tier:             number;
  systems_count?:   number;
}

export interface CommissioningPlanResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "commissioning-plan-agent", "commissioning_plan.py");

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
        let errMsg = `Commissioning plan agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runCommissioningPlan(params: CommissioningPlanParams): Promise<CommissioningPlanResult> {
  const { capacity_mw, tier, systems_count } = params;
  const t0 = Date.now();
  const args: string[] = [String(capacity_mw), String(tier)];
  if (systems_count !== undefined) args.push(String(systems_count));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Commissioning plan agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const days = typeof agentOutput["commissioning_duration_days"] === "number" ? agentOutput["commissioning_duration_days"] as number : 0;
  const testHours = typeof agentOutput["total_test_hours"] === "number" ? agentOutput["total_test_hours"] as number : 0;
  return {
    workflow: "commissioning_plan",
    target: `${capacity_mw} MW Tier ${tier} — ${days} days, ${testHours} test hours`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
