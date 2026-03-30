// ─── AGNTCY Layer ─────────────────────────────────────────────────────────────
// ACP per-agent endpoints (full spec), OASF manifests, SLIM pub/sub transport,
// and Agent Directory registration/discovery.
//
// Mount via: mountAgntcy(app, deps) inside the HTTP server branch of main().

import crypto, { createHmac } from "crypto";
import express from "express";
import { AuditEntry } from "./audit.js";
import { CanonicalResponse } from "./canonical.js";

// ─── Dependency interface ─────────────────────────────────────────────────────

export interface AgntcyDeps {
  workflows: Record<string, { description: string; params: string[]; credits: number }>;
  chains:    Record<string, { name: string; description: string; credits: number; steps: string[] }>;
  resolveKeyRow:           (req: express.Request) => Promise<{ user_id: string; tier: string; revoked: number } | undefined>;
  dispatchWorkflow:        (name: string, params: Record<string, string>) => Promise<CanonicalResponse>;
  runChain:                (chainId: string, params: Record<string, string>, userId: string, tier: string) => Promise<CanonicalResponse>;
  validateWorkflowParams:  (name: string, params: Record<string, string>) => Record<string, string>;
  detectWorkflowFromText:  (text: string) => { chainId?: string; workflowName: string | null; params: Record<string, string> };
  enforceRateLimit:        (userId: string, tier: string) => unknown;
  checkCredits:            (userId: string) => Promise<number>;
  deductCredits:           (userId: string, amount: number, description: string) => Promise<number>;
  logAudit:                (entry: AuditEntry) => void;
}

// ─── Run store ────────────────────────────────────────────────────────────────

interface RunRecord {
  run_id:        string;
  agent_id:      string;
  status:        "pending" | "running" | "completed" | "failed";
  created_at:    string;
  completed_at?: string;
  output?:       unknown;
  error?:        string;
}

const runStore = new Map<string, RunRecord>();

// Keep at most 500 runs in memory; evict oldest when exceeded.
function pruneRunStore(): void {
  if (runStore.size > 500) {
    const oldest = [...runStore.keys()].slice(0, runStore.size - 500);
    for (const k of oldest) runStore.delete(k);
  }
}

// ─── SLIM pub/sub ─────────────────────────────────────────────────────────────

type SlimSubscriber = (msg: SlimMessage) => void;

interface SlimMessage {
  message_id: string;
  channel:    string;
  sender:     string;
  payload:    unknown;
  timestamp:  string;
  signature:  string;
}

// One secret per process; optionally inject via SLIM_SECRET env var.
const SLIM_SECRET = process.env.SLIM_SECRET ?? crypto.randomBytes(32).toString("hex");

const slimChannels = new Map<string, Set<SlimSubscriber>>();

function slimSign(messageId: string, channel: string, timestamp: string, payloadStr: string): string {
  return createHmac("sha256", SLIM_SECRET)
    .update(`${messageId}:${channel}:${timestamp}:${payloadStr}`)
    .digest("hex");
}

function slimPublish(channel: string, message: SlimMessage): void {
  slimChannels.get(channel)?.forEach((sub) => sub(message));
}

// ─── OASF tag taxonomy ────────────────────────────────────────────────────────

