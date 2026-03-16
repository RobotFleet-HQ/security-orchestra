import { spawn } from "child_process";
import path from "path";

export interface EnergyProcurementParams {
  annual_consumption_mwh: number;
  state:                  string;
  contract_term_years:    number;
  renewable_target_pct?:  number;
}

export interface EnergyProcurementResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "energy-procurement-agent", "energy_procurement.py");

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
        let errMsg = `Energy procurement agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runEnergyProcurement(params: EnergyProcurementParams): Promise<EnergyProcurementResult> {
  const { annual_consumption_mwh, state, contract_term_years, renewable_target_pct } = params;
  const t0 = Date.now();
  const args: string[] = [String(annual_consumption_mwh), state, String(contract_term_years)];
  if (renewable_target_pct !== undefined) args.push(String(renewable_target_pct));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Energy procurement agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const recommended = typeof agentOutput["recommended_strategy"] === "string" ? agentOutput["recommended_strategy"] as string : "unknown";
  const annualCost = typeof agentOutput["estimated_annual_cost_usd"] === "number" ? agentOutput["estimated_annual_cost_usd"] as number : 0;
  return {
    workflow: "energy_procurement",
    target: `${annual_consumption_mwh.toLocaleString()} MWh/yr, ${state}, ${contract_term_years}yr — ${recommended}, $${(annualCost / 1_000_000).toFixed(2)}M/yr`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
