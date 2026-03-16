import { spawn } from "child_process";
import path from "path";

export interface ChillerSizingParams {
  it_load_kw:    number;
  pue:           number;
  cooling_type:  "air_cooled" | "water_cooled" | "free_cooling";
  redundancy:    "N+1" | "2N";
}

export interface ChillerSizingResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

const AGENT_PATH = path.join(__dirname, "..", "..", "..", "chiller-sizing-agent", "chiller_sizing.py");

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
        let errMsg = `Chiller sizing agent exited with code ${code}`;
        try { const p = JSON.parse(errText) as { error?: string }; if (p.error) errMsg = p.error; } catch { }
        reject(new Error(errMsg));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

export async function runChillerSizing(params: ChillerSizingParams): Promise<ChillerSizingResult> {
  const { it_load_kw, pue, cooling_type, redundancy } = params;
  const t0 = Date.now();
  const args = [String(it_load_kw), String(pue), cooling_type, redundancy];
  const raw = await runPython(args);
  let agentOutput: Record<string, unknown>;
  try { agentOutput = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`Chiller sizing agent returned non-JSON: ${raw.substring(0, 200)}`); }
  const tons = typeof agentOutput["cooling_load_tons"] === "number" ? agentOutput["cooling_load_tons"] as number : 0;
  const count = typeof agentOutput["chiller_count"] === "number" ? agentOutput["chiller_count"] as number : 0;
  const size = typeof agentOutput["chiller_size_tons_each"] === "number" ? agentOutput["chiller_size_tons_each"] as number : 0;
  return {
    workflow: "chiller_sizing",
    target: `${it_load_kw} kW IT, PUE ${pue} — ${tons} tons, ${count}x ${size}T ${cooling_type} (${redundancy})`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
