import { spawn } from "child_process";
import path from "path";

export interface DnsArchitectureParams {
  rack_count:        number;
  zones_count?:      number;
  dnssec_required?:  "true" | "false";
}

export interface DnsArchitectureResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "dns-architecture-agent", "dns_architecture.py");

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
        let errMsg = `DNS architecture agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runDnsArchitecture(params: DnsArchitectureParams): Promise<DnsArchitectureResult> {
  const { rack_count, zones_count, dnssec_required } = params;
  const t0 = Date.now();
  const args: string[] = [String(rack_count)];
  if (zones_count !== undefined) args.push(String(zones_count));
  if (dnssec_required !== undefined) args.push(dnssec_required);
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`DNS architecture agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const authCount = typeof agentOutput["authoritative_server_count"] === "number" ? agentOutput["authoritative_server_count"] as number : 0;
  const qps = typeof agentOutput["estimated_qps"] === "number" ? agentOutput["estimated_qps"] as number : 0;
  return {
    workflow: "dns_architecture",
    target: `${rack_count} racks — ${authCount} authoritative servers, ~${qps} QPS`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
