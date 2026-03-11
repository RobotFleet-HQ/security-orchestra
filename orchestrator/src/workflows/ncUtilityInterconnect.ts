import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NcUtilityInterconnectParams {
  load_mw:    number;
  voltage_kv?: number;
  load_type?:  "data_center" | "industrial" | "commercial";
  state?:      string;
}

export interface NcUtilityInterconnectResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  utility:           string;
  utility_key:       string;
  abbreviation:      string;
  states:            string[];
  territory:         string;
  rto_iso:           string;
  input:             Record<string, unknown>;
  interconnect_process: {
    process_name:            string;
    queue_approach:          string;
    timeline_months_min:     number;
    timeline_months_typical: number;
    timeline_months_max:     number;
    timeline_note:           string;
    steps:                   Array<Record<string, string>>;
    constraint_notes:        string[];
  };
  costs: {
    study_deposits: {
      total_study_deposits_usd:  number;
      refundable_usd:            number;
      non_refundable_usd:        number;
      deposit_per_kw_range_low:  number;
      deposit_per_kw_range_high: number;
      deposit_range_low_usd:     number;
      deposit_range_high_usd:    number;
      deposit_note:              string;
    };
    network_upgrades_estimate:    Record<string, unknown>;
    customer_facilities_estimate: Record<string, unknown>;
    total_upfront_low_usd:        number;
    total_upfront_high_usd:       number;
    first_year_total_low_usd:     number;
    first_year_total_high_usd:    number;
  };
  annual_operating_cost: {
    total_annual_cost_usd:  number;
    demand_charges_usd:     number;
    energy_charges_usd:     number;
    effective_rate_per_kwh: number;
    per_mw_per_year_usd:    number;
    notes:                  string;
  };
  "10yr_electricity_npv_usd": number;
  rate_structure:             Record<string, unknown>;
  special_programs:           Array<Record<string, string>>;
  competitive_intel:          string[];
  regulatory:                 Record<string, unknown>;
  warnings:                   string[];
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "nc-utility-interconnect-agent", "nc_utility_interconnect.py"
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
        let errMsg = `NC utility interconnect agent exited with code ${code}`;
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

export async function runNcUtilityInterconnect(
  params: NcUtilityInterconnectParams
): Promise<NcUtilityInterconnectResult> {
  const { load_mw, voltage_kv, load_type = "data_center", state } = params;
  const t0 = Date.now();

  const args = [
    String(load_mw),
    voltage_kv ? String(voltage_kv) : "auto",
    load_type,
    state ?? "",
  ];

  const raw = await runPython(args);

  let agentOutput: AgentOutput;
  try {
    agentOutput = JSON.parse(raw) as AgentOutput;
  } catch {
    throw new Error(`NC utility agent returned non-JSON: ${raw.substring(0, 200)}`);
  }

  const label = `${load_mw} MW — NC Utility (${agentOutput.rto_iso})`;

  return {
    workflow:  "nc_utility_interconnect",
    target:    label,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
