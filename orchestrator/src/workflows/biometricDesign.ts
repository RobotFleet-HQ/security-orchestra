import { spawn } from "child_process";
import path from "path";

export interface BiometricDesignParams {
  staff_count:      number;
  security_zones:   number;
  biometric_type:   "fingerprint" | "iris" | "face" | "palm" | "multifactor";
}

export interface BiometricDesignResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "biometric-design-agent", "biometric_design.py");

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
        let errMsg = `Biometric design agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runBiometricDesign(params: BiometricDesignParams): Promise<BiometricDesignResult> {
  const { staff_count, security_zones, biometric_type } = params;
  const t0 = Date.now();
  const args = [String(staff_count), String(security_zones), biometric_type];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Biometric design agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const readers = typeof agentOutput["total_readers"] === "number" ? agentOutput["total_readers"] as number : 0;
  const far = typeof agentOutput["far_pct"] === "number" ? agentOutput["far_pct"] as number : 0;
  return {
    workflow: "biometric_design",
    target: `${staff_count} staff, ${security_zones} zones, ${biometric_type} — ${readers} readers, FAR ${far}%`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
