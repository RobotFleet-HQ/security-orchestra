import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TcoAnalyzerParams {
  it_load_kw:           number;
  power_rate_kwh:       number;
  years:                number;
  pue:                  number;
  labor_cost_annual?:   number;
  refresh_cycle_years?: number;
}

export interface TcoAnalyzerResult {
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
  "tco-analyzer-agent", "tco_analyzer.py"
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
        let errMsg = `TCO analyzer agent exited with code ${code}`;
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

export async function runTcoAnalyzer(
  params: TcoAnalyzerParams
): Promise<TcoAnalyzerResult> {
  const {
    it_load_kw,
    power_rate_kwh,
    years,
    pue,
    labor_cost_annual,
    refresh_cycle_years,
  } = params;

  const t0 = Date.now();

  const args: string[] = [
    String(it_load_kw),
    String(power_rate_kwh),
    String(years),
    String(pue),
  ];
  if (labor_cost_annual  !== undefined) args.push(String(labor_cost_annual));
  if (refresh_cycle_years !== undefined) args.push(String(refresh_cycle_years));

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`TCO analyzer agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  // Extract values for target label
  const tcoSummary = agentOutput["tco_summary"] as Record<string, unknown> | undefined;
  const totalTco      = typeof tcoSummary?.["total_tco"]              === "number" ? tcoSummary["total_tco"]              as number : 0;
  const costPerKwMonth = typeof tcoSummary?.["cost_per_kw_per_month"] === "number" ? tcoSummary["cost_per_kw_per_month"] as number : 0;

  const tcoFormatted = totalTco >= 1_000_000
    ? `$${(totalTco / 1_000_000).toFixed(2)}M`
    : `$${totalTco.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const target = `${it_load_kw} kW over ${years}yr — Total TCO ${tcoFormatted} ($${costPerKwMonth.toFixed(2)}/kW/mo)`;

  return {
    workflow:  "tco_analyzer",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
