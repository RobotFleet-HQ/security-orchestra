import { spawn } from "child_process";
import path from "path";

export interface CybersecurityControlsParams {
  facility_type:         "colo" | "hyperscale" | "enterprise" | "edge";
  compliance_framework:  "soc2" | "pci_dss" | "hipaa" | "fedramp" | "iso27001";
  network_zones:         number;
}

export interface CybersecurityControlsResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "cybersecurity-controls-agent", "cybersecurity_controls.py");

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
        let errMsg = `Cybersecurity controls agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runCybersecurityControls(params: CybersecurityControlsParams): Promise<CybersecurityControlsResult> {
  const { facility_type, compliance_framework, network_zones } = params;
  const t0 = Date.now();
  const args = [facility_type, compliance_framework, String(network_zones)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Cybersecurity controls agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const controls = typeof agentOutput["total_controls"] === "number" ? agentOutput["total_controls"] as number : 0;
  const siemEps = typeof agentOutput["siem_eps"] === "number" ? agentOutput["siem_eps"] as number : 0;
  return {
    workflow: "cybersecurity_controls",
    target: `${facility_type} ${compliance_framework.toUpperCase()}, ${network_zones} zones — ${controls} controls, ${siemEps.toLocaleString()} SIEM EPS`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
