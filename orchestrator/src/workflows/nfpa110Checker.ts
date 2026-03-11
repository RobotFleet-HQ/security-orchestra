import { spawn } from "child_process";
import path from "path";

export type FuelType = "diesel" | "natural_gas" | "propane";

export interface Nfpa110CheckerParams {
  generator_kw: number;
  fuel_capacity_gallons: number;
  runtime_hours: number;
  ats_transfer_time_seconds: number;
  level: 1 | 2;
  fuel_type?: FuelType;
}

export interface Nfpa110CheckerResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: AgentOutput & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  compliance: {
    overall_status: "pass" | "fail" | "conditional_pass";
    level: number;
    violations: Array<{ code: string; description: string; severity: string }>;
    warnings: string[];
    passed_checks: string[];
  };
  fuel_analysis: Record<string, unknown>;
  ats_analysis: Record<string, unknown>;
  remediation: string[];
  testing_requirements: Record<string, unknown>;
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "nfpa-110-checker-agent", "nfpa_110_checker.py"
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
        let errMsg = `NFPA 110 checker agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runNfpa110Checker(params: Nfpa110CheckerParams): Promise<Nfpa110CheckerResult> {
  const { generator_kw, fuel_capacity_gallons, runtime_hours, ats_transfer_time_seconds, level, fuel_type = "diesel" } = params;
  const t0 = Date.now();
  const args = [
    String(generator_kw),
    String(fuel_capacity_gallons),
    String(runtime_hours),
    String(ats_transfer_time_seconds),
    String(level),
    fuel_type,
  ];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`NFPA 110 checker returned non-JSON: ${raw.substring(0, 200)}`); }
  const status = agentOutput.compliance.overall_status;
  const violations = agentOutput.compliance.violations.length;
  const label = `${generator_kw} kW Level ${level} — ${status.toUpperCase()}${violations > 0 ? ` (${violations} violation${violations > 1 ? "s" : ""})` : ""}`;
  return {
    workflow: "nfpa_110_checker",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
