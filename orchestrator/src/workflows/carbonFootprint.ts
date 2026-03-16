import { spawn } from "child_process";
import path from "path";

export interface CarbonFootprintParams {
  it_load_kw:     number;
  pue:            number;
  grid_region:    "WECC" | "SERC" | "RFC" | "MRO" | "NPCC" | "TRE" | "HICC" | "ASCC";
  renewable_pct?: number;
}

export interface CarbonFootprintResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "carbon-footprint-agent", "carbon_footprint.py");

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
        let errMsg = `Carbon footprint agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runCarbonFootprint(params: CarbonFootprintParams): Promise<CarbonFootprintResult> {
  const { it_load_kw, pue, grid_region, renewable_pct } = params;
  const t0 = Date.now();
  const args: string[] = [String(it_load_kw), String(pue), grid_region];
  if (renewable_pct !== undefined) args.push(String(renewable_pct));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Carbon footprint agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const marketMt = typeof agentOutput["market_based_emissions_metric_tons"] === "number" ? agentOutput["market_based_emissions_metric_tons"] as number : 0;
  const intensity = typeof agentOutput["carbon_intensity_tons_per_mw_yr"] === "number" ? agentOutput["carbon_intensity_tons_per_mw_yr"] as number : 0;
  return {
    workflow: "carbon_footprint",
    target: `${it_load_kw} kW, PUE ${pue}, ${grid_region} — ${marketMt.toLocaleString()} tCO2/yr market-based, ${intensity} tCO2/MW/yr`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
