import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemandResponseParams {
  generator_capacity_kw:   number;
  critical_load_kw:        number;
  utility_provider:        string;
  annual_events_expected?: number;
}

export interface DemandResponseResult {
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
  "demand-response-agent", "demand_response.py"
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
        let errMsg = `Demand response agent exited with code ${code}`;
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

export async function runDemandResponse(
  params: DemandResponseParams
): Promise<DemandResponseResult> {
  const {
    generator_capacity_kw,
    critical_load_kw,
    utility_provider,
    annual_events_expected,
  } = params;

  const t0 = Date.now();

  const args: string[] = [
    String(generator_capacity_kw),
    String(critical_load_kw),
    utility_provider,
  ];
  if (annual_events_expected !== undefined) args.push(String(annual_events_expected));

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Demand response agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  // Extract values for target label
  const capacityAnalysis = agentOutput["capacity_analysis"] as Record<string, unknown> | undefined;
  const economics        = agentOutput["economics"]         as Record<string, unknown> | undefined;

  const sheddableKw   = typeof capacityAnalysis?.["sheddable_capacity_kw"] === "number"
    ? capacityAnalysis["sheddable_capacity_kw"] as number
    : generator_capacity_kw - critical_load_kw;
  const annualRevenue = typeof economics?.["best_annual_revenue"] === "number"
    ? economics["best_annual_revenue"] as number
    : 0;

  const revenueFormatted = annualRevenue >= 1_000_000
    ? `$${(annualRevenue / 1_000_000).toFixed(2)}M`
    : `$${annualRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const target = `${sheddableKw.toFixed(0)} kW sheddable — ${revenueFormatted}/yr DR revenue`;

  return {
    workflow:  "demand_response",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
