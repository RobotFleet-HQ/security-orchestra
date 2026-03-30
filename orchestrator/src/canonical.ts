// ─── Canonical Contract Layer ─────────────────────────────────────────────────
// Every agent response is wrapped in CanonicalResponse before leaving
// dispatchWorkflow. This guarantees parseable, unambiguous output for
// Google A2A, OpenAI Agents SDK, AG-UI, ACP/BeeAI, AGNTCY/OASF, and
// any future A2A protocol.

// ─── DataFreshness ────────────────────────────────────────────────────────────

export interface DataFreshness {
  last_validated: string;          // ISO date when agent logic was last verified
  standards_refs: string[];        // e.g. ["NFPA 110:2022", "IEEE 485:2010"]
  stale_risk:     "low" | "medium" | "high";  // based on data volatility
  pricing_note?:  string;          // present whenever result contains pricing/rates
}

// ─── CanonicalResponse ────────────────────────────────────────────────────────

export interface CanonicalResponse {
  agent_id:         string;        // e.g. "generator_sizing"
  agent_version:    string;        // semver
  protocol_version: string;        // always "1.0"

  status:        "success" | "error";
  result:        unknown;          // workflow-specific payload; null on error

  // Flat error fields — easier to match without nested destructure
  error_code?:    string;          // e.g. "WORKFLOW_FAILED", "INVALID_PARAMS"
  error_message?: string;          // human-readable description

  data_freshness: DataFreshness;   // required on every response

  a2a: {
    task_id:           string;
    input_tokens_used: number;
    credits_consumed:  number;
    callable_by:       string[];   // ["google-a2a","openai-agents","ag-ui","acp","agntcy"]
  };
}

// ─── Agent Validation Registry ────────────────────────────────────────────────
// Single source of truth for data freshness per agent.
// Update last_validated whenever agent logic or reference data changes.

interface AgentMeta {
  last_validated: string;
  standards:      string[];
  risk:           "low" | "medium" | "high";
  has_pricing:    boolean;
}

