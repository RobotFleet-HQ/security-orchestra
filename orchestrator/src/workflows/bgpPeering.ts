import { spawn } from "child_process";
import path from "path";

export interface BgpPeeringParams {
  asn:               number;
  peer_count:        number;
  transit_providers: number;
}

export interface BgpPeeringResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "bgp-peering-agent", "bgp_peering.py");

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
        let errMsg = `BGP peering agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runBgpPeering(params: BgpPeeringParams): Promise<BgpPeeringResult> {
  const { asn, peer_count, transit_providers } = params;
  const t0 = Date.now();
  const args = [String(asn), String(peer_count), String(transit_providers)];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`BGP peering agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const rrCount = typeof agentOutput["route_reflector_count"] === "number" ? agentOutput["route_reflector_count"] as number : 0;
  const policy = typeof agentOutput["recommended_routing_policy"] === "string" ? agentOutput["recommended_routing_policy"] as string : "unknown";
  return {
    workflow: "bgp_peering",
    target: `ASN ${asn}: ${peer_count} peers, ${transit_providers} transit — ${rrCount} RR(s), ${policy}`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
