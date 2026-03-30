# Security Orchestra — Agent Validation Checklist

**Last full audit:** 2026-03-28 · **Agent count:** 50+ specialized agents + 8 compound chains

Risk classifications and standards refs are the authoritative source in
`orchestrator/src/staleness.ts → STALENESS`. This checklist is
generated from that registry — update both together.

---

## All 50+ Agents — Stale Risk Quick Reference

| Agent | stale_risk | validated_at | pricing |
|---|---|---|---|
| `subdomain_discovery` | low | 2026-03-28 | — |
| `asset_discovery` | low | 2026-03-28 | — |
| `vulnerability_assessment` | low | 2026-03-28 | — |
| `generator_sizing` | medium | 2026-03-28 | ✓ |
| `utility_interconnect` | **high** | 2026-03-28 | ✓ |
| `pue_calculator` | low | 2026-03-28 | — |
| `construction_cost` | **high** | 2026-03-28 | ✓ |
| `nfpa_110_checker` | medium | 2026-03-28 | — |
| `ats_sizing` | medium | 2026-03-28 | ✓ |
| `ups_sizing` | medium | 2026-03-28 | ✓ |
| `fuel_storage` | medium | 2026-03-28 | ✓ |
| `cooling_load` | low | 2026-03-28 | — |
| `power_density` | medium | 2026-03-28 | — |
| `redundancy_validator` | medium | 2026-03-28 | — |
| `harmonic_analysis` | low | 2026-03-28 | — |
| `voltage_drop` | low | 2026-03-28 | — |
| `demand_response` | **high** | 2026-03-28 | ✓ |
| `environmental_impact` | medium | 2026-03-28 | — |
| `fire_suppression` | medium | 2026-03-28 | ✓ |
| `incentive_finder` | **high** | 2026-03-28 | ✓ |
| `noise_compliance` | low | 2026-03-28 | — |
| `permit_timeline` | medium | 2026-03-28 | — |
| `roi_calculator` | **high** | 2026-03-28 | ✓ |
| `tco_analyzer` | **high** | 2026-03-28 | ✓ |
| `fiber_connectivity` | **high** | 2026-03-28 | ✓ |
| `site_scoring` | low | 2026-03-28 | — |
| `water_availability` | medium | 2026-03-28 | — |
| `network_topology` | low | 2026-03-28 | — |
| `bandwidth_sizing` | low | 2026-03-28 | — |
| `latency_calculator` | low | 2026-03-28 | — |
| `ip_addressing` | low | 2026-03-28 | — |
| `dns_architecture` | low | 2026-03-28 | — |
| `bgp_peering` | low | 2026-03-28 | — |
| `physical_security` | **high** | 2026-03-28 | ✓ |
| `biometric_design` | low | 2026-03-28 | — |
| `surveillance_coverage` | medium | 2026-03-28 | ✓ |
| `cybersecurity_controls` | medium | 2026-03-28 | — |
| `compliance_checker` | medium | 2026-03-28 | — |
| `chiller_sizing` | medium | 2026-03-28 | ✓ |
| `crac_vs_crah` | medium | 2026-03-28 | ✓ |
| `airflow_modeling` | low | 2026-03-28 | — |
| `humidification` | low | 2026-03-28 | — |
| `economizer_analysis` | medium | 2026-03-28 | — |
| `construction_timeline` | medium | 2026-03-28 | — |
| `commissioning_plan` | medium | 2026-03-28 | ✓ |
| `maintenance_schedule` | low | 2026-03-28 | ✓ |
| `capacity_planning` | low | 2026-03-28 | — |
| `sla_calculator` | low | 2026-03-28 | — |
| `change_management` | low | 2026-03-28 | — |
| `carbon_footprint` | **high** | 2026-03-28 | — |
| `solar_feasibility` | **high** | 2026-03-28 | ✓ |
| `battery_storage` | **high** | 2026-03-28 | ✓ |
| `energy_procurement` | **high** | 2026-03-28 | ✓ |
| `tier_certification_checker` | medium | 2026-03-28 | — |
| `nc_utility_interconnect` | **high** | 2026-03-28 | ✓ |

**Summary:** 13 high · 20 medium · 22 low — 27 agents emit `pricing_note`

*Source of truth: `orchestrator/src/staleness.ts`. Update `validated_at` there after each re-audit.*

