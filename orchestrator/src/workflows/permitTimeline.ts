import { spawn } from "child_process";
import path from "path";

export interface PermitTimelineParams {
  jurisdiction: string;
  project_sqft: number;
  generator_count: number;
  project_type?: "new" | "renovation";
}

export interface PermitTimelineResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: Record<string, unknown> & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  permit_list: Array<{
    permit_name: string;
    duration_weeks_min: number;
    duration_weeks_max: number;
    duration_weeks_typical: number;
    sequential_dependency: string | null;
    agency: string;
    notes: string;
  }>;
  critical_path: {
    sequence: string[];
    total_weeks_min: number;
    total_weeks_max: number;
    total_months_typical: number;
  };
  parallel_tracks: string[][];
  expedite_options: Array<{
    option: string;
    weeks_saved: number;
    cost_premium: number;
  }>;
  total_timeline_months: number;
  risk_factors: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "permit-timeline-agent", "permit_timeline.py"
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
        let errMsg = `Permit timeline agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runPermitTimeline(params: PermitTimelineParams): Promise<PermitTimelineResult> {
  const { jurisdiction, project_sqft, generator_count, project_type } = params;
  const t0 = Date.now();
  const args = [jurisdiction, String(project_sqft), String(generator_count), project_type ?? "new"];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Permit timeline agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const total_months = agentOutput.critical_path.total_months_typical;
  const permit_count = agentOutput.permit_list.length;
  const label = `${jurisdiction} — ${total_months} month critical path (${permit_count} permits)`;
  return {
    workflow: "permit_timeline",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
