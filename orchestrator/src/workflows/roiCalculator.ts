import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoiCalculatorParams {
  capex: number;
  annual_opex: number;
  revenue_per_year: number;
  project_lifetime_years: number;
  discount_rate?: number;
}

export interface RoiCalculatorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "roi-calculator-agent", "roi_calculator.py"
);

// ─── Child process runner ─────────────────────────────────────────────────────

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child  = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `ROI calculator agent exited with code ${code}`;
        try {
          const parsed = JSON.parse(errText) as { error?: string };
          if (parsed.error) errMsg = parsed.error;
        } catch { /* use raw text */ }
        reject(new Error(errMsg));
      }
    });

    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runRoiCalculator(
  params: RoiCalculatorParams
): Promise<RoiCalculatorResult> {
  const {
    capex,
    annual_opex,
    revenue_per_year,
    project_lifetime_years,
    discount_rate = 0.10,
  } = params;

  const t0 = Date.now();

  const args = [
    String(capex),
    String(annual_opex),
    String(revenue_per_year),
    String(project_lifetime_years),
    String(discount_rate),
  ];

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`ROI calculator agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  // Extract values for the target label
  const roiSummary = agentOutput["roi_summary"] as Record<string, unknown> | undefined;
  const npvDollars  = typeof roiSummary?.["npv_dollars"]    === "number" ? roiSummary["npv_dollars"]    as number : 0;
  const paybackMonths = typeof roiSummary?.["payback_months"] === "number" ? roiSummary["payback_months"] as number : null;

  const capexM = (capex / 1_000_000).toFixed(1);
  const npvFormatted = npvDollars >= 0
    ? `$${(npvDollars / 1_000_000).toFixed(2)}M`
    : `-$${(Math.abs(npvDollars) / 1_000_000).toFixed(2)}M`;
  const paybackStr = paybackMonths != null ? `${paybackMonths.toFixed(1)} mo payback` : "no payback";

  const target = `${capexM}M CapEx — NPV ${npvFormatted} / ${paybackStr}`;

  return {
    workflow:  "roi_calculator",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