const AGENT_TAGS: Record<string, string[]> = {
  subdomain_discovery:     ["security", "discovery", "dns", "recon"],
  asset_discovery:         ["security", "discovery", "inventory"],
  vulnerability_assessment: ["security", "vulnerability", "scanning"],
  generator_sizing:        ["power", "infrastructure", "sizing", "generator"],
  utility_interconnect:    ["power", "utility", "interconnect"],
  nc_utility_interconnect: ["power", "utility", "nc", "interconnect"],
  pue_calculator:          ["energy", "efficiency", "pue", "sustainability"],
  construction_cost:       ["cost", "construction", "capex"],
  nfpa_110_checker:        ["compliance", "nfpa", "generator", "emergency-power"],
  ats_sizing:              ["power", "electrical", "ats", "sizing"],
  ups_sizing:              ["power", "ups", "battery", "sizing"],
  fuel_storage:            ["fuel", "storage", "generator", "nfpa"],
  cooling_load:            ["cooling", "mechanical", "ashrae", "hvac"],
  power_density:           ["power", "density", "rack", "nec"],
  redundancy_validator:    ["redundancy", "tier", "uptime-institute", "reliability"],
  demand_response:         ["energy", "demand-response", "grid", "revenue"],
  environmental_impact:    ["environmental", "emissions", "permit", "epa"],
  fire_suppression:        ["fire", "suppression", "nfpa", "safety"],
  incentive_finder:        ["finance", "incentives", "tax-credits", "ira"],
  noise_compliance:        ["noise", "compliance", "zoning", "generator"],
  permit_timeline:         ["permitting", "timeline", "construction", "regulatory"],
  roi_calculator:          ["finance", "roi", "npv", "irr"],
  tco_analyzer:            ["finance", "tco", "opex", "cost-analysis"],
  fiber_connectivity:      ["network", "fiber", "connectivity", "carrier"],
  harmonic_analysis:       ["power", "harmonic", "ieee519", "power-quality"],
  site_scoring:            ["site-selection", "scoring", "ranking", "analysis"],
  voltage_drop:            ["power", "voltage", "nec", "electrical"],
  water_availability:      ["water", "cooling", "sustainability", "permit"],
  network_topology:        ["network", "spine-leaf", "switching", "topology"],
  bandwidth_sizing:        ["network", "bandwidth", "sizing", "fabric"],
  latency_calculator:      ["network", "latency", "propagation", "interconnect"],
  ip_addressing:           ["network", "ip", "vlan", "addressing"],
  dns_architecture:        ["network", "dns", "architecture", "anycast"],
  bgp_peering:             ["network", "bgp", "routing", "peering"],
  physical_security:       ["security", "physical", "access-control", "tier"],
  biometric_design:        ["security", "biometric", "access-control"],
  surveillance_coverage:   ["security", "cctv", "surveillance", "physical"],
  cybersecurity_controls:  ["security", "compliance", "soc2", "nist"],
  compliance_checker:      ["compliance", "frameworks", "audit", "risk"],
  chiller_sizing:          ["cooling", "chiller", "mechanical", "sizing"],
  crac_vs_crah:            ["cooling", "crac", "crah", "hvac"],
  airflow_modeling:        ["cooling", "airflow", "containment", "thermal"],
  humidification:          ["cooling", "humidity", "ashrae", "hvac"],
  economizer_analysis:     ["cooling", "economizer", "energy", "efficiency"],
  construction_timeline:   ["construction", "timeline", "schedule", "permitting"],
  commissioning_plan:      ["commissioning", "testing", "startup", "quality"],
  maintenance_schedule:    ["maintenance", "schedule", "reliability", "operations"],
  capacity_planning:       ["capacity", "planning", "growth", "infrastructure"],
  sla_calculator:          ["sla", "availability", "reliability", "operations"],
  change_management:       ["change-management", "operations", "itsm", "process"],
  carbon_footprint:        ["sustainability", "carbon", "emissions", "esg"],
  solar_feasibility:       ["renewable", "solar", "energy", "feasibility"],
  battery_storage:         ["energy-storage", "battery", "renewable", "grid"],
  energy_procurement:      ["energy", "procurement", "ppa", "contract"],
  tier_certification:      ["tier", "certification", "uptime-institute", "compliance"],
};

// ─── OASF manifest builder ────────────────────────────────────────────────────

function buildOASFManifest(
  agentId: string,
  wf: { description: string; params: string[]; credits: number },
  baseUrl: string
) {
  const tags = AGENT_TAGS[agentId] ?? ["infrastructure", "data-center"];
  const paramProps = Object.fromEntries(
    wf.params.map((p) => [p, { type: "string", description: p.replace(/_/g, " ") }])
  );

  return {
    agent_id:    `security-orchestra/${agentId}`,
    name:        agentId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: wf.description,
    version:     "1.0.0",
    provider: {
      organization: "RobotFleet-HQ",
      url:          baseUrl,
      contact:      "https://github.com/RobotFleet-HQ/security-orchestra",
    },
    capabilities: ["inference", "analysis", "data_processing"],
    tags,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language instruction for this agent" },
        ...paramProps,
      },
      required: ["query"],
    },
    output_schema: {
      type: "object",
      properties: {
        workflow:  { type: "string" },
        target:    { type: "string" },
        timestamp: { type: "string", format: "date-time" },
        results:   { type: "object", additionalProperties: true },
      },
    },
    metadata: {
      credits_required: wf.credits,
      framework:        "security-orchestra",
      transport:        ["rest", "acp", "slim", "mcp"],
      invocation_url:   `${baseUrl}/acp/agents/${agentId}/runs`,
    },
    authentication: {
      type:        "bearer",
      description: "API key via Authorization: Bearer <key> or x-api-key header",
    },
  };
}

// ─── Agent Directory registration ────────────────────────────────────────────

