import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoolingType =
  | "air_cooled"
  | "water_cooled"
  | "free_cooling"
  | "hybrid"
  | "liquid_immersion";

export interface PueCalculatorParams {
  it_load_kw:               number;
  cooling_load_kw?:         number;   // omit to auto-estimate from cooling_type
  ups_efficiency_pct?:      number;   // default 94
  pdu_loss_pct?:            number;   // default 1.0
  lighting_kw?:             number;   // omit to auto-estimate
  cooling_type?:            CoolingType; // default "air_cooled"
  electricity_rate_per_kwh?: number;  // default 0.07
}

export interface PueCalculatorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface ImprovementScenario {
  name:                 string;
  new_pue:              number;
  pue_improvement:      number;
  annual_savings_kwh:   number;
  annual_savings_usd:   number;
  estimated_capex_usd?: number;
  simple_payback_years?: number;
  notes:                string;
}

interface AgentOutput {
  input: {
    it_load_kw:               number;
    cooling_load_kw:          number;
    cooling_load_estimated:   boolean;
    ups_efficiency_pct:       number;
    pdu_loss_pct:             number;
    lighting_kw:              number;
    lighting_estimated:       boolean;
    cooling_type:             string;
    cooling_type_label:       string;
    electricity_rate_per_kwh: number;
  };
  power_breakdown_kw: {
    it_load:        number;
    ups_losses:     number;
    pdu_losses:     number;
    cooling:        number;
    lighting:       number;
    misc_bms:       number;
    total_facility: number;
  };
  power_breakdown_pct:  Record<string, number>;
  pue: {
    value:            number;
    dcie_pct:         number;
    rating:           string;
    rating_label:     string;
    industry_avg:     number;
    best_practice:    number;
    vs_industry_avg:  number;
    vs_best_practice: number;
  };
  annual_energy: {
    it_kwh:       number;
    total_kwh:    number;
    overhead_kwh: number;
    overhead_pct: number;
  };
  annual_cost_usd: {
    total:              number;
    it:                 number;
    overhead:           number;
    per_kw_it_per_year: number;
  };
  carbon: {
    annual_co2_tonnes:     number;
    overhead_co2_tonnes:   number;
    grid_factor_kg_per_kwh: number;
    note:                  string;
  };
  benchmarks:            Record<string, unknown>;
  improvement_scenarios: ImprovementScenario[];
  recommendations:       string[];
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "pue-calculator-agent", "pue_calculator.py"
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
        let errMsg = `PUE calculator agent exited with code ${code}`;
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

export async function runPueCalculator(
  params: PueCalculatorParams
): Promise<PueCalculatorResult> {
  const {
    it_load_kw,
    cooling_load_kw,
    ups_efficiency_pct    = 94,
    pdu_loss_pct          = 1.0,
    lighting_kw,
    cooling_type          = "air_cooled",
    electricity_rate_per_kwh = 0.07,
  } = params;

  const t0 = Date.now();

  const args = [
    String(it_load_kw),
    cooling_load_kw !== undefined ? String(cooling_load_kw) : "auto",
    String(ups_efficiency_pct),
    String(pdu_loss_pct),
    lighting_kw !== undefined ? String(lighting_kw) : "auto",
    cooling_type,
    String(electricity_rate_per_kwh),
  ];

  const raw = await runPython(args);

  let agentOutput: AgentOutput;
  try {
    agentOutput = JSON.parse(raw) as AgentOutput;
  } catch {
    throw new Error(`PUE calculator returned non-JSON: ${raw.substring(0, 200)}`);
  }

  const label = `${it_load_kw} kW IT — PUE ${agentOutput.pue.value} (${agentOutput.pue.rating_label})`;

  return {
    workflow:  "pue_calculator",
    target:    label,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
