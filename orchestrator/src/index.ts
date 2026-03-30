import crypto from "crypto";
import path from "path";
import { mountAgntcy } from "./agntcy.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
import { logAudit, auditDb, auditDbAll } from "./audit.js";
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
import { runTierCertification } from "./workflows/tierCertification.js";
import { toCanonical, CanonicalResponse } from "./canonical.js";

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
  const timestamp = new Date().toISOString();
  if (level === "warn" || level === "error") {
    // Structured JSON — Render's log search indexes these fields.
    // Query by: severity:WARN, severity:ERROR
    console.error(JSON.stringify({
      severity:  level === "error" ? "ERROR" : "WARN",
      timestamp,
      service:   "orchestrator",
      message:   msg,
    }));
  } else {
    console.error(`[orchestrator] [INFO] ${timestamp} ${msg}`);
  }
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

const WORKFLOWS: Record<string, {
  description:    string;
  params:         string[];
  credits:        number;
  version:        string;
  last_validated: string;
  standards_refs: string[];
  stale_risk:     "high" | "medium" | "low";
}> = {
  subdomain_discovery: {
    description: "Discover subdomains for a target domain using DNS brute-force, certificate transparency, and passive sources",
    params: ["domain"],
    credits: WORKFLOW_COSTS.subdomain_discovery,
    version: "1.0", last_validated: "2026-03-28", standards_refs: [], stale_risk: "low",
  },
  asset_discovery: {
    description: "Map IP addresses, open ports, technologies, and cloud assets for a target domain",
    params: ["domain"],
    credits: WORKFLOW_COSTS.asset_discovery,
    version: "1.0", last_validated: "2026-03-28", standards_refs: [], stale_risk: "low",
  },
  vulnerability_assessment: {
    description: "Run vulnerability scans against a target and return prioritized findings with remediation guidance",
    params: ["target"],
    credits: WORKFLOW_COSTS.vulnerability_assessment,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["CVE/NVD"], stale_risk: "low",
  },
  generator_sizing: {
    description: "Size generators for data center loads with industry-standard compliance. Returns genset kVA, fuel consumption, tank size, runtime, ATS sizing, and cost estimates.",
    params: ["load_kw", "tier"],
    credits: WORKFLOW_COSTS.generator_sizing,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NFPA 110-2022", "IEEE 446-1987"], stale_risk: "medium",
  },
  utility_interconnect: {
    description: "Analyze utility interconnect requirements for major US power providers. Returns per-load-size timelines, deposit $/kW ranges, first-year cost, competitive intel, and constraint warnings.",
    params: ["utility", "load_mw"],
    credits: WORKFLOW_COSTS.utility_interconnect,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["FERC Order 2023", "IEEE 1547-2018"], stale_risk: "high",
  },
  pue_calculator: {
    description: "Calculate Power Usage Effectiveness (PUE) and efficiency metrics for data center facilities. Analyzes IT load, cooling systems, power distribution, and provides optimization recommendations.",
    params: ["it_load_kw"],
    credits: WORKFLOW_COSTS.pue_calculator,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Green Grid PUE v2", "ISO/IEC 30134-2"], stale_risk: "low",
  },
  construction_cost: {
    description: "Estimate construction costs for data center development. Analyzes $/MW costs, regional pricing factors, tier requirements, and provides detailed cost breakdowns for shell, electrical, mechanical, and IT infrastructure.",
    params: ["capacity_mw"],
    credits: WORKFLOW_COSTS.construction_cost,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["JLL Data Center Outlook 2024", "Turner & Townsend GDCCI 2023", "RS Means City Cost Index 2024"], stale_risk: "high",
  },
  nfpa_110_checker: {
    description: "Check emergency generator compliance per NFPA 110 Level 1 and Level 2 requirements. Validates fuel capacity, ATS transfer time, runtime hours, and returns compliance status with violation details and remediation steps.",
    params: ["generator_kw", "fuel_capacity_gallons", "runtime_hours", "ats_transfer_time_seconds", "level"],
    credits: WORKFLOW_COSTS.nfpa_110_checker,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NFPA 110-2022"], stale_risk: "medium",
  },
  ats_sizing: {
    description: "Size automatic transfer switches per NEC Articles 700, 701, and 702. Calculates load current, applies 125% continuous load factor, selects standard ATS ratings, and returns enclosure options and installation requirements.",
    params: ["load_kw", "voltage", "phases"],
    credits: WORKFLOW_COSTS.ats_sizing,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NEC 2023 Art. 700", "NEC 2023 Art. 701", "NEC 2023 Art. 702"], stale_risk: "medium",
  },
  ups_sizing: {
    description: "Size uninterruptible power supplies per IEEE 485 and 1184. Calculates kVA, selects battery strings (VRLA or Li-ion), determines runtime across N/N+1/2N configurations, and provides cost estimates.",
    params: ["load_kw", "runtime_minutes"],
    credits: WORKFLOW_COSTS.ups_sizing,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IEEE 485-2010", "IEEE 1184-2006"], stale_risk: "medium",
  },
  fuel_storage: {
    description: "Design diesel fuel storage systems for emergency generators. Calculates tank size, runtime, secondary containment, SPCC thresholds, NFPA 30 compliance, and day tank recommendations.",
    params: ["generator_kw", "target_runtime_hours"],
    credits: WORKFLOW_COSTS.fuel_storage,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NFPA 30-2021", "EPA SPCC 40 CFR 112"], stale_risk: "medium",
  },
  cooling_load: {
    description: "Calculate data center cooling load per ASHRAE TC 9.9. Computes IT heat, UPS losses, envelope gains, converts to tons, sizes CRAC/CRAH units with N+1 redundancy, and checks ASHRAE thermal envelopes.",
    params: ["it_load_kw", "ups_capacity_kw", "room_sqft"],
    credits: WORKFLOW_COSTS.cooling_load,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE TC 9.9-2021"], stale_risk: "low",
  },
  power_density: {
    description: "Analyze rack power density for data centers. Classifies kW/rack density, sizes PDUs and branch circuits per NEC 645, calculates airflow requirements, and provides expansion capacity analysis.",
    params: ["total_it_load_kw", "rack_count"],
    credits: WORKFLOW_COSTS.power_density,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NEC 2023 Art. 645"], stale_risk: "medium",
  },
  redundancy_validator: {
    description: "Validate data center redundancy design against Uptime Institute Tier I–IV standards. Identifies single points of failure, assesses concurrent maintainability, and maps achieved tier with gaps to next level.",
    params: ["design_type", "total_load_kw", "generator_count", "generator_capacity_kw", "ups_count", "ups_capacity_kw", "cooling_units"],
    credits: WORKFLOW_COSTS.redundancy_validator,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Uptime Institute Tier Standard 2022"], stale_risk: "medium",
  },
  // Phase 1 — previously unregistered agents
  demand_response: {
    description: "Model utility demand response program participation for backup generator fleets. Calculates curtailment capacity, annual revenue, response time requirements, and program eligibility by utility.",
    params: ["generator_capacity_kw", "critical_load_kw", "utility_provider"],
    credits: WORKFLOW_COSTS.demand_response,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["FERC Order 745", "PJM DR Tariff"], stale_risk: "high",
  },
  environmental_impact: {
    description: "Assess environmental impact of data center generator operations. Calculates NOx/PM2.5/CO2 emissions per USEPA AP-42, air permit thresholds, CEQA/NEPA triggers, and mitigation requirements.",
    params: ["generator_count", "generator_kw", "site_acres"],
    credits: WORKFLOW_COSTS.environmental_impact,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["EPA AP-42 Section 3.4", "40 CFR Part 60 NSPS"], stale_risk: "medium",
  },
  fire_suppression: {
    description: "Design clean agent fire suppression systems per NFPA 2001 and NFPA 75. Calculates agent quantity (FM-200, Novec 1230, Inergen, CO2), cylinder count, nozzle layout, and discharge time.",
    params: ["room_length_ft", "room_width_ft", "ceiling_height_ft"],
    credits: WORKFLOW_COSTS.fire_suppression,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NFPA 2001-2022", "NFPA 75-2020"], stale_risk: "medium",
  },
  incentive_finder: {
    description: "Identify federal and state financial incentives for data center projects. Analyzes IRA tax credits, state grants, utility rebates, enterprise zone benefits, and job creation incentives by state.",
    params: ["state", "capex", "it_load_mw"],
    credits: WORKFLOW_COSTS.incentive_finder,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IRA 2022 Section 48E", "26 USC 48C"], stale_risk: "high",
  },
  noise_compliance: {
    description: "Analyze generator noise compliance with local ordinances. Calculates sound pressure levels at property line using inverse-square law, assesses zoning compliance, and recommends mitigation.",
    params: ["generator_db_at_23ft", "distance_to_property_line_ft", "local_limit_db"],
    credits: WORKFLOW_COSTS.noise_compliance,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ISO 9613-2", "ANSI S12.18"], stale_risk: "low",
  },
  permit_timeline: {
    description: "Estimate permitting timeline and critical path for data center construction. Analyzes building, electrical, mechanical, fire, and environmental permits by jurisdiction type and project scope.",
    params: ["jurisdiction", "project_sqft", "generator_count"],
    credits: WORKFLOW_COSTS.permit_timeline,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IBC 2021", "IFC 2021"], stale_risk: "medium",
  },
  roi_calculator: {
    description: "Calculate return on investment for data center capital projects. Computes NPV, IRR, simple payback, discounted payback, and cumulative cash flow using DCF analysis.",
    params: ["capex", "annual_opex", "revenue_per_year", "project_lifetime_years"],
    credits: WORKFLOW_COSTS.roi_calculator,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["DCF methodology"], stale_risk: "high",
  },
  tco_analyzer: {
    description: "Analyze total cost of ownership for data center operations. Breaks down power, cooling, labor, hardware refresh, maintenance, and facility costs over a multi-year horizon.",
    params: ["it_load_kw", "power_rate_kwh", "years", "pue"],
    credits: WORKFLOW_COSTS.tco_analyzer,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Green Grid TCO methodology"], stale_risk: "high",
  },
  fiber_connectivity: {
    description: "Analyze fiber connectivity options and costs for a data center location. Evaluates carrier diversity, dark fiber vs lit services, latency to key markets, and redundancy paths.",
    params: ["location", "target_markets"],
    credits: WORKFLOW_COSTS.fiber_connectivity,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Ethernet Alliance 400GbE"], stale_risk: "high",
  },
  harmonic_analysis: {
    description: "Perform harmonic analysis per IEEE 519 for data center power systems. Calculates total harmonic distortion (THD), voltage THD, and recommends filters and transformer derating.",
    params: ["total_load_kva", "ups_percentage", "vfd_percentage", "transformer_kva"],
    credits: WORKFLOW_COSTS.harmonic_analysis,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IEEE 519-2022"], stale_risk: "low",
  },
  site_scoring: {
    description: "Score and rank candidate data center sites across power, connectivity, risk, regulatory, and cost dimensions. Accepts a JSON array of site objects with attributes.",
    params: ["sites_json"],
    credits: WORKFLOW_COSTS.site_scoring,
    version: "1.0", last_validated: "2026-03-28", standards_refs: [], stale_risk: "low",
  },
  voltage_drop: {
    description: "Calculate voltage drop for data center power distribution circuits per NEC 210.19. Computes percent drop, conductor sizing recommendations, and NEC 647 compliance for sensitive loads.",
    params: ["load_amps", "distance_feet", "voltage", "circuit_type"],
    credits: WORKFLOW_COSTS.voltage_drop,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NEC 2023 Art. 210.19", "NEC 2023 Art. 647"], stale_risk: "low",
  },
  water_availability: {
    description: "Assess water availability and consumption for data center cooling systems. Estimates daily/annual consumption, water stress risk, permit requirements, and recycled water options.",
    params: ["cooling_tons", "location"],
    credits: WORKFLOW_COSTS.water_availability,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["EPA WaterSense", "ASHRAE 90.1-2022"], stale_risk: "medium",
  },
  // Phase 2 — new agents
  network_topology: {
    description: "Design spine-leaf network topology for data center switching fabric. Calculates spine/leaf switch counts, uplink ratios, oversubscription, port requirements, and cabling inventory.",
    params: ["rack_count", "target_bandwidth_gbps", "redundancy_type"],
    credits: WORKFLOW_COSTS.network_topology,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IEEE 802.1Q-2022", "RFC 7938"], stale_risk: "low",
  },
  bandwidth_sizing: {
    description: "Size north-south and east-west bandwidth for data center network fabric. Estimates aggregate throughput, uplink capacity, peering requirements, and recommends fabric speed.",
    params: ["rack_count", "servers_per_rack", "bandwidth_per_server_gbps"],
    credits: WORKFLOW_COSTS.bandwidth_sizing,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IEEE 802.3bs-2017"], stale_risk: "low",
  },
  latency_calculator: {
    description: "Calculate propagation latency for data center interconnects. Computes one-way and round-trip delay by medium (fiber, copper, wireless, microwave) and hop count.",
    params: ["distance_km", "medium"],
    credits: WORKFLOW_COSTS.latency_calculator,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ITU-T G.826"], stale_risk: "low",
  },
  ip_addressing: {
    description: "Design IP addressing and VLAN architecture for data center networks. Calculates subnet sizes with growth buffer, prefix lengths, VLAN counts, and management IP allocations.",
    params: ["rack_count", "hosts_per_rack"],
    credits: WORKFLOW_COSTS.ip_addressing,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["RFC 1918", "RFC 4291"], stale_risk: "low",
  },
  dns_architecture: {
    description: "Design DNS architecture for data center environments. Recommends authoritative and recursive server counts, anycast deployment, DNSSEC requirements, and QPS capacity.",
    params: ["rack_count"],
    credits: WORKFLOW_COSTS.dns_architecture,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["RFC 1035", "RFC 4033 DNSSEC"], stale_risk: "low",
  },
  bgp_peering: {
    description: "Design BGP peering architecture for data center edge routing. Calculates route reflector requirements, memory for full tables, session counts, and convergence estimates.",
    params: ["asn", "peer_count", "transit_providers"],
    credits: WORKFLOW_COSTS.bgp_peering,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["RFC 4271 BGP-4", "RFC 4456 RR"], stale_risk: "low",
  },
  physical_security: {
    description: "Design physical security systems for data centers per Uptime Institute tier standards. Calculates security zones, guard staffing, camera counts, access control points, and annual cost.",
    params: ["facility_sqft", "tier"],
    credits: WORKFLOW_COSTS.physical_security,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Uptime Institute M&O Stamp 2022", "ANSI/ASIS PSC.1"], stale_risk: "high",
  },
  biometric_design: {
    description: "Design biometric access control systems for data center security zones. Calculates reader counts, FAR/FRR performance, throughput capacity, and enrollment database sizing.",
    params: ["staff_count", "security_zones", "biometric_type"],
    credits: WORKFLOW_COSTS.biometric_design,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NIST SP 800-76-2", "ISO/IEC 19794"], stale_risk: "low",
  },
  surveillance_coverage: {
    description: "Design CCTV surveillance coverage for data center facilities. Calculates camera counts, field of view, storage requirements, and retention compliance for each resolution.",
    params: ["facility_sqft", "camera_resolution", "retention_days"],
    credits: WORKFLOW_COSTS.surveillance_coverage,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NDAA Section 889", "IEC 62676-4"], stale_risk: "medium",
  },
  cybersecurity_controls: {
    description: "Map cybersecurity controls for data center compliance frameworks. Analyzes SOC 2, ISO 27001, NIST CSF, PCI DSS, and FedRAMP control requirements, SIEM sizing, and implementation effort.",
    params: ["facility_type", "compliance_framework", "network_zones"],
    credits: WORKFLOW_COSTS.cybersecurity_controls,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NIST CSF 2.0", "PCI DSS 4.0", "ISO 27001-2022", "FedRAMP Rev 5"], stale_risk: "medium",
  },
  compliance_checker: {
    description: "Check multi-framework compliance posture for data center operations. Identifies control overlaps, gaps, and prioritized remediation across simultaneous compliance programs.",
    params: ["frameworks", "facility_type", "current_tier"],
    credits: WORKFLOW_COSTS.compliance_checker,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["SOC 2 TSC 2017", "ISO 27001-2022", "NIST CSF 2.0", "PCI DSS 4.0"], stale_risk: "medium",
  },
  chiller_sizing: {
    description: "Size water-cooled and air-cooled chillers for data center cooling plants. Calculates cooling tons, chiller plant configuration, N+1/2N sizing, and annual energy consumption.",
    params: ["it_load_kw", "pue", "cooling_type", "redundancy"],
    credits: WORKFLOW_COSTS.chiller_sizing,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE 90.1-2022", "ASHRAE TC 9.9-2021"], stale_risk: "medium",
  },
  crac_vs_crah: {
    description: "Compare CRAC vs CRAH unit selection for data center cooling. Analyzes EER/COP differences, annual energy cost, water availability constraints, and recommends optimal configuration.",
    params: ["it_load_kw", "room_sqft", "water_available"],
    credits: WORKFLOW_COSTS.crac_vs_crah,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE TC 9.9-2021", "ASHRAE 90.1-2022"], stale_risk: "medium",
  },
  airflow_modeling: {
    description: "Model airflow patterns for data center hot/cold aisle containment. Estimates CFM requirements, delta-T across racks, bypass airflow percentage, and hotspot risk by containment type.",
    params: ["rack_count", "avg_kw_per_rack", "room_sqft", "containment_type"],
    credits: WORKFLOW_COSTS.airflow_modeling,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE TC 9.9-2021"], stale_risk: "low",
  },
  humidification: {
    description: "Design humidification and dehumidification systems per ASHRAE A1 envelope. Calculates moisture load, equipment capacity, energy consumption, and seasonal control strategy.",
    params: ["room_sqft", "it_load_kw", "climate_zone"],
    credits: WORKFLOW_COSTS.humidification,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE TC 9.9-2021 Envelope A1"], stale_risk: "low",
  },
  economizer_analysis: {
    description: "Analyze economizer free-cooling potential for data center locations. Estimates annual free-cooling hours by climate, blended PUE improvement, energy savings, and simple payback.",
    params: ["location", "it_load_kw", "pue_mechanical", "economizer_type"],
    credits: WORKFLOW_COSTS.economizer_analysis,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE 90.1-2022 Section 6.5.1"], stale_risk: "medium",
  },
  construction_timeline: {
    description: "Estimate construction timeline for data center development projects. Provides phase-by-phase schedule (design, permits, civil, MEP, commissioning) with state-specific regulatory modifiers.",
    params: ["capacity_mw", "building_type", "state"],
    credits: WORKFLOW_COSTS.construction_timeline,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IBC 2021", "NFPA 1-2021"], stale_risk: "medium",
  },
  commissioning_plan: {
    description: "Generate commissioning plan per ASHRAE Guideline 1.2 for data center infrastructure. Calculates Level 1–4 test hours, witness testing requirements, and integrated systems testing scope.",
    params: ["capacity_mw", "tier"],
    credits: WORKFLOW_COSTS.commissioning_plan,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ASHRAE Guideline 1.2-2019", "Uptime Institute ATD"], stale_risk: "medium",
  },
  maintenance_schedule: {
    description: "Build annual preventive maintenance schedule for data center infrastructure. Calculates PM labor hours, intervals, and annual cost for generators, UPS, cooling, and electrical systems.",
    params: ["generator_count", "ups_count", "cooling_units", "tier"],
    credits: WORKFLOW_COSTS.maintenance_schedule,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NFPA 110-2022 Ch. 8", "IEEE 1188-2005"], stale_risk: "low",
  },
  capacity_planning: {
    description: "Project data center capacity runway and expansion trigger points. Uses logarithmic growth modeling to forecast years to 80% utilization, critical threshold, and end-of-design-life load.",
    params: ["current_load_kw", "current_capacity_kw", "growth_rate_pct_per_year"],
    credits: WORKFLOW_COSTS.capacity_planning,
    version: "1.0", last_validated: "2026-03-28", standards_refs: [], stale_risk: "low",
  },
  sla_calculator: {
    description: "Calculate SLA availability metrics against Uptime Institute tier benchmarks. Computes allowed downtime minutes/year, MTTR budget, and compliance status for target availability percentage.",
    params: ["tier", "target_availability_pct"],
    credits: WORKFLOW_COSTS.sla_calculator,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Uptime Institute Tier Standard 2022"], stale_risk: "low",
  },
  change_management: {
    description: "Design change management process for data center operations. Defines CAB frequency, change windows, rollback SLA, and staffing model based on tier classification and change volume.",
    params: ["tier", "change_volume_per_month", "staff_count"],
    credits: WORKFLOW_COSTS.change_management,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["ITIL 4", "Uptime Institute M&O Stamp"], stale_risk: "low",
  },
  carbon_footprint: {
    description: "Calculate data center carbon footprint per GHG Protocol Scope 2. Computes location-based and market-based emissions using eGRID factors, renewable energy certificates, and carbon intensity.",
    params: ["it_load_kw", "pue", "grid_region"],
    credits: WORKFLOW_COSTS.carbon_footprint,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["EPA eGRID 2022", "GHG Protocol Scope 2 2015"], stale_risk: "high",
  },
  solar_feasibility: {
    description: "Assess rooftop solar PV feasibility for data center facilities. Calculates system capacity, annual generation, energy offset percentage, IRA tax credit (30%), and simple payback.",
    params: ["facility_sqft", "it_load_kw", "state"],
    credits: WORKFLOW_COSTS.solar_feasibility,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["IRA 2022 Section 48E ITC", "IEC 61853-1"], stale_risk: "high",
  },
  battery_storage: {
    description: "Size battery energy storage systems for data center applications. Supports Li-ion, LFP, VRLA, and flow chemistries for UPS backup, peak shaving, demand response, and islanding use cases.",
    params: ["it_load_kw", "target_runtime_minutes", "chemistry"],
    credits: WORKFLOW_COSTS.battery_storage,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["UL 9540-2023", "NFPA 855-2023", "IEC 62619-2022"], stale_risk: "high",
  },
  energy_procurement: {
    description: "Analyze energy procurement strategies for large data center loads. Compares utility tariffs, PPAs, green tariffs, and direct access contracts with estimated annual cost and renewable content.",
    params: ["annual_consumption_mwh", "state", "contract_term_years"],
    credits: WORKFLOW_COSTS.energy_procurement,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["FERC Order 2023", "RE100 standard"], stale_risk: "high",
  },
  // Phase 3 — premium agents
  tier_certification_checker: {
    description: "Evaluate data center readiness for Uptime Institute Tier I–IV certification. Produces a gap analysis with remediation costs, readiness score, and priority steps. This is a readiness assessment, not official certification.",
    params: ["generator_config", "ups_topology", "cooling_redundancy", "power_paths", "fuel_runtime_hours", "transfer_switch_type", "has_concurrent_maintainability", "has_fault_tolerance", "target_tier"],
    credits: WORKFLOW_COSTS.tier_certification_checker,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["Uptime Institute Tier Standard 2022", "ANSI/TIA-942-B-2017"], stale_risk: "medium",
  },
  nc_utility_interconnect: {
    description: "Model the interconnect application process for Duke Energy Progress, Duke Energy Carolinas, or Dominion Energy NC. Returns utility-specific steps, timeline, fees, NCUC filing requirements, and data center considerations.",
    params: ["utility", "capacity_kw", "county", "interconnect_type", "voltage_level", "project_type"],
    credits: WORKFLOW_COSTS.nc_utility_interconnect,
    version: "1.0", last_validated: "2026-03-28", standards_refs: ["NCUC Docket E-2 Sub 1142", "IEEE 1547-2018", "FERC Order 2023"], stale_risk: "high",
  },
};

