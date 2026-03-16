import { spawn } from "child_process";
import path from "path";

export interface AirflowModelingParams {
  rack_count:        number;
  avg_kw_per_rack:   number;
  room_sqft:         number;
  containment_type:  "none" | "hot_aisle" | "cold_aisle" | "full_chimney";
}

export interface AirflowModelingResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "airflow-modeling-agent", "airflow_modeling.py");

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child  = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      if (code === 0) { resolve(Buffer.concat(stdout).toString("utf8").trim()); }
      else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Airflow modeling agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runAirflowModeling(params: AirflowModelingParams): Promise<AirflowModelingResult> {
  const { rack_count, avg_kw_per_rack, room_sqft, containment_type } = params;
  const t0 = Date.now();
  const args = [String(rack_count), String(avg_kw_per_rack), String(room_sqft), containment_type];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Airflow modeling agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const cfm = typeof agentOutput["total_cfm_required"] === "number" ? agentOutput["total_cfm_required"] as number : 0;
  const deltaT = typeof agentOutput["delta_t_f"] === "number" ? agentOutput["delta_t_f"] as number : 0;
  const risk = typeof agentOutput["hotspot_risk"] === "string" ? agentOutput["hotspot_risk"] as string : "unknown";
  return {
    workflow: "airflow_modeling",
    target: `${rack_count} racks @ ${avg_kw_per_rack} kW, ${containment_type} — ${cfm.toLocaleString()} CFM, ΔT ${deltaT}°F, ${risk} hotspot risk`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