export const AGENT_METADATA: Record<string, AgentMeta> = {
  // ── Security ────────────────────────────────────────────────────────────────
  subdomain_discovery:     { last_validated: "2026-03-28", standards: [],                                                                               risk: "low",    has_pricing: false },
  asset_discovery:         { last_validated: "2026-03-28", standards: [],                                                                               risk: "low",    has_pricing: false },
  vulnerability_assessment:{ last_validated: "2026-03-28", standards: ["CVE/NVD"],                                                                      risk: "low",    has_pricing: false },

  // ── Power infrastructure ─────────────────────────────────────────────────
  generator_sizing:        { last_validated: "2026-03-28", standards: ["NFPA 110:2022", "IEEE 446:1987"],                                               risk: "medium", has_pricing: true  },
  utility_interconnect:    { last_validated: "2026-03-28", standards: ["FERC Order 2023", "IEEE 1547:2018"],                                            risk: "high",   has_pricing: true  },
  pue_calculator:          { last_validated: "2026-03-28", standards: ["Green Grid PUE v2", "ISO/IEC 30134-2"],                                         risk: "low",    has_pricing: false },
  construction_cost:       { last_validated: "2026-03-28", standards: ["JLL DC Outlook 2024", "Turner & Townsend GDCCI 2023", "RS Means CCI 2024"],     risk: "high",   has_pricing: true  },
  nfpa_110_checker:        { last_validated: "2026-03-28", standards: ["NFPA 110:2022"],                                                                risk: "medium", has_pricing: false },
  ats_sizing:              { last_validated: "2026-03-28", standards: ["NEC 2023 Art.700", "NEC 2023 Art.701", "NEC 2023 Art.702"],                     risk: "medium", has_pricing: true  },
  ups_sizing:              { last_validated: "2026-03-28", standards: ["IEEE 485:2010", "IEEE 1184:2006"],                                              risk: "medium", has_pricing: true  },
  fuel_storage:            { last_validated: "2026-03-28", standards: ["NFPA 30:2021", "EPA SPCC 40 CFR 112"],                                         risk: "medium", has_pricing: true  },
  cooling_load:            { last_validated: "2026-03-28", standards: ["ASHRAE TC 9.9:2021"],                                                           risk: "low",    has_pricing: false },
  power_density:           { last_validated: "2026-03-28", standards: ["NEC 2023 Art.645"],                                                             risk: "medium", has_pricing: false },
  redundancy_validator:    { last_validated: "2026-03-28", standards: ["Uptime Institute Tier Standard 2022"],                                          risk: "medium", has_pricing: false },
  harmonic_analysis:       { last_validated: "2026-03-28", standards: ["IEEE 519:2022"],                                                                risk: "low",    has_pricing: false },
  voltage_drop:            { last_validated: "2026-03-28", standards: ["NEC 2023 Art.210.19", "NEC 2023 Art.647"],                                     risk: "low",    has_pricing: false },

  // ── Demand & environment ─────────────────────────────────────────────────
  demand_response:         { last_validated: "2026-03-28", standards: ["FERC Order 745", "PJM DR Tariff"],                                             risk: "high",   has_pricing: true  },
  environmental_impact:    { last_validated: "2026-03-28", standards: ["EPA AP-42 §3.4", "40 CFR Part 60 NSPS"],                                       risk: "medium", has_pricing: false },
  fire_suppression:        { last_validated: "2026-03-28", standards: ["NFPA 2001:2022", "NFPA 75:2020"],                                              risk: "medium", has_pricing: true  },
  incentive_finder:        { last_validated: "2026-03-28", standards: ["IRA 2022 §48E", "26 USC 48C"],                                                 risk: "high",   has_pricing: true  },
  noise_compliance:        { last_validated: "2026-03-28", standards: ["ISO 9613-2", "ANSI S12.18"],                                                   risk: "low",    has_pricing: false },
  permit_timeline:         { last_validated: "2026-03-28", standards: ["IBC 2021", "IFC 2021"],                                                        risk: "medium", has_pricing: false },
  roi_calculator:          { last_validated: "2026-03-28", standards: ["DCF methodology"],                                                             risk: "high",   has_pricing: true  },
  tco_analyzer:            { last_validated: "2026-03-28", standards: ["Green Grid TCO methodology"],                                                  risk: "high",   has_pricing: true  },
  fiber_connectivity:      { last_validated: "2026-03-28", standards: ["Ethernet Alliance 400GbE"],                                                    risk: "high",   has_pricing: true  },
  site_scoring:            { last_validated: "2026-03-28", standards: [],                                                                              risk: "low",    has_pricing: false },
  water_availability:      { last_validated: "2026-03-28", standards: ["EPA WaterSense", "ASHRAE 90.1:2022"],                                          risk: "medium", has_pricing: false },

  // ── Network ─────────────────────────────────────────────────────────────
  network_topology:        { last_validated: "2026-03-28", standards: ["IEEE 802.1Q:2022", "RFC 7938"],                                                risk: "low",    has_pricing: false },
  bandwidth_sizing:        { last_validated: "2026-03-28", standards: ["IEEE 802.3bs:2017"],                                                           risk: "low",    has_pricing: false },
  latency_calculator:      { last_validated: "2026-03-28", standards: ["ITU-T G.826"],                                                                 risk: "low",    has_pricing: false },
  ip_addressing:           { last_validated: "2026-03-28", standards: ["RFC 1918", "RFC 4291"],                                                        risk: "low",    has_pricing: false },
  dns_architecture:        { last_validated: "2026-03-28", standards: ["RFC 1035", "RFC 4033 DNSSEC"],                                                 risk: "low",    has_pricing: false },
  bgp_peering:             { last_validated: "2026-03-28", standards: ["RFC 4271 BGP-4", "RFC 4456 RR"],                                               risk: "low",    has_pricing: false },

  // ── Physical & cyber security ────────────────────────────────────────────
  physical_security:       { last_validated: "2026-03-28", standards: ["Uptime Institute M&O Stamp 2022", "ANSI/ASIS PSC.1"],                          risk: "high",   has_pricing: true  },
  biometric_design:        { last_validated: "2026-03-28", standards: ["NIST SP 800-76-2", "ISO/IEC 19794"],                                           risk: "low",    has_pricing: false },
  surveillance_coverage:   { last_validated: "2026-03-28", standards: ["NDAA §889", "IEC 62676-4"],                                                    risk: "medium", has_pricing: true  },
  cybersecurity_controls:  { last_validated: "2026-03-28", standards: ["NIST CSF 2.0", "PCI DSS 4.0", "ISO 27001:2022", "FedRAMP Rev 5"],             risk: "medium", has_pricing: false },
  compliance_checker:      { last_validated: "2026-03-28", standards: ["SOC 2 TSC 2017", "ISO 27001:2022", "NIST CSF 2.0", "PCI DSS 4.0"],            risk: "medium", has_pricing: false },

  // ── HVAC / Cooling ─────────────────────────────────────────────────────
  chiller_sizing:          { last_validated: "2026-03-28", standards: ["ASHRAE 90.1:2022", "ASHRAE TC 9.9:2021"],                                      risk: "medium", has_pricing: true  },
  crac_vs_crah:            { last_validated: "2026-03-28", standards: ["ASHRAE TC 9.9:2021", "ASHRAE 90.1:2022"],                                      risk: "medium", has_pricing: true  },
  airflow_modeling:        { last_validated: "2026-03-28", standards: ["ASHRAE TC 9.9:2021"],                                                          risk: "low",    has_pricing: false },
  humidification:          { last_validated: "2026-03-28", standards: ["ASHRAE TC 9.9:2021 Envelope A1"],                                              risk: "low",    has_pricing: false },
  economizer_analysis:     { last_validated: "2026-03-28", standards: ["ASHRAE 90.1:2022 §6.5.1"],                                                    risk: "medium", has_pricing: false },

  // ── Construction & operations ─────────────────────────────────────────
  construction_timeline:   { last_validated: "2026-03-28", standards: ["IBC 2021", "NFPA 1:2021"],                                                     risk: "medium", has_pricing: false },
  commissioning_plan:      { last_validated: "2026-03-28", standards: ["ASHRAE Guideline 1.2:2019", "Uptime Institute ATD"],                           risk: "medium", has_pricing: true  },
  maintenance_schedule:    { last_validated: "2026-03-28", standards: ["NFPA 110:2022 Ch.8", "IEEE 1188:2005"],                                        risk: "low",    has_pricing: true  },
  capacity_planning:       { last_validated: "2026-03-28", standards: [],                                                                              risk: "low",    has_pricing: false },
  sla_calculator:          { last_validated: "2026-03-28", standards: ["Uptime Institute Tier Standard 2022"],                                         risk: "low",    has_pricing: false },
  change_management:       { last_validated: "2026-03-28", standards: ["ITIL 4", "Uptime Institute M&O Stamp"],                                        risk: "low",    has_pricing: false },

  // ── Sustainability & energy ───────────────────────────────────────────
  carbon_footprint:        { last_validated: "2026-03-28", standards: ["EPA eGRID 2022", "GHG Protocol Scope 2:2015"],                                 risk: "high",   has_pricing: false },
  solar_feasibility:       { last_validated: "2026-03-28", standards: ["IRA 2022 §48E ITC", "IEC 61853-1"],                                           risk: "high",   has_pricing: true  },
  battery_storage:         { last_validated: "2026-03-28", standards: ["UL 9540:2023", "NFPA 855:2023", "IEC 62619:2022"],                            risk: "high",   has_pricing: true  },
  energy_procurement:      { last_validated: "2026-03-28", standards: ["FERC Order 2023", "RE100 standard"],                                           risk: "high",   has_pricing: true  },

  // ── Premium / compliance ──────────────────────────────────────────────
  tier_certification_checker: { last_validated: "2026-03-28", standards: ["Uptime Institute Tier Standard 2022", "ANSI/TIA-942-B:2017"],               risk: "medium", has_pricing: false },
  nc_utility_interconnect:    { last_validated: "2026-03-28", standards: ["NCUC Docket E-2 Sub 1142", "IEEE 1547:2018", "FERC Order 2023"],            risk: "high",   has_pricing: true  },
};

