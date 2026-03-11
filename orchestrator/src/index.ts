import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { db } from "./database.js";
import { checkCredits, deductCredits, WORKFLOW_COSTS } from "./billing.js";
import { validateWorkflowParams } from "./validation.js";
import { enforceRateLimit } from "./rateLimit.js";
import { logAudit, auditDb } from "./audit.js";
import { runSubdomainDiscovery } from "./workflows/subdomain.js";
import { runGeneratorSizing } from "./workflows/generatorSizing.js";
import { runUtilityInterconnect } from "./workflows/utilityInterconnect.js";
import { runNcUtilityInterconnect } from "./workflows/ncUtilityInterconnect.js";

// ─── Auth ────────────────────────────────────────────────────────────────────

let authorizedUserId: string | null = null;
let authorizedTier:   string | null = null;

async function initAuth(): Promise<void> {
  const apiKey = process.env.ORCHESTRATOR_API_KEY;
  if (!apiKey) {
    log("warn", "No ORCHESTRATOR_API_KEY set — server will reject all tool calls");
    return;
  }
  // Env-var mode: trust the key as-is, skip database validation.
  // For multi-key / per-user scenarios, remove ORCHESTRATOR_API_KEY and use
  // the keys.db database with generateKey.js instead.
  authorizedUserId = "admin";
  authorizedTier   = "enterprise";
  log("warn", "Auth: env-var mode — ORCHESTRATOR_API_KEY accepted without database validation");
}

function requireAuth(): { userId: string; tier: string } {
  if (!authorizedUserId || !authorizedTier) {
    logAudit({ user_id: "anonymous", action: "auth_failure", result: "failure",
      details: { reason: "No authorized session — missing or invalid API key" } });
    throw new McpError(ErrorCode.InvalidRequest, "401: Missing or invalid API key");
  }
  return { userId: authorizedUserId, tier: authorizedTier };
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", msg: string) {
  console.error(`[orchestrator] [${level.toUpperCase()}] ${msg}`);
}

// ─── Workflows ────────────────────────────────────────────────────────────────
// subdomain_discovery is a real implementation (see workflows/subdomain.ts).
// asset_discovery and vulnerability_assessment remain mocks.

interface WorkflowResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   Record<string, unknown>;
}

async function runAssetDiscovery(domain: string): Promise<WorkflowResult> {
  log("info", `asset_discovery → ${domain}`);
  return {
    workflow: "asset_discovery",
    target: domain,
    timestamp: new Date().toISOString(),
    results: {
      ips: ["192.168.1.1", "10.0.0.5", "172.16.0.10"],
      open_ports: {
        "192.168.1.1": [80, 443, 22],
        "10.0.0.5":    [80, 8080, 3306],
        "172.16.0.10": [443, 8443, 27017],
      },
      technologies: ["nginx/1.24", "React", "Node.js", "PostgreSQL"],
      cloud_assets: [`s3.${domain}`, `cdn.${domain}`],
      total_assets: 3,
      note: "Mock data — replace with real asset discovery tools",
    },
  };
}

async function runVulnerabilityAssessment(target: string): Promise<WorkflowResult> {
  log("info", `vulnerability_assessment → ${target}`);
  return {
    workflow: "vulnerability_assessment",
    target,
    timestamp: new Date().toISOString(),
    results: {
      findings: [
        { id: "VULN-001", severity: "HIGH",   title: "SQL Injection in login endpoint",
          url: `https://${target}/api/login`, cvss: 8.1, remediation: "Use parameterized queries" },
        { id: "VULN-002", severity: "MEDIUM", title: "Missing security headers",
          url: `https://${target}`,            cvss: 5.3, remediation: "Add CSP, HSTS, X-Frame-Options headers" },
        { id: "VULN-003", severity: "LOW",    title: "Directory listing enabled",
          url: `https://${target}/assets/`,   cvss: 3.7, remediation: "Disable directory listing in web server config" },
      ],
      summary: { HIGH: 1, MEDIUM: 1, LOW: 1, INFO: 0 },
      note: "Mock data — replace with real vulnerability scanning tools",
    },
  };
}

