// ─── Knowledge Staleness Registry ────────────────────────────────────────────
// Single source of truth for every agent's data-freshness metadata.
//
// Update validated_at whenever agent logic or reference data is re-audited.
// See VALIDATION_CHECKLIST.md for per-agent cadence (monthly / quarterly / annually).

export interface AgentStaleness {
  validated_at:            string;                      // ISO date of last logic audit
  standards_ref:           string[];                    // authoritative sources used
  stale_risk:              "low" | "medium" | "high";  // data volatility classification
  has_pricing:             boolean;                     // true → pricing_note injected
  // Mythos methodology extensions (optional)
  refresh_interval_hours?: number;    // recommended re-scan cadence
  data_sources?:           string[];  // input data sources (Mythos agents)
  notes?:                  string;    // human-readable staleness guidance
}

export const STALENESS: Record<string, AgentStaleness> = {
  // ── Security ───────────────────────────────────────────────────────────────
  subdomain_discovery:        { validated_at: "2026-03-28", standards_ref: [],                                                                               stale_risk: "low",    has_pricing: false },
  asset_discovery:            { validated_at: "2026-03-28", standards_ref: [],                                                                               stale_risk: "low",    has_pricing: false },
  vulnerability_assessment:   { validated_at: "2026-03-28", standards_ref: ["CVE/NVD"],                                                                      stale_risk: "low",    has_pricing: false },

  // ── Power infrastructure ──────────────────────────────────────────────────
  generator_sizing:           { validated_at: "2026-03-28", standards_ref: ["NFPA 110:2022", "IEEE 446:1987"],                                               stale_risk: "medium", has_pricing: true  },
  utility_interconnect:       { validated_at: "2026-03-28", standards_ref: ["FERC Order 2023", "IEEE 1547:2018"],                                            stale_risk: "high",   has_pricing: true  },
  pue_calculator:             { validated_at: "2026-03-28", standards_ref: ["Green Grid PUE v2", "ISO/IEC 30134-2"],                                         stale_risk: "low",    has_pricing: false },
  construction_cost:          { validated_at: "2026-03-28", standards_ref: ["JLL DC Outlook 2024", "Turner & Townsend GDCCI 2023", "RS Means CCI 2024"],     stale_risk: "high",   has_pricing: true  },
  nfpa_110_checker:           { validated_at: "2026-03-28", standards_ref: ["NFPA 110:2022"],                                                                stale_risk: "medium", has_pricing: false },
  ats_sizing:                 { validated_at: "2026-03-28", standards_ref: ["NEC 2023 Art.700", "NEC 2023 Art.701", "NEC 2023 Art.702"],                     stale_risk: "medium", has_pricing: true  },
  ups_sizing:                 { validated_at: "2026-03-28", standards_ref: ["IEEE 485:2010", "IEEE 1184:2006"],                                              stale_risk: "medium", has_pricing: true  },
  fuel_storage:               { validated_at: "2026-03-28", standards_ref: ["NFPA 30:2021", "EPA SPCC 40 CFR 112"],                                         stale_risk: "medium", has_pricing: true  },
  cooling_load:               { validated_at: "2026-03-28", standards_ref: ["ASHRAE TC 9.9:2021"],                                                           stale_risk: "low",    has_pricing: false },
  power_density:              { validated_at: "2026-03-28", standards_ref: ["NEC 2023 Art.645"],                                                             stale_risk: "medium", has_pricing: false },
  redundancy_validator:       { validated_at: "2026-03-28", standards_ref: ["Uptime Institute Tier Standard 2022"],                                          stale_risk: "medium", has_pricing: false },
  harmonic_analysis:          { validated_at: "2026-03-28", standards_ref: ["IEEE 519:2022"],                                                                stale_risk: "low",    has_pricing: false },
  voltage_drop:               { validated_at: "2026-03-28", standards_ref: ["NEC 2023 Art.210.19", "NEC 2023 Art.647"],                                     stale_risk: "low",    has_pricing: false },

  // ── Demand, environment & site ────────────────────────────────────────────
  demand_response:            { validated_at: "2026-03-28", standards_ref: ["FERC Order 745", "PJM DR Tariff"],                                             stale_risk: "high",   has_pricing: true  },
  environmental_impact:       { validated_at: "2026-03-28", standards_ref: ["EPA AP-42 §3.4", "40 CFR Part 60 NSPS"],                                       stale_risk: "medium", has_pricing: false },
  fire_suppression:           { validated_at: "2026-03-28", standards_ref: ["NFPA 2001:2022", "NFPA 75:2020"],                                              stale_risk: "medium", has_pricing: true  },
  incentive_finder:           { validated_at: "2026-03-28", standards_ref: ["IRA 2022 §48E", "26 USC 48C"],                                                 stale_risk: "high",   has_pricing: true  },
  noise_compliance:           { validated_at: "2026-03-28", standards_ref: ["ISO 9613-2", "ANSI S12.18"],                                                   stale_risk: "low",    has_pricing: false },
  permit_timeline:            { validated_at: "2026-03-28", standards_ref: ["IBC 2021", "IFC 2021"],                                                        stale_risk: "medium", has_pricing: false },
  roi_calculator:             { validated_at: "2026-03-28", standards_ref: ["DCF methodology"],                                                             stale_risk: "high",   has_pricing: true  },
  tco_analyzer:               { validated_at: "2026-03-28", standards_ref: ["Green Grid TCO methodology"],                                                  stale_risk: "high",   has_pricing: true  },
  fiber_connectivity:         { validated_at: "2026-03-28", standards_ref: ["Ethernet Alliance 400GbE"],                                                    stale_risk: "high",   has_pricing: true  },
  site_scoring:               { validated_at: "2026-03-28", standards_ref: [],                                                                              stale_risk: "low",    has_pricing: false },
  water_availability:         { validated_at: "2026-03-28", standards_ref: ["EPA WaterSense", "ASHRAE 90.1:2022"],                                          stale_risk: "medium", has_pricing: false },

  // ── Network ───────────────────────────────────────────────────────────────
  network_topology:           { validated_at: "2026-03-28", standards_ref: ["IEEE 802.1Q:2022", "RFC 7938"],                                                stale_risk: "low",    has_pricing: false },
  bandwidth_sizing:           { validated_at: "2026-03-28", standards_ref: ["IEEE 802.3bs:2017"],                                                           stale_risk: "low",    has_pricing: false },
  latency_calculator:         { validated_at: "2026-03-28", standards_ref: ["ITU-T G.826"],                                                                 stale_risk: "low",    has_pricing: false },
  ip_addressing:              { validated_at: "2026-03-28", standards_ref: ["RFC 1918", "RFC 4291"],                                                        stale_risk: "low",    has_pricing: false },
  dns_architecture:           { validated_at: "2026-03-28", standards_ref: ["RFC 1035", "RFC 4033 DNSSEC"],                                                 stale_risk: "low",    has_pricing: false },
  bgp_peering:                { validated_at: "2026-03-28", standards_ref: ["RFC 4271 BGP-4", "RFC 4456 RR"],                                               stale_risk: "low",    has_pricing: false },

  // ── Physical & cyber security ─────────────────────────────────────────────
  physical_security:          { validated_at: "2026-03-28", standards_ref: ["Uptime Institute M&O Stamp 2022", "ANSI/ASIS PSC.1"],                          stale_risk: "high",   has_pricing: true  },
  biometric_design:           { validated_at: "2026-03-28", standards_ref: ["NIST SP 800-76-2", "ISO/IEC 19794"],                                           stale_risk: "low",    has_pricing: false },
  surveillance_coverage:      { validated_at: "2026-03-28", standards_ref: ["NDAA §889", "IEC 62676-4"],                                                    stale_risk: "medium", has_pricing: true  },
  cybersecurity_controls:     { validated_at: "2026-03-28", standards_ref: ["NIST CSF 2.0", "PCI DSS 4.0", "ISO 27001:2022", "FedRAMP Rev 5"],             stale_risk: "medium", has_pricing: false },
  compliance_checker:         { validated_at: "2026-03-28", standards_ref: ["SOC 2 TSC 2017", "ISO 27001:2022", "NIST CSF 2.0", "PCI DSS 4.0"],            stale_risk: "medium", has_pricing: false },

  // ── HVAC / Cooling ────────────────────────────────────────────────────────
  chiller_sizing:             { validated_at: "2026-03-28", standards_ref: ["ASHRAE 90.1:2022", "ASHRAE TC 9.9:2021"],                                      stale_risk: "medium", has_pricing: true  },
  crac_vs_crah:               { validated_at: "2026-03-28", standards_ref: ["ASHRAE TC 9.9:2021", "ASHRAE 90.1:2022"],                                      stale_risk: "medium", has_pricing: true  },
  airflow_modeling:           { validated_at: "2026-03-28", standards_ref: ["ASHRAE TC 9.9:2021"],                                                          stale_risk: "low",    has_pricing: false },
  humidification:             { validated_at: "2026-03-28", standards_ref: ["ASHRAE TC 9.9:2021 Envelope A1"],                                              stale_risk: "low",    has_pricing: false },
  economizer_analysis:        { validated_at: "2026-03-28", standards_ref: ["ASHRAE 90.1:2022 §6.5.1"],                                                    stale_risk: "medium", has_pricing: false },

  // ── Construction & operations ─────────────────────────────────────────────
  construction_timeline:      { validated_at: "2026-03-28", standards_ref: ["IBC 2021", "NFPA 1:2021"],                                                     stale_risk: "medium", has_pricing: false },
  commissioning_plan:         { validated_at: "2026-03-28", standards_ref: ["ASHRAE Guideline 1.2:2019", "Uptime Institute ATD"],                           stale_risk: "medium", has_pricing: true  },
  maintenance_schedule:       { validated_at: "2026-03-28", standards_ref: ["NFPA 110:2022 Ch.8", "IEEE 1188:2005"],                                        stale_risk: "low",    has_pricing: true  },
  capacity_planning:          { validated_at: "2026-03-28", standards_ref: [],                                                                              stale_risk: "low",    has_pricing: false },
  sla_calculator:             { validated_at: "2026-03-28", standards_ref: ["Uptime Institute Tier Standard 2022"],                                         stale_risk: "low",    has_pricing: false },
  change_management:          { validated_at: "2026-03-28", standards_ref: ["ITIL 4", "Uptime Institute M&O Stamp"],                                        stale_risk: "low",    has_pricing: false },

  // ── Sustainability & energy ───────────────────────────────────────────────
  carbon_footprint:           { validated_at: "2026-03-28", standards_ref: ["EPA eGRID 2022", "GHG Protocol Scope 2:2015"],                                 stale_risk: "high",   has_pricing: false },
  solar_feasibility:          { validated_at: "2026-03-28", standards_ref: ["IRA 2022 §48E ITC", "IEC 61853-1"],                                           stale_risk: "high",   has_pricing: true  },
  battery_storage:            { validated_at: "2026-03-28", standards_ref: ["UL 9540:2023", "NFPA 855:2023", "IEC 62619:2022"],                            stale_risk: "high",   has_pricing: true  },
  energy_procurement:         { validated_at: "2026-03-28", standards_ref: ["FERC Order 2023", "RE100 standard"],                                           stale_risk: "high",   has_pricing: true  },

  // ── Premium / compliance ──────────────────────────────────────────────────
  tier_certification_checker: { validated_at: "2026-03-28", standards_ref: ["Uptime Institute Tier Standard 2022", "ANSI/TIA-942-B:2017"],                  stale_risk: "medium", has_pricing: false },
  nc_utility_interconnect:    { validated_at: "2026-03-28", standards_ref: ["NCUC Docket E-2 Sub 1142", "IEEE 1547:2018", "FERC Order 2023"],               stale_risk: "high",   has_pricing: true  },

  // ── Grid & weather intelligence ───────────────────────────────────────────
  get_grid_telemetry:         { validated_at: "2026-04-07", standards_ref: ["EIA Form 930", "NERC BAL-004-2"],                                              stale_risk: "high",   has_pricing: false },
  get_active_weather_alerts:  { validated_at: "2026-04-07", standards_ref: ["NWS CAP 1.2", "FEMA IPAWS"],                                                  stale_risk: "high",   has_pricing: false },

  // ── Mythos security methodology ───────────────────────────────────────────
  "infrastructure-ranker":               { validated_at: "2026-04-08", standards_ref: [],                                                                   stale_risk: "low",    has_pricing: false, refresh_interval_hours: 720,  data_sources: ["site_input"],                                                 notes: "Component scoring is deterministic from input — refresh when site changes" },
  "parallel-scan-orchestrator":          { validated_at: "2026-04-08", standards_ref: [],                                                                   stale_risk: "medium", has_pricing: false, refresh_interval_hours: 168,  data_sources: ["config_vuln_hunter", "compliance_gap_detector"],             notes: "Findings may change as configs are updated — weekly refresh recommended" },
  "config-vuln-hunter":                  { validated_at: "2026-04-08", standards_ref: ["NFPA 110:2022", "EPA RICE NESHAP 40 CFR 63 ZZZZ"],                 stale_risk: "high",   has_pricing: false, refresh_interval_hours: 168,  data_sources: ["nfpa_110", "epa_rice_neshap", "tier_standards", "site_config"], notes: "Standards update annually — rescan after any config change" },
  "compliance-gap-detector":             { validated_at: "2026-04-08", standards_ref: ["Uptime Institute Tier Standard 2022", "NFPA 110:2022", "NEC 2023"], stale_risk: "medium", has_pricing: false, refresh_interval_hours: 720,  data_sources: ["tier_standards", "nfpa_110", "nec", "site_documentation"],   notes: "Refresh after any infrastructure change or standard revision" },
  "failure-chain-analyst":               { validated_at: "2026-04-08", standards_ref: [],                                                                   stale_risk: "high",   has_pricing: false, refresh_interval_hours: 168,  data_sources: ["findings_input"],                                             notes: "Chains depend on current finding set — rerun after any new findings" },
  "impact-poc-generator":                { validated_at: "2026-04-08", standards_ref: [],                                                                   stale_risk: "low",    has_pricing: false, refresh_interval_hours: 720,  data_sources: ["finding_input", "site_context"],                             notes: "PoC is deterministic from finding — refresh if site context changes" },
  "finding-validation":                  { validated_at: "2026-04-08", standards_ref: [],                                                                   stale_risk: "medium", has_pricing: false, refresh_interval_hours: 168,  data_sources: ["findings_input"],                                             notes: "Rerun validation after any new findings are added to the set" },
  "ics-scada-cve-intelligence":          { validated_at: "2026-04-08", standards_ref: ["NVD/CVE", "ICS-CERT", "CISA KEV"],                                  stale_risk: "high",   has_pricing: false, refresh_interval_hours: 72,   data_sources: ["nvd_cve_database", "ics_cert", "manufacturer_advisories"],   notes: "CVE landscape changes frequently — refresh every 72 hours minimum" },
  "responsible-disclosure-coordinator":  { validated_at: "2026-04-08", standards_ref: [],                                                                   stale_risk: "high",   has_pricing: false, refresh_interval_hours: 24,   data_sources: ["findings_input", "disclosure_timeline"],                     notes: "Disclosure deadlines are time-sensitive — check daily" },
};
