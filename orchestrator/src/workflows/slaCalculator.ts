import { spawn } from "child_process";
import path from "path";

export interface SlaCalculatorParams {
  tier:                          number;
  target_availability_pct:       number;
  maintenance_windows_per_year?: number;
}

export interface SlaCalculatorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "sla-calculator-agent", "sla_calculator.py");

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
        let errMsg = `SLA calculator agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runSlaCalculator(params: SlaCalculatorParams): Promise<SlaCalculatorResult> {
  const { tier, target_availability_pct, maintenance_windows_per_year } = params;
  const t0 = Date.now();
  const args: string[] = [String(tier), String(target_availability_pct)];
  if (maintenance_windows_per_year !== undefined) args.push(String(maintenance_windows_per_year));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`SLA calculator agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const downtimeMin = typeof agentOutput["allowed_downtime_minutes_per_year"] === "number" ? agentOutput["allowed_downtime_minutes_per_year"] as number : 0;
  const benchmark = agentOutput["tier_benchmark"] as Record<string, unknown> | undefined;
  const meetsBenchmark = typeof benchmark?.["meets_tier_benchmark"] === "boolean" ? benchmark["meets_tier_benchmark"] as boolean : false;
  return {
    workflow: "sla_calculator",
    target: `Tier ${tier} @ ${target_availability_pct}% — ${downtimeMin.toFixed(1)} min/yr downtime, ${meetsBenchmark ? "meets" : "below"} tier benchmark`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
