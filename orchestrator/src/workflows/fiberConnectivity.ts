import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FiberConnectivityParams {
  location:             string;
  target_markets:       string;
  redundancy_required?: "yes" | "no";
}

export interface FiberConnectivityResult {
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
  "fiber-connectivity-agent", "fiber_connectivity.py"
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
        let errMsg = `Fiber connectivity agent exited with code ${code}`;
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

export async function runFiberConnectivity(
  params: FiberConnectivityParams
): Promise<FiberConnectivityResult> {
  const {
    location,
    target_markets,
    redundancy_required = "yes",
  } = params;

  const t0 = Date.now();

  const args: string[] = [location, target_markets, redundancy_required];

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Fiber connectivity agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  const locationAnalysis = agentOutput["location_analysis"] as Record<string, unknown> | undefined;
  const fiberScore        = typeof agentOutput["fiber_score"] === "number"
    ? agentOutput["fiber_score"] as number
    : 0;
  const marketTier        = typeof locationAnalysis?.["market_tier"] === "string"
    ? locationAnalysis["market_tier"] as string
    : "unknown";
  const carrierCount      = typeof locationAnalysis?.["estimated_carriers_available"] === "number"
    ? locationAnalysis["estimated_carriers_available"] as number
    : 0;

  const target = `${location} — ${marketTier} market, ${carrierCount} carriers, score ${fiberScore}/10`;

  return {
    workflow:  "fiber_connectivity",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
