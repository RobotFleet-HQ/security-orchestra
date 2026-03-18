import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TierCertificationParams {
  generator_config:               string;
  ups_topology:                   string;
  cooling_redundancy:             string;
  power_paths:                    number;
  fuel_runtime_hours:             number;
  transfer_switch_type:           string;
  has_concurrent_maintainability: boolean;
  has_fault_tolerance:            boolean;
  target_tier:                    "Tier I" | "Tier II" | "Tier III" | "Tier IV";
}

export interface TierCertificationResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface TierDetails {
  description:     string;
  uptime_pct:      number;
  downtime_hrs_yr: number;
}

interface Gap {
  gap:                      string;
  requirement:              string;
  remediation:              string;
  estimated_cost_low_usd:  number;
  estimated_cost_high_usd: number;
  priority:                 string;
}

interface GapAnalysis {
  current_tier:                    string;
  target_tier:                     string;
  already_qualifies:               boolean;
  gap_count:                       number;
  gaps:                            Gap[];
  total_remediation_cost_low_usd:  number;
  total_remediation_cost_high_usd: number;
}

interface AgentOutput {
  current_tier:          string;
  target_tier:           string;
  qualifies_for_target:  boolean;
  readiness_score_pct:   number;
  current_tier_details:  TierDetails;
  target_tier_details:   TierDetails;
  assessed_capabilities: Record<string, unknown>;
  gap_analysis:          GapAnalysis;
  priority_remediation_steps: string[];
  total_remediation_cost_low_usd:  number;
  total_remediation_cost_high_usd: number;
  disclaimer:            string;
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "tier-certification-agent", "tier_certification.py"
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
        let errMsg = `Tier certification agent exited with code ${code}`;
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

export async function runTierCertification(
  params: TierCertificationParams
): Promise<TierCertificationResult> {
  const {
    generator_config, ups_topology, cooling_redundancy,
    power_paths, fuel_runtime_hours, transfer_switch_type,
    has_concurrent_maintainability, has_fault_tolerance, target_tier,
  } = params;

  const t0 = Date.now();

  const args = [
    generator_config,
    ups_topology,
    cooling_redundancy,
    String(power_paths),
    String(fuel_runtime_hours),
    transfer_switch_type,
    String(has_concurrent_maintainability),
    String(has_fault_tolerance),
    target_tier,
  ];

  const raw = await runPython(args);

  let agentOutput: AgentOutput;
  try {
    agentOutput = JSON.parse(raw) as AgentOutput;
  } catch {
    throw new Error(`Tier certification agent returned non-JSON: ${raw.substring(0, 200)}`);
  }

  return {
    workflow:  "tier_certification_checker",
    target:    `${target_tier} readiness — ${generator_config}`,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
