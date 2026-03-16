import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoltageDropParams {
  load_amps:           number;
  distance_feet:       number;
  voltage:             number;
  circuit_type:        "feeder" | "branch";
  conductor_material?: "copper" | "aluminum";
}

export interface VoltageDropResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown> & { duration_ms: number };
}

// ─── Python agent path ────────────────────────────────────────────────────────
// __dirname = orchestrator/dist/workflows/
// ../../../ = security-orchestra/

const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "voltage-drop-agent", "voltage_drop.py"
);

// ─── Child process runner ─────────────────────────────────────────────────────

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child  = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Voltage drop agent exited with code ${code}`;
        try {
          const parsed = JSON.parse(errText) as { error?: string };
          if (parsed.error) errMsg = parsed.error;
        } catch { /* use raw text */ }
        reject(new Error(errMsg));
      }
    });

    child.on("error", (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runVoltageDrop(
  params: VoltageDropParams
): Promise<VoltageDropResult> {
  const {
    load_amps,
    distance_feet,
    voltage,
    circuit_type,
    conductor_material = "copper",
  } = params;

  const t0 = Date.now();

  const args: string[] = [
    String(load_amps),
    String(distance_feet),
    String(voltage),
    circuit_type,
    conductor_material,
  ];

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Voltage drop agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  const vdAnalysis       = agentOutput["voltage_drop_analysis"] as Record<string, unknown> | undefined;
  const recommendedConductor = agentOutput["recommended_conductor"] as Record<string, unknown> | undefined;

  const vdPercent  = typeof vdAnalysis?.["voltage_drop_percent"] === "number"
    ? vdAnalysis["voltage_drop_percent"] as number
    : 0;
  const compliant  = typeof vdAnalysis?.["compliant"] === "boolean"
    ? vdAnalysis["compliant"] as boolean
    : false;
  const recAwg     = typeof recommendedConductor?.["awg"] === "string"
    ? recommendedConductor["awg"] as string
    : "unknown";

  const target = `${load_amps}A at ${distance_feet}ft ${voltage}V — ${vdPercent.toFixed(2)}% drop, rec ${recAwg} AWG ${conductor_material}, ${compliant ? "NEC COMPLIANT" : "EXCEEDS NEC LIMIT"}`;

  return {
    workflow:  "voltage_drop",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