---

## Validation Schedule

| Risk tier | Trigger | Rationale |
|---|---|---|
| **High** | Monthly | Market pricing, utility tariffs, tax law — can change any quarter |
| **Medium** | Quarterly | Standards codes on 3–5 year cycles; amendments published mid-cycle |
| **Low** | Annually | Physics / math fundamentals; protocol RFCs rarely change |

---

## High-Risk Agents — Validate Monthly

*Pricing, utility rates, incentive percentages, carbon factors — tied to market and regulatory cycles.*

### Power & Utilities

- [ ] **`utility_interconnect`** — FERC Order 2023, IEEE 1547:2018
  - Verify deposit $/kW ranges and timeline estimates per utility
  - Check FERC interconnection queue reform updates
  - Confirm IEEE 1547 amendment status

- [ ] **`nc_utility_interconnect`** — NCUC Docket E-2 Sub 1142, IEEE 1547:2018, FERC Order 2023
  - Duke Energy Progress / Duke Energy Carolinas / Dominion NC tariff schedules
  - Verify NCUC docket for new orders or fee schedule changes
  - Confirm interconnect application fees and study deposit amounts

- [ ] **`construction_cost`** — JLL DC Outlook 2024, Turner & Townsend GDCCI 2023, RS Means CCI 2024
  - $/MW shell, electrical, mechanical, and IT infrastructure cost ranges
  - Regional cost multipliers by US metro
  - Verify annual report releases (JLL typically Q1, T&T typically Q2)

- [ ] **`demand_response`** — FERC Order 745, PJM DR Tariff
  - PJM / SERC demand response payment rates ($/MW-day)
  - Program availability windows and notice requirements
  - Verify curtailment capacity calculation methodology

### Finance & Incentives

- [ ] **`roi_calculator`** — DCF methodology
  - Verify default discount rate assumptions remain market-reasonable
  - Check that construction cost inputs align with `construction_cost` agent

- [ ] **`tco_analyzer`** — Green Grid TCO methodology
  - Confirm power rate $/kWh defaults reflect current US averages
  - Verify labor cost annual defaults (BLS Occupational Handbook)
  - Check hardware refresh cost assumptions

- [ ] **`incentive_finder`** — IRA 2022 §48E, 26 USC 48C
  - ITC / PTC percentage — IRS may phase down or extend
  - State-level grant program availability and caps
  - Verify qualifying technology lists have not changed

- [ ] **`fiber_connectivity`** — Ethernet Alliance 400GbE
  - Dark fiber lease rate estimates by market
  - Carrier availability per city — major provider exits or entries
  - 400GbE vs 800GbE transition milestones

### Physical Security

- [ ] **`physical_security`** — Uptime Institute M&O Stamp 2022, ANSI/ASIS PSC.1
  - Guard staffing rates $/hour by region
  - Verify Uptime M&O Stamp criteria version
  - Check ANSI/ASIS PSC.1 reaffirmation or revision status

### Sustainability & Energy

- [ ] **`carbon_footprint`** — EPA eGRID 2022, GHG Protocol Scope 2:2015
  - EPA eGRID emission factors update annually (~Q1) — update grid region lb CO₂/kWh values
  - Confirm GHG Protocol Scope 2 guidance version (market-based vs location-based)

- [ ] **`solar_feasibility`** — IRA 2022 §48E ITC, IEC 61853-1
  - ITC percentage (30% base through 2032 — check for adder eligibility changes)
  - Bonus adder rules (energy community, domestic content) may update quarterly
  - Verify NREL irradiance data vintage used in calculations

- [ ] **`battery_storage`** — UL 9540:2023, NFPA 855:2023, IEC 62619:2022
  - $/kWh installed cost (BNEF BESS price index — check quarterly)
  - ITC adder eligibility for standalone storage (IRS Notice updates)
  - Verify UL 9540 and NFPA 855 amendment status

- [ ] **`energy_procurement`** — FERC Order 2023, RE100 standard
  - Utility green tariff availability by state
  - PPA pricing $/MWh by technology and region
  - RE100 matching criteria updates

---

## Medium-Risk Agents — Validate Quarterly

*Building codes, engineering standards, regulatory rules — updated on predictable 3–5 year cycles with mid-cycle amendments.*

