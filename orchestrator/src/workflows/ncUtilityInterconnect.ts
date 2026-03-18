import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NcUtilityInterconnectParams {
  utility:          string;
  capacity_kw:      number;
  county:           string;
  interconnect_type: string;
  voltage_level:    string;
  project_type:     string;
}

export interface NcUtilityInterconnectResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  utility:              string;
  utility_abbreviation: string;
  ncuc_docket_prefix:   string;
  county:               string;
  territory_confirmed:  boolean;
  territory_note:       string;
  input:                Record<string, unknown>;
  interconnect_type_details: {
    type:                      string;
    description:               string;
    export_allowed:            boolean;
    ncuc_filing_required:      boolean;
    engineering_study_required: boolean;
  };
  voltage_requirements: {
    voltage_level:    string;
    required_studies: string[];
    protection_type:  string;
  };
  application_process: {
    portal:          string;
    contact_email:   string;
    tariff_schedule: string;
    steps:           Array<Record<string, unknown>>;
    total_steps:     number;
  };
  timeline_estimate: {
    total_weeks_low:   number;
    total_weeks_high:  number;
    total_months_low:  number;
    total_months_high: number;
    note:              string;
  };
  fees: {
    application_fee_usd:             number;
    feasibility_study_deposit_usd:   number;
    protection_relay_engineering_usd: number;
    total_estimated_fees_usd:        number;
    note:                            string;
  };
  ncuc_requirements: {
    filing_required:    boolean;
    docket:             string;
    public_notice_days: number;
    portal:             string;
  };
  data_center_considerations: string[];
  disclaimer:                 string;
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
  const { utility, capacity_kw, county, interconnect_type, voltage_level, project_type } = params;
  const t0 = Date.now();

  const raw = await runPython([
    utility,
    String(capacity_kw),
    county,
    interconnect_type,
    voltage_level,
    project_type,
  ]);

  let agentOutput: AgentOutput;
  try {
    agentOutput = JSON.parse(raw) as AgentOutput;
  } catch {
    throw new Error(`NC utility agent returned non-JSON: ${raw.substring(0, 200)}`);
  }

  return {
    workflow:  "nc_utility_interconnect",
    target:    `${capacity_kw} kW — ${utility} (${county} County, NC)`,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
