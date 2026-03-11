import { spawn } from "child_process";
import path from "path";

export type AtsVoltage = 120 | 208 | 240 | 277 | 480 | 600;
export type AtsPhases = 1 | 3;
export type AtsApplicationType = "emergency" | "legally_required" | "optional" | "critical";

export interface AtsSizingParams {
  load_kw: number;
  voltage: AtsVoltage;
  phases: AtsPhases;
  application_type?: AtsApplicationType;
}

export interface AtsSizingResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  load_analysis: {
    load_amps: number;
    design_amps_125pct: number;
    full_load_kva: number;
  };
  ats_specification: {
    rated_amps: number;
    voltage_rating: number;
    phases: number;
    poles: number;
    interrupt_rating_kaic: number;
    nec_article: string;
    application_type: string;
  };
  enclosure_options: Array<{ nema_type: string; description: string; recommended_for: string }>;
  coordination_notes: string[];
  installation_requirements: Record<string, unknown>;
  cable_recommendations: Record<string, unknown>;
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "ats-sizing-agent", "ats_sizing.py"
);

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child = spawn(python, [AGENT_PATH, ...args], { timeout: 15_000 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      if (code === 0) { resolve(Buffer.concat(stdout).toString("utf8").trim()); }
      else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `ATS sizing agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runAtsSizing(params: AtsSizingParams): Promise<AtsSizingResult> {
  const { load_kw, voltage, phases, application_type = "emergency" } = params;
  const t0 = Date.now();
  const args = [String(load_kw), String(voltage), String(phases), application_type];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`ATS sizing returned non-JSON: ${raw.substring(0, 200)}`); }
  const spec = agentOutput.ats_specification;
  const label = `${spec.rated_amps}A ${voltage}V ${phases}-phase ATS (NEC ${spec.nec_article})`;
  return {
    workflow: "ats_sizing",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