// ─── Workflow Registry ────────────────────────────────────────────────────────

const WORKFLOWS: Record<string, { description: string; params: string[]; credits: number }> = {
  subdomain_discovery: {
    description: "Discover subdomains for a target domain using DNS brute-force, certificate transparency, and passive sources",
    params: ["domain"],
    credits: WORKFLOW_COSTS.subdomain_discovery,
  },
  asset_discovery: {
    description: "Map IP addresses, open ports, technologies, and cloud assets for a target domain",
    params: ["domain"],
    credits: WORKFLOW_COSTS.asset_discovery,
  },
  vulnerability_assessment: {
    description: "Run vulnerability scans against a target and return prioritized findings with remediation guidance",
    params: ["target"],
    credits: WORKFLOW_COSTS.vulnerability_assessment,
  },
  generator_sizing: {
    description: "Size generators for data center loads with industry-standard compliance. Returns genset kVA, fuel consumption, tank size, runtime, ATS sizing, and cost estimates.",
    params: ["load_kw", "tier"],
    credits: WORKFLOW_COSTS.generator_sizing,
  },
  utility_interconnect: {
    description: "Analyze utility interconnect requirements for major US power providers. Returns per-load-size timelines, deposit $/kW ranges, first-year cost, competitive intel, and constraint warnings.",
    params: ["utility", "load_mw"],
    credits: WORKFLOW_COSTS.utility_interconnect,
  },
  nc_utility_interconnect: {
    description: "Analyze utility interconnect requirements for North Carolina power provider with detailed timeline, cost estimates, and regional regulatory requirements.",
    params: ["load_mw"],
    credits: WORKFLOW_COSTS.nc_utility_interconnect,
  },
};

