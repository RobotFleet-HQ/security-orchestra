import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataCenterTier    = "tier1" | "tier2" | "tier3" | "tier4";
export type ConstructionRegion =
  | "northeast" | "mid_atlantic" | "southeast" | "midwest"
  | "southwest" | "mountain"    | "pacific"    | "pacific_nw";
export type BuildingType = "new_build" | "shell_core" | "retrofit";

export interface ConstructionCostParams {
  capacity_mw:               number;
  tier?:                     DataCenterTier;       // default "tier3"
  region?:                   ConstructionRegion;   // default "southeast"
  building_type?:            BuildingType;         // default "new_build"
  electricity_rate_per_kwh?: number;               // default 0.07
}

export interface ConstructionCostResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface CostRange {
  low_usd:     number;
  typical_usd: number;
  high_usd:    number;
}

interface AgentOutput {
  input: {
    capacity_mw:              number;
    tier:                     string;
    tier_label:               string;
    region:                   string;
    region_label:             string;
    building_type:            string;
    building_type_label:      string;
    electricity_rate_per_kwh: number;
  };
  multipliers: {
    tier:          number;
    region:        number;
    building_type: number;
    combined:      number;
  };
  tier_specs: {
    redundancy:      string;
    uptime_pct:      number;
    downtime_hrs_yr: number;
    description:     string;
  };
  total_project_cost: CostRange & {
    cost_per_mw_low:     number;
    cost_per_mw_typical: number;
    cost_per_mw_high:    number;
  };
  cost_breakdown: {
    hard_costs: {
      total_low_usd:     number;
      total_typical_usd: number;
      total_high_usd:    number;
      categories:        Record<string, CostRange>;
      line_items:        Record<string, CostRange & { label: string }>;
    };
    soft_costs: {
      pct_of_hard:       number;
      total_low_usd:     number;
      total_typical_usd: number;
      total_high_usd:    number;
      breakdown:         Record<string, CostRange>;
    };
    contingency: CostRange & { pct: number };
  };
  category_pct_of_total: Record<string, number>;
  annual_opex_power: {
    assumed_pue:            number;
    total_facility_kw:      number;
    annual_kwh:             number;
    annual_cost_usd:        number;
    per_mw_it_per_year_usd: number;
    note:                   string;
  };
  construction_timeline: {
    low_months:     number;
    typical_months: number;
    high_months:    number;
    notes:          string;
  };
  region_context: {
    key_markets: string[];
    cost_notes:  string;
  };
  recommendations: string[];
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "construction-cost-agent", "construction_cost.py"
);

// ─── Child process runner ─────────────────────────────────────────────────────

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child  = spawn(python, [AGENT_PATH, ...args], { timeout: 15_000 });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Construction cost agent exited with code ${code}`;
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

export async function runConstructionCost(
  params: ConstructionCostParams
): Promise<ConstructionCostResult> {
  const {
    capacity_mw,
    tier                    = "tier3",
    region                  = "southeast",
    building_type           = "new_build",
    electricity_rate_per_kwh = 0.07,
  } = params;

  const t0 = Date.now();

  const args = [
    String(capacity_mw),
    tier,
    region,
    building_type,
    String(electricity_rate_per_kwh),
  ];

  const raw = await runPython(args);

  let agentOutput: AgentOutput;
  try {
    agentOutput = JSON.parse(raw) as AgentOutput;
  } catch {
    throw new Error(`Construction cost agent returned non-JSON: ${raw.substring(0, 200)}`);
  }

  const { total_project_cost: tpc } = agentOutput;
  const label = (
    `${capacity_mw} MW ${tier.toUpperCase()} — ` +
    `$${(tpc.cost_per_mw_typical / 1_000_000).toFixed(1)}M/MW typical ` +
    `($${(tpc.typical_usd / 1_000_000).toFixed(0)}M total)`
  );

  return {
    workflow:  "construction_cost",
    target:    label,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
