import { spawn } from "child_process";
import path from "path";

export interface ComplianceCheckerParams {
  frameworks:     string;
  facility_type:  "colo" | "hyperscale" | "enterprise" | "edge";
  current_tier:   number;
}

export interface ComplianceCheckerResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "compliance-checker-agent", "compliance_checker.py");

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
        let errMsg = `Compliance checker agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runComplianceChecker(params: ComplianceCheckerParams): Promise<ComplianceCheckerResult> {
  const { frameworks, facility_type, current_tier } = params;
  const t0 = Date.now();
  const args = [frameworks, facility_type, String(current_tier)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Compliance checker agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const analyzed = typeof agentOutput["frameworks_analyzed"] === "number" ? agentOutput["frameworks_analyzed"] as number : 0;
  const uniqueControls = typeof agentOutput["total_unique_controls"] === "number" ? agentOutput["total_unique_controls"] as number : 0;
  return {
    workflow: "compliance_checker",
    target: `${facility_type} Tier ${current_tier}: ${analyzed} frameworks, ${uniqueControls} unique controls`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
