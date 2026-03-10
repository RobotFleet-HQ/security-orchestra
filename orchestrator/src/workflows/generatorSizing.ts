import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RedundancyTier = "N" | "N+1" | "2N" | "2N+1";

export interface GeneratorSizingParams {
  load_kw:      number;
  tier:         RedundancyTier;
  altitude_ft?: number;
  temp_f?:      number;
}

export interface GeneratorSizingResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    genset_kva:           number;
    genset_kw:            number;
    unit_model:           string;
    unit_kw:              number;
    fuel_gph:             number;
    tank_size_gal:        number;
    runtime_hours:        number;
    runtime_target_hours: number;
    ats_amps_480v:        number;
    nox_lb_per_hr:        number;
    redundancy_config:    RedundancyConfig;
    cost_estimate:        CostEstimate;
    derating:             Derating;
    compliance:           Compliance;
    input:                GeneratorSizingParams;
    notes:                string[];
    duration_ms:          number;
  };
}

interface RedundancyConfig {
  total_units:    number;
  active_units:   number;
  standby_units:  number;
  description:    string;
  nfpa110_class:  string;
}

interface CostEstimate {
  equipment_usd:    number;
  installed_usd:    number;
  per_kw_installed: number;
}

interface Derating {
  altitude_factor:     number;
  temperature_factor:  number;
  combined_factor:     number;
  derated_required_kw: number;
}

interface Compliance {
  nfpa_110_class:    string;
  nfpa_110_fuel_req: string;
  epa_emission_tier: string;
  ieee_446:          string;
}

// ─── Python script path ───────────────────────────────────────────────────────
// Resolves to security-orchestra/generator-sizing-agent/generator_sizing.py
// regardless of where the compiled JS sits.

// __dirname = orchestrator/dist/workflows/
// ../../../  = security-orchestra/
const AGENT_PATH = path.join(
  __dirname, "..", "..", "..",
  "generator-sizing-agent", "generator_sizing.py"
);

// ─── Child process runner ─────────────────────────────────────────────────────

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child  = spawn(python, [AGENT_PATH, ...args], { timeout: 30_000 });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        const errText = Buffer.concat(stderr).toString("utf8").trim();
        let errMsg = `Generator sizing agent exited with code ${code}`;
        try {
          const parsed = JSON.parse(errText) as { error?: string };
          if (parsed.error) errMsg = parsed.error;
        } catch { /* use raw text */ }
        reject(new Error(errMsg));
      }
    });

    child.on("error", (err) => reject(new Error(`Failed to start Python: ${err.message}`)));
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runGeneratorSizing(
  params: GeneratorSizingParams
): Promise<GeneratorSizingResult> {
  const { load_kw, tier, altitude_ft = 0, temp_f = 77 } = params;
  const t0 = Date.now();

  const raw = await runPython([
    String(load_kw),
    tier,
    String(altitude_ft),
    String(temp_f),
  ]);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Generator agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  return {
    workflow:  "generator_sizing",
    target:    `${load_kw}kW ${tier} (${altitude_ft}ft, ${temp_f}°F)`,
    timestamp: new Date().toISOString(),
    results: {
      ...(agentOutput as Omit<GeneratorSizingResult["results"], "duration_ms">),
      duration_ms: Date.now() - t0,
    },
  };
}
