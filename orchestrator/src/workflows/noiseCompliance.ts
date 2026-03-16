import { spawn } from "child_process";
import path from "path";

export interface NoiseComplianceParams {
  generator_db_at_23ft: number;
  distance_to_property_line_ft: number;
  local_limit_db: number;
  zoning?: "residential" | "commercial" | "industrial";
}

export interface NoiseComplianceResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: Record<string, unknown> & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  sound_analysis: {
    generator_db_at_23ft: number;
    distance_to_property_line_ft: number;
    calculated_db_at_boundary: number;
    local_limit_db: number;
    excess_db: number;
    compliant: boolean;
  };
  attenuation_required: {
    required_db: number;
    enclosure_type: "standard" | "critical" | "hospital" | "acoustic_vault";
    enclosure_description: string;
    enclosure_cost_per_generator: number;
  };
  barrier_wall: {
    recommended: boolean;
    additional_attenuation_db: number;
    wall_spec: string;
    estimated_cost: number;
  };
  compliance_path: string;
  notes: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "noise-compliance-agent", "noise_compliance.py"
);

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      if (code === 0) { resolve(Buffer.concat(stdout).toString("utf8").trim()); }
      else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Noise compliance agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runNoiseCompliance(params: NoiseComplianceParams): Promise<NoiseComplianceResult> {
  const { generator_db_at_23ft, distance_to_property_line_ft, local_limit_db, zoning } = params;
  const t0 = Date.now();
  const args = [
    String(generator_db_at_23ft),
    String(distance_to_property_line_ft),
    String(local_limit_db),
    zoning ?? "commercial",
  ];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Noise compliance agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const calculated_db = agentOutput.sound_analysis.calculated_db_at_boundary;
  const compliant = agentOutput.sound_analysis.compliant;
  const label = `${calculated_db} dB at boundary vs ${local_limit_db} dB limit — ${compliant ? "COMPLIANT" : "NON-COMPLIANT"}`;
  return {
    workflow: "noise_compliance",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