const PRICING_NOTE =
  "Cost estimates based on 2026 Q1 market data. Verify current pricing before procurement.";

// ─── toCanonical ─────────────────────────────────────────────────────────────

export function toCanonical(
  agentId: string,
  result: unknown,
  meta: {
    version: string;
    credits: number;
    taskId:  string;
  },
  error?: { code: string; message: string }
): CanonicalResponse {
  const reg = AGENT_METADATA[agentId];

  const freshness: DataFreshness = reg
    ? {
        last_validated: reg.last_validated,
        standards_refs: reg.standards,
        stale_risk:     reg.risk,
        ...(reg.has_pricing && { pricing_note: PRICING_NOTE }),
      }
    : {
        last_validated: new Date().toISOString().slice(0, 10),
        standards_refs: [],
        stale_risk:     "low",
      };

  const resp: CanonicalResponse = {
    agent_id:         agentId,
    agent_version:    meta.version,
    protocol_version: "1.0",
    status:           error ? "error" : "success",
    result:           error ? null : result,
    data_freshness:   freshness,
    a2a: {
      task_id:           meta.taskId,
      input_tokens_used: 0,
      credits_consumed:  meta.credits,
      callable_by:       ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"],
    },
  };

  if (error) {
    resp.error_code    = error.code;
    resp.error_message = error.message;
  }

  return resp;
}