// ─── Chain Registry ───────────────────────────────────────────────────────────

const CHAINS: Record<string, {
  name: string;
  description: string;
  credits: number;
  steps: string[];
}> = {
  full_power_analysis: {
    name: "Full Power Analysis",
    description: "Generator sizing → NFPA 110 compliance → UPS sizing → ROI calculator. Complete power infrastructure analysis in one request.",
    credits: 8,
    steps: ["generator_sizing", "nfpa_110_checker", "ups_sizing", "roi_calculator"],
  },
  site_readiness: {
    name: "Site Readiness",
    description: "Site scoring → Tier certification → Utility interconnect → Compliance check. Full site evaluation pipeline.",
    credits: 8,
    steps: ["site_scoring", "tier_certification_checker", "utility_interconnect", "compliance_checker"],
  },
  tco_deep_dive: {
    name: "TCO Deep Dive",
    description: "PUE calculator → Cooling load → TCO analyzer. Full cost of ownership analysis.",
    credits: 6,
    steps: ["pue_calculator", "cooling_load", "tco_analyzer"],
  },
  nc_power_package: {
    name: "NC Power Package",
    description: "NC utility interconnect → Generator sizing → NFPA 110 → UPS sizing. North Carolina specific full power analysis.",
    credits: 8,
    steps: ["nc_utility_interconnect", "generator_sizing", "nfpa_110_checker", "ups_sizing"],
  },
  emergency_power_package: {
    name: "Emergency Power Package",
    description: "UPS sizing → ATS sizing → Generator sizing → Fuel storage → NFPA 110. Complete emergency power system design.",
    credits: 10,
    steps: ["ups_sizing", "ats_sizing", "generator_sizing", "fuel_storage", "nfpa_110_checker"],
  },
  cooling_optimization: {
    name: "Cooling Optimization",
    description: "Cooling load → Chiller sizing → CRAC vs CRAH → Airflow modeling → Economizer analysis. Full cooling system design.",
    credits: 10,
    steps: ["cooling_load", "chiller_sizing", "crac_vs_crah", "airflow_modeling", "economizer_analysis"],
  },
  full_site_analysis: {
    name: "Full Site Analysis",
    description: "Site scoring → Tier certification → Utility interconnect → Permit timeline → Construction cost → Construction timeline. Complete site feasibility study.",
    credits: 12,
    steps: ["site_scoring", "tier_certification_checker", "utility_interconnect", "permit_timeline", "construction_cost", "construction_timeline"],
  },
  sustainability_package: {
    name: "Sustainability Package",
    description: "Carbon footprint → Solar feasibility → Battery storage → Energy procurement → Environmental impact. Full green energy analysis.",
    credits: 10,
    steps: ["carbon_footprint", "solar_feasibility", "battery_storage", "energy_procurement", "environmental_impact"],
  },
};

