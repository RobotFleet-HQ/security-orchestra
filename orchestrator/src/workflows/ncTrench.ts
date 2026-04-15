import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NcTrenchParams {
  route_length_ft:  number;
  conduit_count:    number;
  conduit_size_in:  number;
  soil_type:        string;
  voltage_class:    string;
  county:           string;
  crossing_type:    string;
}

export interface NcTrenchResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface CostEstimate {
  excavation_cost_usd:           number;
  conduit_material_cost_usd:     number;
  backfill_compaction_cost_usd:  number;
  concrete_encasement_cost_usd:  number;
  crossing_cost_usd:             number;
  warning_tape_tracer_wire_usd:  number;
  inspection_testing_usd:        number;
  mobilization_usd:              number;
  subtotal_usd:                  number;
  contingency_15pct_usd:         number;
  total_estimated_cost_usd:      number;
  cost_per_linear_ft_usd:        number;
}

interface AgentOutput {
  route_length_ft:      number;
  county:               string;
  suggested_soil_type:  string;
  soil_match_note:      string;
  input:                Record<string, unknown>;
  voltage_requirements: {
    class:                       string;
    label:                       string;
    min_burial_depth_in:         number;
    separation_from_telecom_in:  number;
    conduit_type:                string;
  };
  soil_classification: {
    type:                  string;
    description:           string;
    osha_class:            string;
    excavation_difficulty: string;
    dewatering_risk:       string;
  };
  trench_dimensions: {
    trench_depth_in:     number;
    trench_depth_ft:     number;
    trench_width_in:     number;
    trench_width_ft:     number;
    duct_bank_layout:    string;
    duct_bank_width_in:  number;
    duct_bank_height_in: number;
    conduit_od_in:       number;
  };
  crossing_details: {
    type:                  string;
    description:           string;
    boring_required:       boolean;
    ncdot_permit_required: boolean;
  };
  cost_estimate:                CostEstimate;
  osha_requirements:            Record<string, unknown>;
  nc_permits:                   Array<Record<string, unknown>>;
  timeline_estimate: {
    permit_weeks_low:    number;
    permit_weeks_high:   number;
    construction_days:   number;
    total_weeks_low:     number;
    total_weeks_high:    number;
    note:                string;
  };
  data_center_considerations:   string[];
  disclaimer:                   string;
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "nc-trench-agent", "nc_trench.py"
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
        let errMsg = `NC trench agent exited with code ${code}`;
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

export async function runNcTrench(
  params: NcTrenchParams
): Promise<NcTrenchResult> {
  const {
    route_length_ft, conduit_count, conduit_size_in,
    soil_type, voltage_class, county, crossing_type,
  } = params;
  const t0 = Date.now();

  const raw = await runPython([
    String(route_length_ft),
    String(conduit_count),
    String(conduit_size_in),
    soil_type,
    voltage_class,
    county,
    crossing_type,
  ]);

  let agentOutput: AgentOutput;
  try {
    agentOutput = JSON.parse(raw) as AgentOutput;
  } catch {
    throw new Error(`NC trench agent returned non-JSON: ${raw.substring(0, 200)}`);
  }

  const totalCost = agentOutput.cost_estimate.total_estimated_cost_usd;
  const label = `${route_length_ft} ft — ${conduit_count}× ${conduit_size_in}" ${voltage_class} (${county} County, NC) — $${totalCost.toLocaleString()}`;

  return {
    workflow:  "nc_trench",
    target:    label,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
