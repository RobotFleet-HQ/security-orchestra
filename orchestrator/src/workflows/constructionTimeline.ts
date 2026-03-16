import { spawn } from "child_process";
import path from "path";

export interface ConstructionTimelineParams {
  capacity_mw:    number;
  building_type:  "new_build" | "shell_core" | "retrofit";
  state:          string;
}

export interface ConstructionTimelineResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "construction-timeline-agent", "construction_timeline.py");

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
        let errMsg = `Construction timeline agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runConstructionTimeline(params: ConstructionTimelineParams): Promise<ConstructionTimelineResult> {
  const { capacity_mw, building_type, state } = params;
  const t0 = Date.now();
  const args = [String(capacity_mw), building_type, state];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Construction timeline agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const months = typeof agentOutput["expected_start_to_ops_months"] === "number" ? agentOutput["expected_start_to_ops_months"] as number : 0;
  const risk = typeof agentOutput["permitting_risk"] === "string" ? agentOutput["permitting_risk"] as string : "unknown";
  return {
    workflow: "construction_timeline",
    target: `${capacity_mw} MW ${building_type} in ${state} — ${months} months, permitting risk: ${risk}`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
