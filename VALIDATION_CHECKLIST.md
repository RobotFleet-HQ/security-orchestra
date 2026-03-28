# Security Orchestra — Knowledge Staleness Validation Checklist

All 51 workflows were audited on **2026-03-28** (version 1.0).
Use this checklist to keep agent knowledge current. Update `last_validated` in `WORKFLOWS` and re-validate Python agent hardcoded data after each check.

---

## HIGH RISK — Check Monthly
*Pricing, utility rates, carbon factors — changes with market conditions*

| Workflow | Standards / Data Sources | What to verify |
|---|---|---|
| `construction_cost` | JLL Data Center Outlook, Turner & Townsend GDCCI, RS Means City Cost Index | $/kW construction cost ranges, regional multipliers |
| `carbon_footprint` | EPA eGRID, GHG Protocol Scope 2 | EPA eGRID emission factors by grid region (new release ~Q1 each year) |
| `nc_utility_interconnect` | NCUC Docket E-2 Sub 1142, IEEE 1547-2018, FERC Order 2023 | Interconnection queue fees, Duke/Dominion tariff updates |
| `nc_energy_rate_optimizer` | Duke Energy NC tariff, Dominion Energy NC tariff | Demand charge rates, TOU windows, rider schedules |
| `renewable_energy_credits` | M-RETS, NC REPS | REC pricing by technology and vintage |
| `energy_procurement_strategy` | EIA Short-Term Energy Outlook | Electricity forward prices, natural gas indices |
| `demand_response_optimizer` | PJM DR programs, SERC DR programs | Program availability, payment rates per kW-year |
| `battery_storage_optimizer` | BNEF Battery Price Survey | $/kWh installed cost; ITC adder eligibility |
| `solar_generation_model` | NREL PVWatts | No code change needed — API-driven; verify API key validity |
| `power_purchase_agreement` | FERC, NC Utilities Commission | Standard contract terms, avoided-cost rates |
| `operating_cost_model` | EIA electricity prices, BLS PPI | $/kWh opex ranges, labor cost indices |
| `financial_model` | IRS MACRS, Section 48C, Bonus Depreciation | Tax credit percentages, depreciation schedules |
| `incentive_optimizer` | IRA incentives, NC state incentives | Federal/state grant amounts, eligibility windows |
| `site_acquisition_cost` | CoStar, local assessor data | Land $/acre by region and zoning class |
| `water_usage_optimizer` | Local utility rate cards | Water cost $/gallon, discharge surcharge rates |
| `cooling_system_optimizer` | ASHRAE, local wet-bulb data | ASHRAE climate design data updates (annual) |

---

## MEDIUM RISK — Check Quarterly
*Building codes, regulatory standards — updated on predictable cycles*