### Emergency Power

- [ ] **`generator_sizing`** — NFPA 110:2022, IEEE 446:1987
  - Confirm current NFPA 110 edition; watch for tentative interim amendments
  - Verify IEEE 446 reaffirmation status (last revised 1987)
  - Check genset derating factor tables for altitude/temperature

- [ ] **`nfpa_110_checker`** — NFPA 110:2022
  - Check NFPA 110 TIAs (tentative interim amendments) since 2022 edition
  - Verify Level 1 vs Level 2 runtime hour requirements still 96h / 8h
  - Confirm ATS transfer time limits (10s Level 1, 60s Level 2)

- [ ] **`ats_sizing`** — NEC 2023 Art.700, Art.701, Art.702
  - Verify NC state NEC adoption cycle (check NCDOI — NC historically lags 1 cycle)
  - Confirm 125% continuous load factor still required
  - Check standard ATS ampere rating table for new catalog entries

- [ ] **`ups_sizing`** — IEEE 485:2010, IEEE 1184:2006
  - Check IEEE 485 revision status (last revised 2010)
  - Check IEEE 1184 revision status (last revised 2006 — overdue)
  - Verify Li-ion vs VRLA cost crossover assumptions

- [ ] **`fuel_storage`** — NFPA 30:2021, EPA SPCC 40 CFR 112
  - Confirm NFPA 30 2021 edition is current; watch for 2024 cycle
  - Verify EPA SPCC aggregate aboveground threshold (currently 1,320 gal)
  - Check secondary containment sizing formula (110% largest tank)

- [ ] **`redundancy_validator`** — Uptime Institute Tier Standard 2022
  - Verify Uptime Institute Tier Standard edition (watch for new version)
  - Check Tier III concurrent maintainability definition hasn't shifted
  - Confirm N, N+1, 2N, 2N+1 classification logic

- [ ] **`power_density`** — NEC 2023 Art.645
  - NC NEC adoption status (confirm which cycle is enforced)
  - Article 645 ITE room definition and PDU branch circuit rules

### Environmental & Site

- [ ] **`environmental_impact`** — EPA AP-42 §3.4, 40 CFR Part 60 NSPS
  - EPA AP-42 Section 3.4 emission factor updates for diesel reciprocating engines
  - 40 CFR Part 60 Subpart IIII/JJJJ NSPS tier requirements
  - State-specific air permit threshold changes (check target state DEQ)

- [ ] **`fire_suppression`** — NFPA 2001:2022, NFPA 75:2020
  - NFPA 2001 agent flooding factor tables (FM-200, Novec 1230, CO₂)
  - NFPA 75 IT equipment protection scope
  - Confirm Novec 1230 / FM-200 phase-down status under EPA SNAP

- [ ] **`permit_timeline`** — IBC 2021, IFC 2021
  - Charlotte/Raleigh local plan review time SLA updates
  - NC State Building Code adoption cycle (check for IBC 2024 adoption)
  - Data center-specific fast-track permit program availability

- [ ] **`water_availability`** — EPA WaterSense, ASHRAE 90.1:2022
  - Regional water stress index updates (WRI Aqueduct — annual)
  - ASHRAE 90.1 Section 6 cooling tower blowdown requirements

- [ ] **`construction_timeline`** — IBC 2021, NFPA 1:2021
  - Verify state-specific permitting modifier assumptions remain accurate
  - Check for changes to NC conditional use permit / special use permit timelines

### Security & Compliance

- [ ] **`surveillance_coverage`** — NDAA §889, IEC 62676-4
  - NDAA Section 889 prohibited vendor list updates (FCC publishes updates)
  - IEC 62676-4 video transmission standard revision status

- [ ] **`cybersecurity_controls`** — NIST CSF 2.0, PCI DSS 4.0, ISO 27001:2022, FedRAMP Rev 5
  - NIST CSF 2.0 profile updates or supplemental guidance
  - PCI DSS 4.0 required controls (v3.2.1 EOL was March 2024 — ensure v4 logic)
  - FedRAMP Rev 5 baselines — check for new control additions
  - ISO 27001:2022 Annex A control count (93 controls) still accurate

