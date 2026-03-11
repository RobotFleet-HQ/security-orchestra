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
import { runPueCalculator } from "./workflows/pueCalculator.js";
import { runConstructionCost } from "./workflows/constructionCost.js";
import { runNfpa110Checker } from "./workflows/nfpa110Checker.js";
import { runAtsSizing } from "./workflows/atsSizing.js";
import { runUpsSizing } from "./workflows/upsSizing.js";
import { runFuelStorage } from "./workflows/fuelStorage.js";
import { runCoolingLoad } from "./workflows/coolingLoad.js";
import { runPowerDensity } from "./workflows/powerDensity.js";
import { runRedundancyValidator } from "./workflows/redundancyValidator.js";

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
  pue_calculator: {
    description: "Calculate Power Usage Effectiveness (PUE) and efficiency metrics for data center facilities. Analyzes IT load, cooling systems, power distribution, and provides optimization recommendations.",
    params: ["it_load_kw"],
    credits: WORKFLOW_COSTS.pue_calculator,
  },
  construction_cost: {
    description: "Estimate construction costs for data center development. Analyzes $/MW costs, regional pricing factors, tier requirements, and provides detailed cost breakdowns for shell, electrical, mechanical, and IT infrastructure.",
    params: ["capacity_mw"],
    credits: WORKFLOW_COSTS.construction_cost,
  },
  nfpa_110_checker: {
    description: "Check emergency generator compliance per NFPA 110 Level 1 and Level 2 requirements. Validates fuel capacity, ATS transfer time, runtime hours, and returns compliance status with violation details and remediation steps.",
    params: ["generator_kw", "fuel_capacity_gallons", "runtime_hours", "ats_transfer_time_seconds", "level"],
    credits: WORKFLOW_COSTS.nfpa_110_checker,
  },
  ats_sizing: {
    description: "Size automatic transfer switches per NEC Articles 700, 701, and 702. Calculates load current, applies 125% continuous load factor, selects standard ATS ratings, and returns enclosure options and installation requirements.",
    params: ["load_kw", "voltage", "phases"],
    credits: WORKFLOW_COSTS.ats_sizing,
  },
  ups_sizing: {
    description: "Size uninterruptible power supplies per IEEE 485 and 1184. Calculates kVA, selects battery strings (VRLA or Li-ion), determines runtime across N/N+1/2N configurations, and provides cost estimates.",
    params: ["load_kw", "runtime_minutes"],
    credits: WORKFLOW_COSTS.ups_sizing,
  },
  fuel_storage: {
    description: "Design diesel fuel storage systems for emergency generators. Calculates tank size, runtime, secondary containment, SPCC thresholds, NFPA 30 compliance, and day tank recommendations.",
    params: ["generator_kw", "target_runtime_hours"],
    credits: WORKFLOW_COSTS.fuel_storage,
  },
  cooling_load: {
    description: "Calculate data center cooling load per ASHRAE TC 9.9. Computes IT heat, UPS losses, envelope gains, converts to tons, sizes CRAC/CRAH units with N+1 redundancy, and checks ASHRAE thermal envelopes.",
    params: ["it_load_kw", "ups_capacity_kw", "room_sqft"],
    credits: WORKFLOW_COSTS.cooling_load,
  },
  power_density: {
    description: "Analyze rack power density for data centers. Classifies kW/rack density, sizes PDUs and branch circuits per NEC 645, calculates airflow requirements, and provides expansion capacity analysis.",
    params: ["total_it_load_kw", "rack_count"],
    credits: WORKFLOW_COSTS.power_density,
  },
  redundancy_validator: {
    description: "Validate data center redundancy design against Uptime Institute Tier I–IV standards. Identifies single points of failure, assesses concurrent maintainability, and maps achieved tier with gaps to next level.",
    params: ["design_type", "total_load_kw", "generator_count", "generator_capacity_kw", "ups_count", "ups_capacity_kw", "cooling_units"],
    credits: WORKFLOW_COSTS.redundancy_validator,
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

    case "construction_cost": {
      const ccResult = await runConstructionCost({
        capacity_mw:              parseFloat(args.capacity_mw),
        tier:                     (args.tier as "tier1" | "tier2" | "tier3" | "tier4") ?? undefined,
        region:                   (args.region as "northeast" | "mid_atlantic" | "southeast" | "midwest" | "southwest" | "mountain" | "pacific" | "pacific_nw") ?? undefined,
        building_type:            (args.building_type as "new_build" | "shell_core" | "retrofit") ?? undefined,
        electricity_rate_per_kwh: args.electricity_rate_per_kwh ? parseFloat(args.electricity_rate_per_kwh) : undefined,
      });
      log("info", `construction_cost complete — ${ccResult.target} in ${ccResult.results.duration_ms}ms`);
      return ccResult as unknown as WorkflowResult;
    }

    case "pue_calculator": {
      const pueResult = await runPueCalculator({
        it_load_kw:               parseFloat(args.it_load_kw),
        cooling_load_kw:          args.cooling_load_kw          ? parseFloat(args.cooling_load_kw)          : undefined,
        ups_efficiency_pct:       args.ups_efficiency_pct       ? parseFloat(args.ups_efficiency_pct)       : undefined,
        pdu_loss_pct:             args.pdu_loss_pct             ? parseFloat(args.pdu_loss_pct)             : undefined,
        lighting_kw:              args.lighting_kw              ? parseFloat(args.lighting_kw)              : undefined,
        cooling_type:             (args.cooling_type as "air_cooled" | "water_cooled" | "free_cooling" | "hybrid" | "liquid_immersion") ?? undefined,
        electricity_rate_per_kwh: args.electricity_rate_per_kwh ? parseFloat(args.electricity_rate_per_kwh) : undefined,
      });
      log("info", `pue_calculator complete — ${pueResult.target} in ${pueResult.results.duration_ms}ms`);
      return pueResult as unknown as WorkflowResult;
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

    case "nfpa_110_checker": {
      const nfpaResult = await runNfpa110Checker({
        generator_kw:              parseFloat(args.generator_kw),
        fuel_capacity_gallons:     parseFloat(args.fuel_capacity_gallons),
        runtime_hours:             parseFloat(args.runtime_hours),
        ats_transfer_time_seconds: parseFloat(args.ats_transfer_time_seconds),
        level:                     (parseInt(args.level) as 1 | 2),
        fuel_type:                 (args.fuel_type as "diesel" | "natural_gas" | "propane") ?? undefined,
      });
      log("info", `nfpa_110_checker complete — ${nfpaResult.target} in ${nfpaResult.results.duration_ms}ms`);
      return nfpaResult as unknown as WorkflowResult;
    }

    case "ats_sizing": {
      const atsResult = await runAtsSizing({
        load_kw:          parseFloat(args.load_kw),
        voltage:          (parseInt(args.voltage) as 120 | 208 | 240 | 277 | 480 | 600),
        phases:           (parseInt(args.phases) as 1 | 3),
        application_type: (args.application_type as "emergency" | "legally_required" | "optional" | "critical") ?? undefined,
      });
      log("info", `ats_sizing complete — ${atsResult.target} in ${atsResult.results.duration_ms}ms`);
      return atsResult as unknown as WorkflowResult;
    }

    case "ups_sizing": {
      const upsResult = await runUpsSizing({
        load_kw:          parseFloat(args.load_kw),
        runtime_minutes:  parseFloat(args.runtime_minutes),
        redundancy:       (args.redundancy as "N" | "N+1" | "2N") ?? undefined,
        voltage:          args.voltage ? (parseInt(args.voltage) as 208 | 480) : undefined,
        battery_type:     (args.battery_type as "VRLA" | "Li-ion") ?? undefined,
      });
      log("info", `ups_sizing complete — ${upsResult.target} in ${upsResult.results.duration_ms}ms`);
      return upsResult as unknown as WorkflowResult;
    }

    case "fuel_storage": {
      const fsResult = await runFuelStorage({
        generator_kw:          parseFloat(args.generator_kw),
        target_runtime_hours:  parseFloat(args.target_runtime_hours),
        tank_type:             (args.tank_type as "above_ground" | "underground" | "day_tank") ?? undefined,
        jurisdiction:          (args.jurisdiction as "epa" | "california" | "nfpa30") ?? undefined,
      });
      log("info", `fuel_storage complete — ${fsResult.target} in ${fsResult.results.duration_ms}ms`);
      return fsResult as unknown as WorkflowResult;
    }

    case "cooling_load": {
      const clResult = await runCoolingLoad({
        it_load_kw:       parseFloat(args.it_load_kw),
        ups_capacity_kw:  parseFloat(args.ups_capacity_kw),
        room_sqft:        parseFloat(args.room_sqft),
        ceiling_height_ft: args.ceiling_height_ft ? parseFloat(args.ceiling_height_ft) : undefined,
        ambient_temp_f:   args.ambient_temp_f ? parseFloat(args.ambient_temp_f) : undefined,
      });
      log("info", `cooling_load complete — ${clResult.target} in ${clResult.results.duration_ms}ms`);
      return clResult as unknown as WorkflowResult;
    }

    case "power_density": {
      const pdResult = await runPowerDensity({
        total_it_load_kw:           parseFloat(args.total_it_load_kw),
        rack_count:                  parseInt(args.rack_count),
        cabinet_height_u:            args.cabinet_height_u ? parseInt(args.cabinet_height_u) : undefined,
        cooling_type:                (args.cooling_type as "air" | "liquid" | "hybrid") ?? undefined,
        target_density_kw_per_rack:  args.target_density_kw_per_rack ? parseFloat(args.target_density_kw_per_rack) : undefined,
      });
      log("info", `power_density complete — ${pdResult.target} in ${pdResult.results.duration_ms}ms`);
      return pdResult as unknown as WorkflowResult;
    }

    case "redundancy_validator": {
      const rvResult = await runRedundancyValidator({
        design_type:            (args.design_type as "N" | "N+1" | "2N" | "2N+1"),
        total_load_kw:          parseFloat(args.total_load_kw),
        generator_count:        parseInt(args.generator_count),
        generator_capacity_kw:  parseFloat(args.generator_capacity_kw),
        ups_count:              parseInt(args.ups_count),
        ups_capacity_kw:        parseFloat(args.ups_capacity_kw),
        cooling_units:          parseInt(args.cooling_units),
        has_bypass:             args.has_bypass === "true" ? true : undefined,
      });
      log("info", `redundancy_validator complete — ${rvResult.target} in ${rvResult.results.duration_ms}ms`);
      return rvResult as unknown as WorkflowResult;
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
