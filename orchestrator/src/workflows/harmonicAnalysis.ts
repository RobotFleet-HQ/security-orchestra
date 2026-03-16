import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarmonicAnalysisParams {
  total_load_kva:   number;
  ups_percentage:   number;
  vfd_percentage:   number;
  transformer_kva:  number;
}

export interface HarmonicAnalysisResult {
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
  "harmonic-analysis-agent", "harmonic_analysis.py"
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
        let errMsg = `Harmonic analysis agent exited with code ${code}`;
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

export async function runHarmonicAnalysis(
  params: HarmonicAnalysisParams
): Promise<HarmonicAnalysisResult> {
  const {
    total_load_kva,
    ups_percentage,
    vfd_percentage,
    transformer_kva,
  } = params;

  const t0 = Date.now();

  const args: string[] = [
    String(total_load_kva),
    String(ups_percentage),
    String(vfd_percentage),
    String(transformer_kva),
  ];

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Harmonic analysis agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  const harmonicAnalysis = agentOutput["harmonic_analysis"] as Record<string, unknown> | undefined;
  const ieee519          = agentOutput["ieee519_compliance"] as Record<string, unknown> | undefined;

  const thdI      = typeof harmonicAnalysis?.["thd_current_percent"] === "number"
    ? harmonicAnalysis["thd_current_percent"] as number
    : 0;
  const compliant = typeof ieee519?.["overall_compliant"] === "boolean"
    ? ieee519["overall_compliant"] as boolean
    : false;
  const kFactor   = typeof harmonicAnalysis?.["k_factor"] === "number"
    ? harmonicAnalysis["k_factor"] as number
    : 0;

  const target = `${total_load_kva} kVA — THD_I ${thdI.toFixed(2)}%, K-factor ${kFactor.toFixed(2)}, IEEE 519 ${compliant ? "COMPLIANT" : "NON-COMPLIANT"}`;

  return {
    workflow:  "harmonic_analysis",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