- [ ] **`compliance_checker`** — SOC 2 TSC 2017, ISO 27001:2022, NIST CSF 2.0, PCI DSS 4.0
  - AICPA Trust Services Criteria — check for 2024 update cycle
  - Verify control overlap mapping still reflects current framework versions

- [ ] **`tier_certification_checker`** — Uptime Institute Tier Standard 2022, ANSI/TIA-942-B:2017
  - Watch for Uptime Institute Tier Standard new edition
  - ANSI/TIA-942-C publication status (B was 2017 — C cycle may be active)
  - Verify concurrent maintainability and fault tolerance test criteria

### HVAC & Cooling

- [ ] **`chiller_sizing`** — ASHRAE 90.1:2022, ASHRAE TC 9.9:2021
  - ASHRAE 90.1 chiller efficiency (kW/ton) minimum requirement updates
  - ASHRAE TC 9.9 recommended operating envelope revisions
  - Refrigerant phase-down schedule (HFCs under AIM Act — check EPA timeline)

- [ ] **`crac_vs_crah`** — ASHRAE TC 9.9:2021, ASHRAE 90.1:2022
  - EER/COP comparison values — verify against current manufacturer catalog data
  - ASHRAE 90.1 CRAC efficiency minimums (check Section 6)

- [ ] **`economizer_analysis`** — ASHRAE 90.1:2022 §6.5.1
  - ASHRAE 90.1 Section 6.5.1 economizer control requirements
  - Climate bin hour data — verify source dataset vintage (TMY3 vs TMYx)

- [ ] **`commissioning_plan`** — ASHRAE Guideline 1.2:2019, Uptime Institute ATD
  - ASHRAE Guideline 1.2 revision cycle (2019 is current — watch for update)
  - Uptime ATD (Accredited Tier Designer) testing scope changes

---

## Low-Risk Agents — Validate Annually

*Physics-based calculations and engineering fundamentals — only change when underlying standards have major revisions.*

### Security Workflows

- [ ] **`subdomain_discovery`** — No external standards
  - Verify certificate transparency log sources still active (crt.sh, Google CT)
  - Check DNS brute-force wordlist vintage

- [ ] **`asset_discovery`** — No external standards
  - Confirm mock data is clearly labeled; no hardcoded production IPs

- [ ] **`vulnerability_assessment`** — CVE/NVD
  - Verify CVSS v3.1 scoring weights not superseded by CVSS v4
  - Check NVD API endpoint hasn't changed (NVD 2.0 API migration complete)

### Electrical Calculations

- [ ] **`pue_calculator`** — Green Grid PUE v2, ISO/IEC 30134-2
  - Confirm Green Grid PUE v2 definition unchanged
  - ISO/IEC 30134-2 partial PUE (pPUE) methodology

- [ ] **`cooling_load`** — ASHRAE TC 9.9:2021
  - Heat transfer coefficients and IT equipment power factor assumptions
  - CRAC/CRAH sensible heat ratio defaults

- [ ] **`harmonic_analysis`** — IEEE 519:2022
  - IEEE 519 current distortion limit tables (PCC voltage class)
  - Transformer K-factor derating formula

- [ ] **`voltage_drop`** — NEC 2023 Art.210.19, NEC 2023 Art.647
  - NEC recommended 3% / 5% drop limits still in advisory (not mandatory) column
  - Copper/aluminum resistivity constants unchanged

### Network Engineering

- [ ] **`network_topology`** — IEEE 802.1Q:2022, RFC 7938
  - RFC 7938 BGP in data center fabric — check for updating RFC
  - Spine/leaf port count assumptions vs current 400G/800G switch SKUs

- [ ] **`bandwidth_sizing`** — IEEE 802.3bs:2017
  - 800GbE (IEEE 802.3df) ratification status — may need upper tier adjustment
  - East-west traffic ratio assumption (currently 80/20 east-west)

- [ ] **`latency_calculator`** — ITU-T G.826
  - Speed-of-light in fiber constant (2×10⁸ m/s) — no change expected
  - Per-hop switching latency defaults vs current ASIC specs

- [ ] **`ip_addressing`** — RFC 1918, RFC 4291
  - RFC 6598 (100.64.0.0/10 shared address space) — consider adding as option
  - IPv6 /48 per-site allocation assumption vs RFC 6177