async function registerWithDirectory(
  baseUrl:   string,
  dirUrl:    string,
  agentCount: number
): Promise<{ status: string; agents_registered: number; directory_url: string }> {
  const body = JSON.stringify({
    provider:         "RobotFleet-HQ",
    name:             "Security Orchestra",
    base_url:         baseUrl,
    manifest_url:     `${baseUrl}/agntcy/directory`,
    acp_base_url:     `${baseUrl}/acp`,
    agent_count:      agentCount,
    capabilities:     ["acp", "slim", "mcp", "openai", "a2a", "agui"],
    registered_at:    new Date().toISOString(),
  });

  try {
    const res = await fetch(`${dirUrl}/v1/providers`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal:  AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { status: "registered", agents_registered: agentCount, directory_url: dirUrl };
    }
  } catch {
    // Directory unreachable — non-fatal
  }

  return { status: "self_hosted", agents_registered: agentCount, directory_url: `${baseUrl}/agntcy/directory` };
}

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountAgntcy(app: express.Application, deps: AgntcyDeps): void {
  const {
    workflows, chains, resolveKeyRow, dispatchWorkflow, runChain,
    validateWorkflowParams, detectWorkflowFromText, enforceRateLimit,
    checkCredits, deductCredits, logAudit,
  } = deps;

  const BASE_URL     = (process.env.BASE_URL ?? "https://security-orchestra-orchestrator.onrender.com").replace(/\/$/, "");
  const AGNTCY_DIR   = process.env.AGNTCY_DIR_URL ?? "https://directory.agntcy.org";
  const agentCount   = Object.keys(workflows).length + Object.keys(chains).length;
  const now          = () => new Date().toISOString();

  // ── AGNTCY well-known discovery ──────────────────────────────────────────────

  app.get("/.well-known/agntcy.json", (_req, res) => {
    res.json({
      agntcy_version:  "1.0",
      name:            "Security Orchestra",
      provider:        "RobotFleet-HQ",
      description:     `${agentCount} AI-powered agents for data center critical power infrastructure`,
      base_url:        BASE_URL,
      endpoints: {
        directory:     `${BASE_URL}/agntcy/directory`,
        acp_agents:    `${BASE_URL}/acp/agents`,
        slim_send:     `${BASE_URL}/slim/send`,
        slim_subscribe:`${BASE_URL}/slim/subscribe/:channel`,
      },
      authentication:  { type: "bearer" },
      agent_count:     agentCount,
      capabilities:    ["acp", "slim", "mcp", "openai", "a2a", "agui"],
    });
  });

  // ── Agent Directory ──────────────────────────────────────────────────────────

  // GET /agntcy/directory — full OASF manifest list (public)
  app.get("/agntcy/directory", (_req, res) => {
    const agents = [
      ...Object.entries(workflows).map(([id, wf]) => buildOASFManifest(id, wf, BASE_URL)),
      ...Object.entries(chains).map(([id, c]) => ({
        agent_id:    `security-orchestra/chain_${id}`,
        name:        c.name,
        description: c.description,
        version:     "1.0.0",
        provider:    { organization: "RobotFleet-HQ", url: BASE_URL },
        capabilities: ["inference", "multi_step", "chain"],
        tags:        ["chain", "compound-workflow", "data-center"],
        input_schema: {
          type: "object",
          properties: { query: { type: "string", description: "Natural language instruction" } },
          required: ["query"],
        },
        metadata: {
          credits_required: c.credits,
          steps:            c.steps,
          framework:        "security-orchestra",
          transport:        ["rest", "acp"],
          invocation_url:   `${BASE_URL}/acp/agents/chain_${id}/runs`,
        },
        authentication: { type: "bearer" },
      })),
    ];
    res.json({ agents, total: agents.length, provider: "RobotFleet-HQ", updated_at: now() });
  });

  // POST /agntcy/register — re-trigger directory registration (admin)
  app.post("/agntcy/register", express.json(), async (req, res) => {
    const keyRow = await resolveKeyRow(req);
    if (!keyRow || keyRow.revoked) { res.status(401).json({ error: "Unauthorized" }); return; }
    const result = await registerWithDirectory(BASE_URL, AGNTCY_DIR, agentCount);
    res.json(result);
  });

  // ── ACP per-agent endpoints (full spec) ──────────────────────────────────────

  // GET /acp/agents/:agent_id — OASF manifest for one agent
  app.get("/acp/agents/:agent_id", (req, res) => {
    const agentId = req.params.agent_id;

    if (agentId.startsWith("chain_")) {
      const chain = chains[agentId.slice(6)];
      if (!chain) { res.status(404).json({ error: `Agent not found: ${agentId}` }); return; }
      res.json({
        agent_id:    `security-orchestra/${agentId}`,
        name:        chain.name,
        description: chain.description,
        version:     "1.0.0",
        provider:    { organization: "RobotFleet-HQ", url: BASE_URL },
        capabilities: ["inference", "multi_step", "chain"],
        tags:        ["chain", "compound-workflow"],
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        metadata: { credits_required: chain.credits, steps: chain.steps },
        authentication: { type: "bearer" },
      });
      return;
    }

    const wf = workflows[agentId];
    if (!wf) { res.status(404).json({ error: `Agent not found: ${agentId}` }); return; }
    res.json(buildOASFManifest(agentId, wf, BASE_URL));
  });

  // GET /acp/agents/:agent_id/runs — list recent runs for this agent
  app.get("/acp/agents/:agent_id/runs", async (req, res) => {
    const keyRow = await resolveKeyRow(req);
    if (!keyRow || keyRow.revoked) { res.status(401).json({ error: "Unauthorized" }); return; }
    const agentId  = req.params.agent_id;
    const limit    = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
    const agentRuns = [...runStore.values()]
      .filter((r) => r.agent_id === agentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
    res.json({ runs: agentRuns, agent_id: agentId, total: agentRuns.length });
  });

  // POST /acp/agents/:agent_id/runs — create a run for a specific agent
  app.post("/acp/agents/:agent_id/runs", express.json(), async (req, res) => {
    const keyRow = await resolveKeyRow(req);
    if (!keyRow || keyRow.revoked) { res.status(401).json({ error: "Unauthorized" }); return; }

    const agentId = req.params.agent_id;
    const runId   = crypto.randomUUID();

    const isChain  = agentId.startsWith("chain_");
    const chainKey = isChain ? agentId.slice(6) : undefined;
    const wf       = isChain ? undefined : workflows[agentId];
    const chain    = chainKey ? chains[chainKey] : undefined;

    if (!wf && !chain) {
      res.status(404).json({ run_id: runId, status: "failed", error: `Agent not found: ${agentId}` });
      return;
    }

    // Accept either ACP envelope (input[]) or plain { query } body
    const inputMessages: { role: string; content: { type: string; text: string }[] }[] | undefined = req.body?.input;
    const queryDirect: string | undefined = req.body?.query;

    let text: string | undefined;
    if (queryDirect) {
      text = queryDirect;
    } else if (Array.isArray(inputMessages) && inputMessages.length > 0) {
      const lastUser = [...inputMessages].reverse().find((m) => m.role === "user");
      text = lastUser?.content?.[0]?.text;
    }

    if (!text) {
      res.status(400).json({
        run_id: runId, status: "failed",
        error: "Provide input array (ACP envelope) or query string",
      });
      return;
    }

    const runRecord: RunRecord = { run_id: runId, agent_id: agentId, status: "running", created_at: now() };
    runStore.set(runId, runRecord);
    pruneRunStore();

    try {
      enforceRateLimit(keyRow.user_id, keyRow.tier);
      const billingEnabled = !!process.env.BILLING_API_URL;
      let output: unknown;

      if (chain && chainKey) {
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < chain.credits) {
            runRecord.status       = "failed";
            runRecord.error        = `Insufficient credits — balance: ${balance}, required: ${chain.credits}`;
            runRecord.completed_at = now();
            res.status(402).json({ run_id: runId, agent_id: agentId, status: "failed", error: runRecord.error });
            return;
          }
        }
        const { params } = detectWorkflowFromText(text);
        logAudit({ user_id: keyRow.user_id, action: "agntcy_run_start",    resource: agentId, result: "success", details: { tier: keyRow.tier } });
        const t0 = Date.now();
        output = await runChain(chainKey, params, keyRow.user_id, keyRow.tier);
        if (billingEnabled) await deductCredits(keyRow.user_id, chain.credits, `chain:${chainKey}`);
        logAudit({ user_id: keyRow.user_id, action: "agntcy_run_complete", resource: agentId, result: "success", duration_ms: Date.now() - t0, details: { tier: keyRow.tier } });

      } else if (wf) {
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            runRecord.status       = "failed";
            runRecord.error        = `Insufficient credits — balance: ${balance}, required: ${wf.credits}`;
            runRecord.completed_at = now();
            res.status(402).json({ run_id: runId, agent_id: agentId, status: "failed", error: runRecord.error });
            return;
          }
        }
        const { params } = detectWorkflowFromText(text);
        const cleanParams = validateWorkflowParams(agentId, params);
        logAudit({ user_id: keyRow.user_id, action: "agntcy_run_start",    resource: agentId, result: "success", details: { params: cleanParams, tier: keyRow.tier } });
        const t0 = Date.now();
        const result = await dispatchWorkflow(agentId, cleanParams);
        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, agentId);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }
        logAudit({ user_id: keyRow.user_id, action: "agntcy_run_complete", resource: agentId, result: "success", duration_ms: Date.now() - t0, details: { tier: keyRow.tier } });
        output = result;
      }

      runRecord.status       = "completed";
      runRecord.completed_at = now();
      runRecord.output       = output;

      // Notify SLIM channel subscribers of run completion
      slimPublish(`agent:${agentId}`, {
        message_id: crypto.randomUUID(),
        channel:    `agent:${agentId}`,
        sender:     "security-orchestra",
        payload:    { event: "run_complete", run_id: runId, agent_id: agentId },
        timestamp:  now(),
        signature:  slimSign(runId, `agent:${agentId}`, now(), JSON.stringify({ run_id: runId })),
      });

      res.json({
        run_id:        runId,
        agent_id:      agentId,
        status:        "completed",
        created_at:    runRecord.created_at,
        completed_at:  runRecord.completed_at,
        output: [{ role: "agent", content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runRecord.status       = "failed";
      runRecord.error        = msg;
      runRecord.completed_at = now();
      res.status(500).json({ run_id: runId, agent_id: agentId, status: "failed", error: msg });
    }
  });

  // GET /acp/agents/:agent_id/runs/:run_id — run status + result
  app.get("/acp/agents/:agent_id/runs/:run_id", async (req, res) => {
    const keyRow = await resolveKeyRow(req);
    if (!keyRow || keyRow.revoked) { res.status(401).json({ error: "Unauthorized" }); return; }
    const run = runStore.get(req.params.run_id);
    if (!run) { res.status(404).json({ error: `Run not found: ${req.params.run_id}` }); return; }
    res.json(run);
  });

  // ── SLIM pub/sub transport ────────────────────────────────────────────────────

  // POST /slim/send — publish a signed message to a channel
  app.post("/slim/send", express.json(), async (req, res) => {
    const keyRow = await resolveKeyRow(req);
    if (!keyRow || keyRow.revoked) { res.status(401).json({ error: "Unauthorized" }); return; }

    const channel: string | undefined = req.body?.channel;
    const payload: unknown            = req.body?.payload;

    if (!channel || payload === undefined) {
      res.status(400).json({ error: "channel and payload are required" });
      return;
    }

    const messageId  = crypto.randomUUID();
    const timestamp  = now();
    const payloadStr = JSON.stringify(payload);
    const signature  = slimSign(messageId, channel, timestamp, payloadStr);

    const msg: SlimMessage = { message_id: messageId, channel, sender: keyRow.user_id, payload, timestamp, signature };
    slimPublish(channel, msg);

    logAudit({ user_id: keyRow.user_id, action: "slim_send", resource: channel, result: "success", details: { message_id: messageId } });

    res.json({ message_id: messageId, channel, status: "delivered", timestamp, signature });
  });

  // GET /slim/subscribe/:channel — SSE stream for receiving SLIM messages
  app.get("/slim/subscribe/:channel", async (req, res) => {
    const keyRow = await resolveKeyRow(req);
    if (!keyRow || keyRow.revoked) { res.status(401).json({ error: "Unauthorized" }); return; }

    const channel = req.params.channel;

    res.setHeader("Content-Type",    "text/event-stream");
    res.setHeader("Cache-Control",   "no-cache");
    res.setHeader("Connection",      "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (!slimChannels.has(channel)) slimChannels.set(channel, new Set());

    const subscriber: SlimSubscriber = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
    slimChannels.get(channel)!.add(subscriber);

    // Connected acknowledgement
    res.write(`data: ${JSON.stringify({ event: "connected", channel, timestamp: now() })}\n\n`);

    logAudit({ user_id: keyRow.user_id, action: "slim_subscribe", resource: channel, result: "success" });

    req.on("close", () => {
      const subs = slimChannels.get(channel);
      if (subs) {
        subs.delete(subscriber);
        if (subs.size === 0) slimChannels.delete(channel);
      }
    });
  });

  // ── Background: register with AGNTCY directory on startup ────────────────────

  registerWithDirectory(BASE_URL, AGNTCY_DIR, agentCount).then(({ status, directory_url }) => {
    console.error(`[agntcy] directory registration: ${status} → ${directory_url}`);
  }).catch(() => {
    // Non-fatal
  });
}
