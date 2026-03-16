import { spawn } from "child_process";
import path from "path";

export interface IpAddressingParams {
  rack_count:       number;
  hosts_per_rack:   number;
  vlans_required?:  number;
}

export interface IpAddressingResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "ip-addressing-agent", "ip_addressing.py");

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
        let errMsg = `IP addressing agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runIpAddressing(params: IpAddressingParams): Promise<IpAddressingResult> {
  const { rack_count, hosts_per_rack, vlans_required } = params;
  const t0 = Date.now();
  const args: string[] = [String(rack_count), String(hosts_per_rack)];
  if (vlans_required !== undefined) args.push(String(vlans_required));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`IP addressing agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const totalHosts = typeof agentOutput["total_hosts_needed"] === "number" ? agentOutput["total_hosts_needed"] as number : 0;
  const supernet = typeof agentOutput["recommended_supernet"] === "string" ? agentOutput["recommended_supernet"] as string : "unknown";
  return {
    workflow: "ip_addressing",
    target: `${rack_count} racks × ${hosts_per_rack} hosts — ${totalHosts} IPs needed, supernet ${supernet}`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