// ─── Chain Execution ──────────────────────────────────────────────────────────

/** Map the output of a completed step into params for subsequent steps. */
function extractChainParams(stepId: string, r: Record<string, unknown>): Record<string, string> {
  const s = (v: unknown): string | undefined =>
    v !== undefined && v !== null && !Number.isNaN(v) ? String(v) : undefined;
  const out: Record<string, string> = {};

  if (stepId === "generator_sizing") {
    const kw = s(r.genset_kw);
    if (kw) { out.generator_kw = kw; out.load_kw = kw; }
    if (s(r.tank_size_gal)) out.fuel_capacity_gallons = s(r.tank_size_gal)!;
    if (s(r.runtime_hours)) out.runtime_hours = s(r.runtime_hours)!;
    const cost = r.cost_estimate as Record<string, unknown> | undefined;
    if (cost && s(cost.installed_usd)) out.capex = s(cost.installed_usd)!;
  }

  if (stepId === "pue_calculator") {
    const pueObj = r.pue as Record<string, unknown> | undefined;
    if (pueObj && s(pueObj.value)) out.pue = s(pueObj.value)!;
    const bk = r.power_breakdown_kw as Record<string, unknown> | undefined;
    if (bk && s(bk.cooling)) out.cooling_kw = s(bk.cooling)!;
  }

  if (stepId === "cooling_load") {
    if (s(r.total_cooling_kw)) out.cooling_kw = s(r.total_cooling_kw)!;
    const cr = r.cooling_requirements as Record<string, unknown> | undefined;
    const designTons = cr?.design_tons_with_margin ?? cr?.total_tons;
    if (s(designTons)) out.cooling_tons = s(designTons)!;
  }

  if (stepId === "nc_utility_interconnect") {
    const cap = r.capacity_kw ?? r.load_kw;
    if (s(cap)) { out.load_kw = s(cap)!; out.generator_kw = s(cap)!; }
  }

  if (stepId === "ups_sizing") {
    const sizing = r.ups_sizing as Record<string, unknown> | undefined;
    if (sizing && s(sizing.total_installed_kva)) out.ups_kva = s(sizing.total_installed_kva)!;
    if (sizing && s(sizing.selected_module_kva)) out.ups_capacity_kw = s(sizing.selected_module_kva)!;
  }

  if (stepId === "ats_sizing") {
    if (s(r.ats_rating_amps)) out.ats_rating_amps = s(r.ats_rating_amps)!;
  }

  if (stepId === "fuel_storage") {
    if (s(r.tank_size_gal))      out.fuel_capacity_gallons = s(r.tank_size_gal)!;
    if (s(r.runtime_hours))      out.runtime_hours         = s(r.runtime_hours)!;
    if (s(r.generator_kw))       out.generator_kw          = s(r.generator_kw)!;
  }

  if (stepId === "chiller_sizing") {
    const sel = r.selected_chiller as Record<string, unknown> | undefined;
    if (sel && s(sel.total_tons)) out.cooling_tons = s(sel.total_tons)!;
    if (s(r.total_tons))          out.cooling_tons = s(r.total_tons)!;
  }

  if (stepId === "crac_vs_crah") {
    const rec = r.recommendation as Record<string, unknown> | undefined;
    if (rec && s(rec.type))       out.cooling_type = s(rec.type)!;
    if (s(r.recommended_type))    out.cooling_type = s(r.recommended_type)!;
  }

  if (stepId === "carbon_footprint") {
    if (s(r.annual_co2_tonnes))   out.co2_baseline   = s(r.annual_co2_tonnes)!;
    if (s(r.annual_co2_tons))     out.co2_baseline   = s(r.annual_co2_tons)!;
    const ae = r.annual_energy as Record<string, unknown> | undefined;
    if (ae && s(ae.total_kwh))    out.annual_kwh     = s(ae.total_kwh)!;
  }

  if (stepId === "solar_feasibility") {
    if (s(r.system_size_kw))      out.solar_kw       = s(r.system_size_kw)!;
    if (s(r.annual_kwh))          out.annual_kwh     = s(r.annual_kwh)!;
  }

  return out;
}

/** Fill in params that aren't derivable from prior steps with sensible defaults. */
function applyChainDefaults(params: Record<string, string>): Record<string, string> {
  const load_kw = parseFloat(params.load_kw ?? "1000");
  const p = { ...params };
  if (!p.runtime_minutes)        p.runtime_minutes        = "15";
  if (!p.runtime_hours)          p.runtime_hours          = "96";
  if (!p.fuel_capacity_gallons)  p.fuel_capacity_gallons  = String(Math.round(load_kw * 5));
  if (!p.ats_transfer_time_seconds) p.ats_transfer_time_seconds = "10";
  if (!p.level)                  p.level                  = "1";
  if (!p.ups_capacity_kw)        p.ups_capacity_kw        = String(Math.round(load_kw * 0.15));
  if (!p.room_sqft)              p.room_sqft              = String(Math.round(load_kw * 10));
  if (!p.power_rate_kwh)         p.power_rate_kwh         = "0.07";
  if (!p.years)                  p.years                  = "10";
  if (!p.annual_opex)            p.annual_opex            = String(Math.round(load_kw * 500));
  if (!p.revenue_per_year)       p.revenue_per_year       = String(Math.round(load_kw * 1200));
  if (!p.project_lifetime_years) p.project_lifetime_years = "15";
  if (!p.capex)                  p.capex                  = String(Math.round(load_kw * 605));
  if (!p.frameworks)             p.frameworks             = "nist_csf,soc2";
  if (!p.facility_type)          p.facility_type          = "enterprise";
  if (!p.current_tier)           p.current_tier           = p.tier ?? "2N";
  if (!p.utility)                p.utility                = "duke_energy";
  if (!p.load_mw)                p.load_mw                = String(Math.max(1, load_kw / 1000));
  if (!p.generator_config)       p.generator_config       = "2N";
  if (!p.ups_topology)           p.ups_topology           = "2N";
  if (!p.cooling_redundancy)     p.cooling_redundancy     = "N+1";
  if (!p.power_paths)            p.power_paths            = "2";
  if (!p.fuel_runtime_hours)     p.fuel_runtime_hours     = p.runtime_hours ?? "96";
  if (!p.transfer_switch_type)   p.transfer_switch_type   = "ATS";
  if (!p.has_concurrent_maintainability) p.has_concurrent_maintainability = "true";
  if (!p.has_fault_tolerance)    p.has_fault_tolerance    = "true";
  if (!p.target_tier) {
    const tierNumMap: Record<string, string> = { "1": "Tier I", "2": "Tier II", "3": "Tier III", "4": "Tier IV" };
    p.target_tier = tierNumMap[p.tier ?? "3"] ?? "Tier III";
  }
  if (!p.sites_json)             p.sites_json             = JSON.stringify([{
    name: "Site A — " + (p.state ?? "NC"),
    state: p.state ?? "NC",
    power_available_mw: load_kw / 1000 * 2,
    water_availability: "adequate",
    water_access: "municipal",
    land_acres: 50,
    fiber_providers: 3,
    fiber_quality: 3,
    distance_to_major_market_miles: 20,
    incentives_pct: 5,
    labor_cost_index: 95,
    power_rate_kwh: parseFloat(p.power_rate_kwh ?? "0.07"),
    risk_score: 2,
  }]);
  if (!p.construction_tier)      p.construction_tier      = "tier3";
  // construction_cost uses tier1-tier4 format; map from 2N/N+1 if needed
  if (!p.tier_label) {
    const tm: Record<string, string> = { "N": "tier1", "N+1": "tier2", "2N": "tier3", "2N+1": "tier4" };
    p.tier_label = tm[p.tier ?? "2N"] ?? "tier3";
  }
  if (!p.target_runtime_hours)   p.target_runtime_hours   = p.runtime_hours ?? "96";
  if (!p.ats_rating_amps)        p.ats_rating_amps        = String(Math.round(load_kw * 2));
  if (!p.voltage)                p.voltage                = "480";
  if (!p.phases)                 p.phases                 = "3";
  if (!p.cooling_tons)           p.cooling_tons           = String(Math.round(load_kw * 0.3));
  if (!p.cooling_type)           p.cooling_type           = "air_cooled";
  if (!p.water_available)        p.water_available        = "yes";
  if (!p.redundancy)             p.redundancy             = "N+1";
  if (!p.containment_type)       p.containment_type       = "hot_aisle";
  if (!p.rack_count)             p.rack_count             = String(Math.round(load_kw / 10));
  if (!p.avg_kw_per_rack)        p.avg_kw_per_rack        = "10";
  if (!p.economizer_type)        p.economizer_type        = "air_side";
  if (!p.pue)                    p.pue                    = "1.4";
  if (!p.pue_mechanical)         p.pue_mechanical         = "1.4";
  if (!p.location)               p.location               = p.state ?? "NC";
  if (!p.roof_sqft)              p.roof_sqft              = p.room_sqft ?? String(Math.round(load_kw * 8));
  if (!p.facility_sqft)          p.facility_sqft          = p.room_sqft ?? String(Math.round(load_kw * 10));
  if (!p.annual_kwh)             p.annual_kwh             = String(Math.round(load_kw * 8760));
  if (!p.utility_rate)           p.utility_rate           = p.power_rate_kwh ?? "0.07";
  if (!p.battery_hours)          p.battery_hours          = "4";
  if (!p.chemistry)              p.chemistry              = "lithium_ion";
  if (!p.target_runtime_minutes) p.target_runtime_minutes = p.runtime_minutes ?? "15";
  if (!p.solar_fraction)         p.solar_fraction         = "0.3";
  if (!p.contract_term_years)    p.contract_term_years    = "10";
  if (!p.renewable_target_pct)   p.renewable_target_pct   = "30";
  if (!p.grid_region) {
    const stateToGrid: Record<string, string> = {
      NC: "SERC", SC: "SERC", GA: "SERC", FL: "SERC", TN: "SERC", AL: "SERC", MS: "SERC",
      VA: "RFC",  MD: "RFC",  PA: "RFC",  OH: "RFC",  IN: "RFC",  MI: "RFC",  NJ: "RFC",
      NY: "NPCC", CT: "NPCC", MA: "NPCC", VT: "NPCC", NH: "NPCC", ME: "NPCC", RI: "NPCC",
      TX: "TRE",
      CA: "WECC", OR: "WECC", WA: "WECC", NV: "WECC", AZ: "WECC", CO: "WECC", UT: "WECC",
      MN: "MRO",  IA: "MRO",  ND: "MRO",  SD: "MRO",  NE: "MRO",  WI: "MRO",  KS: "MRO",
      IL: "RFC",
    };
    p.grid_region = stateToGrid[p.state?.toUpperCase() ?? ""] ?? "SERC";
  }
  if (!p.generator_kw)           p.generator_kw           = p.load_kw ?? "1000";
  if (!p.generator_count)        p.generator_count        = "2";
  if (!p.site_acres)             p.site_acres             = "50";
  if (!p.jurisdiction) {
    const st = (p.state ?? "").toUpperCase();
    p.jurisdiction = st === "CA" ? "california" : "nfpa30";
  }
  if (!p.project_sqft)           p.project_sqft           = p.facility_sqft ?? String(Math.round(load_kw * 10));
  if (!p.building_type)          p.building_type          = "new_build";
  if (!p.target_markets)         p.target_markets         = "Charlotte,Raleigh";
  if (!p.annual_consumption_mwh) p.annual_consumption_mwh = String(Math.round(load_kw * 8.76));
  return p;
}

async function runChain(
  chainId: string,
  initialParams: Record<string, string>,
  _userId: string,
  _tier: string
): Promise<CanonicalResponse> {
  const chain = CHAINS[chainId];
  const stepResults: Array<{ step: string; result: unknown; error?: string }> = [];
  let runningParams = applyChainDefaults({ ...initialParams });

  for (const stepId of chain.steps) {
    try {
      const result = await dispatchWorkflow(stepId, runningParams);
      stepResults.push({ step: stepId, result });
      // Extract step-specific output→input mappings for next step
      const r = result.result as Record<string, unknown>;
      const derived = extractChainParams(stepId, r);
      runningParams = applyChainDefaults({ ...runningParams, ...derived });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stepResults.push({ step: stepId, result: null, error: msg });
      // Continue remaining steps even if this one failed
    }
  }

  const stepsCompleted = stepResults.filter((s) => !s.error).length;
  const summary = stepResults
    .map((s) => (s.error ? `${s.step}: FAILED — ${s.error}` : `${s.step}: OK`))
    .join("\n");

  const payload = { chain: chainId, steps_completed: stepsCompleted, results: stepResults, summary };
  return toCanonical(`chain:${chainId}`, payload, {
    version: "1.0",
    credits: chain.credits,
    taskId:  crypto.randomUUID(),
  });
}

