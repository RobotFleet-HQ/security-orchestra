import { spawn } from "child_process";
import path from "path";

export interface BandwidthSizingParams {
  rack_count:                  number;
  servers_per_rack:            number;
  bandwidth_per_server_gbps:   number;
}

export interface BandwidthSizingResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "bandwidth-sizing-agent", "bandwidth_sizing.py");

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
        let errMsg = `Bandwidth sizing agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runBandwidthSizing(params: BandwidthSizingParams): Promise<BandwidthSizingResult> {
  const { rack_count, servers_per_rack, bandwidth_per_server_gbps } = params;
  const t0 = Date.now();
  const args = [String(rack_count), String(servers_per_rack), String(bandwidth_per_server_gbps)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Bandwidth sizing agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const totalTbps = typeof agentOutput["total_bandwidth_tbps"] === "number" ? agentOutput["total_bandwidth_tbps"] as number : 0;
  const fabricSpeed = typeof agentOutput["recommended_fabric_speed_gbps"] === "number" ? agentOutput["recommended_fabric_speed_gbps"] as number : 0;
  return {
    workflow: "bandwidth_sizing",
    target: `${rack_count * servers_per_rack} servers — ${totalTbps} Tbps total, ${fabricSpeed}G fabric recommended`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
