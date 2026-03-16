import { spawn } from "child_process";
import path from "path";

export interface PhysicalSecurityParams {
  facility_sqft:  number;
  tier:           number;
  perimeter_ft?:  number;
}

export interface PhysicalSecurityResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "physical-security-agent", "physical_security.py");

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
        let errMsg = `Physical security agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runPhysicalSecurity(params: PhysicalSecurityParams): Promise<PhysicalSecurityResult> {
  const { facility_sqft, tier, perimeter_ft } = params;
  const t0 = Date.now();
  const args: string[] = [String(facility_sqft), String(tier)];
  if (perimeter_ft !== undefined) args.push(String(perimeter_ft));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Physical security agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const zones = typeof agentOutput["security_zone_count"] === "number" ? agentOutput["security_zone_count"] as number : 0;
  const cameras = (typeof agentOutput["camera_count_interior"] === "number" ? agentOutput["camera_count_interior"] as number : 0)
    + (typeof agentOutput["camera_count_perimeter"] === "number" ? agentOutput["camera_count_perimeter"] as number : 0);
  const annualCost = typeof agentOutput["estimated_annual_security_cost"] === "number" ? agentOutput["estimated_annual_security_cost"] as number : 0;
  return {
    workflow: "physical_security",
    target: `Tier ${tier}, ${facility_sqft.toLocaleString()} sqft — ${zones} security zones, ${cameras} cameras, $${(annualCost/1000).toFixed(0)}K/yr`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
