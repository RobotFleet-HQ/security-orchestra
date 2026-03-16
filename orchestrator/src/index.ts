import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { generateApiKey } from "./auth.js";
import { storeApiKey } from "./database.js";
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
// Phase 1 — previously unregistered agents
import { runDemandResponse } from "./workflows/demandResponse.js";
import { runEnvironmentalImpact } from "./workflows/environmentalImpact.js";
import { runFireSuppression } from "./workflows/fireSuppression.js";
import { runIncentiveFinder } from "./workflows/incentiveFinder.js";
import { runNoiseCompliance } from "./workflows/noiseCompliance.js";
import { runPermitTimeline } from "./workflows/permitTimeline.js";
import { runRoiCalculator } from "./workflows/roiCalculator.js";
import { runTcoAnalyzer } from "./workflows/tcoAnalyzer.js";
import { runFiberConnectivity } from "./workflows/fiberConnectivity.js";
import { runHarmonicAnalysis } from "./workflows/harmonicAnalysis.js";
import { runSiteScoring } from "./workflows/siteScoring.js";
import { runVoltageDrop } from "./workflows/voltageDrop.js";
import { runWaterAvailability } from "./workflows/waterAvailability.js";
// Phase 2 — new agents
import { runNetworkTopology } from "./workflows/networkTopology.js";
import { runBandwidthSizing } from "./workflows/bandwidthSizing.js";
import { runLatencyCalculator } from "./workflows/latencyCalculator.js";
import { runIpAddressing } from "./workflows/ipAddressing.js";
import { runDnsArchitecture } from "./workflows/dnsArchitecture.js";
import { runBgpPeering } from "./workflows/bgpPeering.js";
import { runPhysicalSecurity } from "./workflows/physicalSecurity.js";
import { runBiometricDesign } from "./workflows/biometricDesign.js";
import { runSurveillanceCoverage } from "./workflows/surveillanceCoverage.js";
import { runCybersecurityControls } from "./workflows/cybersecurityControls.js";
import { runComplianceChecker } from "./workflows/complianceChecker.js";
import { runChillerSizing } from "./workflows/chillerSizing.js";
import { runCracVsCrah } from "./workflows/cracVsCrah.js";
import { runAirflowModeling } from "./workflows/airflowModeling.js";
import { runHumidification } from "./workflows/humidification.js";
import { runEconomizerAnalysis } from "./workflows/economizerAnalysis.js";
import { runConstructionTimeline } from "./workflows/constructionTimeline.js";
import { runCommissioningPlan } from "./workflows/commissioningPlan.js";
import { runMaintenanceSchedule } from "./workflows/maintenanceSchedule.js";
import { runCapacityPlanning } from "./workflows/capacityPlanning.js";
import { runSlaCalculator } from "./workflows/slaCalculator.js";
import { runChangeManagement } from "./workflows/changeManagement.js";
import { runCarbonFootprint } from "./workflows/carbonFootprint.js";
import { runSolarFeasibility } from "./workflows/solarFeasibility.js";
import { runBatteryStorage } from "./workflows/batteryStorage.js";
import { runEnergyProcurement } from "./workflows/energyProcurement.js";

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
  // Phase 1 — previously unregistered agents
  demand_response: {
    description: "Model utility demand response program participation for backup generator fleets. Calculates curtailment capacity, annual revenue, response time requirements, and program eligibility by utility.",
    params: ["generator_capacity_kw", "critical_load_kw", "utility_provider"],
    credits: WORKFLOW_COSTS.demand_response,
  },
  environmental_impact: {
    description: "Assess environmental impact of data center generator operations. Calculates NOx/PM2.5/CO2 emissions per USEPA AP-42, air permit thresholds, CEQA/NEPA triggers, and mitigation requirements.",
    params: ["generator_count", "generator_kw", "site_acres"],
    credits: WORKFLOW_COSTS.environmental_impact,
  },
  fire_suppression: {
    description: "Design clean agent fire suppression systems per NFPA 2001 and NFPA 75. Calculates agent quantity (FM-200, Novec 1230, Inergen, CO2), cylinder count, nozzle layout, and discharge time.",
    params: ["room_length_ft", "room_width_ft", "ceiling_height_ft"],
    credits: WORKFLOW_COSTS.fire_suppression,
  },
  incentive_finder: {
    description: "Identify federal and state financial incentives for data center projects. Analyzes IRA tax credits, state grants, utility rebates, enterprise zone benefits, and job creation incentives by state.",
    params: ["state", "capex", "it_load_mw"],
    credits: WORKFLOW_COSTS.incentive_finder,
  },
  noise_compliance: {
    description: "Analyze generator noise compliance with local ordinances. Calculates sound pressure levels at property line using inverse-square law, assesses zoning compliance, and recommends mitigation.",
    params: ["generator_db_at_23ft", "distance_to_property_line_ft", "local_limit_db"],
    credits: WORKFLOW_COSTS.noise_compliance,
  },
  permit_timeline: {
    description: "Estimate permitting timeline and critical path for data center construction. Analyzes building, electrical, mechanical, fire, and environmental permits by jurisdiction type and project scope.",
    params: ["jurisdiction", "project_sqft", "generator_count"],
    credits: WORKFLOW_COSTS.permit_timeline,
  },
  roi_calculator: {
    description: "Calculate return on investment for data center capital projects. Computes NPV, IRR, simple payback, discounted payback, and cumulative cash flow using DCF analysis.",
    params: ["capex", "annual_opex", "revenue_per_year", "project_lifetime_years"],
    credits: WORKFLOW_COSTS.roi_calculator,
  },
  tco_analyzer: {
    description: "Analyze total cost of ownership for data center operations. Breaks down power, cooling, labor, hardware refresh, maintenance, and facility costs over a multi-year horizon.",
    params: ["it_load_kw", "power_rate_kwh", "years", "pue"],
    credits: WORKFLOW_COSTS.tco_analyzer,
  },
  fiber_connectivity: {
    description: "Analyze fiber connectivity options and costs for a data center location. Evaluates carrier diversity, dark fiber vs lit services, latency to key markets, and redundancy paths.",
    params: ["location", "target_markets"],
    credits: WORKFLOW_COSTS.fiber_connectivity,
  },
  harmonic_analysis: {
    description: "Perform harmonic analysis per IEEE 519 for data center power systems. Calculates total harmonic distortion (THD), voltage THD, and recommends filters and transformer derating.",
    params: ["total_load_kva", "ups_percentage", "vfd_percentage", "transformer_kva"],
    credits: WORKFLOW_COSTS.harmonic_analysis,
  },
  site_scoring: {
    description: "Score and rank candidate data center sites across power, connectivity, risk, regulatory, and cost dimensions. Accepts a JSON array of site objects with attributes.",
    params: ["sites_json"],
    credits: WORKFLOW_COSTS.site_scoring,
  },
  voltage_drop: {
    description: "Calculate voltage drop for data center power distribution circuits per NEC 210.19. Computes percent drop, conductor sizing recommendations, and NEC 647 compliance for sensitive loads.",
    params: ["load_amps", "distance_feet", "voltage", "circuit_type"],
    credits: WORKFLOW_COSTS.voltage_drop,
  },
  water_availability: {
    description: "Assess water availability and consumption for data center cooling systems. Estimates daily/annual consumption, water stress risk, permit requirements, and recycled water options.",
    params: ["cooling_tons", "location"],
    credits: WORKFLOW_COSTS.water_availability,
  },
  // Phase 2 — new agents
  network_topology: {
    description: "Design spine-leaf network topology for data center switching fabric. Calculates spine/leaf switch counts, uplink ratios, oversubscription, port requirements, and cabling inventory.",
    params: ["rack_count", "target_bandwidth_gbps", "redundancy_type"],
    credits: WORKFLOW_COSTS.network_topology,
  },
  bandwidth_sizing: {
    description: "Size north-south and east-west bandwidth for data center network fabric. Estimates aggregate throughput, uplink capacity, peering requirements, and recommends fabric speed.",
    params: ["rack_count", "servers_per_rack", "bandwidth_per_server_gbps"],
    credits: WORKFLOW_COSTS.bandwidth_sizing,
  },
  latency_calculator: {
    description: "Calculate propagation latency for data center interconnects. Computes one-way and round-trip delay by medium (fiber, copper, wireless, microwave) and hop count.",
    params: ["distance_km", "medium"],
    credits: WORKFLOW_COSTS.latency_calculator,
  },
  ip_addressing: {
    description: "Design IP addressing and VLAN architecture for data center networks. Calculates subnet sizes with growth buffer, prefix lengths, VLAN counts, and management IP allocations.",
    params: ["rack_count", "hosts_per_rack"],
    credits: WORKFLOW_COSTS.ip_addressing,
  },
  dns_architecture: {
    description: "Design DNS architecture for data center environments. Recommends authoritative and recursive server counts, anycast deployment, DNSSEC requirements, and QPS capacity.",
    params: ["rack_count"],
    credits: WORKFLOW_COSTS.dns_architecture,
  },
  bgp_peering: {
    description: "Design BGP peering architecture for data center edge routing. Calculates route reflector requirements, memory for full tables, session counts, and convergence estimates.",
    params: ["asn", "peer_count", "transit_providers"],
    credits: WORKFLOW_COSTS.bgp_peering,
  },
  physical_security: {
    description: "Design physical security systems for data centers per Uptime Institute tier standards. Calculates security zones, guard staffing, camera counts, access control points, and annual cost.",
    params: ["facility_sqft", "tier"],
    credits: WORKFLOW_COSTS.physical_security,
  },
  biometric_design: {
    description: "Design biometric access control systems for data center security zones. Calculates reader counts, FAR/FRR performance, throughput capacity, and enrollment database sizing.",
    params: ["staff_count", "security_zones", "biometric_type"],
    credits: WORKFLOW_COSTS.biometric_design,
  },
  surveillance_coverage: {
    description: "Design CCTV surveillance coverage for data center facilities. Calculates camera counts, field of view, storage requirements, and retention compliance for each resolution.",
    params: ["facility_sqft", "camera_resolution", "retention_days"],
    credits: WORKFLOW_COSTS.surveillance_coverage,
  },
  cybersecurity_controls: {
    description: "Map cybersecurity controls for data center compliance frameworks. Analyzes SOC 2, ISO 27001, NIST CSF, PCI DSS, and FedRAMP control requirements, SIEM sizing, and implementation effort.",
    params: ["facility_type", "compliance_framework", "network_zones"],
    credits: WORKFLOW_COSTS.cybersecurity_controls,
  },
  compliance_checker: {
    description: "Check multi-framework compliance posture for data center operations. Identifies control overlaps, gaps, and prioritized remediation across simultaneous compliance programs.",
    params: ["frameworks", "facility_type", "current_tier"],
    credits: WORKFLOW_COSTS.compliance_checker,
  },
  chiller_sizing: {
    description: "Size water-cooled and air-cooled chillers for data center cooling plants. Calculates cooling tons, chiller plant configuration, N+1/2N sizing, and annual energy consumption.",
    params: ["it_load_kw", "pue", "cooling_type", "redundancy"],
    credits: WORKFLOW_COSTS.chiller_sizing,
  },
  crac_vs_crah: {
    description: "Compare CRAC vs CRAH unit selection for data center cooling. Analyzes EER/COP differences, annual energy cost, water availability constraints, and recommends optimal configuration.",
    params: ["it_load_kw", "room_sqft", "water_available"],
    credits: WORKFLOW_COSTS.crac_vs_crah,
  },
  airflow_modeling: {
    description: "Model airflow patterns for data center hot/cold aisle containment. Estimates CFM requirements, delta-T across racks, bypass airflow percentage, and hotspot risk by containment type.",
    params: ["rack_count", "avg_kw_per_rack", "room_sqft", "containment_type"],
    credits: WORKFLOW_COSTS.airflow_modeling,
  },
  humidification: {
    description: "Design humidification and dehumidification systems per ASHRAE A1 envelope. Calculates moisture load, equipment capacity, energy consumption, and seasonal control strategy.",
    params: ["room_sqft", "it_load_kw", "climate_zone"],
    credits: WORKFLOW_COSTS.humidification,
  },
  economizer_analysis: {
    description: "Analyze economizer free-cooling potential for data center locations. Estimates annual free-cooling hours by climate, blended PUE improvement, energy savings, and simple payback.",
    params: ["location", "it_load_kw", "pue_mechanical", "economizer_type"],
    credits: WORKFLOW_COSTS.economizer_analysis,
  },
  construction_timeline: {
    description: "Estimate construction timeline for data center development projects. Provides phase-by-phase schedule (design, permits, civil, MEP, commissioning) with state-specific regulatory modifiers.",
    params: ["capacity_mw", "building_type", "state"],
    credits: WORKFLOW_COSTS.construction_timeline,
  },
  commissioning_plan: {
    description: "Generate commissioning plan per ASHRAE Guideline 1.2 for data center infrastructure. Calculates Level 1–4 test hours, witness testing requirements, and integrated systems testing scope.",
    params: ["capacity_mw", "tier"],
    credits: WORKFLOW_COSTS.commissioning_plan,
  },
  maintenance_schedule: {
    description: "Build annual preventive maintenance schedule for data center infrastructure. Calculates PM labor hours, intervals, and annual cost for generators, UPS, cooling, and electrical systems.",
    params: ["generator_count", "ups_count", "cooling_units", "tier"],
    credits: WORKFLOW_COSTS.maintenance_schedule,
  },
  capacity_planning: {
    description: "Project data center capacity runway and expansion trigger points. Uses logarithmic growth modeling to forecast years to 80% utilization, critical threshold, and end-of-design-life load.",
    params: ["current_load_kw", "current_capacity_kw", "growth_rate_pct_per_year"],
    credits: WORKFLOW_COSTS.capacity_planning,
  },
  sla_calculator: {
    description: "Calculate SLA availability metrics against Uptime Institute tier benchmarks. Computes allowed downtime minutes/year, MTTR budget, and compliance status for target availability percentage.",
    params: ["tier", "target_availability_pct"],
    credits: WORKFLOW_COSTS.sla_calculator,
  },
  change_management: {
    description: "Design change management process for data center operations. Defines CAB frequency, change windows, rollback SLA, and staffing model based on tier classification and change volume.",
    params: ["tier", "change_volume_per_month", "staff_count"],
    credits: WORKFLOW_COSTS.change_management,
  },
  carbon_footprint: {
    description: "Calculate data center carbon footprint per GHG Protocol Scope 2. Computes location-based and market-based emissions using eGRID factors, renewable energy certificates, and carbon intensity.",
    params: ["it_load_kw", "pue", "grid_region"],
    credits: WORKFLOW_COSTS.carbon_footprint,
  },
  solar_feasibility: {
    description: "Assess rooftop solar PV feasibility for data center facilities. Calculates system capacity, annual generation, energy offset percentage, IRA tax credit (30%), and simple payback.",
    params: ["facility_sqft", "it_load_kw", "state"],
    credits: WORKFLOW_COSTS.solar_feasibility,
  },
  battery_storage: {
    description: "Size battery energy storage systems for data center applications. Supports Li-ion, LFP, VRLA, and flow chemistries for UPS backup, peak shaving, demand response, and islanding use cases.",
    params: ["it_load_kw", "target_runtime_minutes", "chemistry"],
    credits: WORKFLOW_COSTS.battery_storage,
  },
  energy_procurement: {
    description: "Analyze energy procurement strategies for large data center loads. Compares utility tariffs, PPAs, green tariffs, and direct access contracts with estimated annual cost and renewable content.",
    params: ["annual_consumption_mwh", "state", "contract_term_years"],
    credits: WORKFLOW_COSTS.energy_procurement,
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

    // ── Phase 1 — previously unregistered agents ──────────────────────────────

    case "demand_response": {
      const drResult = await runDemandResponse({
        generator_capacity_kw:  parseFloat(args.generator_capacity_kw),
        critical_load_kw:       parseFloat(args.critical_load_kw),
        utility_provider:       args.utility_provider,
        annual_events_expected: args.annual_events_expected ? parseInt(args.annual_events_expected) : undefined,
      });
      log("info", `demand_response complete — ${drResult.target} in ${drResult.results.duration_ms}ms`);
      return drResult as unknown as WorkflowResult;
    }

    case "environmental_impact": {
      const eiResult = await runEnvironmentalImpact({
        generator_count:         parseInt(args.generator_count),
        generator_kw:            parseFloat(args.generator_kw),
        site_acres:              parseFloat(args.site_acres),
        proximity_to_wetlands_ft: args.proximity_to_wetlands_ft ? parseFloat(args.proximity_to_wetlands_ft) : undefined,
        state:                   args.state ?? undefined,
      });
      log("info", `environmental_impact complete — ${eiResult.target} in ${eiResult.results.duration_ms}ms`);
      return eiResult as unknown as WorkflowResult;
    }

    case "fire_suppression": {
      const fsResult = await runFireSuppression({
        room_length_ft:  parseFloat(args.room_length_ft),
        room_width_ft:   parseFloat(args.room_width_ft),
        ceiling_height_ft: parseFloat(args.ceiling_height_ft),
        agent_type:      (args.agent_type as "FM200" | "Novec1230" | "Inergen" | "CO2") ?? undefined,
        enclosure_type:  (args.enclosure_type as "server_room" | "ups_room" | "battery_room" | "cable_vault" | "mechanical") ?? undefined,
      });
      log("info", `fire_suppression complete — ${fsResult.target} in ${fsResult.results.duration_ms}ms`);
      return fsResult as unknown as WorkflowResult;
    }

    case "incentive_finder": {
      const ifResult = await runIncentiveFinder({
        state:                args.state,
        capex:                parseFloat(args.capex),
        it_load_mw:           parseFloat(args.it_load_mw),
        renewable_percentage: args.renewable_percentage ? parseFloat(args.renewable_percentage) : undefined,
        new_jobs_created:     args.new_jobs_created ? parseInt(args.new_jobs_created) : undefined,
      });
      log("info", `incentive_finder complete — ${ifResult.target} in ${ifResult.results.duration_ms}ms`);
      return ifResult as unknown as WorkflowResult;
    }

    case "noise_compliance": {
      const ncResult = await runNoiseCompliance({
        generator_db_at_23ft:        parseFloat(args.generator_db_at_23ft),
        distance_to_property_line_ft: parseFloat(args.distance_to_property_line_ft),
        local_limit_db:              parseFloat(args.local_limit_db),
        zoning:                      (args.zoning as "residential" | "commercial" | "industrial") ?? undefined,
      });
      log("info", `noise_compliance complete — ${ncResult.target} in ${ncResult.results.duration_ms}ms`);
      return ncResult as unknown as WorkflowResult;
    }

    case "permit_timeline": {
      const ptResult = await runPermitTimeline({
        jurisdiction:     args.jurisdiction,
        project_sqft:     parseFloat(args.project_sqft),
        generator_count:  parseInt(args.generator_count),
        project_type:     (args.project_type as "new" | "renovation") ?? undefined,
      });
      log("info", `permit_timeline complete — ${ptResult.target} in ${ptResult.results.duration_ms}ms`);
      return ptResult as unknown as WorkflowResult;
    }

    case "roi_calculator": {
      const roiResult = await runRoiCalculator({
        capex:                  parseFloat(args.capex),
        annual_opex:            parseFloat(args.annual_opex),
        revenue_per_year:       parseFloat(args.revenue_per_year),
        project_lifetime_years: parseFloat(args.project_lifetime_years),
        discount_rate:          args.discount_rate ? parseFloat(args.discount_rate) : undefined,
      });
      log("info", `roi_calculator complete — ${roiResult.target} in ${roiResult.results.duration_ms}ms`);
      return roiResult as unknown as WorkflowResult;
    }

    case "tco_analyzer": {
      const tcoResult = await runTcoAnalyzer({
        it_load_kw:          parseFloat(args.it_load_kw),
        power_rate_kwh:      parseFloat(args.power_rate_kwh),
        years:               parseFloat(args.years),
        pue:                 parseFloat(args.pue),
        labor_cost_annual:   args.labor_cost_annual ? parseFloat(args.labor_cost_annual) : undefined,
        refresh_cycle_years: args.refresh_cycle_years ? parseFloat(args.refresh_cycle_years) : undefined,
      });
      log("info", `tco_analyzer complete — ${tcoResult.target} in ${tcoResult.results.duration_ms}ms`);
      return tcoResult as unknown as WorkflowResult;
    }

    case "fiber_connectivity": {
      const fcResult = await runFiberConnectivity({
        location:             args.location,
        target_markets:       args.target_markets,
        redundancy_required:  (args.redundancy_required as "yes" | "no") ?? undefined,
      });
      log("info", `fiber_connectivity complete — ${fcResult.target} in ${fcResult.results.duration_ms}ms`);
      return fcResult as unknown as WorkflowResult;
    }

    case "harmonic_analysis": {
      const haResult = await runHarmonicAnalysis({
        total_load_kva:   parseFloat(args.total_load_kva),
        ups_percentage:   parseFloat(args.ups_percentage),
        vfd_percentage:   parseFloat(args.vfd_percentage),
        transformer_kva:  parseFloat(args.transformer_kva),
      });
      log("info", `harmonic_analysis complete — ${haResult.target} in ${haResult.results.duration_ms}ms`);
      return haResult as unknown as WorkflowResult;
    }

    case "site_scoring": {
      const ssResult = await runSiteScoring({ sites_json: args.sites_json });
      log("info", `site_scoring complete — ${ssResult.target} in ${ssResult.results.duration_ms}ms`);
      return ssResult as unknown as WorkflowResult;
    }

    case "voltage_drop": {
      const vdResult = await runVoltageDrop({
        load_amps:          parseFloat(args.load_amps),
        distance_feet:      parseFloat(args.distance_feet),
        voltage:            parseFloat(args.voltage),
        circuit_type:       args.circuit_type as "feeder" | "branch",
        conductor_material: (args.conductor_material as "copper" | "aluminum") ?? undefined,
      });
      log("info", `voltage_drop complete — ${vdResult.target} in ${vdResult.results.duration_ms}ms`);
      return vdResult as unknown as WorkflowResult;
    }

    case "water_availability": {
      const waResult = await runWaterAvailability({
        cooling_tons:  parseFloat(args.cooling_tons),
        location:      args.location,
        cooling_type:  (args.cooling_type as "air" | "tower" | "hybrid") ?? undefined,
      });
      log("info", `water_availability complete — ${waResult.target} in ${waResult.results.duration_ms}ms`);
      return waResult as unknown as WorkflowResult;
    }

    // ── Phase 2 — new agents ──────────────────────────────────────────────────

    case "network_topology": {
      const ntResult = await runNetworkTopology({
        rack_count:            parseInt(args.rack_count),
        target_bandwidth_gbps: parseFloat(args.target_bandwidth_gbps),
        redundancy_type:       args.redundancy_type as "N+1" | "2N" | "mesh",
      });
      log("info", `network_topology complete — ${ntResult.target} in ${ntResult.results.duration_ms}ms`);
      return ntResult as unknown as WorkflowResult;
    }

    case "bandwidth_sizing": {
      const bwResult = await runBandwidthSizing({
        rack_count:                parseInt(args.rack_count),
        servers_per_rack:          parseInt(args.servers_per_rack),
        bandwidth_per_server_gbps: parseFloat(args.bandwidth_per_server_gbps),
      });
      log("info", `bandwidth_sizing complete — ${bwResult.target} in ${bwResult.results.duration_ms}ms`);
      return bwResult as unknown as WorkflowResult;
    }

    case "latency_calculator": {
      const lcResult = await runLatencyCalculator({
        distance_km: parseFloat(args.distance_km),
        medium:      args.medium as "fiber" | "copper" | "wireless",
        hops:        args.hops ? parseInt(args.hops) : undefined,
      });
      log("info", `latency_calculator complete — ${lcResult.target} in ${lcResult.results.duration_ms}ms`);
      return lcResult as unknown as WorkflowResult;
    }

    case "ip_addressing": {
      const ipResult = await runIpAddressing({
        rack_count:      parseInt(args.rack_count),
        hosts_per_rack:  parseInt(args.hosts_per_rack),
        vlans_required:  args.vlans_required ? parseInt(args.vlans_required) : undefined,
      });
      log("info", `ip_addressing complete — ${ipResult.target} in ${ipResult.results.duration_ms}ms`);
      return ipResult as unknown as WorkflowResult;
    }

    case "dns_architecture": {
      const dnsResult = await runDnsArchitecture({
        rack_count:      parseInt(args.rack_count),
        zones_count:     args.zones_count ? parseInt(args.zones_count) : undefined,
        dnssec_required: (args.dnssec_required as "true" | "false" | undefined) ?? undefined,
      });
      log("info", `dns_architecture complete — ${dnsResult.target} in ${dnsResult.results.duration_ms}ms`);
      return dnsResult as unknown as WorkflowResult;
    }

    case "bgp_peering": {
      const bgpResult = await runBgpPeering({
        asn:               parseInt(args.asn),
        peer_count:        parseInt(args.peer_count),
        transit_providers: parseInt(args.transit_providers),
      });
      log("info", `bgp_peering complete — ${bgpResult.target} in ${bgpResult.results.duration_ms}ms`);
      return bgpResult as unknown as WorkflowResult;
    }

    case "physical_security": {
      const psResult = await runPhysicalSecurity({
        facility_sqft: parseFloat(args.facility_sqft),
        tier:          parseInt(args.tier),
        perimeter_ft:  args.perimeter_ft ? parseFloat(args.perimeter_ft) : undefined,
      });
      log("info", `physical_security complete — ${psResult.target} in ${psResult.results.duration_ms}ms`);
      return psResult as unknown as WorkflowResult;
    }

    case "biometric_design": {
      const biResult = await runBiometricDesign({
        staff_count:     parseInt(args.staff_count),
        security_zones:  parseInt(args.security_zones),
        biometric_type:  args.biometric_type as "fingerprint" | "iris" | "face" | "palm" | "multifactor",
      });
      log("info", `biometric_design complete — ${biResult.target} in ${biResult.results.duration_ms}ms`);
      return biResult as unknown as WorkflowResult;
    }

    case "surveillance_coverage": {
      const scResult = await runSurveillanceCoverage({
        facility_sqft:    parseFloat(args.facility_sqft),
        camera_resolution: args.camera_resolution as "2mp" | "4mp" | "8mp" | "12mp",
        retention_days:   parseInt(args.retention_days),
      });
      log("info", `surveillance_coverage complete — ${scResult.target} in ${scResult.results.duration_ms}ms`);
      return scResult as unknown as WorkflowResult;
    }

    case "cybersecurity_controls": {
      const ccResult = await runCybersecurityControls({
        facility_type:        args.facility_type as "colo" | "hyperscale" | "enterprise" | "edge",
        compliance_framework: args.compliance_framework as "soc2" | "pci_dss" | "hipaa" | "fedramp" | "iso27001",
        network_zones:        parseInt(args.network_zones),
      });
      log("info", `cybersecurity_controls complete — ${ccResult.target} in ${ccResult.results.duration_ms}ms`);
      return ccResult as unknown as WorkflowResult;
    }

    case "compliance_checker": {
      const compResult = await runComplianceChecker({
        frameworks:    args.frameworks,
        facility_type: args.facility_type as "colo" | "hyperscale" | "enterprise" | "edge",
        current_tier:  parseInt(args.current_tier),
      });
      log("info", `compliance_checker complete — ${compResult.target} in ${compResult.results.duration_ms}ms`);
      return compResult as unknown as WorkflowResult;
    }

    case "chiller_sizing": {
      const chillerResult = await runChillerSizing({
        it_load_kw:   parseFloat(args.it_load_kw),
        pue:          parseFloat(args.pue),
        cooling_type: args.cooling_type as "air_cooled" | "water_cooled" | "free_cooling",
        redundancy:   args.redundancy as "N+1" | "2N",
      });
      log("info", `chiller_sizing complete — ${chillerResult.target} in ${chillerResult.results.duration_ms}ms`);
      return chillerResult as unknown as WorkflowResult;
    }

    case "crac_vs_crah": {
      const cvcResult = await runCracVsCrah({
        it_load_kw:     parseFloat(args.it_load_kw),
        room_sqft:      parseFloat(args.room_sqft),
        water_available: args.water_available as "yes" | "no",
        climate_zone:   (args.climate_zone as "hot_dry" | "hot_humid" | "mild" | "cold") ?? undefined,
      });
      log("info", `crac_vs_crah complete — ${cvcResult.target} in ${cvcResult.results.duration_ms}ms`);
      return cvcResult as unknown as WorkflowResult;
    }

    case "airflow_modeling": {
      const afResult = await runAirflowModeling({
        rack_count:       parseInt(args.rack_count),
        avg_kw_per_rack:  parseFloat(args.avg_kw_per_rack),
        room_sqft:        parseFloat(args.room_sqft),
        containment_type: args.containment_type as "none" | "hot_aisle" | "cold_aisle" | "full_chimney",
      });
      log("info", `airflow_modeling complete — ${afResult.target} in ${afResult.results.duration_ms}ms`);
      return afResult as unknown as WorkflowResult;
    }

    case "humidification": {
      const humResult = await runHumidification({
        room_sqft:      parseFloat(args.room_sqft),
        it_load_kw:     parseFloat(args.it_load_kw),
        climate_zone:   args.climate_zone as "arid" | "temperate" | "humid",
        target_rh_pct:  args.target_rh_pct ? parseFloat(args.target_rh_pct) : undefined,
      });
      log("info", `humidification complete — ${humResult.target} in ${humResult.results.duration_ms}ms`);
      return humResult as unknown as WorkflowResult;
    }

    case "economizer_analysis": {
      const ecoResult = await runEconomizerAnalysis({
        location:        args.location,
        it_load_kw:      parseFloat(args.it_load_kw),
        pue_mechanical:  parseFloat(args.pue_mechanical),
        economizer_type: args.economizer_type as "air_side" | "water_side" | "hybrid",
      });
      log("info", `economizer_analysis complete — ${ecoResult.target} in ${ecoResult.results.duration_ms}ms`);
      return ecoResult as unknown as WorkflowResult;
    }

    case "construction_timeline": {
      const ctResult = await runConstructionTimeline({
        capacity_mw:   parseFloat(args.capacity_mw),
        building_type: args.building_type as "new_build" | "shell_core" | "retrofit",
        state:         args.state,
      });
      log("info", `construction_timeline complete — ${ctResult.target} in ${ctResult.results.duration_ms}ms`);
      return ctResult as unknown as WorkflowResult;
    }

    case "commissioning_plan": {
      const cpResult = await runCommissioningPlan({
        capacity_mw:    parseFloat(args.capacity_mw),
        tier:           parseInt(args.tier),
        systems_count:  args.systems_count ? parseInt(args.systems_count) : undefined,
      });
      log("info", `commissioning_plan complete — ${cpResult.target} in ${cpResult.results.duration_ms}ms`);
      return cpResult as unknown as WorkflowResult;
    }

    case "maintenance_schedule": {
      const msResult = await runMaintenanceSchedule({
        generator_count: parseInt(args.generator_count),
        ups_count:       parseInt(args.ups_count),
        cooling_units:   parseInt(args.cooling_units),
        tier:            parseInt(args.tier),
      });
      log("info", `maintenance_schedule complete — ${msResult.target} in ${msResult.results.duration_ms}ms`);
      return msResult as unknown as WorkflowResult;
    }

    case "capacity_planning": {
      const capResult = await runCapacityPlanning({
        current_load_kw:          parseFloat(args.current_load_kw),
        current_capacity_kw:      parseFloat(args.current_capacity_kw),
        growth_rate_pct_per_year: parseFloat(args.growth_rate_pct_per_year),
        design_life_years:        args.design_life_years ? parseFloat(args.design_life_years) : undefined,
      });
      log("info", `capacity_planning complete — ${capResult.target} in ${capResult.results.duration_ms}ms`);
      return capResult as unknown as WorkflowResult;
    }

    case "sla_calculator": {
      const slaResult = await runSlaCalculator({
        tier:                        parseInt(args.tier),
        target_availability_pct:     parseFloat(args.target_availability_pct),
        maintenance_windows_per_year: args.maintenance_windows_per_year ? parseInt(args.maintenance_windows_per_year) : undefined,
      });
      log("info", `sla_calculator complete — ${slaResult.target} in ${slaResult.results.duration_ms}ms`);
      return slaResult as unknown as WorkflowResult;
    }

    case "change_management": {
      const cmResult = await runChangeManagement({
        tier:                    parseInt(args.tier),
        change_volume_per_month: parseInt(args.change_volume_per_month),
        staff_count:             parseInt(args.staff_count),
      });
      log("info", `change_management complete — ${cmResult.target} in ${cmResult.results.duration_ms}ms`);
      return cmResult as unknown as WorkflowResult;
    }

    case "carbon_footprint": {
      const cfResult = await runCarbonFootprint({
        it_load_kw:   parseFloat(args.it_load_kw),
        pue:          parseFloat(args.pue),
        grid_region:  args.grid_region as "WECC" | "SERC" | "RFC" | "MRO" | "NPCC" | "TRE" | "HICC" | "ASCC",
        renewable_pct: args.renewable_pct ? parseFloat(args.renewable_pct) : undefined,
      });
      log("info", `carbon_footprint complete — ${cfResult.target} in ${cfResult.results.duration_ms}ms`);
      return cfResult as unknown as WorkflowResult;
    }

    case "solar_feasibility": {
      const sfResult = await runSolarFeasibility({
        facility_sqft:      parseFloat(args.facility_sqft),
        it_load_kw:         parseFloat(args.it_load_kw),
        state:              args.state,
        roof_available_sqft: args.roof_available_sqft ? parseFloat(args.roof_available_sqft) : undefined,
      });
      log("info", `solar_feasibility complete — ${sfResult.target} in ${sfResult.results.duration_ms}ms`);
      return sfResult as unknown as WorkflowResult;
    }

    case "battery_storage": {
      const bsResult = await runBatteryStorage({
        it_load_kw:             parseFloat(args.it_load_kw),
        target_runtime_minutes: parseFloat(args.target_runtime_minutes),
        chemistry:              args.chemistry as "lithium_ion" | "lfp" | "vrla" | "flow",
        use_case:               (args.use_case as "ups_backup" | "peak_shaving" | "demand_response" | "islanding") ?? undefined,
      });
      log("info", `battery_storage complete — ${bsResult.target} in ${bsResult.results.duration_ms}ms`);
      return bsResult as unknown as WorkflowResult;
    }

    case "energy_procurement": {
      const epResult = await runEnergyProcurement({
        annual_consumption_mwh: parseFloat(args.annual_consumption_mwh),
        state:                  args.state,
        contract_term_years:    parseInt(args.contract_term_years),
        renewable_target_pct:   args.renewable_target_pct ? parseFloat(args.renewable_target_pct) : undefined,
      });
      log("info", `energy_procurement complete — ${epResult.target} in ${epResult.results.duration_ms}ms`);
      return epResult as unknown as WorkflowResult;
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

    // Admin: provision an API key for a user (called by billing-api after payment/verification)
    app.post("/admin/provision-key", express.json(), async (req, res) => {
      const adminKey = process.env.ORCHESTRATOR_ADMIN_KEY;
      if (!adminKey) {
        res.status(503).json({ error: "Admin key provisioning not configured" });
        return;
      }
      const suppliedKey = req.headers["x-admin-key"];
      if (!suppliedKey || suppliedKey !== adminKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { userId, tier } = req.body as { userId?: string; tier?: string };
      if (!userId || !tier) {
        res.status(400).json({ error: "userId and tier are required" });
        return;
      }
      try {
        const apiKey = generateApiKey(userId, tier);
        await storeApiKey(apiKey, userId, tier);
        log("info", `Provisioned API key for user ${userId} (tier: ${tier})`);
        res.json({ apiKey });
      } catch (err) {
        log("error", `provision-key error: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to provision key" });
      }
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
