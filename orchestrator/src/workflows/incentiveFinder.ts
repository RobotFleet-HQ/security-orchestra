import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncentiveFinderParams {
  state:                string;
  capex:                number;
  it_load_mw:           number;
  renewable_percentage?: number;
  new_jobs_created?:    number;
}

export interface IncentiveFinderResult {
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
  "incentive-finder-agent", "incentive_finder.py"
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
        let errMsg = `Incentive finder agent exited with code ${code}`;
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

export async function runIncentiveFinder(
  params: IncentiveFinderParams
): Promise<IncentiveFinderResult> {
  const {
    state,
    capex,
    it_load_mw,
    renewable_percentage,
    new_jobs_created,
  } = params;

  const t0 = Date.now();

  const args: string[] = [
    state,
    String(capex),
    String(it_load_mw),
  ];
  if (renewable_percentage !== undefined) args.push(String(renewable_percentage));
  if (new_jobs_created     !== undefined) args.push(String(new_jobs_created));

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Incentive finder agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  // Extract values for target label
  const eligibleIncentives = Array.isArray(agentOutput["eligible_incentives"])
    ? agentOutput["eligible_incentives"] as unknown[]
    : [];
  const incentiveCount = eligibleIncentives.length;
  const totalSavings   = typeof agentOutput["total_potential_savings"] === "number"
    ? agentOutput["total_potential_savings"] as number
    : 0;

  const savingsFormatted = totalSavings >= 1_000_000
    ? `$${(totalSavings / 1_000_000).toFixed(2)}M`
    : `$${totalSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const target = `${state.toUpperCase()} — ${incentiveCount} incentives, ${savingsFormatted} potential savings`;

  return {
    workflow:  "incentive_finder",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