| Workflow | Standards / Data Sources | What to verify |
|---|---|---|
| `nfpa_110_checker` | NFPA 110-2022 | Check for new edition or tentative interim amendments |
| `tier_certification_checker` | Uptime Institute Tier Standard 2022, ANSI/TIA-942-B-2017 | New Tier Standard edition; TIA-942-C publication status |
| `building_code_compliance` | IBC 2021, NC State Building Code | NC adoption of next IBC cycle; local amendments |
| `ashrae_90_4_checker` | ASHRAE 90.4-2019 | New edition; IECC adoption status |
| `fire_suppression_checker` | NFPA 2001, NFPA 13-2022 | Edition changes; AHJ amendments |
| `electrical_compliance` | NEC 2023, NFPA 70E-2021 | State NEC adoption cycle (NC is on 2020 NEC) |
| `environmental_compliance` | EPA NPDES, NC DEQ | Stormwater permit thresholds, spill reporting rules |
| `hazmat_compliance` | OSHA PSM, EPA RMP | Threshold quantities, reporting timelines |
| `seismic_risk_assessment` | ASCE 7-22, USGS Seismic Hazard Maps | USGS hazard map updates; ASCE 7 edition adoption |
| `wind_load_calculator` | ASCE 7-22, ASCE 7-16 | NC wind speed map updates; code adoption cycle |
| `accessibility_compliance` | ADA 2010 Standards, NC Accessibility Code | DOJ ADA updates; NC amendments |
| `zoning_compliance_checker` | Local zoning ordinances | Charlotte/Raleigh UDO amendments (check quarterly) |
| `permit_timeline_estimator` | Local AHJ data | Charlotte/Raleigh permitting fee schedules and timelines |
| `contractor_qualification` | NC contractor license board | License category requirements; bond/insurance minimums |
| `equipment_lead_time_tracker` | Internal sourcing data | Transformer, switchgear, UPS lead times (volatile) |
| `grid_stability_analyzer` | NERC reliability standards | NERC standard updates; PJM/SERC rule changes |
| `substation_design_checker` | IEEE C57, NERC FAC-001 | IEEE C57 transformer standard revisions |
| `generator_sizing_calculator` | NFPA 110-2022, IEEE 446 | Code edition updates; fuel type efficiency factors |
| `ups_sizing_calculator` | IEEE 1184, IEC 62040 | Standard revision cycle |
| `power_distribution_design` | NEC 2023, IEEE 3001 | NEC adoption; IEEE 3001 data center power series updates |
| `cooling_load_calculator` | ASHRAE 55, ASHRAE 62.1 | ASHRAE annual edition updates |
| `server_room_design` | ASHRAE TC 9.9, TIA-942 | New ASHRAE TC 9.9 white paper releases (annual) |
| `network_infrastructure_design` | TIA-568, IEEE 802.3 | TIA-568-C.2 revision; 802.3 amendment ratification |
| `security_system_design` | NFPA 731, UL 2050 | Edition changes; NC private security licensing updates |
| `staffing_model` | BLS Occupational Handbook | BLS SOC code updates; regional wage surveys |
| `maintenance_schedule_optimizer` | OEM documentation, NFPA 110 | OEM service bulletin changes; NFPA 110 testing intervals |

---

## LOW RISK — Check Annually
*Physics-based calculations, math, engineering fundamentals — rarely changes*

| Workflow | Standards / Data Sources | What to verify |
|---|---|---|
| `pue_calculator` | The Green Grid PUE definition | Confirm Green Grid hasn't revised PUE methodology |
| `cable_sizing_calculator` | NEC 310, IEEE 835 | NEC adoption cycle; ampacity table updates |
| `voltage_drop_calculator` | NEC 647, IEEE 141 | NEC adoption cycle |
| `load_flow_analysis` | IEEE 399 | Standard revision cycle |
| `harmonic_distortion_analyzer` | IEEE 519-2022 | Next IEEE 519 revision cycle |
| `grounding_system_design` | IEEE 80, NEC Article 250 | IEEE 80 revision (last 2013 — check for new edition) |
| `lightning_protection_design` | NFPA 780, IEC 62305 | NFPA 780 edition cycle |
| `thermal_modeling` | ASHRAE HoF, CIBSE TM55 | Fundamental physics — verify only if ASHRAE updates coefficients |
| `structural_load_calculator` | ASCE 7-22, ACI 318 | Major code cycle changes only |
| `subdomain_discovery` | Internal / nmap | Tool version updates; technique currency |
| `asset_discovery` | Internal | No external standards |
| `vulnerability_assessment` | CVE / NVD | NVD API key validity; ensure CVE feed is current |
| `network_scan` | Internal / nmap | nmap version; NSE script updates |
| `port_scan` | Internal / nmap | nmap version |
| `ssl_checker` | Mozilla SSL Configuration Generator | Mozilla recommended cipher suite updates (annual) |
| `dns_lookup` | IANA, RFC standards | No expiry |
| `whois_lookup` | IANA RDAP | No expiry |
| `http_headers_checker` | OWASP Secure Headers | OWASP recommendations update cycle |
| `subdomain_takeover_checker` | Can-I-Take-Over-XYZ list | Fingerprint list updates (check quarterly in practice) |

---

## How to Re-validate

1. Open the relevant Python agent file in `orchestrator/agents/`
2. Search for hardcoded numeric values (rates, costs, factors)
3. Cross-reference against the listed standards/sources
4. Update values if stale
5. Update `last_validated` field in the matching `WORKFLOWS` entry in `orchestrator/src/index.ts`
6. Bump `version` field (e.g., `"1.0"` → `"1.1"`)
7. Commit with message: `"chore: re-validate <workflow> against <source> <date>"`

---

*Last full audit: 2026-03-28*
