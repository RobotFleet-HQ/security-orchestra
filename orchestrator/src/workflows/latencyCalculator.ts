import { spawn } from "child_process";
import path from "path";

export interface LatencyCalculatorParams {
  distance_km:  number;
  medium:       "fiber" | "copper" | "wireless";
  hops?:        number;
}

export interface LatencyCalculatorResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "latency-calculator-agent", "latency_calculator.py");

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
        let errMsg = `Latency calculator agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runLatencyCalculator(params: LatencyCalculatorParams): Promise<LatencyCalculatorResult> {
  const { distance_km, medium, hops } = params;
  const t0 = Date.now();
  const args: string[] = [String(distance_km), medium];
  if (hops !== undefined) args.push(String(hops));
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Latency calculator agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const rtt = typeof agentOutput["rtt_ms"] === "number" ? agentOutput["rtt_ms"] as number : 0;
  const classification = typeof agentOutput["classification"] === "string" ? agentOutput["classification"] as string : "unknown";
  return {
    workflow: "latency_calculator",
    target: `${distance_km} km ${medium} — RTT ${rtt.toFixed(2)} ms (${classification})`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
