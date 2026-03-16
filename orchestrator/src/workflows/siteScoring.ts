import { spawn } from "child_process";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteScoringParams {
  sites_json: string;
}

export interface SiteScoringResult {
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
  "site-scoring-agent", "site_scoring.py"
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
        let errMsg = `Site scoring agent exited with code ${code}`;
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

export async function runSiteScoring(
  params: SiteScoringParams
): Promise<SiteScoringResult> {
  const { sites_json } = params;

  const t0 = Date.now();

  const args: string[] = [sites_json];

  const raw = await runPython(args);

  let agentOutput: Record<string, unknown>;
  try {
    agentOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Site scoring agent returned non-JSON output: ${raw.substring(0, 200)}`);
  }

  const recommendation = agentOutput["recommendation"] as Record<string, unknown> | undefined;
  const inputData      = agentOutput["input"]          as Record<string, unknown> | undefined;

  const topSite       = typeof recommendation?.["top_site"] === "string"
    ? recommendation["top_site"] as string
    : "unknown";
  const sitesEvaluated = typeof inputData?.["sites_evaluated"] === "number"
    ? inputData["sites_evaluated"] as number
    : 0;

  const scoredSites = Array.isArray(agentOutput["scored_sites"])
    ? agentOutput["scored_sites"] as Array<Record<string, unknown>>
    : [];
  const topScore = scoredSites.length > 0 && typeof scoredSites[0]["total_score"] === "number"
    ? scoredSites[0]["total_score"] as number
    : 0;

  const target = `${sitesEvaluated} sites evaluated — top: ${topSite} (${topScore}/100)`;

  return {
    workflow:  "site_scoring",
    target,
    timestamp: new Date().toISOString(),
    results: {
      ...agentOutput,
      duration_ms: Date.now() - t0,
    },
  };
}
