import { spawn } from "child_process";
import path from "path";

export interface HumidificationParams {
  room_sqft:       number;
  it_load_kw:      number;
  climate_zone:    "arid" | "temperate" | "humid";
  target_rh_pct?:  number;
}

export interface HumidificationResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "humidification-agent", "humidification.py");

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
        let errMsg = `Humidification agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runHumidification(params: HumidificationParams): Promise<HumidificationResult> {
  const { room_sqft, it_load_kw, climate_zone, target_rh_pct } = params;
  const t0 = Date.now();
  const args: string[] = [String(room_sqft), String(it_load_kw), climate_zone];
  if (target_rh_pct !== undefined) args.push(String(target_rh_pct));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Humidification agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const humCap = typeof agentOutput["humidifier_capacity_lbs_per_hr"] === "number" ? agentOutput["humidifier_capacity_lbs_per_hr"] as number : 0;
  const compliant = typeof agentOutput["ashrae_compliant"] === "boolean" ? agentOutput["ashrae_compliant"] as boolean : false;
  return {
    workflow: "humidification",
    target: `${room_sqft.toLocaleString()} sqft, ${climate_zone} — ${humCap} lbs/hr humidification, ASHRAE ${compliant ? "COMPLIANT" : "NON-COMPLIANT"}`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
