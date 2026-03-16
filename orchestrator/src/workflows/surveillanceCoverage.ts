import { spawn } from "child_process";
import path from "path";

export interface SurveillanceCoverageParams {
  facility_sqft:       number;
  camera_resolution:   "2mp" | "4mp" | "8mp" | "12mp";
  retention_days:      number;
}

export interface SurveillanceCoverageResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "surveillance-coverage-agent", "surveillance_coverage.py");

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
        let errMsg = `Surveillance coverage agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runSurveillanceCoverage(params: SurveillanceCoverageParams): Promise<SurveillanceCoverageResult> {
  const { facility_sqft, camera_resolution, retention_days } = params;
  const t0 = Date.now();
  const args = [String(facility_sqft), camera_resolution, String(retention_days)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Surveillance coverage agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const cameras = typeof agentOutput["camera_count"] === "number" ? agentOutput["camera_count"] as number : 0;
  const storageTb = typeof agentOutput["storage_required_tb"] === "number" ? agentOutput["storage_required_tb"] as number : 0;
  return {
    workflow: "surveillance_coverage",
    target: `${facility_sqft.toLocaleString()} sqft, ${camera_resolution} — ${cameras} cameras, ${storageTb.toFixed(1)} TB storage`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
