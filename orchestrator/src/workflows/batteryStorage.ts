import { spawn } from "child_process";
import path from "path";

export interface BatteryStorageParams {
  it_load_kw:              number;
  target_runtime_minutes:  number;
  chemistry:               "lithium_ion" | "lfp" | "vrla" | "flow";
  use_case?:               "ups_backup" | "peak_shaving" | "demand_response" | "islanding";
}

export interface BatteryStorageResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "battery-storage-agent", "battery_storage.py");

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
        let errMsg = `Battery storage agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runBatteryStorage(params: BatteryStorageParams): Promise<BatteryStorageResult> {
  const { it_load_kw, target_runtime_minutes, chemistry, use_case } = params;
  const t0 = Date.now();
  const args: string[] = [String(it_load_kw), String(target_runtime_minutes), chemistry];
  if (use_case !== undefined) args.push(use_case);
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Battery storage agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const capacityKwh = typeof agentOutput["usable_capacity_kwh"] === "number" ? agentOutput["usable_capacity_kwh"] as number : 0;
  const unitCount = typeof agentOutput["battery_units_required"] === "number" ? agentOutput["battery_units_required"] as number : 0;
  return {
    workflow: "battery_storage",
    target: `${it_load_kw} kW, ${target_runtime_minutes} min, ${chemistry} — ${capacityKwh.toFixed(0)} kWh usable, ${unitCount} units`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
