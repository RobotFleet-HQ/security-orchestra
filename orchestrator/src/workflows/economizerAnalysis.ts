import { spawn } from "child_process";
import path from "path";

export interface EconomizerAnalysisParams {
  location:          string;
  it_load_kw:        number;
  pue_mechanical:    number;
  economizer_type:   "air_side" | "water_side" | "hybrid";
}

export interface EconomizerAnalysisResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "economizer-analysis-agent", "economizer_analysis.py");

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
        let errMsg = `Economizer analysis agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runEconomizerAnalysis(params: EconomizerAnalysisParams): Promise<EconomizerAnalysisResult> {
  const { location, it_load_kw, pue_mechanical, economizer_type } = params;
  const t0 = Date.now();
  const args = [location, String(it_load_kw), String(pue_mechanical), economizer_type];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Economizer analysis agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const blendedPue = typeof agentOutput["blended_pue"] === "number" ? agentOutput["blended_pue"] as number : 0;
  const savings = typeof agentOutput["annual_cost_savings"] === "number" ? agentOutput["annual_cost_savings"] as number : 0;
  const payback = typeof agentOutput["payback_years"] === "number" ? agentOutput["payback_years"] as number : 0;
  return {
    workflow: "economizer_analysis",
    target: `${location}, ${it_load_kw} kW, ${economizer_type} — PUE ${blendedPue}, $${savings.toLocaleString()}/yr savings, ${payback.toFixed(1)}yr payback`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
