import { spawn } from "child_process";
import path from "path";

export interface NetworkTopologyParams {
  rack_count:             number;
  target_bandwidth_gbps:  number;
  redundancy_type:        "N+1" | "2N" | "mesh";
}

export interface NetworkTopologyResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "network-topology-agent", "network_topology.py");

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
        let errMsg = `Network topology agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runNetworkTopology(params: NetworkTopologyParams): Promise<NetworkTopologyResult> {
  const { rack_count, target_bandwidth_gbps, redundancy_type } = params;
  const t0 = Date.now();
  const args = [String(rack_count), String(target_bandwidth_gbps), redundancy_type];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Network topology agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const switchCounts = agentOutput["switch_counts"] as Record<string, unknown> | undefined;
  const totalSwitches = typeof switchCounts?.["total_switches"] === "number" ? switchCounts["total_switches"] as number : 0;
  const bwCapacity = typeof agentOutput["bandwidth_capacity_gbps"] === "number" ? agentOutput["bandwidth_capacity_gbps"] as number : 0;
  return {
    workflow: "network_topology",
    target: `${rack_count} racks, ${target_bandwidth_gbps} Gbps, ${redundancy_type} — ${totalSwitches} switches, ${bwCapacity} Gbps capacity`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
