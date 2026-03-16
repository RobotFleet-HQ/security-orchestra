import { spawn } from "child_process";
import path from "path";

export interface FireSuppressionParams {
  room_length_ft: number;
  room_width_ft: number;
  ceiling_height_ft: number;
  agent_type?: "FM200" | "Novec1230" | "Inergen" | "CO2";
  enclosure_type?: "server_room" | "ups_room" | "battery_room" | "cable_vault" | "mechanical";
}

export interface FireSuppressionResult {
  workflow: string;
  target: string;
  timestamp: string;
  results: Record<string, unknown> & { duration_ms: number };
}

interface AgentOutput {
  input: Record<string, unknown>;
  room_analysis: {
    volume_cf: number;
    volume_m3: number;
    floor_area_sqft: number;
  };
  agent_calculation: {
    agent_type: string;
    design_concentration_pct: number;
    agent_quantity_lbs: number;
    cylinder_capacity_lbs: number;
    cylinders_required: number;
    discharge_time_seconds: number;
    nfpa_2001_compliant: boolean;
  };
  system_design: {
    pre_action_sprinkler_required: boolean;
    detection_zones: number;
    abort_delay_seconds: number;
    pneumatic_abort_switch: boolean;
  };
  cost_estimate: {
    equipment_cost: number;
    installation_cost: number;
    total_system_cost: number;
    annual_inspection_cost: number;
  };
  installation_notes: string[];
  safety_warnings: string[];
}

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "fire-suppression-agent", "fire_suppression.py"
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
        let errMsg = `Fire suppression agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runFireSuppression(params: FireSuppressionParams): Promise<FireSuppressionResult> {
  const { room_length_ft, room_width_ft, ceiling_height_ft, agent_type, enclosure_type } = params;
  const t0 = Date.now();
  const args = [
    String(room_length_ft),
    String(room_width_ft),
    String(ceiling_height_ft),
    agent_type ?? "FM200",
    enclosure_type ?? "server_room",
  ];
  const raw = await runPython(args);
  let agentOutput: AgentOutput;
  try { agentOutput = JSON.parse(raw) as AgentOutput; }
  catch { throw new Error(`Fire suppression agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const volume_cf = agentOutput.room_analysis.volume_cf;
  const agent_quantity_lbs = agentOutput.agent_calculation.agent_quantity_lbs;
  const cylinders_required = agentOutput.agent_calculation.cylinders_required;
  const resolved_agent = agentOutput.agent_calculation.agent_type;
  const label = `${volume_cf} cf room — ${agent_quantity_lbs} lbs ${resolved_agent} (${cylinders_required} cylinders)`;
  return {
    workflow: "fire_suppression",
    target: label,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