async function dispatchWorkflow(
  name: string,
  args: Record<string, string>
): Promise<WorkflowResult> {
  switch (name) {
    case "subdomain_discovery": {
      if (!args.domain) throw new McpError(ErrorCode.InvalidParams, "Missing required param: domain");
      log("info", `subdomain_discovery → ${args.domain} (real implementation)`);
      const sdResult = await runSubdomainDiscovery(args.domain);
      log("info", `subdomain_discovery complete — ${sdResult.results.total} subdomains in ${sdResult.results.duration_ms}ms`);
      return sdResult as unknown as WorkflowResult;
    }

    case "asset_discovery":
      if (!args.domain) throw new McpError(ErrorCode.InvalidParams, "Missing required param: domain");
      return runAssetDiscovery(args.domain);

    case "vulnerability_assessment":
      if (!args.target) throw new McpError(ErrorCode.InvalidParams, "Missing required param: target");
      return runVulnerabilityAssessment(args.target);

    case "generator_sizing": {
      const loadKw   = parseFloat(args.load_kw);
      const tier     = args.tier as "N" | "N+1" | "2N" | "2N+1";
      const altFt    = args.altitude_ft ? parseFloat(args.altitude_ft) : 0;
      const tempF    = args.temp_f      ? parseFloat(args.temp_f)      : 77;
      const gsResult = await runGeneratorSizing({ load_kw: loadKw, tier, altitude_ft: altFt, temp_f: tempF });
      log("info", `generator_sizing complete — ${gsResult.results.genset_kva} kVA in ${gsResult.results.duration_ms}ms`);
      return gsResult as unknown as WorkflowResult;
    }

    case "utility_interconnect": {
      const uiResult = await runUtilityInterconnect({
        utility:    args.utility  as "dominion" | "pge" | "comed" | "georgia_power" | "aps" | "oncor" | "duke_energy" | "sce" | "xcel",
        load_mw:    parseFloat(args.load_mw),
        voltage_kv: args.voltage_kv ? parseFloat(args.voltage_kv) : undefined,
        load_type:  (args.load_type as "data_center" | "industrial" | "commercial") ?? "data_center",
        state:      args.state ?? undefined,
      });
      log("info", `utility_interconnect complete — ${uiResult.target} in ${uiResult.results.duration_ms}ms`);
      return uiResult as unknown as WorkflowResult;
    }

    case "nc_utility_interconnect": {
      const ncResult = await runNcUtilityInterconnect({
        load_mw:    parseFloat(args.load_mw),
        voltage_kv: args.voltage_kv ? parseFloat(args.voltage_kv) : undefined,
        load_type:  (args.load_type as "data_center" | "industrial" | "commercial") ?? "data_center",
        state:      args.state ?? undefined,
      });
      log("info", `nc_utility_interconnect complete — ${ncResult.target} in ${ncResult.results.duration_ms}ms`);
      return ncResult as unknown as WorkflowResult;
    }

    default:
      throw new McpError(ErrorCode.InvalidParams,
        `Unknown workflow: "${name}". Call get_capabilities to list available workflows.`);
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "orchestrator", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_capabilities",
        description: "List all available security workflows and their required parameters",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "execute_workflow",
        description: "Execute a named security workflow against a target",
        inputSchema: {
          type: "object",
          properties: {
            workflow: { type: "string",
              description: `Workflow name. Available: ${Object.keys(WORKFLOWS).join(", ")}` },
            domain:   { type: "string",
              description: "Target domain (required for subdomain_discovery, asset_discovery)" },
            target:   { type: "string",
              description: "Target host or domain (required for vulnerability_assessment)" },
          },
          required: ["workflow"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  // requireAuth() logs its own auth_failure before throwing
  const { userId, tier } = requireAuth();
  const { name, arguments: args = {} } = request.params;
  const typedArgs = args as Record<string, string>;

  log("info", `tool=${name} user=${userId} tier=${tier}`);

  // ── get_capabilities ───────────────────────────────────────────────────────
  if (name === "get_capabilities") {
    const balance = await checkCredits(userId).catch(() => null);
    logAudit({ user_id: userId, action: "query_capabilities", result: "success",
      details: { tier, credit_balance: balance } });

    const capabilities = Object.entries(WORKFLOWS).map(([wfName, wf]) => ({
      name: wfName,
      description: wf.description,
      required_params: wf.params,
      credit_cost: wf.credits,
      can_run: balance !== null ? balance >= wf.credits : null,
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ workflows: capabilities, total: capabilities.length,
          credit_balance: balance }, null, 2),
      }],
    };
  }

  // ── execute_workflow ───────────────────────────────────────────────────────
  if (name === "execute_workflow") {
    const workflowName = typedArgs.workflow;
    if (!workflowName) {
      throw new McpError(ErrorCode.InvalidParams, "Missing required param: workflow");
    }

    const wf = WORKFLOWS[workflowName];
    if (!wf) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown workflow: "${workflowName}"`);
    }

    // 1. Rate limit ────────────────────────────────────────────────────────────
    let rl;
    try {
      rl = enforceRateLimit(userId, tier);
      log("info", `rate limit OK — remaining: ${rl.remaining}/${rl.limit} per minute`);
    } catch (err) {
      const msg = err instanceof McpError ? err.message : String(err);
      logAudit({ user_id: userId, action: "rate_limit_exceeded", resource: workflowName,
        result: "blocked", details: { tier, limit: `${rl!.limit}/min`, message: msg } });
      throw err;
    }

    // 2. Input validation ──────────────────────────────────────────────────────
    let cleanParams: Record<string, string>;
    try {
      cleanParams = validateWorkflowParams(workflowName, typedArgs);
      log("info", `validation OK — params: ${JSON.stringify(cleanParams)}`);
    } catch (err) {
      const msg = err instanceof McpError ? err.message : String(err);
      logAudit({ user_id: userId, action: "validation_failure", resource: workflowName,
        result: "failure", details: { raw_params: typedArgs, message: msg } });
      throw err;
    }

    // 3. Credit gate ───────────────────────────────────────────────────────────
    const billingEnabled = !!process.env.BILLING_API_URL;
    if (billingEnabled) {
      let balance: number;
      try {
        balance = await checkCredits(userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAudit({ user_id: userId, action: "credit_check_error", resource: workflowName,
          result: "failure", details: { message: msg } });
        throw err;
      }

      if (balance < wf.credits) {
        logAudit({ user_id: userId, action: "credit_insufficient", resource: workflowName,
          result: "blocked", details: { balance, required: wf.credits,
            shortfall: wf.credits - balance } });
        throw new McpError(ErrorCode.InvalidRequest,
          `402: Insufficient credits — balance: ${balance}, required: ${wf.credits} for ${workflowName}. ` +
          `Upgrade your plan at ${process.env.BILLING_API_URL}/checkout/tiers`
        );
      }

      logAudit({ user_id: userId, action: "credit_check", resource: workflowName,
        result: "success", details: { balance, required: wf.credits } });
      log("info", `credits OK — balance: ${balance}, cost: ${wf.credits}`);
    }

    // 4. Execute ───────────────────────────────────────────────────────────────
    logAudit({ user_id: userId, action: "workflow_start", resource: workflowName,
      result: "success", details: { params: cleanParams, tier, credits_required: wf.credits } });
    const startTime = Date.now();

    let result: WorkflowResult;
    try {
      result = await dispatchWorkflow(workflowName, cleanParams);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logAudit({ user_id: userId, action: "workflow_error", resource: workflowName,
        result: "failure", duration_ms: Date.now() - startTime,
        details: { params: cleanParams, message: msg } });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `Workflow error: ${msg}`);
    }

    // 5. Deduct credits after success ──────────────────────────────────────────
    if (billingEnabled) {
      const remaining = await deductCredits(userId, wf.credits, workflowName);
      log("info", `credits deducted — cost: ${wf.credits}, remaining: ${remaining}`);
      logAudit({ user_id: userId, action: "credit_deduct", resource: workflowName,
        result: "success", details: { deducted: wf.credits, remaining } });
      result.results.credits_used      = wf.credits;
      result.results.credits_remaining = remaining;
    }

    // 6. Log completion ────────────────────────────────────────────────────────
    const durationMs = Date.now() - startTime;
    logAudit({ user_id: userId, action: "workflow_complete", resource: workflowName,
      result: "success", duration_ms: durationMs,
      details: { params: cleanParams, tier } });
    log("info", `workflow_complete — ${workflowName} in ${durationMs}ms`);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  log("info", "Starting orchestrator MCP server...");

  await initAuth();

  const httpPort = process.env.PORT ? parseInt(process.env.PORT) : null;

  if (httpPort) {
    // ── Production: HTTP + SSE transport (Railway / remote) ─────────────────
    const app = express();

    app.get("/", (_req, res) => {
      res.json({
        name: "security-orchestra",
        version: "1.0.0",
        description: "MCP orchestrator for data center power infrastructure intelligence",
        transport: "sse",
        endpoints: {
          sse:     "/sse",
          message: "/message",
          health:  "/health",
        },
        workflows: Object.keys(WORKFLOWS),
      });
    });

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "orchestrator", uptime: process.uptime() });
    });

    // One active SSE transport per session, keyed by sessionId
    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (_req, res) => {
      const transport = new SSEServerTransport("/message", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => {
        transports.delete(transport.sessionId);
        log("info", `SSE session ${transport.sessionId} closed`);
      });
      log("info", `SSE session ${transport.sessionId} opened`);
      await server.connect(transport);
    });

    app.post("/message", express.json(), async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.listen(httpPort, () =>
      log("info", `HTTP/SSE MCP server listening on :${httpPort}`)
    );
  } else {
    // ── Local: stdio transport (Claude Desktop) ──────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("info", "Server ready — listening on stdio");
  }

  process.on("SIGINT", () => {
    log("info", "Shutting down...");
    db.close();
    auditDb.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log("error", `Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