async function dispatchWorkflow(
  name: string,
  args: Record<string, string>
): Promise<CanonicalResponse> {
  const result = await (async (): Promise<WorkflowResult> => {
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
      // args.tier uses "2N"/"N+1" format; construction_cost expects "tier1"–"tier4"
      const ccTierMap: Record<string, "tier1" | "tier2" | "tier3" | "tier4"> =
        { "N": "tier1", "N+1": "tier2", "2N": "tier3", "2N+1": "tier4" };
      const ccTier = (args.tier_label as "tier1" | "tier2" | "tier3" | "tier4") ??
                     ccTierMap[args.tier ?? ""] ?? "tier3";
      const ccResult = await runConstructionCost({
        capacity_mw:              parseFloat(args.capacity_mw),
        tier:                     ccTier,
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
        utility:          args.utility,
        capacity_kw:      parseFloat(args.capacity_kw),
        county:           args.county,
        interconnect_type: args.interconnect_type,
        voltage_level:    args.voltage_level,
        project_type:     args.project_type,
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

    case "tier_certification_checker": {
      const tcResult = await runTierCertification({
        generator_config:               args.generator_config,
        ups_topology:                   args.ups_topology,
        cooling_redundancy:             args.cooling_redundancy,
        power_paths:                    parseInt(args.power_paths),
        fuel_runtime_hours:             parseFloat(args.fuel_runtime_hours),
        transfer_switch_type:           args.transfer_switch_type,
        has_concurrent_maintainability: args.has_concurrent_maintainability === "true",
        has_fault_tolerance:            args.has_fault_tolerance === "true",
        target_tier:                    args.target_tier as "Tier I" | "Tier II" | "Tier III" | "Tier IV",
      });
      log("info", `tier_certification_checker complete — ${tcResult.target} in ${tcResult.results.duration_ms}ms`);
      return tcResult as unknown as WorkflowResult;
    }

    default:
      throw new McpError(ErrorCode.InvalidParams,
        `Unknown workflow: "${name}". Call get_capabilities to list available workflows.`);
  }
  })();

  const wf = WORKFLOWS[name];
  const taskId = crypto.randomUUID();
  const rawResults = (result as unknown as { results: unknown }).results;
  return toCanonical(name, rawResults, {
    version: wf?.version ?? "1.0",
    credits: wf?.credits ?? 0,
    taskId,
  });
}

// ─── Tier access control ──────────────────────────────────────────────────────
// Maximum agent credit cost each tier may invoke.
// free     (100 credits/month) → simple + compliance only (≤ 20 credits/call)
// starter  (500 credits/month) → + complex              (≤ 50 credits/call)
// pro/enterprise               → all agents             (≤ 100 credits/call)

const TIER_MAX_AGENT_COST: Record<string, number> = {
  free:       20,
  starter:    50,
  pro:        100,
  enterprise: 100,
};

function checkTierAccess(tier: string, agentCost: number): { allowed: boolean; message: string } {
  const maxCost = TIER_MAX_AGENT_COST[tier] ?? 20; // unknown tiers treated as free
  if (agentCost <= maxCost) return { allowed: true, message: "" };

  const upgrade =
    tier === "free"
      ? "Upgrade to Starter ($29/mo) for complex agents, or Pro ($99/mo) for all premium agents."
      : tier === "starter"
      ? "Upgrade to Pro ($99/mo) to access premium agents."
      : "Contact support to enable this agent.";

  return {
    allowed: false,
    message:
      `This agent costs ${agentCost} credits/call, which exceeds the ${tier} tier limit of ${maxCost} credits/call. ${upgrade}`,
  };
}

// ─── Chat: workflow detection from natural language ───────────────────────────

function detectWorkflowFromText(
  text: string
): { chainId?: string; workflowName: string | null; params: Record<string, string> } {
  const t = text.toLowerCase();

  // Extract numeric values (done first so chains can carry them forward)
  const kwVal  = text.match(/(\d+(?:\.\d+)?)\s*(?:kw|kilowatt)/i)?.[1];
  const mwVal  = text.match(/(\d+(?:\.\d+)?)\s*(?:mw|megawatt)/i)?.[1];
  const load_kw =
    kwVal ?? (mwVal ? String(parseFloat(mwVal) * 1000) : "1000");
  const load_mw =
    mwVal ?? (kwVal ? String(parseFloat(kwVal) / 1000) : "10");
  const tierDigit = parseInt(text.match(/tier\s*([1-4])/i)?.[1] ?? "3", 10);
  const TIER_MAP: Record<number, string> = { 1: "N", 2: "N+1", 3: "2N", 4: "2N+1" };
  const tierNum = TIER_MAP[tierDigit] ?? "2N";

  // ── Chain detection (after numeric extraction so params propagate) ───────────
  if (/full.{0,10}power.{0,15}anal|complete.{0,10}power/i.test(t)) {
    return { chainId: "full_power_analysis", workflowName: null, params: { load_kw, tier: tierNum } };
  }
  if (/site.{0,10}readiness|site.{0,10}evaluat/i.test(t)) {
    return { chainId: "site_readiness", workflowName: null, params: { load_kw, load_mw, tier: tierNum } };
  }
  if (/\btco\b.{0,40}cool|cool.{0,40}\btco\b|deep.{0,10}dive/i.test(t)) {
    return { chainId: "tco_deep_dive", workflowName: null, params: { it_load_kw: load_kw } };
  }
  if (/north.{0,10}carolina.{0,20}power|\bnc\b.{0,10}power.{0,20}pack/i.test(t)) {
    return { chainId: "nc_power_package", workflowName: null, params: { load_kw, load_mw, tier: tierNum } };
  }
  if (/emergency.{0,10}power|emergency.{0,20}package/i.test(t)) {
    return { chainId: "emergency_power_package", workflowName: null, params: { load_kw, tier: tierNum } };
  }
  if (/cooling.{0,10}optim|cooling.{0,20}system.{0,20}design/i.test(t)) {
    return { chainId: "cooling_optimization", workflowName: null, params: { it_load_kw: load_kw } };
  }
  if (/full.{0,10}site.{0,10}anal|site.{0,10}feasibility|site.{0,10}analysis/i.test(t)) {
    return { chainId: "full_site_analysis", workflowName: null, params: { load_kw, load_mw, tier: tierNum } };
  }
  if (/sustainability|green.{0,10}energy|carbon.{0,10}solar/i.test(t)) {
    return { chainId: "sustainability_package", workflowName: null, params: { it_load_kw: load_kw } };
  }

  // ── Security workflows ──────────────────────────────────────────────────────
  if (/subdomain/i.test(t)) {
    const domain = text.match(/(?:for\s+)?([\w-]+\.[\w.-]+\.\w{2,})/i)?.[1] ?? "example.com";
    return { workflowName: "subdomain_discovery", params: { domain } };
  }
  if (/asset.{0,20}discov/i.test(t)) {
    const domain = text.match(/(?:for\s+)?([\w-]+\.[\w.-]+\.\w{2,})/i)?.[1] ?? "example.com";
    return { workflowName: "asset_discovery", params: { domain } };
  }
  if (/vulnerab/i.test(t)) {
    const target = text.match(/(?:for\s+)?([\w-]+\.[\w.-]+\.\w{2,})/i)?.[1] ?? "example.com";
    return { workflowName: "vulnerability_assessment", params: { target } };
  }

  // ── Power infrastructure ────────────────────────────────────────────────────
  if (/generator|genset|epss|emergency power supply/i.test(t)) {
    return { workflowName: "generator_sizing", params: { load_kw, tier: tierNum } };
  }
  if (/nfpa.?110/i.test(t)) {
    const gallons = text.match(/(\d+)\s*gallon/i)?.[1] ?? "2000";
    const runtime = text.match(/(\d+)\s*hour/i)?.[1] ?? "96";
    const ats_sec = text.match(/(\d+)\s*second/i)?.[1] ?? "10";
    return {
      workflowName: "nfpa_110_checker",
      params: {
        generator_kw: load_kw,
        fuel_capacity_gallons: gallons,
        runtime_hours: runtime,
        ats_transfer_time_seconds: ats_sec,
        level: "1",
      },
    };
  }
  if (/nc.{0,20}utility|north carolina.{0,20}utility|duke.{0,10}carolina|duke.{0,10}progress|dominion.*nc/i.test(t)) {
    const utility = text.match(/duke energy (progress|carolinas)|dominion/i)?.[0] ?? "Duke Energy Progress";
    return { workflowName: "nc_utility_interconnect", params: { utility, load_mw } };
  }
  if (/utility.{0,20}interconnect|grid.{0,10}connect/i.test(t)) {
    const utility = text.match(/dominion|duke|pge|pg&e|con.?ed|pepco|entergy|xcel|aps/i)?.[0] ?? "Duke Energy";
    return { workflowName: "utility_interconnect", params: { utility, load_mw } };
  }
  if (/\bpue\b|power usage effectiveness/i.test(t)) {
    return { workflowName: "pue_calculator", params: { it_load_kw: load_kw } };
  }
  if (/\bups\b|uninterruptible/i.test(t)) {
    const runtime_minutes = text.match(/(\d+)\s*min/i)?.[1] ?? "15";
    return { workflowName: "ups_sizing", params: { load_kw, runtime_minutes } };
  }
  if (/\bats\b|transfer switch/i.test(t)) {
    const voltage = text.match(/(\d{3,4})\s*v/i)?.[1] ?? "480";
    const phases  = text.match(/(\d)\s*phase/i)?.[1] ?? "3";
    return { workflowName: "ats_sizing", params: { load_kw, voltage, phases } };
  }
  if (/fuel.{0,20}tank|diesel.{0,20}tank|fuel storage/i.test(t)) {
    const target_runtime_hours = text.match(/(\d+)\s*hour/i)?.[1] ?? "96";
    return { workflowName: "fuel_storage", params: { generator_kw: load_kw, target_runtime_hours } };
  }
  if (/cooling.{0,20}load|heat.{0,20}load/i.test(t)) {
    return { workflowName: "cooling_load", params: { it_load_kw: load_kw } };
  }
  if (/power.{0,20}density/i.test(t)) {
    return { workflowName: "power_density", params: { it_load_kw: load_kw } };
  }
  if (/redundan/i.test(t)) {
    return { workflowName: "redundancy_validator", params: { it_load_kw: load_kw } };
  }
  if (/harmonic/i.test(t)) {
    return { workflowName: "harmonic_analysis", params: { it_load_kw: load_kw } };
  }
  if (/voltage.{0,20}drop/i.test(t)) {
    return { workflowName: "voltage_drop", params: { it_load_kw: load_kw } };
  }
  if (/short.{0,10}circuit/i.test(t)) {
    return { workflowName: "short_circuit", params: { it_load_kw: load_kw } };
  }
  if (/grounding/i.test(t)) {
    return { workflowName: "grounding_design", params: { it_load_kw: load_kw } };
  }

  // ── Network ─────────────────────────────────────────────────────────────────
  if (/network.{0,20}topolog/i.test(t)) {
    return { workflowName: "network_topology", params: { it_load_kw: load_kw } };
  }
  if (/bandwidth/i.test(t)) {
    return { workflowName: "bandwidth_sizing", params: { it_load_kw: load_kw } };
  }
  if (/latency/i.test(t)) {
    return { workflowName: "latency_calculator", params: { it_load_kw: load_kw } };
  }
  if (/ip.{0,15}address|subnetting|cidr/i.test(t)) {
    return { workflowName: "ip_addressing", params: { it_load_kw: load_kw } };
  }
  if (/\bdns\b/i.test(t)) {
    return { workflowName: "dns_architecture", params: { it_load_kw: load_kw } };
  }
  if (/\bbgp\b|border gateway/i.test(t)) {
    return { workflowName: "bgp_peering", params: { it_load_kw: load_kw } };
  }
  if (/fiber.{0,20}connect|dark fiber/i.test(t)) {
    return { workflowName: "fiber_connectivity", params: { it_load_kw: load_kw } };
  }

  // ── Physical security ───────────────────────────────────────────────────────
  if (/physical.{0,20}security|access control|badge/i.test(t)) {
    return { workflowName: "physical_security", params: { it_load_kw: load_kw } };
  }
  if (/biometric/i.test(t)) {
    return { workflowName: "biometric_design", params: { it_load_kw: load_kw } };
  }
  if (/cctv|camera|surveillance/i.test(t)) {
    return { workflowName: "surveillance_coverage", params: { it_load_kw: load_kw } };
  }
  if (/cybersecurity|infosec/i.test(t)) {
    return { workflowName: "cybersecurity_controls", params: { it_load_kw: load_kw } };
  }
  if (/compliance.{0,20}check/i.test(t)) {
    return { workflowName: "compliance_checker", params: { it_load_kw: load_kw } };
  }
  if (/fire.{0,20}suppress/i.test(t)) {
    return { workflowName: "fire_suppression", params: { it_load_kw: load_kw } };
  }

  // ── Mechanical / HVAC ───────────────────────────────────────────────────────
  if (/chiller/i.test(t)) {
    return { workflowName: "chiller_sizing", params: { it_load_kw: load_kw } };
  }
  if (/\bcrac\b|\bcrah\b|precision.{0,20}cool/i.test(t)) {
    return { workflowName: "crac_vs_crah", params: { it_load_kw: load_kw } };
  }
  if (/airflow|hot.{0,10}aisle|cold.{0,10}aisle/i.test(t)) {
    return { workflowName: "airflow_modeling", params: { it_load_kw: load_kw } };
  }
  if (/humid/i.test(t)) {
    return { workflowName: "humidification", params: { it_load_kw: load_kw } };
  }
  if (/economizer/i.test(t)) {
    return { workflowName: "economizer_analysis", params: { it_load_kw: load_kw } };
  }

  // ── Site, finance & project ─────────────────────────────────────────────────
  if (/construction.{0,20}cost|build.{0,20}cost/i.test(t)) {
    return { workflowName: "construction_cost", params: { capacity_mw: load_mw } };
  }
  if (/construction.{0,20}timeline|build.{0,20}schedule/i.test(t)) {
    return { workflowName: "construction_timeline", params: { capacity_mw: load_mw } };
  }
  if (/\broi\b|return.{0,10}invest/i.test(t)) {
    return { workflowName: "roi_calculator", params: { it_load_kw: load_kw } };
  }
  if (/\btco\b|total.{0,10}cost.{0,10}owner/i.test(t)) {
    return { workflowName: "tco_analyzer", params: { it_load_kw: load_kw } };
  }
  if (/site.{0,20}scor|site.{0,20}rank|site.{0,20}eval/i.test(t)) {
    return { workflowName: "site_scoring", params: { it_load_kw: load_kw } };
  }
  if (/water.{0,20}avail/i.test(t)) {
    return { workflowName: "water_availability", params: { it_load_kw: load_kw } };
  }
  if (/noise|acoustic|\bdb\b|decibel/i.test(t)) {
    return { workflowName: "noise_compliance", params: { it_load_kw: load_kw } };
  }
  if (/incentive|rebate|tax.{0,10}credit/i.test(t)) {
    return { workflowName: "incentive_finder", params: { it_load_kw: load_kw } };
  }
  if (/permit|entitlement/i.test(t)) {
    return { workflowName: "permit_timeline", params: { it_load_kw: load_kw } };
  }
  if (/commission/i.test(t)) {
    return { workflowName: "commissioning_plan", params: { it_load_kw: load_kw } };
  }
  if (/maintenance.{0,20}schedule|preventive.{0,10}maint/i.test(t)) {
    return { workflowName: "maintenance_schedule", params: { it_load_kw: load_kw } };
  }
  if (/capacity.{0,20}plan/i.test(t)) {
    return { workflowName: "capacity_planning", params: { it_load_kw: load_kw } };
  }
  if (/\bsla\b|service.{0,10}level/i.test(t)) {
    return { workflowName: "sla_calculator", params: { it_load_kw: load_kw } };
  }
  if (/change.{0,20}manage/i.test(t)) {
    return { workflowName: "change_management", params: { it_load_kw: load_kw } };
  }

  // ── Energy & sustainability ─────────────────────────────────────────────────
  if (/carbon.{0,20}foot|emission|co2/i.test(t)) {
    return { workflowName: "carbon_footprint", params: { it_load_kw: load_kw } };
  }
  if (/solar|photovoltaic|\bpv\b/i.test(t)) {
    return { workflowName: "solar_feasibility", params: { it_load_kw: load_kw } };
  }
  if (/battery.{0,20}storage|\bbess\b/i.test(t)) {
    return { workflowName: "battery_storage", params: { it_load_kw: load_kw } };
  }
  if (/energy.{0,20}procure|power.{0,10}purchase|\bppa\b/i.test(t)) {
    return { workflowName: "energy_procurement", params: { it_load_kw: load_kw } };
  }
  if (/demand.{0,20}response/i.test(t)) {
    return { workflowName: "demand_response", params: { it_load_kw: load_kw } };
  }
  if (/environ.{0,20}impact/i.test(t)) {
    return { workflowName: "environmental_impact", params: { it_load_kw: load_kw } };
  }

  // ── Compliance ──────────────────────────────────────────────────────────────
  if (/tier.{0,20}cert|uptime.{0,10}inst/i.test(t)) {
    return { workflowName: "tier_certification_checker", params: { it_load_kw: load_kw, tier: tierNum } };
  }

  return { workflowName: null, params: {} };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

function createServer(): Server {
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

    let result: CanonicalResponse;
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
      (result.result as Record<string, unknown>).credits_used      = wf.credits;
      (result.result as Record<string, unknown>).credits_remaining = remaining;
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

  return server;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  log("info", "Starting orchestrator MCP server...");

  await initAuth();

  // ── Billing guard ──────────────────────────────────────────────────────────
  // Without BILLING_API_URL all credit checks are skipped — every caller gets
  // unlimited free access. Fail fast in production-like environments.
  if (!process.env.BILLING_API_URL) {
    const NODE_ENV = process.env.NODE_ENV ?? "development";
    if (NODE_ENV === "production") {
      log("error", "FATAL: BILLING_API_URL is not set in production — refusing to start. " +
        "Set BILLING_API_URL to the billing-api service URL (e.g. https://security-orchestra-billing.onrender.com).");
      process.exit(1);
    } else {
      log("warn", "⚠  BILLING_API_URL is not set — all requests will run WITHOUT credit checks or deduction. " +
        "Set NODE_ENV=production to enforce billing.");
    }
  }

  const PORT = parseInt(process.env.PORT || '3000');
  const HOST = '0.0.0.0';

  if (PORT) {
    // ── Production: HTTP + SSE transport (Railway / remote) ─────────────────
    const app = express();

    // ─── Security headers ──────────────────────────────────────────────────
    app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://security-orchestra-orchestrator.onrender.com; frame-ancestors 'none'"
      );
      next();
    });

    // ─── Static assets ─────────────────────────────────────────────────────
    app.use(express.static(path.join(__dirname, "..", "public")));

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

    app.get("/agents", (_req, res) => {
      const CREDITS_PER_DOLLAR = 10; // 10 credits = $1.00
      const tierLabel = (credits: number) => {
        if (credits <= 5)  return "simple";
        if (credits <= 20) return "compliance";
        if (credits <= 50) return "complex";
        return "premium";
      };
      const agents = Object.entries(WORKFLOWS).map(([id, wf]) => ({
        id,
        name: id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        description: wf.description,
        tier: tierLabel(wf.credits),
        credits_per_call: wf.credits,
        price_per_call_usd: `$${(wf.credits / CREDITS_PER_DOLLAR).toFixed(2)}`,
      }));
      res.json({ count: agents.length, agents });
    });

    // Admin: provision an API key for a user (called by billing-api after payment/verification)
    // Protected by ORCHESTRATOR_ADMIN_KEY — no rate limiting applied here.
    app.post("/admin/provision-key", express.json(), async (req, res) => {
      log("info", `[provision-key] Received request from ${req.ip} — content-type: ${req.headers["content-type"]}`);

      const adminKey = process.env.ORCHESTRATOR_ADMIN_KEY;
      if (!adminKey) {
        log("error", "[provision-key] ORCHESTRATOR_ADMIN_KEY not set");
        res.status(503).json({ error: "Admin key provisioning not configured" });
        return;
      }
      const suppliedKey = req.headers["x-admin-key"];
      const supplied = Buffer.from(typeof suppliedKey === "string" ? suppliedKey : "");
      const expected = Buffer.from(adminKey);
      const valid = supplied.length === expected.length &&
        crypto.timingSafeEqual(supplied, expected);
      if (!valid) {
        log("warn", "[provision-key] Unauthorized — x-admin-key mismatch");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { userId, tier } = req.body as { userId?: string; tier?: string };
      if (!userId || !tier) {
        log("warn", `[provision-key] Missing params — userId: ${userId}, tier: ${tier}`);
        res.status(400).json({ error: "userId and tier are required" });
        return;
      }
      try {
        const apiKey = generateApiKey(userId, tier);
        await storeApiKey(apiKey, userId, tier);
        log("info", `[provision-key] Success — user: ${userId}, tier: ${tier}, prefix: ${apiKey.slice(0, 16)}`);
        res.json({ apiKey });
      } catch (err) {
        log("error", `[provision-key] Error: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to provision key" });
      }
    });

    // Admin: private dashboard data — aggregates today's audit logs
    app.get("/admin/dashboard-data", async (req, res) => {
      const adminKey = process.env.ORCHESTRATOR_ADMIN_KEY;
      const supplied = req.headers["x-admin-key"];
      if (!adminKey || typeof supplied !== "string") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const suppliedBuf = Buffer.from(supplied);
      const expectedBuf = Buffer.from(adminKey);
      const valid =
        suppliedBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(suppliedBuf, expectedBuf);
      if (!valid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const todayStart = today + "T00:00:00.000Z";
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const wfActions = [
        "workflow_complete", "run_workflow_complete", "agui_workflow_complete",
        "a2a_workflow_complete", "a2a_stream_complete", "openai_run_complete", "chat_workflow_complete",
      ];
      const chainActions = ["chain_complete", "agui_chain_complete"];
      const allComplete = [...wfActions, ...chainActions];

      try {
        const ph = (arr: unknown[]) => arr.map(() => "?").join(",");

        const [callsRow] = await auditDbAll(
          `SELECT COUNT(*) as cnt FROM audit_logs WHERE timestamp >= ? AND action IN (${ph(wfActions)})`,
          [todayStart, ...wfActions]
        );
        const today_calls = (callsRow as unknown as Record<string, number>)?.cnt ?? 0;

        const [chainsRow] = await auditDbAll(
          `SELECT COUNT(*) as cnt FROM audit_logs WHERE timestamp >= ? AND action IN (${ph(chainActions)})`,
          [todayStart, ...chainActions]
        );
        const today_chains = (chainsRow as unknown as Record<string, number>)?.cnt ?? 0;

        const [usersRow] = await auditDbAll(
          `SELECT COUNT(DISTINCT user_id) as cnt FROM audit_logs WHERE timestamp >= ?`,
          [todayStart]
        );
        const unique_users = (usersRow as unknown as Record<string, number>)?.cnt ?? 0;

        const [creditsRow] = await auditDbAll(
          `SELECT SUM(CAST(json_extract(details, '$.deducted') AS INTEGER)) as total
           FROM audit_logs WHERE timestamp >= ? AND action = 'credit_deduct'`,
          [todayStart]
        );
        const credits_consumed = (creditsRow as unknown as Record<string, number>)?.total ?? 0;

        const topAgentsRows = await auditDbAll(
          `SELECT resource, COUNT(*) as calls FROM audit_logs
           WHERE timestamp >= ? AND action IN (${ph(allComplete)}) AND resource IS NOT NULL
           GROUP BY resource ORDER BY calls DESC LIMIT 10`,
          [todayStart, ...allComplete]
        );
        const top_agents = topAgentsRows.map(r => ({
          agent: r.resource,
          calls: (r as unknown as Record<string, number>).calls,
        }));

        const protocolDefs: [string, string[]][] = [
          ["MCP",    ["workflow_complete"]],
          ["HTTP",   ["run_workflow_complete"]],
          ["AG-UI",  ["agui_workflow_complete", "agui_chain_complete"]],
          ["ACP",    ["acp_run_complete"]],
          ["A2A",    ["a2a_workflow_complete", "a2a_stream_complete"]],
          ["OpenAI", ["openai_run_complete"]],
          ["Chat",   ["chat_workflow_complete"]],
          ["Chain",  ["chain_complete"]],
        ];
        const protocol_breakdown: Record<string, number> = {};
        for (const [proto, actions] of protocolDefs) {
          const [row] = await auditDbAll(
            `SELECT COUNT(*) as cnt FROM audit_logs WHERE timestamp >= ? AND action IN (${ph(actions)})`,
            [todayStart, ...actions]
          );
          protocol_breakdown[proto] = (row as unknown as Record<string, number>)?.cnt ?? 0;
        }

        const recent_activity = await auditDbAll(
          `SELECT id, timestamp, user_id, action, resource, result, duration_ms
           FROM audit_logs ORDER BY id DESC LIMIT 20`,
          []
        );

        const creditHealthRows = await auditDbAll(
          `SELECT DATE(timestamp) as day,
                  SUM(CAST(json_extract(details, '$.deducted') AS INTEGER)) as credits
           FROM audit_logs WHERE timestamp >= ? AND action = 'credit_deduct'
           GROUP BY DATE(timestamp) ORDER BY day ASC`,
          [sevenDaysAgo]
        );
        const credit_health = creditHealthRows.map(r => ({
          day: (r as unknown as Record<string, string>).day,
          credits: (r as unknown as Record<string, number>).credits ?? 0,
        }));

        res.json({
          today_calls,
          today_chains,
          unique_users,
          credits_consumed,
          top_agents,
          protocol_breakdown,
          recent_activity,
          credit_health,
          generated_at: new Date().toISOString(),
        });
      } catch (err) {
        log("error", `[dashboard-data] ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to load dashboard data" });
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
      const srv = createServer();
      await srv.connect(transport);
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

    // ── Streamable HTTP transport (MCP 2025-03, used by Smithery and modern clients)
    // Stateless: each POST is independent — initialize and tools/list need no auth.
    // tools/call auth is enforced inside CallToolRequestSchema via requireAuth().
    app.post("/mcp", express.json(), async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const srv = createServer();
      res.on("close", () => { transport.close().catch(() => {}); });
      await srv.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const srv = createServer();
      res.on("close", () => { transport.close().catch(() => {}); });
      await srv.connect(transport);
      await transport.handleRequest(req, res);
    });

    // ── REST: direct workflow execution ──────────────────────────────────────
    // POST /run — simple REST alternative to MCP/A2A
    // Body: { "workflow": "<name>", "<param1>": "value", ... }
    // Auth: Authorization: Bearer <api-key>  OR  x-api-key: <api-key>
    app.post("/run", express.json(), async (req, res) => {
      const supplied = (req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ?? req.headers["x-api-key"]) as string | undefined;

      // Look up user by API key
      const keyRow = supplied
        ? await new Promise<{ user_id: string; tier: string; revoked: number } | undefined>((resolve, reject) =>
            db.get(
              "SELECT user_id, tier, revoked FROM api_keys WHERE key_prefix = ?",
              [supplied.slice(0, 16)],
              (err, row) => err ? reject(err) : resolve(row as { user_id: string; tier: string; revoked: number } | undefined)
            )
          )
        : undefined;

      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      const { workflow: workflowName, ...rawParams } = req.body ?? {};
      if (!workflowName) {
        res.status(400).json({ error: "Missing required field: workflow" });
        return;
      }

      const wf = WORKFLOWS[workflowName];
      if (!wf) {
        res.status(404).json({ error: `Unknown workflow: "${workflowName}". See GET /agents for available workflows.` });
        return;
      }

      // Tier access check — before credits, before execution
      const tierAccess = checkTierAccess(keyRow.tier, wf.credits);
      if (!tierAccess.allowed) {
        logAudit({ user_id: keyRow.user_id, action: "tier_access_denied", resource: workflowName,
          result: "blocked", details: { tier: keyRow.tier, agent_cost: wf.credits } });
        res.status(403).json({ error: tierAccess.message });
        return;
      }

      try {
        enforceRateLimit(keyRow.user_id, keyRow.tier);

        const cleanParams = validateWorkflowParams(workflowName, rawParams);

        const billingEnabled = !!process.env.BILLING_API_URL;
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            res.status(402).json({ error: `Insufficient credits — balance: ${balance}, required: ${wf.credits}` });
            return;
          }
        }

        logAudit({ user_id: keyRow.user_id, action: "run_workflow_start", resource: workflowName,
          result: "success", details: { params: cleanParams, tier: keyRow.tier } });
        const startTime = Date.now();
        const result = await dispatchWorkflow(workflowName, cleanParams);

        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, workflowName);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }

        logAudit({ user_id: keyRow.user_id, action: "run_workflow_complete", resource: workflowName,
          result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });

        res.json(result);
      } catch (err) {
        const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", `[run] workflow error — ${workflowName}: ${msg}`);
        res.status(500).json({ error: msg });
      }
    });

    // ── A2A: Agent Card endpoints ─────────────────────────────────────────────
    const AGENT_CARD = {
      name: "Security Orchestra",
      description: "50+ specialized agents & 8 compound chains for data center critical power infrastructure. Generator sizing, NFPA 110 compliance, UPS/ATS sizing, PUE, cooling, ROI/TCO, site scoring, and more.",
      url: "https://security-orchestra-orchestrator.onrender.com",
      version: "1.0.0",
      provider: {
        organization: "RobotFleet-HQ",
        url: "https://robotfleet-hq.github.io/security-orchestra-landing/",
      },
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: false,
        agui: "https://security-orchestra-orchestrator.onrender.com/agui",
        acp: "https://security-orchestra-orchestrator.onrender.com/acp/runs",
      },
      authentication: {
        schemes: ["bearer"],
      },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: [
        ...Object.entries(WORKFLOWS).map(([id, w]) => ({
          id,
          name: id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          description: w.description,
          tags: ["data-center", "critical-power", "infrastructure"],
          inputModes: ["text"],
          outputModes: ["text"],
          examples: [],
        })),
        ...Object.entries(CHAINS).map(([id, c]) => ({
          id: `chain_${id}`,
          name: `${c.name} (chain)`,
          description: c.description,
          tags: ["data-center", "critical-power", "chain"],
          inputModes: ["text"],
          outputModes: ["text"],
          examples: [],
        })),
      ],
    };

    app.get("/.well-known/agent.json", (_req, res) => {
      res.json(AGENT_CARD);
    });

    app.get("/.well-known/mcp/server-card.json", (_req, res) => {
      res.json(AGENT_CARD);
    });

    // ── AG-UI discovery ───────────────────────────────────────────────────────
    const AGUI_DISCOVERY = {
      name: "Security Orchestra",
      version: "1.0",
      agui_endpoint: "https://security-orchestra-orchestrator.onrender.com/agui",
      agents_endpoint: "https://security-orchestra-orchestrator.onrender.com/agui/agents",
      authentication: { type: "bearer" },
      capabilities: { streaming: true, chains: true, multi_agent: true },
    };

    app.get("/.well-known/agui.json", (_req, res) => {
      res.json(AGUI_DISCOVERY);
    });

    // ── AG-UI: agent manifest ─────────────────────────────────────────────────
    app.get("/agui/agents", express.json(), async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }
      const agents = [
        ...Object.entries(WORKFLOWS).map(([id, wf]) => ({
          agent_id: id,
          name: id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          description: wf.description,
          type: "workflow",
          capabilities: ["text"],
        })),
        ...Object.entries(CHAINS).map(([id, c]) => ({
          agent_id: `chain_${id}`,
          name: c.name,
          description: c.description,
          type: "chain",
          capabilities: ["text"],
        })),
      ];
      res.json({ agents });
    });

    // ── AG-UI: streaming endpoint ─────────────────────────────────────────────
    function writeAGUIEvent(res: express.Response, event: Record<string, unknown>): void {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    app.post("/agui", express.json(), async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      const messages: { role: string; content: string }[] | undefined = req.body?.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) {
        res.status(400).json({ error: "No user message found" });
        return;
      }
      const text = lastUser.content;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const runId = crypto.randomUUID();
      const now = () => new Date().toISOString();

      writeAGUIEvent(res, { type: "RUN_STARTED", run_id: runId, agent_id: req.body?.agent_id ?? "auto", timestamp: now() });

      try {
        const { chainId: detectedChainId, workflowName, params: detectedParams } = detectWorkflowFromText(text);

        if (detectedChainId) {
          const chain = CHAINS[detectedChainId];
          const billingEnabledChain = !!process.env.BILLING_API_URL;
          if (billingEnabledChain) {
            const balance = await checkCredits(keyRow.user_id);
            if (balance < chain.credits) {
              writeAGUIEvent(res, { type: "RUN_ERROR", run_id: runId, message: `Insufficient credits — balance: ${balance}, required: ${chain.credits}`, timestamp: now() });
              res.end();
              return;
            }
          }

          const msgId = crypto.randomUUID();
          writeAGUIEvent(res, { type: "TEXT_MESSAGE_START", message_id: msgId, role: "assistant" });

          for (const stepId of chain.steps) {
            const stepName = stepId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            writeAGUIEvent(res, { type: "TEXT_MESSAGE_CONTENT", message_id: msgId, delta: `\n▶ Running ${stepName}...\n` });
            const toolCallId = crypto.randomUUID();
            writeAGUIEvent(res, { type: "TOOL_CALL_START", tool_call_id: toolCallId, tool_call_name: stepId });
            try {
              const stepParams = validateWorkflowParams(stepId, detectedParams);
              await dispatchWorkflow(stepId, stepParams);
            } catch (_e) { /* individual step errors don't abort the chain */ }
            writeAGUIEvent(res, { type: "TOOL_CALL_END", tool_call_id: toolCallId });
            writeAGUIEvent(res, { type: "TEXT_MESSAGE_CONTENT", message_id: msgId, delta: `✓ ${stepId} complete\n` });
          }

          logAudit({ user_id: keyRow.user_id, action: "agui_chain_start", resource: detectedChainId, result: "success", details: { tier: keyRow.tier } });
          const chainResult = await runChain(detectedChainId, detectedParams, keyRow.user_id, keyRow.tier);
          if (billingEnabledChain) await deductCredits(keyRow.user_id, chain.credits, `chain:${detectedChainId}`);
          logAudit({ user_id: keyRow.user_id, action: "agui_chain_complete", resource: detectedChainId, result: "success", details: { tier: keyRow.tier } });

          const fullText = JSON.stringify(chainResult, null, 2);
          for (let i = 0; i < fullText.length; i += 100) {
            writeAGUIEvent(res, { type: "TEXT_MESSAGE_CONTENT", message_id: msgId, delta: fullText.slice(i, i + 100) });
            await new Promise((r) => setTimeout(r, 10));
          }
          writeAGUIEvent(res, { type: "TEXT_MESSAGE_END", message_id: msgId });
          writeAGUIEvent(res, { type: "RUN_FINISHED", run_id: runId, timestamp: now() });
          res.end();
          return;
        }

        if (!workflowName) {
          const msgId = crypto.randomUUID();
          const errText = "I couldn't determine which agent to use. Try being more specific.";
          writeAGUIEvent(res, { type: "TEXT_MESSAGE_START", message_id: msgId, role: "assistant" });
          writeAGUIEvent(res, { type: "TEXT_MESSAGE_CONTENT", message_id: msgId, delta: errText });
          writeAGUIEvent(res, { type: "TEXT_MESSAGE_END", message_id: msgId });
          writeAGUIEvent(res, { type: "RUN_FINISHED", run_id: runId, timestamp: now() });
          res.end();
          return;
        }

        enforceRateLimit(keyRow.user_id, keyRow.tier);
        const cleanParams = validateWorkflowParams(workflowName, detectedParams);
        const wf = WORKFLOWS[workflowName];
        const billingEnabled = !!process.env.BILLING_API_URL;
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            writeAGUIEvent(res, { type: "RUN_ERROR", run_id: runId, message: `Insufficient credits — balance: ${balance}, required: ${wf.credits}`, timestamp: now() });
            res.end();
            return;
          }
        }

        const toolCallId = crypto.randomUUID();
        writeAGUIEvent(res, { type: "TOOL_CALL_START", tool_call_id: toolCallId, tool_call_name: workflowName });

        logAudit({ user_id: keyRow.user_id, action: "agui_workflow_start", resource: workflowName, result: "success", details: { params: cleanParams, tier: keyRow.tier } });
        const startTime = Date.now();
        const result = await dispatchWorkflow(workflowName, cleanParams);

        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, workflowName);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }
        logAudit({ user_id: keyRow.user_id, action: "agui_workflow_complete", resource: workflowName, result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });

        const msgId = crypto.randomUUID();
        writeAGUIEvent(res, { type: "TEXT_MESSAGE_START", message_id: msgId, role: "assistant" });
        const fullText = JSON.stringify(result, null, 2);
        for (let i = 0; i < fullText.length; i += 100) {
          writeAGUIEvent(res, { type: "TEXT_MESSAGE_CONTENT", message_id: msgId, delta: fullText.slice(i, i + 100) });
          await new Promise((r) => setTimeout(r, 10));
        }
        writeAGUIEvent(res, { type: "TEXT_MESSAGE_END", message_id: msgId });
        writeAGUIEvent(res, { type: "TOOL_CALL_END", tool_call_id: toolCallId });
        writeAGUIEvent(res, { type: "RUN_FINISHED", run_id: runId, timestamp: now() });
        res.end();
      } catch (err) {
        const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", `[agui] error: ${msg}`);
        writeAGUIEvent(res, { type: "RUN_ERROR", run_id: runId, message: msg, timestamp: now() });
        res.end();
      }
    });

    // ── ACP: IBM/BeeAI Agent Communication Protocol ───────────────────────────
    const ACP_DESCRIPTOR = {
      name: "Security Orchestra",
      version: "1.0",
      description: "50+ specialized agents & 8 compound chains for data center critical power infrastructure",
      url: "https://security-orchestra-orchestrator.onrender.com/acp",
      agents: [
        {
          name: "security-orchestra",
          description: "Routes to any of the 50+ specialized agents & 8 compound chains",
          metadata: {
            framework: "custom",
            capabilities: ["generator_sizing", "nfpa_110", "ups_sizing", "pue", "tco", "tier_certification", "multi_agent_chains"],
          },
        },
      ],
      authentication: { type: "bearer" },
    };

    app.get("/.well-known/acp.json", (_req, res) => {
      res.json(ACP_DESCRIPTOR);
    });

    // GET /acp/agents — full workflow + chain listing in ACP format
    app.get("/acp/agents", express.json(), async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }
      const agents = [
        ...Object.entries(WORKFLOWS).map(([id, wf]) => ({
          name: id,
          description: wf.description,
          metadata: { type: "workflow", credits: wf.credits },
        })),
        ...Object.entries(CHAINS).map(([id, c]) => ({
          name: `chain_${id}`,
          description: c.description,
          metadata: { type: "chain", credits: c.credits },
        })),
      ];
      res.json({ agents });
    });

    // GET /acp/runs/:run_id — run status stub
    app.get("/acp/runs/:run_id", async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }
      res.json({ run_id: req.params.run_id, status: "completed" });
    });

    // POST /acp/runs — synchronous agent run
    app.post("/acp/runs", express.json(), async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      const runId = crypto.randomUUID();
      const agentName: string = req.body?.agent_name ?? "security-orchestra";

      // Extract last user message text from ACP envelope
      const inputMessages: { role: string; content: { type: string; text: string }[] }[] | undefined = req.body?.input;
      if (!Array.isArray(inputMessages) || inputMessages.length === 0) {
        res.status(400).json({ run_id: runId, agent_name: agentName, status: "failed", error: "input array is required" });
        return;
      }
      const lastUser = [...inputMessages].reverse().find((m) => m.role === "user");
      const text = lastUser?.content?.[0]?.text;
      if (!text) {
        res.status(400).json({ run_id: runId, agent_name: agentName, status: "failed", error: "No user message text found in input" });
        return;
      }

      try {
        enforceRateLimit(keyRow.user_id, keyRow.tier);
        const { chainId: detectedChainId, workflowName, params: detectedParams } = detectWorkflowFromText(text);

        if (detectedChainId) {
          const chain = CHAINS[detectedChainId];
          const billingEnabled = !!process.env.BILLING_API_URL;
          if (billingEnabled) {
            const balance = await checkCredits(keyRow.user_id);
            if (balance < chain.credits) {
              res.status(402).json({ run_id: runId, agent_name: agentName, status: "failed", error: `Insufficient credits — balance: ${balance}, required: ${chain.credits}` });
              return;
            }
          }
          logAudit({ user_id: keyRow.user_id, action: "acp_run_start", resource: detectedChainId, result: "success", details: { tier: keyRow.tier } });
          const startTime = Date.now();
          const chainResult = await runChain(detectedChainId, detectedParams, keyRow.user_id, keyRow.tier);
          if (billingEnabled) await deductCredits(keyRow.user_id, chain.credits, `chain:${detectedChainId}`);
          logAudit({ user_id: keyRow.user_id, action: "acp_run_complete", resource: detectedChainId, result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });
          res.json({
            run_id: runId,
            agent_name: agentName,
            status: "completed",
            output: [{ role: "agent", content: [{ type: "text", text: JSON.stringify(chainResult, null, 2) }] }],
          });
          return;
        }

        if (!workflowName) {
          res.json({
            run_id: runId,
            agent_name: agentName,
            status: "completed",
            output: [{ role: "agent", content: [{ type: "text", text: "I couldn't determine which agent to use. Try being more specific." }] }],
          });
          return;
        }

        const wf = WORKFLOWS[workflowName];
        const cleanParams = validateWorkflowParams(workflowName, detectedParams);
        const billingEnabled = !!process.env.BILLING_API_URL;
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            res.status(402).json({ run_id: runId, agent_name: agentName, status: "failed", error: `Insufficient credits — balance: ${balance}, required: ${wf.credits}` });
            return;
          }
        }

        logAudit({ user_id: keyRow.user_id, action: "acp_run_start", resource: workflowName, result: "success", details: { params: cleanParams, tier: keyRow.tier } });
        const startTime = Date.now();
        const result = await dispatchWorkflow(workflowName, cleanParams);

        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, workflowName);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }
        logAudit({ user_id: keyRow.user_id, action: "acp_run_complete", resource: workflowName, result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });

        res.json({
          run_id: runId,
          agent_name: agentName,
          status: "completed",
          output: [{ role: "agent", content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }],
        });
      } catch (err) {
        const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", `[acp/runs] error: ${msg}`);
        res.status(500).json({ run_id: runId, agent_name: agentName, status: "failed", error: msg });
      }
    });

    // ── A2A: JSON-RPC 2.0 task endpoint ──────────────────────────────────────
    app.post("/a2a", express.json(), async (req, res) => {
      // Auth: same DB-based key lookup as /chat
      const supplied = (
        req.headers["x-api-key"] ??
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "")
      ) as string | undefined;

      const keyRow = supplied
        ? await new Promise<{ user_id: string; tier: string; revoked: number } | undefined>(
            (resolve, reject) =>
              db.get(
                "SELECT user_id, tier, revoked FROM api_keys WHERE key_prefix = ?",
                [supplied.slice(0, 16)],
                (err, row) =>
                  err
                    ? reject(err)
                    : resolve(row as { user_id: string; tier: string; revoked: number } | undefined)
              )
          )
        : undefined;

      if (!keyRow || keyRow.revoked) {
        res.status(401).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: { code: -32001, message: "Unauthorized: missing or invalid API key" },
        });
        return;
      }

      const { jsonrpc, id, method, params } = req.body ?? {};
      if (jsonrpc !== "2.0" || !method) {
        res.status(400).json({
          jsonrpc: "2.0",
          id: id ?? null,
          error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
        });
        return;
      }

      // tasks/get stub
      if (method === "tasks/get") {
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            id: params?.id ?? crypto.randomUUID(),
            status: { state: "completed" },
          },
        });
        return;
      }

      if (method !== "message/send") {
        res.status(200).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
        return;
      }

      // Extract message text from A2A task
      const text: string | undefined = params?.message?.parts?.[0]?.text;
      if (!text) {
        res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing params.message.parts[0].text" },
        });
        return;
      }

      // Detect chain or workflow from natural language
      const { chainId: detectedChainId, workflowName, params: detectedParams } = detectWorkflowFromText(text);

      // ── Chain dispatch ───────────────────────────────────────────────────────
      if (detectedChainId) {
        const chain = CHAINS[detectedChainId];
        const billingEnabledChain = !!process.env.BILLING_API_URL;
        if (billingEnabledChain) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < chain.credits) {
            res.status(402).json({
              jsonrpc: "2.0", id,
              error: { code: -32002, message: `Insufficient credits — balance: ${balance}, required: ${chain.credits}` },
            });
            return;
          }
        }
        logAudit({ user_id: keyRow.user_id, action: "chain_start", resource: detectedChainId,
          result: "success", details: { params: detectedParams, tier: keyRow.tier } });
        const chainStartTime = Date.now();
        const chainResult = await runChain(detectedChainId, detectedParams, keyRow.user_id, keyRow.tier);
        if (billingEnabledChain) await deductCredits(keyRow.user_id, chain.credits, `chain:${detectedChainId}`);
        logAudit({ user_id: keyRow.user_id, action: "chain_complete", resource: detectedChainId,
          result: "success", duration_ms: Date.now() - chainStartTime, details: { tier: keyRow.tier } });
        res.json({
          jsonrpc: "2.0", id,
          result: {
            id: crypto.randomUUID(),
            status: { state: "completed" },
            artifacts: [{ name: "response", parts: [{ kind: "text", text: JSON.stringify(chainResult, null, 2) }] }],
          },
        });
        return;
      }

      if (!workflowName) {
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            id: crypto.randomUUID(),
            status: { state: "completed" },
            artifacts: [{ name: "response", parts: [{ kind: "text", text: "I couldn't determine which agent to use. Try being more specific, e.g. \"analyze IP 1.2.3.4\" or \"lookup CVE-2024-1234\". See GET /agents for all available workflows." }] }],
          },
        });
        return;
      }

      const wf = WORKFLOWS[workflowName];

      try {
        enforceRateLimit(keyRow.user_id, keyRow.tier);
        const cleanParams = validateWorkflowParams(workflowName, detectedParams);

        const billingEnabled = !!process.env.BILLING_API_URL;
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            res.status(402).json({
              jsonrpc: "2.0",
              id,
              error: { code: -32002, message: `Insufficient credits — balance: ${balance}, required: ${wf.credits}` },
            });
            return;
          }
        }

        logAudit({ user_id: keyRow.user_id, action: "a2a_workflow_start", resource: workflowName,
          result: "success", details: { params: cleanParams, tier: keyRow.tier } });
        const startTime = Date.now();
        const result = await dispatchWorkflow(workflowName, cleanParams);

        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, workflowName);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }

        logAudit({ user_id: keyRow.user_id, action: "a2a_workflow_complete", resource: workflowName,
          result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });

        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            id: crypto.randomUUID(),
            status: { state: "completed" },
            artifacts: [{ name: "response", parts: [{ kind: "text", text: JSON.stringify(result, null, 2) }] }],
          },
        });
      } catch (err) {
        const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", `[a2a] workflow error — ${workflowName}: ${msg}`);
        res.status(500).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: msg },
        });
      }
    });

    // ── A2A: SSE streaming endpoint ───────────────────────────────────────────
    app.post("/a2a/stream", express.json(), async (req, res) => {
      // Auth: same DB-based key lookup as /chat
      const supplied = (
        req.headers["x-api-key"] ??
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "")
      ) as string | undefined;

      const keyRow = supplied
        ? await new Promise<{ user_id: string; tier: string; revoked: number } | undefined>(
            (resolve, reject) =>
              db.get(
                "SELECT user_id, tier, revoked FROM api_keys WHERE key_prefix = ?",
                [supplied.slice(0, 16)],
                (err, row) =>
                  err
                    ? reject(err)
                    : resolve(row as { user_id: string; tier: string; revoked: number } | undefined)
              )
          )
        : undefined;

      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      const text: string | undefined = req.body?.params?.message?.parts?.[0]?.text;
      if (!text) {
        res.status(400).json({ error: "Missing params.message.parts[0].text" });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const { chainId: streamChainId, workflowName, params: detectedParams } = detectWorkflowFromText(text);

      if (streamChainId) {
        const chain = CHAINS[streamChainId];
        const chainResult = await runChain(streamChainId, detectedParams, keyRow.user_id, keyRow.tier);
        if (!!process.env.BILLING_API_URL) await deductCredits(keyRow.user_id, chain.credits, `chain:${streamChainId}`);
        res.write(`data: ${JSON.stringify({ kind: "artifact-update", part: { kind: "text", text: JSON.stringify(chainResult, null, 2) } })}\n\n`);
        res.write(`data: ${JSON.stringify({ kind: "task-status", status: { state: "completed" } })}\n\n`);
        res.end();
        return;
      }

      if (!workflowName) {
        res.write(`data: ${JSON.stringify({ kind: "artifact-update", part: { kind: "text", text: "I couldn't determine which agent to use. Try being more specific." } })}\n\n`);
        res.write(`data: ${JSON.stringify({ kind: "task-status", status: { state: "completed" } })}\n\n`);
        res.end();
        return;
      }

      try {
        enforceRateLimit(keyRow.user_id, keyRow.tier);
        const cleanParams = validateWorkflowParams(workflowName, detectedParams);

        const billingEnabled = !!process.env.BILLING_API_URL;
        const wf = WORKFLOWS[workflowName];
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            res.write(`data: ${JSON.stringify({ kind: "task-status", status: { state: "failed" }, error: `Insufficient credits — balance: ${balance}, required: ${wf.credits}` })}\n\n`);
            res.end();
            return;
          }
        }

        logAudit({ user_id: keyRow.user_id, action: "a2a_stream_start", resource: workflowName,
          result: "success", details: { params: cleanParams, tier: keyRow.tier } });
        const startTime = Date.now();
        const result = await dispatchWorkflow(workflowName, cleanParams);

        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, workflowName);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }

        logAudit({ user_id: keyRow.user_id, action: "a2a_stream_complete", resource: workflowName,
          result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });

        res.write(`data: ${JSON.stringify({ kind: "artifact-update", part: { kind: "text", text: JSON.stringify(result, null, 2) } })}\n\n`);
        res.write(`data: ${JSON.stringify({ kind: "task-status", status: { state: "completed" } })}\n\n`);
        res.end();
      } catch (err) {
        const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", `[a2a/stream] workflow error — ${workflowName}: ${msg}`);
        res.write(`data: ${JSON.stringify({ kind: "task-status", status: { state: "failed" }, error: msg })}\n\n`);
        res.end();
      }
    });

    // ── POST /chain — multi-agent chain execution ─────────────────────────────
    app.post("/chain", express.json(), async (req, res) => {
      const supplied = (
        req.headers["x-api-key"] ??
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "")
      ) as string | undefined;

      const keyRow = supplied
        ? await new Promise<{ user_id: string; tier: string; revoked: number } | undefined>(
            (resolve, reject) =>
              db.get(
                "SELECT user_id, tier, revoked FROM api_keys WHERE key_prefix = ?",
                [supplied.slice(0, 16)],
                (err, row) =>
                  err
                    ? reject(err)
                    : resolve(row as { user_id: string; tier: string; revoked: number } | undefined)
              )
          )
        : undefined;

      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      const chainId: string | undefined = req.body?.chain;
      const query: string | undefined   = req.body?.query;

      if (!chainId || !query) {
        res.status(400).json({ error: "chain and query are required" });
        return;
      }

      const chain = CHAINS[chainId];
      if (!chain) {
        res.status(400).json({
          error: `Unknown chain "${chainId}". Available: ${Object.keys(CHAINS).join(", ")}`,
        });
        return;
      }

      const billingEnabled = !!process.env.BILLING_API_URL;
      if (billingEnabled) {
        const balance = await checkCredits(keyRow.user_id);
        if (balance < chain.credits) {
          res.status(402).json({
            error: `Insufficient credits — balance: ${balance}, required: ${chain.credits} for chain ${chainId}`,
          });
          return;
        }
      }

      // Extract numeric params directly — detectWorkflowFromText may return {} if
      // no workflow keyword matches the chain query (e.g. "500kW data center...")
      const kwVal  = query.match(/(\d+(?:\.\d+)?)\s*(?:kw|kilowatt)/i)?.[1];
      const mwVal  = query.match(/(\d+(?:\.\d+)?)\s*(?:mw|megawatt)/i)?.[1];
      const load_kw = kwVal ?? (mwVal ? String(parseFloat(mwVal) * 1000) : "1000");
      const load_mw = mwVal ?? (kwVal ? String(parseFloat(kwVal) / 1000) : "10");
      const tierDigit = parseInt(query.match(/tier\s*([1-4])/i)?.[1] ?? "3", 10);
      const CHAIN_TIER_MAP: Record<number, string> = { 1: "N", 2: "N+1", 3: "2N", 4: "2N+1" };
      const tierNum = CHAIN_TIER_MAP[tierDigit] ?? "2N";
      const stateMatch = query.match(/\b(NC|SC|VA|TX|CA|NY|FL|GA|OH|PA|IL|WA|OR|CO|AZ|NV)\b/i)?.[1]?.toUpperCase() ?? "NC";
      const initialParams: Record<string, string> = {
        load_kw, load_mw, it_load_kw: load_kw, tier: tierNum,
        state: stateMatch, capacity_mw: load_mw,
      };

      logAudit({
        user_id: keyRow.user_id, action: "chain_start", resource: chainId,
        result: "success", details: { query, steps: chain.steps, tier: keyRow.tier },
      });
      const startTime = Date.now();

      const chainResult = await runChain(chainId, initialParams, keyRow.user_id, keyRow.tier);

      if (billingEnabled) {
        const remaining = await deductCredits(keyRow.user_id, chain.credits, `chain:${chainId}`);
        (chainResult.result as Record<string, unknown>).credits_remaining = remaining;
      }

      logAudit({
        user_id: keyRow.user_id, action: "chain_complete", resource: chainId,
        result: "success", duration_ms: Date.now() - startTime,
        details: { steps_completed: (chainResult.result as Record<string, unknown>).steps_completed, tier: keyRow.tier },
      });

      res.json(chainResult);
    });

    // ── OpenAI Agents SDK compatibility ──────────────────────────────────────

    // Helper: resolve keyRow from request headers (same logic as /chat and /a2a)
    async function resolveKeyRow(
      req: express.Request
    ): Promise<{ user_id: string; tier: string; revoked: number } | undefined> {
      const supplied = (
        req.headers["x-api-key"] ??
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "")
      ) as string | undefined;
      if (!supplied) return undefined;
      return new Promise<{ user_id: string; tier: string; revoked: number } | undefined>(
        (resolve, reject) =>
          db.get(
            "SELECT user_id, tier, revoked FROM api_keys WHERE key_prefix = ?",
            [supplied.slice(0, 16)],
            (err, row) =>
              err
                ? reject(err)
                : resolve(row as { user_id: string; tier: string; revoked: number } | undefined)
          )
      );
    }

    // GET /openai/tools — return all workflows as OpenAI function tool definitions
    app.get("/openai/tools", express.json(), async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      const tools = [
        ...Object.entries(WORKFLOWS).map(([name, wf]) => ({
          type: "function",
          function: {
            name,
            description: wf.description,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Natural language instruction for this agent" },
              },
              required: ["query"],
            },
          },
        })),
        ...Object.entries(CHAINS).map(([name, c]) => ({
          type: "function",
          function: {
            name: `chain_${name}`,
            description: c.description,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Natural language instruction for this compound workflow chain" },
              },
              required: ["query"],
            },
          },
        })),
      ];

      res.json(tools);
    });

    // POST /openai/run — execute a workflow via OpenAI tool call format
    app.post("/openai/run", express.json(), async (req, res) => {
      const keyRow = await resolveKeyRow(req);
      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ role: "tool", content: "Error: Unauthorized: missing or invalid API key" });
        return;
      }

      const toolName: string | undefined = req.body?.tool;
      const query: string | undefined    = req.body?.parameters?.query;

      if (!toolName || !query) {
        res.status(400).json({ role: "tool", content: "Error: tool and parameters.query are required" });
        return;
      }

      // Check if tool is a chain
      const openaiChainId = toolName.startsWith("chain_") ? toolName.slice(6) : undefined;
      if (openaiChainId) {
        const chain = CHAINS[openaiChainId];
        if (!chain) {
          res.status(400).json({ role: "tool", content: `Error: Unknown chain "${openaiChainId}"` });
          return;
        }
        try {
          enforceRateLimit(keyRow.user_id, keyRow.tier);
          const { params: chainParams } = detectWorkflowFromText(query);
          logAudit({ user_id: keyRow.user_id, action: "chain_start", resource: openaiChainId,
            result: "success", details: { query, tier: keyRow.tier } });
          const chainResult = await runChain(openaiChainId, chainParams, keyRow.user_id, keyRow.tier);
          if (!!process.env.BILLING_API_URL) await deductCredits(keyRow.user_id, chain.credits, `chain:${openaiChainId}`);
          logAudit({ user_id: keyRow.user_id, action: "chain_complete", resource: openaiChainId,
            result: "success", details: { tier: keyRow.tier } });
          res.json({ role: "tool", content: JSON.stringify(chainResult, null, 2) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.status(500).json({ role: "tool", content: `Error: ${msg}` });
        }
        return;
      }

      const wf = WORKFLOWS[toolName];
      if (!wf) {
        res.status(400).json({ role: "tool", content: `Error: Unknown tool "${toolName}"` });
        return;
      }

      try {
        enforceRateLimit(keyRow.user_id, keyRow.tier);

        const { workflowName, params: detectedParams } = detectWorkflowFromText(query);
        const targetWorkflow = workflowName ?? toolName;
        const cleanParams = validateWorkflowParams(targetWorkflow, detectedParams);

        const billingEnabled = !!process.env.BILLING_API_URL;
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            res.status(402).json({ role: "tool", content: `Error: Insufficient credits — balance: ${balance}, required: ${wf.credits}` });
            return;
          }
        }

        logAudit({ user_id: keyRow.user_id, action: "openai_run_start", resource: targetWorkflow,
          result: "success", details: { query, tier: keyRow.tier } });
        const startTime = Date.now();
        const result = await dispatchWorkflow(targetWorkflow, cleanParams);

        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, targetWorkflow);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }

        logAudit({ user_id: keyRow.user_id, action: "openai_run_complete", resource: targetWorkflow,
          result: "success", duration_ms: Date.now() - startTime, details: { tier: keyRow.tier } });

        res.json({ role: "tool", content: JSON.stringify(result, null, 2) });
      } catch (err) {
        const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", `[openai/run] workflow error — ${toolName}: ${msg}`);
        res.status(500).json({ role: "tool", content: `Error: ${msg}` });
      }
    });

    // ── POST /chat — conversational workflow interface ────────────────────────
    // Auth:   x-api-key: <key>  OR  Authorization: Bearer <key>
    // Body:   { messages: [{ role: "user"|"assistant", content: string }] }
    // Reply:  { reply: string, agent: string | null }
    app.post("/chat", express.json(), async (req, res) => {
      // 1. Auth — same key lookup as /run
      const supplied = (
        req.headers["x-api-key"] ??
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "")
      ) as string | undefined;

      const keyRow = supplied
        ? await new Promise<{ user_id: string; tier: string; revoked: number } | undefined>(
            (resolve, reject) =>
              db.get(
                "SELECT user_id, tier, revoked FROM api_keys WHERE key_prefix = ?",
                [supplied.slice(0, 16)],
                (err, row) =>
                  err
                    ? reject(err)
                    : resolve(row as { user_id: string; tier: string; revoked: number } | undefined)
              )
          )
        : undefined;

      if (!keyRow || keyRow.revoked) {
        res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
        return;
      }

      // 2. Validate body
      const messages: { role: string; content: string }[] | undefined = req.body?.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required and must not be empty" });
        return;
      }

      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) {
        res.status(400).json({ error: "No user message found in messages array" });
        return;
      }

      // 3a. Agent-list shortcut — return full registry if user is asking what's available
      const msgLower = lastUser.content.toLowerCase();
      const isAgentListQuery =
        /what agents|list agents|show agents|available agents|what can you do/.test(msgLower);
      if (isAgentListQuery) {
        const agentList = Object.entries(WORKFLOWS).map(([name, wf]) => ({
          name,
          description: wf.description,
          credits: wf.credits,
        }));
        res.json({
          reply:
            `Here are all ${agentList.length} available agents:\n\n` +
            agentList.map((a) => `• **${a.name}** — ${a.description} (${a.credits} credits)`).join("\n"),
          agent: null,
          agents: agentList,
        });
        return;
      }

      // 3. Detect chain or workflow from message text
      const { chainId: chatChainId, workflowName, params: detectedParams } = detectWorkflowFromText(lastUser.content);

      // ── Chain dispatch ─────────────────────────────────────────────────────
      if (chatChainId) {
        const chain = CHAINS[chatChainId];
        const billingEnabledChat = !!process.env.BILLING_API_URL;
        if (billingEnabledChat) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < chain.credits) {
            res.status(402).json({
              error: `Insufficient credits — balance: ${balance}, required: ${chain.credits} for chain ${chatChainId}`,
            });
            return;
          }
        }
        try {
          enforceRateLimit(keyRow.user_id, keyRow.tier);
          logAudit({ user_id: keyRow.user_id, action: "chain_start", resource: chatChainId,
            result: "success", details: { params: detectedParams, tier: keyRow.tier } });
          const chainStartTime = Date.now();
          const chainResult = await runChain(chatChainId, detectedParams, keyRow.user_id, keyRow.tier);
          if (billingEnabledChat) {
            const remaining = await deductCredits(keyRow.user_id, chain.credits, `chain:${chatChainId}`);
            (chainResult.result as Record<string, unknown>).credits_remaining = remaining;
          }
          logAudit({ user_id: keyRow.user_id, action: "chain_complete", resource: chatChainId,
            result: "success", duration_ms: Date.now() - chainStartTime, details: { tier: keyRow.tier } });
          res.json({ reply: JSON.stringify(chainResult, null, 2), agent: `chain:${chatChainId}` });
        } catch (err) {
          const msg = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);
          log("error", `[chat] chain error — ${chatChainId}: ${msg}`);
          res.status(500).json({ error: msg });
        }
        return;
      }

      if (!workflowName) {
        res.json({
          reply:
            "I couldn't determine which agent to use. Try being more specific, e.g. " +
            "\"size a generator for 500kW\" or \"calculate PUE for a 2MW IT load\". " +
            "See GET /agents for all available tools (50+ specialized agents & 8 compound chains).",
          agent: null,
        });
        return;
      }

      const wf = WORKFLOWS[workflowName];

      // 4. Tier access check — before rate limit, before credits
      const tierAccess = checkTierAccess(keyRow.tier, wf.credits);
      if (!tierAccess.allowed) {
        logAudit({ user_id: keyRow.user_id, action: "tier_access_denied", resource: workflowName,
          result: "blocked", details: { tier: keyRow.tier, agent_cost: wf.credits } });
        res.status(403).json({ error: tierAccess.message, agent: workflowName });
        return;
      }

      try {
        // 5. Rate limit
        enforceRateLimit(keyRow.user_id, keyRow.tier);

        // 6. Validate params (fills in any missing fields detected above)
        const cleanParams = validateWorkflowParams(workflowName, detectedParams);

        // 7. Credit gate
        const billingEnabled = !!process.env.BILLING_API_URL;
        if (billingEnabled) {
          const balance = await checkCredits(keyRow.user_id);
          if (balance < wf.credits) {
            res.status(402).json({
              error: `Insufficient credits — balance: ${balance}, required: ${wf.credits} for ${workflowName}`,
            });
            return;
          }
        }

        // 7. Execute
        logAudit({
          user_id: keyRow.user_id,
          action:   "chat_workflow_start",
          resource: workflowName,
          result:   "success",
          details:  { params: cleanParams, tier: keyRow.tier },
        });
        const startTime = Date.now();
        const result = await dispatchWorkflow(workflowName, cleanParams);

        // 8. Deduct credits
        if (billingEnabled) {
          const remaining = await deductCredits(keyRow.user_id, wf.credits, workflowName);
          (result.result as Record<string, unknown>).credits_used      = wf.credits;
          (result.result as Record<string, unknown>).credits_remaining = remaining;
        }

        logAudit({
          user_id:     keyRow.user_id,
          action:      "chat_workflow_complete",
          resource:    workflowName,
          result:      "success",
          duration_ms: Date.now() - startTime,
          details:     { tier: keyRow.tier },
        });

        res.json({
          reply: JSON.stringify(result, null, 2),
          agent: workflowName,
        });
      } catch (err) {
        const msg =
          err instanceof McpError
            ? err.message
            : err instanceof Error
            ? err.message
            : String(err);
        log("error", `[chat] workflow error — ${workflowName}: ${msg}`);
        res.status(500).json({ error: msg });
      }
    });

    // ── AGNTCY layer: ACP per-agent endpoints, OASF manifests, SLIM, directory ──
    mountAgntcy(app, {
      workflows: WORKFLOWS,
      chains:    CHAINS,
      resolveKeyRow,
      dispatchWorkflow,
      runChain,
      validateWorkflowParams,
      detectWorkflowFromText,
      enforceRateLimit,
      checkCredits,
      deductCredits,
      logAudit,
    });

    app.listen(PORT, HOST, () =>
      log("info", `HTTP/SSE MCP server listening on ${HOST}:${PORT}`)
    );
  } else {
    // ── Local: stdio transport (Claude Desktop) ──────────────────────────────
    const transport = new StdioServerTransport();
    const server = createServer();
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