- [ ] **`dns_architecture`** — RFC 1035, RFC 4033 DNSSEC
  - DNSSEC algorithm recommendations — check IANA DNSSEC algorithm registry
  - Anycast node count assumptions vs current Cloudflare/AWS Route 53 topology

- [ ] **`bgp_peering`** — RFC 4271 BGP-4, RFC 4456 RR
  - Full table route count assumption (~950K IPv4 routes — grows ~50K/yr)
  - Memory per-route estimate vs current router platform specs

### Physical & Operations

- [ ] **`biometric_design`** — NIST SP 800-76-2, ISO/IEC 19794
  - NIST SP 800-76 revision status (check NIST CSRC)
  - FAR/FRR benchmark values vs current generation sensor specs

- [ ] **`airflow_modeling`** — ASHRAE TC 9.9:2021
  - CFM/kW airflow rule of thumb (currently ~100 CFM/kW for air-cooled)
  - Hot/cold aisle temperature delta defaults

- [ ] **`humidification`** — ASHRAE TC 9.9:2021 Envelope A1
  - ASHRAE A1 allowable humidity range (currently 20–80% RH)
  - Verify ASHRAE hasn't published a TC 9.9 update narrowing the envelope

- [ ] **`noise_compliance`** — ISO 9613-2, ANSI S12.18
  - Inverse-square law attenuation formula — no change expected
  - Verify typical local ordinance dB(A) limits in reference table are current

- [ ] **`site_scoring`** — No external standards
  - Scoring weight factors for power / connectivity / risk / cost dimensions
  - Confirm regional water stress index source is current

- [ ] **`maintenance_schedule`** — NFPA 110:2022 Ch.8, IEEE 1188:2005
  - NFPA 110 Chapter 8 generator test interval (monthly load test, annual full-load)
  - IEEE 1188 VRLA battery maintenance procedures — check revision status

- [ ] **`capacity_planning`** — No external standards
  - Logarithmic growth model coefficients — validate against observed industry growth rates

- [ ] **`sla_calculator`** — Uptime Institute Tier Standard 2022
  - Tier I–IV allowable downtime minutes/year values unchanged

- [ ] **`change_management`** — ITIL 4, Uptime Institute M&O Stamp
  - ITIL 4 change management practice guidance — check for AXELOS updates
  - Uptime M&O Stamp operational criteria revision

---

## Compound Chains — Validate When Member Agents Update

Each chain inherits risk from its highest-risk member. Re-test chain output after
any member agent is re-validated.

| Chain | Highest-risk member | Validate when |
|---|---|---|
| `full_power_analysis` | `roi_calculator` (high) | Monthly |
| `site_readiness` | `utility_interconnect` (high) | Monthly |
| `nc_power_package` | `nc_utility_interconnect` (high) | Monthly |
| `sustainability_package` | `energy_procurement` (high) | Monthly |
| `tco_deep_dive` | `tco_analyzer` (high) | Monthly |
| `full_site_analysis` | `construction_cost` (high) | Monthly |
| `emergency_power_package` | `ups_sizing` (medium) | Quarterly |
| `cooling_optimization` | `chiller_sizing` (medium) | Quarterly |

---

## Re-Validation Procedure

1. Open `orchestrator/src/canonical.ts` → `AGENT_METADATA[<agent_id>]`
2. Cross-reference `standards` array against the actual published editions
3. Open the matching workflow file `orchestrator/src/workflows/<agent>.ts`
4. Audit all hardcoded numeric constants (rates, costs, factors, thresholds)
5. Update stale values; note source and publication date in an inline comment
6. Update `last_validated` in `AGENT_METADATA` to today's ISO date
7. If logic changed materially, bump `version` in the `WORKFLOWS` registry in `index.ts`
8. Run `npx tsc --noEmit` — must be clean
9. Commit: `chore: re-validate <agent_id> against <source> <YYYY-MM-DD>`

---

## Stale Agent Alert Thresholds

Add this check to your CI or a monthly cron job:

```
High-risk agents: flag if last_validated > 30 days ago
Medium-risk agents: flag if last_validated > 90 days ago
Low-risk agents: flag if last_validated > 365 days ago
```

These thresholds match the `stale_risk` field emitted in every `CanonicalResponse.data_freshness`.

---

*Checklist reflects AGENT_METADATA as of commit `bb17c4f` (2026-03-28)*
