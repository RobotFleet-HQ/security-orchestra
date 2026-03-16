import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaterAvailabilityParams {
  cooling_tons:   number;
  location:       string;
  cooling_type?:  "tower" | "air" | "hybrid";
}

export interface WaterAvailabilityResult {
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
  "water-availability-agent", "water_availability.py"
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
        let errMsg = `Water availability agent exited with code ${code}`;
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

export async function runWaterAvailability(
  params: WaterAvailabilityParams
): Promise<WaterAvailabilityResult> {
  const {
    cooling_tons,
    location,
    cooling_type = "tower",
  } = params;

  const t0 = Date.now();

  const args: string[] = [String(cooling_tons), location, cooling_type];

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Water availability agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  const waterReq  = agentOutput["water_requirements"] as Record<string, unknown> | undefined;
  const droughtRisk = agentOutput["drought_risk"]     as Record<string, unknown> | undefined;

  const makeupGpm    = typeof waterReq?.["makeup_water_gpm"] === "number"
    ? waterReq["makeup_water_gpm"] as number
    : 0;
  const riskLevel    = typeof droughtRisk?.["risk_level"] === "string"
    ? droughtRisk["risk_level"] as string
    : "unknown";
  const waterCosts   = agentOutput["water_costs"] as Record<string, unknown> | undefined;
  const annualCost   = typeof waterCosts?.["total_annual_water_cost"] === "number"
    ? waterCosts["total_annual_water_cost"] as number
    : 0;

  const target = `${cooling_tons}T ${cooling_type} in ${location} — ${makeupGpm} gpm, drought risk: ${riskLevel}, $${annualCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr`;

  return {
    workflow:  "water_availability",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
