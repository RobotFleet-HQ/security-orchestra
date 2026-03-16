import { spawn } from "child_process";
import path from "path";

export interface ChangeManagementParams {
  tier:                     number;
  change_volume_per_month:  number;
  staff_count:              number;
}

export interface ChangeManagementResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "change-management-agent", "change_management.py");

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
        let errMsg = `Change management agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runChangeManagement(params: ChangeManagementParams): Promise<ChangeManagementResult> {
  const { tier, change_volume_per_month, staff_count } = params;
  const t0 = Date.now();
  const args = [String(tier), String(change_volume_per_month), String(staff_count)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Change management agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const rollbackMin = typeof agentOutput["rollback_time_requirement_minutes"] === "number" ? agentOutput["rollback_time_requirement_minutes"] as number : 0;
  const cabFreq = typeof agentOutput["cab_frequency"] === "string" ? agentOutput["cab_frequency"] as string : "unknown";
  return {
    workflow: "change_management",
    target: `Tier ${tier}: ${change_volume_per_month} changes/mo — ${cabFreq} CAB, ${rollbackMin} min rollback SLA`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
