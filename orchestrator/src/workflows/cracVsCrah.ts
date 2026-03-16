import { spawn } from "child_process";
import path from "path";

export interface CracVsCrahParams {
  it_load_kw:       number;
  room_sqft:        number;
  water_available:  "yes" | "no";
  climate_zone?:    "hot_dry" | "hot_humid" | "mild" | "cold";
}

export interface CracVsCrahResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "crac-vs-crah-agent", "crac_vs_crah.py");

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
        let errMsg = `CRAC vs CRAH agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runCracVsCrah(params: CracVsCrahParams): Promise<CracVsCrahResult> {
  const { it_load_kw, room_sqft, water_available, climate_zone } = params;
  const t0 = Date.now();
  const args: string[] = [String(it_load_kw), String(room_sqft), water_available];
  if (climate_zone !== undefined) args.push(climate_zone);
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`CRAC vs CRAH agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const recommendation = typeof agentOutput["recommendation"] === "string" ? agentOutput["recommendation"] as string : "unknown";
  const savings = typeof agentOutput["annual_savings_with_crah"] === "number" ? agentOutput["annual_savings_with_crah"] as number : 0;
  return {
    workflow: "crac_vs_crah",
    target: `${it_load_kw} kW, water: ${water_available} — recommend ${recommendation}, $${savings.toLocaleString()}/yr CRAH savings`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
