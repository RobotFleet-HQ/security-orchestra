#!/usr/bin/env python3
"""
Utility Interconnect Agent  v2.0
=================================
Generates detailed interconnect estimates for large loads (1–500 MW)
across nine major US utilities covering 80%+ of data center development.

Data sources: FERC OASIS, utility tariff filings, RTO/ISO posted study fees,
public interconnect queue reports, and industry benchmarks (2024–2025).

Usage:
    python utility_interconnect.py <utility> <load_mw> [voltage_kv|auto] [load_type] [state]

    utility    : dominion | pge | comed | georgia_power | aps | oncor |
                 duke_energy | sce | xcel
    load_mw    : 1 – 500
    voltage_kv : requested delivery voltage, or "auto" to select by load size
    load_type  : data_center | industrial | commercial  (default: data_center)
    state      : two-letter state code for validation (optional)

Output: JSON to stdout, diagnostics to stderr.
"""

import sys, json, math

# ═══════════════════════════════════════════════════════════════════════════════
# Utility database
# ═══════════════════════════════════════════════════════════════════════════════

UTILITIES = {

    # ── Dominion Energy Virginia / North Carolina ─────────────────────────────
    "dominion": {
        "name":          "Dominion Energy Virginia",
        "abbreviation":  "DEV",
        "states":        ["VA", "NC"],
        "territory":     "Northern Virginia, Richmond, Hampton Roads, Piedmont VA/NC",
        "rto_iso":       "PJM Interconnection",
        "ferc_docket":   "ER",
        "tier_1_dc_hub": True,   # #1 US data center market by MW
        "interconnect": {
            "large_load_threshold_mw": 5,
            "process_name":   "PJM Large Load Interconnection Service (LLIS)",
            "tariff_section": "Dominion OATT Schedule 23 / PJM OATT Part IV",
            "queue_approach": "PJM cluster-study queue (Transition Cycle, post-2023 FERC Order 2023 reform)",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 18, "typical": 24, "max": 36,
                                "notes": "Distribution-level service; Dominion fast-track possible for <5 MW at existing substations"},
                "10_to_50mw":  {"min": 24, "typical": 36, "max": 54,
                                "notes": "Sub-transmission study required; NOVA substations severely loaded"},
                "50_to_100mw": {"min": 30, "typical": 48, "max": 66,
                                "notes": "PJM SIS likely triggers 230/500 kV upgrade; 2+ year queue position wait in NOVA"},
                "100mw_plus":  {"min": 36, "typical": 60, "max": 84,
                                "notes": "Major network upgrades near-certain in NOVA; consider Richmond/Hampton Roads sites for shorter timeline"},
            },
            "steps": [
                {"step": "1", "name": "Pre-application meeting",
                 "duration_weeks": "2–4",   "cost": "No fee",
                 "notes": "Strongly recommended for loads >20 MW; Dominion Economic Development team"},
                {"step": "2", "name": "System Impact Study (SIS) request",
                 "duration_weeks": "4–8",   "cost": "Deposit per load_mw",
                 "notes": "Triggers formal PJM queue position; cluster cycle"},
                {"step": "3", "name": "Feasibility / Readiness review",
                 "duration_weeks": "12–20", "cost": "Included in SIS deposit",
                 "notes": "PJM screens voltage, stability, short-circuit; NOVA often shows zero headroom"},
                {"step": "4", "name": "System Impact Study",
                 "duration_weeks": "26–52", "cost": "Refundable toward facilities",
                 "notes": "Identifies required network upgrades; NOVA often returns $100M–$2B+ figure"},
                {"step": "5", "name": "Facilities Study",
                 "duration_weeks": "20–36", "cost": "Refundable toward construction",
                 "notes": "Detailed engineering; final cost responsibility letter"},
                {"step": "6", "name": "Interconnection Agreement execution",
                 "duration_weeks": "8–16",  "cost": "Legal fees ~$75K",
                 "notes": "FERC-approved form; customer posts construction deposit (20% of upgrade cost)"},
                {"step": "7", "name": "Facilities construction & commissioning",
                 "duration_weeks": "52–156","cost": "Customer-funded",
                 "notes": "500 kV transformer lead times 52–104 weeks; Dominion constructs utility facilities"},
            ],
            "timeline_months_min":     30,
            "timeline_months_typical": 48,
            "timeline_months_max":     72,
            "constraint_notes": [
                "Loudoun/Prince William Counties (NOVA): some substations have ZERO incremental capacity without new 500/230 kV line",
                "NOVA data center load growth: +3,500 MW queued in 2023–2025 alone",
                "DEV published Data Center Load Growth Plan with six $100M+ capital projects through 2030",
                "Richmond / Hampton Roads corridors have meaningfully more headroom than NOVA; 12–18 month shorter timeline",
                "500 kV transformer global shortage: 52–104 week lead times adding to construction delays",
            ],
        },
        "study_fees": {
            "sis_base_usd":              50_000,
            "sis_per_mw_usd":            2_000,
            "sis_refundable_pct":        100,
            "facilities_base_usd":       100_000,
            "facilities_per_mw_usd":     3_000,
            "facilities_refundable_pct": 100,
            "application_fee_usd":       5_000,
            "deposit_per_kw_low":        75,
            "deposit_per_kw_high":       175,
            "deposit_note":              "NOVA sites carry 2–2.5× premium vs. RVA/Hampton Roads due to queue congestion and expected upgrade scope",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 50,   "distribution_high": 300,
            "sub_transmission_low": 150, "sub_transmission_high": 800,
            "transmission_low": 300,  "transmission_high": 2_500,
            "nova_premium_multiplier": 2.5,
        },
        "customer_facilities": {
            "distribution_substation_per_mva": 120_000,
            "transmission_substation_per_mva": 95_000,
            "protection_relaying_base":         350_000,
            "scada_rtu_cost":                   150_000,
        },
        "rates": {
            "tariff_schedule": "Schedule 6 – Large General Service (>5 MW)",
            "demand_charge_per_kw_month":          14.20,
            "energy_charge_per_kwh":               0.0432,
            "transmission_charge_per_kw_month":    11.85,
            "ancillary_services_per_kw_month":      1.20,
            "distribution_delivery_per_kw_month":   3.50,
            "fuel_adjustment_per_kwh":             0.0028,
            "state_tax_rate":                      0.018,
            "notes": "Virginia data centers qualify for Sales Tax exemption on electricity (Va. Code § 58.1-609.3)",
        },
        "special_programs": [
            {"name": "Virginia Data Center Investment Grant",   "detail": "Up to $40M for qualified data centers investing $150M+"},
            {"name": "Economic Development Rate (ED-1)",        "detail": "Discounted demand charge for net-new large loads; requires 5-yr commitment"},
            {"name": "100% Renewable Rider RG",                 "detail": "Renewable guarantee; premium ~$1.50/MWh; popular with hyperscalers"},
        ],
        "competitive_intel": [
            "NOVA queue is 2–7 years depending on substation; sites outside Loudoun/PWC can connect 18–24 months faster",
            "vs. Georgia Power: GA offers 30–40% lower electricity costs and 18–28 month typical timeline — strong alternative for non-latency-critical workloads",
            "vs. Oncor/DFW: Texas offers 50%+ faster interconnect and lower energy rates, but lacks NOVA's fiber/carrier-hotel ecosystem",
            "Richmond and Hampton Roads corridors within Dominion territory are materially less congested; good secondary NOVA option",
        ],
        "regulatory": {
            "irp_process":              "Virginia IRP filed biennially; new large loads may require CPCN",
            "data_center_definition_mw": 25,
            "utility_commission":        "Virginia State Corporation Commission (SCC)",
        },
    },

    # ── Pacific Gas & Electric (CAISO) ────────────────────────────────────────
    "pge": {
        "name":         "Pacific Gas and Electric Company",
        "abbreviation": "PG&E",
        "states":       ["CA"],
        "territory":    "Northern & Central California: Silicon Valley, Bay Area, Sacramento",
        "rto_iso":      "CAISO (California ISO)",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 1,
            "process_name":   "CAISO Wholesale Distribution Access Tariff (WDAT) / Rule 21",
            "tariff_section": "PG&E Electric Rule 2 (distribution), CAISO OATT (transmission)",
            "queue_approach": "CAISO Cluster study with 20% deposit to retain queue position",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 18, "typical": 30, "max": 42,
                                "notes": "Distribution-level Rule 2; CEQA screening can add 6–12 months"},
                "10_to_50mw":  {"min": 24, "typical": 42, "max": 60,
                                "notes": "SIS required; Bay Area/Silicon Valley sites at capacity — Sacramento valley preferred"},
                "50_to_100mw": {"min": 36, "typical": 54, "max": 78,
                                "notes": "230 kV or higher required; CAISO queue position wait 3–5 years for constrained substations"},
                "100mw_plus":  {"min": 48, "typical": 72, "max": 96,
                                "notes": "Rare approvals; network upgrade costs frequently exceed $500M; multi-agency permitting"},
            },
            "steps": [
                {"step": "1", "name": "Preliminary review / Rule 2 application",
                 "duration_weeks": "4–8",   "cost": "$3,500–$10,000",
                 "notes": "Required for distribution loads; assess point-of-interconnection"},
                {"step": "2", "name": "CEQA / permitting assessment",
                 "duration_weeks": "4–52",  "cost": "$25,000–$250,000",
                 "notes": "California Environmental Quality Act review; large loads in urban areas 12–18 months"},
                {"step": "3", "name": "Interconnection Feasibility Study (IFS)",
                 "duration_weeks": "16–26", "cost": "$40,000–$150,000 deposit",
                 "notes": "CAISO reliability screening; refundable"},
                {"step": "4", "name": "System Impact Study (SIS)",
                 "duration_weeks": "26–52", "cost": "$100,000–$500,000",
                 "notes": "Bay Area often returns $500M+ for loads >50 MW"},
                {"step": "5", "name": "Facilities Study",
                 "duration_weeks": "20–40", "cost": "Refundable toward construction",
                 "notes": "Final engineering; PG&E constructs utility facilities"},
                {"step": "6", "name": "PG&E upgrade construction",
                 "duration_weeks": "52–208","cost": "Customer responsibility",
                 "notes": "Substation & transmission line; equipment lead times 2–4 years"},
            ],
            "timeline_months_min":     36,
            "timeline_months_typical": 54,
            "timeline_months_max":     84,
            "constraint_notes": [
                "Silicon Valley substations broadly capacity-constrained (2024 CAISO LTRA report)",
                "CAISO interconnection queue: 180+ GW requested (2024); load queue also heavily backed up",
                "SF Peninsula: zero available capacity without $200M+ upgrades at most delivery points",
                "Sacramento Valley and Central Valley have more headroom than Bay Area — 12–18 months faster",
                "CEQA and Coastal Commission permits can add 1–3 years for non-brownfield sites",
            ],
        },
        "study_fees": {
            "ifs_base_usd":              40_000,
            "ifs_per_mw_usd":            1_500,
            "sis_base_usd":             100_000,
            "sis_per_mw_usd":            3_000,
            "sis_refundable_pct":        90,
            "facilities_base_usd":      150_000,
            "facilities_per_mw_usd":     4_000,
            "facilities_refundable_pct": 100,
            "application_fee_usd":       3_500,
            "deposit_per_kw_low":        90,
            "deposit_per_kw_high":       200,
            "deposit_note":              "Bay Area locations command upper end; Sacramento and Central Valley lower end",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 100, "distribution_high": 600,
            "sub_transmission_low": 250, "sub_transmission_high": 1_200,
            "transmission_low": 500, "transmission_high": 4_000,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva": 180_000,
            "transmission_substation_per_mva": 140_000,
            "protection_relaying_base":         450_000,
            "scada_rtu_cost":                   200_000,
        },
        "rates": {
            "tariff_schedule": "Schedule A-10 (Large Commercial / Industrial)",
            "demand_charge_per_kw_month":          19.45,
            "energy_charge_per_kwh":               0.0612,
            "transmission_charge_per_kw_month":    14.30,
            "ancillary_services_per_kw_month":      2.10,
            "distribution_delivery_per_kw_month":   5.20,
            "fuel_adjustment_per_kwh":             0.0041,
            "state_tax_rate":                      0.0,
            "notes": "Among highest US commercial rates; SB 100 mandates 100% clean energy by 2045. CA exempts electricity from sales tax.",
        },
        "special_programs": [
            {"name": "Self-Generation Incentive Program (SGIP)", "detail": "Battery storage rebates; effective for demand charge management"},
            {"name": "Green Tariff / Green Option",              "detail": "100% renewable procurement at ~$3/MWh premium"},
            {"name": "Large Load Fast Track",                    "detail": "Available where existing substation capacity exists — rarely applicable in Bay Area"},
        ],
        "competitive_intel": [
            "PG&E rates are 40–55% higher than ComEd/Oncor/Georgia Power; 10-yr energy cost premium of $50M–$200M+ vs. lower-cost markets per 100 MW",
            "Bay Area interconnect queue 3–5 years; Sacramento corridor is 12–24 months faster with lower network upgrade exposure",
            "vs. Dominion VA: similar timeline but significantly higher rates and CEQA adds multi-year permitting risk",
            "Many hyperscalers are redirecting new Bay Area capacity to Phoenix (APS/SRP) or Dallas (Oncor) to avoid CA rate and permitting burden",
        ],
        "regulatory": {
            "irp_process":              "CPUC Integrated Resource Plan; new gas generation requires CPUC pre-approval",
            "data_center_definition_mw": 1,
            "utility_commission":        "California Public Utilities Commission (CPUC)",
        },
    },

    # ── Commonwealth Edison (MISO) ────────────────────────────────────────────
    "comed": {
        "name":         "Commonwealth Edison (ComEd)",
        "abbreviation": "ComEd",
        "states":       ["IL"],
        "territory":    "Northern Illinois: Chicago metro, suburban Cook/DuPage/Kane/Lake counties, Rockford",
        "rto_iso":      "MISO (Midcontinent ISO)",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 5,
            "process_name":   "MISO Transmission Interconnection / ComEd Distribution Service Facility Study (DSFS)",
            "tariff_section": "ComEd Tariff Rate DH / MISO OATT Part IV",
            "queue_approach": "MISO Definitive Planning Phase (DPP) cluster studies; ComEd DSFS for distribution",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 10, "typical": 16, "max": 26,
                                "notes": "DSFS only; ComEd fast-track available; suburban sites with available capacity"},
                "10_to_50mw":  {"min": 14, "typical": 22, "max": 34,
                                "notes": "DSFS + possible MISO study if sub-transmission; Cook County incentive zones add some planning complexity"},
                "50_to_100mw": {"min": 18, "typical": 28, "max": 42,
                                "notes": "MISO SIS required; DPP cycle 18–24 months; suburban O'Hare/Northbrook corridor preferred over CBD"},
                "100mw_plus":  {"min": 22, "typical": 36, "max": 54,
                                "notes": "MISO DPP cluster; 2023–2024 DPP identified $3.5B in N. Illinois upgrades; budget accordingly"},
            },
            "steps": [
                {"step": "1", "name": "ComEd Large Load Inquiry",
                 "duration_weeks": "2–6",   "cost": "$1,500 fee",
                 "notes": "Initial capacity screening; dedicated large load team"},
                {"step": "2", "name": "Distribution Service Facility Study (DSFS)",
                 "duration_weeks": "16–26", "cost": "$25,000–$100,000",
                 "notes": "Required for distribution service; less for sub-transmission entry"},
                {"step": "3", "name": "MISO Transmission SIS (>20 MW typical)",
                 "duration_weeks": "26–52", "cost": "$50,000–$250,000 deposit",
                 "notes": "MISO cluster cycle; DPP takes 18–24 months"},
                {"step": "4", "name": "Facilities Study",
                 "duration_weeks": "16–30", "cost": "Refundable",
                 "notes": "Final cost estimates; MISO network upgrade responsibilities allocated"},
                {"step": "5", "name": "Interconnection Agreement",
                 "duration_weeks": "8–16",  "cost": "Legal fees ~$50K",
                 "notes": "FERC Form 715; customer posts 20% deposit on network upgrades"},
                {"step": "6", "name": "Construction & commissioning",
                 "duration_weeks": "40–120","cost": "Customer-funded",
                 "notes": "ComEd constructs utility portion; customer builds service entrance"},
            ],
            "timeline_months_min":     18,
            "timeline_months_typical": 30,
            "timeline_months_max":     48,
            "constraint_notes": [
                "Chicago CBD: limited substation capacity; O'Hare/Northbrook/Elk Grove Village corridor far better positioned",
                "Illinois data center boom (Cook County incentives) has loaded NI MISO zone since 2022",
                "MISO DPP 2023–2024 identified $3.5B in Northern Illinois network upgrades",
                "Suburban sites (Kane, DuPage, Lake counties) often have 20–30% lower network upgrade exposure than Cook County",
                "ComEd has a dedicated Large Load team and pre-application program — among the most customer-friendly utilities in MISO",
            ],
        },
        "study_fees": {
            "dsfs_base_usd":             25_000,
            "dsfs_per_mw_usd":            1_200,
            "sis_base_usd":              50_000,
            "sis_per_mw_usd":             1_800,
            "sis_refundable_pct":         100,
            "facilities_base_usd":        75_000,
            "facilities_per_mw_usd":      2_000,
            "facilities_refundable_pct":  100,
            "application_fee_usd":         1_500,
            "deposit_per_kw_low":          50,
            "deposit_per_kw_high":         120,
            "deposit_note":               "Cook County CBD sites at upper end; suburban sites often 40–50% lower deposit exposure",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 40,  "distribution_high": 200,
            "sub_transmission_low": 100, "sub_transmission_high": 500,
            "transmission_low": 200, "transmission_high": 1_200,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva": 100_000,
            "transmission_substation_per_mva":  80_000,
            "protection_relaying_base":         280_000,
            "scada_rtu_cost":                   120_000,
        },
        "rates": {
            "tariff_schedule": "Rate DH – Distribution High Voltage Service",
            "demand_charge_per_kw_month":          10.85,
            "energy_charge_per_kwh":               0.0358,
            "transmission_charge_per_kw_month":     7.90,
            "ancillary_services_per_kw_month":      0.95,
            "distribution_delivery_per_kw_month":   2.80,
            "fuel_adjustment_per_kwh":             0.0015,
            "state_tax_rate":                      0.025,
            "notes": "Illinois exempts data center equipment from state use tax (35 ILCS 105/3-5); Cook County 2.5% electricity tax rate available for large DCs",
        },
        "special_programs": [
            {"name": "Cook County Data Center Tax Incentive",  "detail": "2.5% electricity tax rate vs. standard rate; requires 10-year commitment, $250M investment"},
            {"name": "Illinois EDGE Tax Credit",               "detail": "Corporate income tax credit for large capital investments; negotiated with DCEO"},
            {"name": "ComEd Smart Ideas Demand Response",      "detail": "Up to $150/kW for curtailable load; reduces demand charge exposure"},
        ],
        "competitive_intel": [
            "Chicago offers mid-tier rates (lower than CA/VA, higher than TX/GA) with one of the best fiber interconnect ecosystems outside NOVA",
            "vs. Oncor/Dallas: Texas is 20–30% cheaper on energy but Chicago has denser carrier-neutral colocation options",
            "Cook County incentives make Chicago competitive on a tax-adjusted basis vs. most non-TX/GA markets",
            "Suburban Chicago sites (Elk Grove, Bolingbrook) often 12+ months faster than city sites and $20–50M cheaper in network upgrades",
        ],
        "regulatory": {
            "irp_process":              "Illinois Long-Term Renewable Resources Procurement Plan",
            "data_center_definition_mw": 1,
            "utility_commission":        "Illinois Commerce Commission (ICC)",
        },
    },

    # ── Georgia Power (Southern Company) ─────────────────────────────────────
    "georgia_power": {
        "name":         "Georgia Power Company",
        "abbreviation": "GPC",
        "states":       ["GA"],
        "territory":    "Statewide Georgia (except areas served by EMCs and Dalton Utilities)",
        "rto_iso":      "Southern Company / SEEM (Southeast Energy Exchange Market)",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 1,
            "process_name":   "Georgia Power Large Load Interconnection / Transmission Service Request",
            "tariff_section": "Georgia Power OATT Schedule 23 / Economic Development Tariff",
            "queue_approach": "Serial FERC queue; moving to cluster studies for loads >50 MW (2024)",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 9,  "typical": 14, "max": 22,
                                "notes": "Distribution-level service; Georgia Power fast-track available at pre-permitted megasites"},
                "10_to_50mw":  {"min": 12, "typical": 20, "max": 30,
                                "notes": "Sub-transmission study; Atlanta metro has good capacity in Cherokee/Forsyth/Douglas corridors"},
                "50_to_100mw": {"min": 16, "typical": 26, "max": 38,
                                "notes": "TSR + SIS required; Georgia Power has 'hyperscale-ready' substation program"},
                "100mw_plus":  {"min": 20, "typical": 32, "max": 48,
                                "notes": "Still faster than most US utilities; Vogtle nuclear baseload enables rapid load accommodation"},
            },
            "steps": [
                {"step": "1", "name": "Pre-application / Site feasibility",
                 "duration_weeks": "2–8",   "cost": "No fee",
                 "notes": "Dedicated Economic Development team; very customer-friendly; megasite program"},
                {"step": "2", "name": "Transmission Service Request (TSR)",
                 "duration_weeks": "4–8",   "cost": "$10,000–$30,000",
                 "notes": "Identifies transmission path; required for loads >20 MW"},
                {"step": "3", "name": "System Impact Study",
                 "duration_weeks": "16–30", "cost": "$30,000–$150,000 deposit",
                 "notes": "Grid generally less constrained than PJM/CAISO; faster study cycles"},
                {"step": "4", "name": "Facilities Study",
                 "duration_weeks": "16–26", "cost": "Refundable toward construction",
                 "notes": "Final engineering drawings and cost responsibility letter"},
                {"step": "5", "name": "Interconnection Agreement",
                 "duration_weeks": "6–12",  "cost": "Legal fees ~$40K",
                 "notes": "Georgia Power executes quickly; Georgia PSC oversight"},
                {"step": "6", "name": "Construction",
                 "duration_weeks": "32–104","cost": "Customer-funded",
                 "notes": "Faster than most utilities; megasite program substations pre-engineered"},
            ],
            "timeline_months_min":     18,
            "timeline_months_typical": 28,
            "timeline_months_max":     42,
            "constraint_notes": [
                "Metro Atlanta (Douglas, Cherokee, Forsyth) growing fast; still significantly less constrained than NOVA or Bay Area",
                "Georgia Megasite program: pre-permitted sites with available capacity can cut 12–24 months off timeline",
                "Vogtle Units 3 & 4 nuclear (2,600 MW) provide reliable 24/7 clean energy — major draw for net-zero hyperscalers",
                "Rural substations often have substantial headroom; >100 MW loads can connect faster outside the metro corridor",
                "No MISO or PJM cluster queue dependency; Georgia Power controls its own timeline",
            ],
        },
        "study_fees": {
            "tsr_base_usd":              10_000,
            "tsr_per_mw_usd":               800,
            "sis_base_usd":              30_000,
            "sis_per_mw_usd":             1_200,
            "sis_refundable_pct":           100,
            "facilities_base_usd":        50_000,
            "facilities_per_mw_usd":       1_800,
            "facilities_refundable_pct":    100,
            "application_fee_usd":          2_500,
            "deposit_per_kw_low":            40,
            "deposit_per_kw_high":           100,
            "deposit_note":                "Lowest deposits in major DC markets; megasite program often reduces deposit further",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 30,  "distribution_high": 180,
            "sub_transmission_low": 80,  "sub_transmission_high": 400,
            "transmission_low": 150, "transmission_high": 900,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva":  90_000,
            "transmission_substation_per_mva":  70_000,
            "protection_relaying_base":         250_000,
            "scada_rtu_cost":                   100_000,
        },
        "rates": {
            "tariff_schedule": "PL-3 – Large Power Service (>5,000 kW)",
            "demand_charge_per_kw_month":          9.40,
            "energy_charge_per_kwh":               0.0298,
            "transmission_charge_per_kw_month":    6.50,
            "ancillary_services_per_kw_month":     0.80,
            "distribution_delivery_per_kw_month":  2.20,
            "fuel_adjustment_per_kwh":             0.0062,
            "state_tax_rate":                      0.04,
            "notes": "Among the lowest commercial rates in the Southeast; HB 282 provides full sales tax exemption on data center equipment",
        },
        "special_programs": [
            {"name": "Economic Development Rate (ED-1/ED-2)",       "detail": "20–30% discount on demand charge for new large loads; 5-year term"},
            {"name": "HB 282 Data Center Sales Tax Exemption",       "detail": "Full sales tax exemption on servers, cooling, UPS; qualifying data centers"},
            {"name": "Georgia Megasite Program",                     "detail": "Pre-permitted sites with available utility capacity; shortens timeline 12–24 months"},
            {"name": "Vogtle Nuclear Carbon-Free PPA",               "detail": "30-year nuclear PPA available; attractive for RE100 / net-zero commitments"},
        ],
        "competitive_intel": [
            "Georgia Power is the #1 US utility for data center development speed + cost combination (2024 industry surveys)",
            "Atlanta metro rates are 35–40% lower than NOVA and 55% lower than Bay Area on a $/kWh basis",
            "Megasite program compresses timeline to as little as 9–14 months for pre-permitted sites",
            "vs. Oncor/Texas: Georgia has better incentives and nuclear clean energy; Texas has slightly lower rates but higher weather risk",
        ],
        "regulatory": {
            "irp_process":              "Georgia PSC IRP filed every 3 years",
            "data_center_definition_mw": 1,
            "utility_commission":        "Georgia Public Service Commission (PSC)",
        },
    },

    # ── Arizona Public Service (WECC / Phoenix metro) ─────────────────────────
    "aps": {
        "name":         "Arizona Public Service Company",
        "abbreviation": "APS",
        "states":       ["AZ"],
        "territory":    "Statewide Arizona (excl. SRP territory in Phoenix metro East/Southeast)",
        "rto_iso":      "WECC / APS own balancing authority",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 1,
            "process_name":   "APS Transmission Service Request / Distribution New Service",
            "tariff_section": "APS OATT Schedule 1–3 / ACC General Order U-0000",
            "queue_approach": "Serial FERC interconnection queue; WECC path ratings apply",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 10, "typical": 16, "max": 24,
                                "notes": "Distribution-level service; APS Technical Development team responsive"},
                "10_to_50mw":  {"min": 14, "typical": 22, "max": 34,
                                "notes": "Sub-transmission; Pinal/East Valley sites preferred for speed and cost vs. Maricopa West Side"},
                "50_to_100mw": {"min": 18, "typical": 30, "max": 46,
                                "notes": "TSR + SIS; Phoenix metro West Side substations increasingly constrained"},
                "100mw_plus":  {"min": 22, "typical": 38, "max": 56,
                                "notes": "500 kV path constraints at Hassayampa–Westwing; budget for significant network upgrades"},
            },
            "steps": [
                {"step": "1", "name": "Pre-application meeting",
                 "duration_weeks": "2–4",   "cost": "No fee",
                 "notes": "APS Technical Development team assesses substation proximity and capacity"},
                {"step": "2", "name": "Transmission Service Request",
                 "duration_weeks": "4–8",   "cost": "$5,000–$20,000",
                 "notes": "Identifies delivery point and WECC path constraints"},
                {"step": "3", "name": "System Impact Study",
                 "duration_weeks": "20–36", "cost": "$40,000–$180,000 deposit",
                 "notes": "Phoenix metro West Side increasingly constrained; Pinal/East Valley better"},
                {"step": "4", "name": "Facilities Study",
                 "duration_weeks": "16–28", "cost": "Refundable toward construction",
                 "notes": "APS engineers final substation additions; desert construction adds 10–15% premium"},
                {"step": "5", "name": "Interconnection Agreement",
                 "duration_weeks": "8–14",  "cost": "Legal fees ~$45K",
                 "notes": "Arizona Corporation Commission approval required for new substations"},
                {"step": "6", "name": "Construction",
                 "duration_weeks": "36–120","cost": "Customer-funded",
                 "notes": "Desert heat construction premium; cooling load peaks 110°F+ in summer"},
            ],
            "timeline_months_min":     24,
            "timeline_months_typical": 36,
            "timeline_months_max":     54,
            "constraint_notes": [
                "Phoenix metro West Side (Maricopa): constrained; Pinal County and East Valley (Chandler/Mesa/Gilbert) have more headroom",
                "Summer peak demand (June–Sept, 110°F+) sizes all equipment; on-site generation helps",
                "Hassayampa–Westwing 500 kV path is transmission bottleneck for West Phoenix growth",
                "Water availability is a separate siting constraint — APS territory is generally better than CAP-restricted areas",
                "SRP territory in East Phoenix has a separate (non-FERC) interconnect process with different timeline/cost profile",
                "APS territory is FERC-jurisdictional; SRP is not — confirm which territory before starting",
            ],
        },
        "study_fees": {
            "tsr_base_usd":               5_000,
            "tsr_per_mw_usd":               900,
            "sis_base_usd":              40_000,
            "sis_per_mw_usd":             1_500,
            "sis_refundable_pct":           100,
            "facilities_base_usd":        60_000,
            "facilities_per_mw_usd":       2_200,
            "facilities_refundable_pct":    100,
            "application_fee_usd":          2_000,
            "deposit_per_kw_low":            55,
            "deposit_per_kw_high":           130,
            "deposit_note":                "West Phoenix/Maricopa sites at upper end; Pinal County sites typically 30–40% lower",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 60,  "distribution_high": 280,
            "sub_transmission_low": 150, "sub_transmission_high": 700,
            "transmission_low": 250, "transmission_high": 1_500,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva": 115_000,
            "transmission_substation_per_mva":  90_000,
            "protection_relaying_base":         300_000,
            "scada_rtu_cost":                   130_000,
        },
        "rates": {
            "tariff_schedule": "Rate LGS – Large General Service (>1,000 kW)",
            "demand_charge_per_kw_month":          13.10,
            "energy_charge_per_kwh":               0.0388,
            "transmission_charge_per_kw_month":     8.90,
            "ancillary_services_per_kw_month":      1.05,
            "distribution_delivery_per_kw_month":   3.10,
            "fuel_adjustment_per_kwh":             0.0048,
            "state_tax_rate":                      0.056,
            "notes": "Summer On-Peak demand charges elevated (June–Sept); on-site generation recommended. Arizona TPT (sales tax ~5.6%) applies. ACA data center equipment exemption available (>$50M investment).",
        },
        "special_programs": [
            {"name": "Arizona Commerce Authority (ACA) Data Center Incentive", "detail": "TPT exemption on equipment for investments >$50M; 15-year term"},
            {"name": "APS Green Power Program",                                "detail": "Solar-heavy renewable portfolio matching; excellent AZ solar resource"},
            {"name": "Economic Development Rate",                              "detail": "Negotiated terms for qualifying new large industrial loads"},
        ],
        "competitive_intel": [
            "Phoenix metro is #3 US data center market; APS territory (West Valley, North Phoenix) is a primary growth zone",
            "vs. Georgia Power: AZ rates ~35% higher but better solar resource for renewable PPAs and lower labor costs for construction",
            "vs. Oncor/DFW: Phoenix offers similar growth dynamics but higher electricity rates; DFW has edge on total cost",
            "Pinal County (Mesa/Coolidge/Queen Creek area) is the fastest-growing data center sub-market within APS territory — 20%+ shorter timeline vs. West Phoenix",
        ],
        "regulatory": {
            "irp_process":              "APS IRP filed every 2 years; Arizona Corporation Commission oversight",
            "data_center_definition_mw": 1,
            "utility_commission":        "Arizona Corporation Commission (ACC)",
        },
    },

    # ── Oncor Electric Delivery (ERCOT / DFW) ────────────────────────────────
    "oncor": {
        "name":         "Oncor Electric Delivery Company",
        "abbreviation": "Oncor",
        "states":       ["TX"],
        "territory":    "North Texas: Dallas–Fort Worth Metroplex, West Texas, Permian Basin",
        "rto_iso":      "ERCOT (Electric Reliability Council of Texas)",
        "ferc_docket":  "Non-FERC (ERCOT exempt)",
        "interconnect": {
            "large_load_threshold_mw": 1,
            "process_name":   "ERCOT Transmission Load Interconnection / Oncor Distribution New Service",
            "tariff_section": "ERCOT Protocols Section 5 / Oncor Tariff for Retail Delivery Service",
            "queue_approach": "ERCOT 'Connect and Manage' model; first-come-first-served with network upgrade deposits",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 4,  "typical": 9,  "max": 15,
                                "notes": "Distribution service; Oncor Major Projects team; fastest large-load timeline in US"},
                "10_to_50mw":  {"min": 8,  "typical": 16, "max": 26,
                                "notes": "Sub-transmission; ERCOT Load Registration required for >10 MW at transmission"},
                "50_to_100mw": {"min": 12, "typical": 22, "max": 36,
                                "notes": "Network Upgrade Study; DFW West/South corridors more congested than N. Dallas/Allen/McKinney"},
                "100mw_plus":  {"min": 16, "typical": 28, "max": 48,
                                "notes": "PUCT CCN required if new transmission line needed; DFW demand growth pressuring N. Texas grid"},
            },
            "steps": [
                {"step": "1", "name": "Oncor large load pre-application",
                 "duration_weeks": "2–4",   "cost": "No fee",
                 "notes": "Dedicated Major Projects team; DFW region extremely active (2024)"},
                {"step": "2", "name": "ERCOT Transmission Load Registration",
                 "duration_weeks": "4–12",  "cost": "$25,000–$75,000",
                 "notes": "For loads >10 MW at transmission; ERCOT screens for reliability"},
                {"step": "3", "name": "Network Upgrade Study (Oncor)",
                 "duration_weeks": "12–24", "cost": "$30,000–$120,000",
                 "notes": "Oncor identifies required wires upgrades; Texas deregulated model"},
                {"step": "4", "name": "Oncor Facilities Extension Agreement",
                 "duration_weeks": "8–16",  "cost": "Deposit = estimated facilities cost",
                 "notes": "Customer deposits full estimated extension cost upfront (not refundable; offset against construction)"},
                {"step": "5", "name": "PUCT / ERCOT approval (if new transmission)",
                 "duration_weeks": "16–40", "cost": "Filing fees ~$10,000",
                 "notes": "Certificate of Convenience and Necessity (CCN) for new transmission lines"},
                {"step": "6", "name": "Construction",
                 "duration_weeks": "26–104","cost": "Customer-funded",
                 "notes": "Oncor constructs wires; customer chooses retail electric provider separately"},
            ],
            "timeline_months_min":     12,
            "timeline_months_typical": 24,
            "timeline_months_max":     42,
            "constraint_notes": [
                "DFW is the largest data center market in the world by MW capacity (2024 Q3 estimates: 2,800+ MW operating)",
                "ERCOT is an island grid with no interstate AC ties; no FERC jurisdiction on most load matters",
                "Texas deregulation: Oncor handles wires only — customer must separately procure power from a Retail Electric Provider (REP)",
                "ERCOT 4-Coincident Peak (4CP) charges apply 15-minute interval metering; peak awareness programs can save $2–5M/yr",
                "Lewisville/Carrollton/Allen/McKinney corridor: best current capacity; South Dallas increasingly loaded",
                "Winter Storm Uri (2021) drove new backup power requirements; ERCOT weatherization rules tightening",
            ],
        },
        "study_fees": {
            "ercot_reg_base_usd":        25_000,
            "ercot_reg_per_mw_usd":       1_000,
            "nup_base_usd":              30_000,
            "nup_per_mw_usd":             1_100,
            "sis_refundable_pct":            80,
            "facilities_base_usd":        50_000,
            "facilities_per_mw_usd":       1_500,
            "facilities_refundable_pct":      0,
            "application_fee_usd":             0,
            "deposit_per_kw_low":             45,
            "deposit_per_kw_high":            110,
            "deposit_note":                "Deposits applied against construction cost (not refunded as cash); actual facilities cost often lower than initial estimate",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 35,  "distribution_high": 180,
            "sub_transmission_low": 90,  "sub_transmission_high": 450,
            "transmission_low": 180, "transmission_high": 1_000,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva":  85_000,
            "transmission_substation_per_mva":  65_000,
            "protection_relaying_base":         220_000,
            "scada_rtu_cost":                   100_000,
        },
        "rates": {
            "tariff_schedule": "Oncor Delivery Service (wires only); energy from chosen REP",
            "demand_charge_per_kw_month":          7.20,
            "energy_charge_per_kwh":               0.0280,
            "transmission_charge_per_kw_month":    5.50,
            "ancillary_services_per_kw_month":     0.85,
            "distribution_delivery_per_kw_month":  1.90,
            "fuel_adjustment_per_kwh":             0.0,
            "state_tax_rate":                      0.0,
            "notes": "ERCOT 4CP demand charges can be $3–8/kW-month on top of wires charges; market energy price highly variable with wind/solar. Texas sales tax (~8.25%) on electricity via REP.",
        },
        "special_programs": [
            {"name": "Texas HB 7 (formerly Sec 313) Tax Abatement",   "detail": "School district M&O tax limitation for qualifying investments >$1M; negotiated per county"},
            {"name": "ERCOT 4CP Demand Response",                      "detail": "Load curtailment during ~4 summer peak hours lowers annual T&D cost by $2–8M per 100 MW"},
            {"name": "Competitive REP Market",                         "detail": "Largest competitive electricity market in US; fixed-price, index, or renewable PPAs available"},
            {"name": "Texas Enterprise Fund",                          "detail": "Governor's closing fund for large corporate relocations; negotiated case-by-case"},
        ],
        "competitive_intel": [
            "DFW is the world's largest data center market; Oncor territory is the primary growth zone; sites in Allen/McKinney/Lewisville have 20–30% faster timelines than South Dallas",
            "Texas total cost of power (Oncor wires + REP energy) typically 25–35% lower than NOVA and 45–55% lower than Bay Area",
            "vs. Georgia Power: Texas is slightly cheaper on energy but Georgia has better incentives, lower permitting risk, and nuclear clean energy",
            "ERCOT islanded grid is a risk factor; backup generation requirements and battery storage are increasingly mandatory for data center tenants",
        ],
        "regulatory": {
            "irp_process":              "ERCOT Long-Term System Assessment (LTSA); PUCT oversees transmission",
            "data_center_definition_mw": 1,
            "utility_commission":        "Public Utility Commission of Texas (PUCT) / ERCOT",
        },
    },

    # ── Duke Energy Carolinas / Progress ─────────────────────────────────────
    "duke_energy": {
        "name":         "Duke Energy Carolinas / Duke Energy Progress",
        "abbreviation": "DEC/DEP",
        "states":       ["NC", "SC", "IN", "OH", "FL"],
        "territory":    "Western Carolinas, Charlotte metro, Research Triangle NC, Piedmont NC/SC",
        "rto_iso":      "PJM (DEC) / SERC Reliability Corp / Duke own balancing authority",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 5,
            "process_name":   "Duke Energy Carolinas Large Load Interconnection / Transmission Service Request",
            "tariff_section": "Duke Energy OATT Schedule 23 / Rate Schedule ED",
            "queue_approach": "Serial FERC queue; Duke is own Transmission Owner and Balancing Authority in Carolinas",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 10, "typical": 16, "max": 24,
                                "notes": "Distribution service; Large Load Response Team; RTP area load growth accelerating"},
                "10_to_50mw":  {"min": 14, "typical": 22, "max": 34,
                                "notes": "TSR + SIS required; Triad (Greensboro/Winston-Salem) less constrained than Charlotte/RTP"},
                "50_to_100mw": {"min": 18, "typical": 28, "max": 42,
                                "notes": "Transmission-level study; Charlotte I-77 corridor and RTP Area 3 have limited headroom"},
                "100mw_plus":  {"min": 22, "typical": 36, "max": 56,
                                "notes": "Duke Carbon Plan accommodates load growth; rural NC Piedmont sites 12–18 months faster than metro"},
            },
            "steps": [
                {"step": "1", "name": "Pre-application / Large Load team engagement",
                 "duration_weeks": "2–6",   "cost": "No fee",
                 "notes": "Dedicated Large Load Response Team; Charlotte/RTP area very active 2023–2025"},
                {"step": "2", "name": "Transmission Service Request",
                 "duration_weeks": "4–10",  "cost": "$10,000–$40,000",
                 "notes": "Duke evaluates transmission path; RTP sub-market is most loaded"},
                {"step": "3", "name": "System Impact Study",
                 "duration_weeks": "18–34", "cost": "$40,000–$200,000",
                 "notes": "Identifies network upgrades; Charlotte moderately constrained; Triad/rural sites cheaper"},
                {"step": "4", "name": "Facilities Study",
                 "duration_weeks": "16–28", "cost": "Refundable",
                 "notes": "Final engineering; Duke constructs delivery point equipment"},
                {"step": "5", "name": "Interconnection Agreement",
                 "duration_weeks": "6–14",  "cost": "Legal fees ~$45K",
                 "notes": "FERC-approved form; NCUC oversight"},
                {"step": "6", "name": "Construction",
                 "duration_weeks": "36–104","cost": "Customer-funded",
                 "notes": "Duke constructs utility portion; 12–36 months for large substations"},
            ],
            "timeline_months_min":     20,
            "timeline_months_typical": 32,
            "timeline_months_max":     54,
            "constraint_notes": [
                "Research Triangle Park and Charlotte are heavily loaded; new substations required for most >50 MW loads",
                "Duke 2023 Carbon Plan targets 18 GW of new capacity through 2035 to serve load growth",
                "Nuclear fleet (McGuire, Catawba, Oconee) provides low-carbon 24/7 baseload — key draw for hyperscaler RE commitments",
                "Triad (Greensboro/Winston-Salem/High Point) and rural NC Piedmont: less congested, meaningfully lower network upgrade costs",
                "Duke Indiana/Ohio operations are MISO-connected and have a different queue process",
            ],
        },
        "study_fees": {
            "tsr_base_usd":              10_000,
            "tsr_per_mw_usd":               900,
            "sis_base_usd":              40_000,
            "sis_per_mw_usd":             1_400,
            "sis_refundable_pct":           100,
            "facilities_base_usd":        60_000,
            "facilities_per_mw_usd":       2_000,
            "facilities_refundable_pct":    100,
            "application_fee_usd":          2_500,
            "deposit_per_kw_low":            50,
            "deposit_per_kw_high":           120,
            "deposit_note":                "Charlotte/RTP metro at upper end; rural NC Piedmont and Triad typically 30–40% lower",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 35,  "distribution_high": 200,
            "sub_transmission_low": 90, "sub_transmission_high": 500,
            "transmission_low": 180, "transmission_high": 1_100,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva":  95_000,
            "transmission_substation_per_mva":  75_000,
            "protection_relaying_base":         270_000,
            "scada_rtu_cost":                   110_000,
        },
        "rates": {
            "tariff_schedule": "Schedule EP-5 – Extra Large Power (>1,000 kW)",
            "demand_charge_per_kw_month":          10.20,
            "energy_charge_per_kwh":               0.0322,
            "transmission_charge_per_kw_month":     7.20,
            "ancillary_services_per_kw_month":      0.90,
            "distribution_delivery_per_kw_month":   2.50,
            "fuel_adjustment_per_kwh":             0.0055,
            "state_tax_rate":                      0.0475,
            "notes": "NC data centers exempt from sales tax on electricity if >$75M investment (NCGS 105-164.13). Duke offers Green Source Advantage renewable PPAs.",
        },
        "special_programs": [
            {"name": "NC Data Center Sales Tax Exemption", "detail": "NCGS 105-164.13: electricity sales tax exemption for DCs investing >$75M, creating 5+ jobs"},
            {"name": "Economic Development Rate (ED)",     "detail": "Discounted rates for new qualifying large loads; negotiated case-by-case"},
            {"name": "Green Source Advantage",            "detail": "Renewable energy procurement program; PPAs available through Duke"},
            {"name": "NC OneNC Incentive Package",        "detail": "State grants and tax credits for large capital investments; EDPNC coordinates"},
        ],
        "competitive_intel": [
            "Research Triangle is a top-5 US data center market; Charlotte is top-10 — both are growing rapidly with favorable state incentives",
            "Duke rates are 25–30% lower than Dominion/VA, with comparable nuclear clean energy story and slightly faster typical timeline",
            "vs. Georgia Power: GA offers lower rates (~10–15%) and faster timeline, but NC has stronger workforce and data center ecosystem",
            "Rural NC Piedmont sites (Alamance, Randolph, Guilford counties) offer best Duke timeline + cost profile outside metro areas",
        ],
        "regulatory": {
            "irp_process":              "Duke Carbon Plan filed per NC HB 951; approved by NCUC",
            "data_center_definition_mw": 1,
            "utility_commission":        "North Carolina Utilities Commission (NCUC) / South Carolina PSC",
        },
    },

    # ── Southern California Edison (CAISO / LA Basin) ─────────────────────────
    "sce": {
        "name":         "Southern California Edison Company",
        "abbreviation": "SCE",
        "states":       ["CA"],
        "territory":    "Los Angeles Basin, Inland Empire, Orange County, San Bernardino, Ventura",
        "rto_iso":      "CAISO (California ISO)",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 1,
            "process_name":   "CAISO Wholesale Distribution Access Tariff / SCE Rule 2",
            "tariff_section": "SCE Electric Rule 2 (distribution), CAISO OATT (transmission)",
            "queue_approach": "CAISO Cluster study with 20% deposit; SCE distribution queue separate",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 18, "typical": 30, "max": 48,
                                "notes": "Distribution Rule 2; LA County permitting adds 6–12 months vs. Inland Empire"},
                "10_to_50mw":  {"min": 28, "typical": 44, "max": 66,
                                "notes": "IFS + SIS required; LA Basin substations broadly at capacity; Inland Empire preferred"},
                "50_to_100mw": {"min": 40, "typical": 60, "max": 84,
                                "notes": "230 kV or 500 kV required; Big Creek Corridor upgrades ongoing; multi-agency CEQA"},
                "100mw_plus":  {"min": 54, "typical": 78, "max": 108,
                                "notes": "Extremely difficult in LA Basin; Inland Empire (San Bernardino/Riverside) is the viable corridor"},
            },
            "steps": [
                {"step": "1", "name": "Rule 2 application / project scoping",
                 "duration_weeks": "4–10",  "cost": "$2,500–$8,000",
                 "notes": "SCE Large Customer Programs team; LA Basin among most constrained grids in US"},
                {"step": "2", "name": "CEQA / permitting assessment",
                 "duration_weeks": "8–78",  "cost": "$30,000–$300,000",
                 "notes": "LA County/Coastal Commission permitting 1–3 years; Inland Empire 6–18 months"},
                {"step": "3", "name": "Interconnection Feasibility Study (IFS)",
                 "duration_weeks": "16–30", "cost": "$50,000–$200,000",
                 "notes": "CAISO cluster study; many LA Basin substations at 0% available capacity"},
                {"step": "4", "name": "System Impact Study",
                 "duration_weeks": "30–60", "cost": "$150,000–$600,000",
                 "notes": "LA Basin: 230/500 kV upgrades common; $500M–$2B+ for large loads"},
                {"step": "5", "name": "Facilities Study",
                 "duration_weeks": "20–44", "cost": "Refundable",
                 "notes": "Final engineering; CalOSHA and CPUC safety requirements"},
                {"step": "6", "name": "Construction",
                 "duration_weeks": "52–260","cost": "Customer-funded",
                 "notes": "Most expensive construction market in US; extreme labor costs"},
            ],
            "timeline_months_min":     42,
            "timeline_months_typical": 60,
            "timeline_months_max":     96,
            "constraint_notes": [
                "LA Basin transmission is among the most congested in the Western Interconnection",
                "Big Creek Corridor (Devers–Palo Verde 500 kV): $2B+ upgrade program underway through 2030",
                "Inland Empire (San Bernardino/Riverside/Fontana): significantly more capacity than LA proper; growing data center market",
                "SCE has highest average commercial rates in the US (2024 EIA data)",
                "CPUC wildfire mitigation adds $300–600M/yr to utility capex → structural rate pressure through 2030+",
                "Water scarcity affects data center siting in parts of SCE territory (MWD area restrictions)",
            ],
        },
        "study_fees": {
            "ifs_base_usd":              50_000,
            "ifs_per_mw_usd":             2_000,
            "sis_base_usd":             150_000,
            "sis_per_mw_usd":             4_000,
            "sis_refundable_pct":            90,
            "facilities_base_usd":       200_000,
            "facilities_per_mw_usd":       5_000,
            "facilities_refundable_pct":    100,
            "application_fee_usd":          2_500,
            "deposit_per_kw_low":           110,
            "deposit_per_kw_high":          250,
            "deposit_note":               "Highest deposits in major US data center markets; LA Basin locations at upper end; Inland Empire 20–30% lower",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 150, "distribution_high": 800,
            "sub_transmission_low": 400, "sub_transmission_high": 2_000,
            "transmission_low": 800, "transmission_high": 6_000,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva": 220_000,
            "transmission_substation_per_mva": 170_000,
            "protection_relaying_base":         550_000,
            "scada_rtu_cost":                   250_000,
        },
        "rates": {
            "tariff_schedule": "Schedule TOU-8 – Large Commercial / Industrial (>200 kW)",
            "demand_charge_per_kw_month":          22.80,
            "energy_charge_per_kwh":               0.0780,
            "transmission_charge_per_kw_month":    16.40,
            "ancillary_services_per_kw_month":      2.50,
            "distribution_delivery_per_kw_month":   6.80,
            "fuel_adjustment_per_kwh":             0.0062,
            "state_tax_rate":                      0.0,
            "notes": "Highest commercial rates in continental US. CPUC approved multiple rate increases 2022–2024. On-site generation and battery storage strongly recommended for demand management.",
        },
        "special_programs": [
            {"name": "CPUC Self-Generation Incentive (SGIP)", "detail": "Battery storage rebate; reduces demand peak charges"},
            {"name": "Renewable Self-Generation Bill Credit",  "detail": "On-site solar + storage bill credit"},
            {"name": "Large Commercial Rate Discount Pilot",   "detail": "Negotiated demand response commitments for discounted rate; limited availability"},
        ],
        "competitive_intel": [
            "SCE rates are the highest in continental US; 10-year energy cost premium vs. Oncor/DFW is $150M–$500M per 100 MW campus",
            "LA Basin interconnect is among the longest in the US (5–8 years for large loads); only viable for proximity to existing fiber/carrier ecosystems",
            "Inland Empire (San Bernardino/Fontana/Rialto) is substantially more attractive: 20–30% shorter timeline, lower network upgrade cost, same CAISO market",
            "Most greenfield hyperscale development in Southern CA is moving to APS/Phoenix or Georgia Power rather than SCE due to cost and timeline",
        ],
        "regulatory": {
            "irp_process":              "CPUC IRP R.20-05-003; SB 100 mandates 100% clean energy by 2045",
            "data_center_definition_mw": 1,
            "utility_commission":        "California Public Utilities Commission (CPUC)",
        },
    },

    # ── Xcel Energy (PSCo Colorado / NSP Minnesota) ───────────────────────────
    "xcel": {
        "name":         "Xcel Energy (Public Service Company of Colorado / Northern States Power)",
        "abbreviation": "Xcel/PSCo",
        "states":       ["CO", "MN", "ND", "SD", "WI", "NM", "TX"],
        "territory":    "Denver/Front Range CO, Minneapolis–St. Paul MN, Albuquerque NM",
        "rto_iso":      "WECC / Xcel PSCo balancing authority (CO); MISO / Xcel NSP (MN)",
        "ferc_docket":  "ER",
        "interconnect": {
            "large_load_threshold_mw": 1,
            "process_name":   "PSCo Transmission Service Request + Distribution New Service (CO) / MISO DPP (MN)",
            "tariff_section": "Xcel PSCo OATT Schedule 19 (CO) / Xcel NSP MISO OATT (MN)",
            "queue_approach": "Serial FERC queue for CO (PSCo own BA); MISO DPP cluster studies for MN",
            "timeline_by_load_size": {
                "1_to_10mw":   {"min": 10, "typical": 16, "max": 26,
                                "notes": "Distribution service; Xcel large load team responsive; Front Range suburban sites preferred"},
                "10_to_50mw":  {"min": 14, "typical": 24, "max": 36,
                                "notes": "TSR + SIS required in CO; Denver Tech Center / Centennial corridor has growing load"},
                "50_to_100mw": {"min": 18, "typical": 30, "max": 46,
                                "notes": "Transmission-level study; Brighton/Longmont/Fort Collins corridor better positioned than Denver metro"},
                "100mw_plus":  {"min": 22, "typical": 38, "max": 58,
                                "notes": "Xcel CO expansion; renewable integration goals provide favorable IRP environment for large load accommodation"},
            },
            "steps": [
                {"step": "1", "name": "Pre-application / Large Load team engagement",
                 "duration_weeks": "2–6",   "cost": "No fee",
                 "notes": "Xcel has a dedicated Large Customer Services team in both CO and MN"},
                {"step": "2", "name": "Transmission Service Request (CO) / MISO Queue Filing (MN)",
                 "duration_weeks": "4–10",  "cost": "$10,000–$35,000 (CO); $25,000–$80,000 (MN)",
                 "notes": "CO uses Xcel PSCo serial queue; MN uses MISO DPP cluster cycle (18–24 months)"},
                {"step": "3", "name": "System Impact Study",
                 "duration_weeks": "18–34", "cost": "$35,000–$160,000 deposit",
                 "notes": "Identifies required network upgrades; CO Front Range generally less constrained than major coastal markets"},
                {"step": "4", "name": "Facilities Study",
                 "duration_weeks": "16–28", "cost": "Refundable toward construction",
                 "notes": "Final engineering; Xcel constructs utility portions"},
                {"step": "5", "name": "Interconnection Agreement",
                 "duration_weeks": "6–14",  "cost": "Legal fees ~$40K",
                 "notes": "CO: Colorado PUC approval; MN: MPUC oversight"},
                {"step": "6", "name": "Construction",
                 "duration_weeks": "36–104","cost": "Customer-funded",
                 "notes": "High-altitude construction premium in CO (~8% above national avg); MN cold-weather construction premium (~5%)"},
            ],
            "timeline_months_min":     22,
            "timeline_months_typical": 34,
            "timeline_months_max":     52,
            "constraint_notes": [
                "Denver metro (Arapahoe, Jefferson, Adams counties): growing fast; suburban Front Range has better capacity than Denver CBD",
                "Brighton / Longmont / Fort Collins corridor: best current headroom in CO for large loads",
                "Minnesota (Twin Cities): MISO DPP cluster dependency adds 6–12 months vs. CO serial queue",
                "Colorado 2030 clean energy mandate (HB 19-1261): 80% carbon reduction — Xcel is fastest-decarbonizing large utility in US",
                "High altitude (Denver = 5,280 ft): generators require derating (~15%); cooling equipment sizing affected",
                "Water: Colorado Data Center Water Efficiency guidelines; Xcel territory has fewer restrictions than arid AZ/CA markets",
            ],
        },
        "study_fees": {
            "tsr_base_usd":              10_000,
            "tsr_per_mw_usd":               800,
            "sis_base_usd":              35_000,
            "sis_per_mw_usd":             1_200,
            "sis_refundable_pct":           100,
            "facilities_base_usd":        55_000,
            "facilities_per_mw_usd":       1_800,
            "facilities_refundable_pct":    100,
            "application_fee_usd":          2_500,
            "deposit_per_kw_low":            50,
            "deposit_per_kw_high":           120,
            "deposit_note":               "Denver CBD at upper end; Brighton/Longmont/Fort Collins corridor at lower end; MN Twin Cities mid-range",
        },
        "network_upgrade_cost_per_kw": {
            "distribution_low": 45,  "distribution_high": 220,
            "sub_transmission_low": 120, "sub_transmission_high": 600,
            "transmission_low": 220, "transmission_high": 1_200,
            "nova_premium_multiplier": 1.0,
        },
        "customer_facilities": {
            "distribution_substation_per_mva": 105_000,
            "transmission_substation_per_mva":  82_000,
            "protection_relaying_base":         280_000,
            "scada_rtu_cost":                   115_000,
        },
        "rates": {
            "tariff_schedule": "Schedule P – Large Commercial (CO) / Schedule TOU-D (MN)",
            "demand_charge_per_kw_month":          11.50,
            "energy_charge_per_kwh":               0.0385,
            "transmission_charge_per_kw_month":     8.20,
            "ancillary_services_per_kw_month":      0.95,
            "distribution_delivery_per_kw_month":   2.90,
            "fuel_adjustment_per_kwh":             0.0022,
            "state_tax_rate":                      0.029,
            "notes": "Colorado sales tax exemption available for qualifying data center equipment (HB 23-1256). MN has separate rate schedule; rates comparable. Xcel's renewables-heavy portfolio provides clean energy at moderate premiums.",
        },
        "special_programs": [
            {"name": "Colorado HB 23-1256 Sales Tax Exemption",      "detail": "Exemption on data center equipment purchases; qualifying investment thresholds apply"},
            {"name": "Xcel Renewable*Connect Program",               "detail": "Subscription-based renewable energy; 10-year blocks; wind + solar mix"},
            {"name": "Colorado Enterprise Zone Tax Credits",          "detail": "Investment tax credits in designated enterprise zones; varies by county"},
            {"name": "Xcel Demand Response / Interruptible Service",  "detail": "Up to $120/kW for interruptible service; reduces demand charge exposure"},
        ],
        "competitive_intel": [
            "Denver/Front Range is a fast-growing data center market; lower land/labor costs than coastal markets with comparable connectivity",
            "Xcel has the lowest carbon intensity of any large US utility (2024: ~16% carbon by generation mix) — strong RE100/CDP appeal",
            "vs. ComEd/Chicago: Denver offers lower land costs, faster permitting, and comparable rates; Chicago has better fiber density",
            "vs. Oncor/DFW: Texas has lower electricity rates and faster interconnect; Colorado offers better air quality, altitude cooling benefits, and renewable story",
            "Minneapolis/NSP territory serves a secondary Midwest data center market — comparable timeline to ComEd but different MISO queue dynamics",
        ],
        "regulatory": {
            "irp_process":              "Colorado PUC Electricity Resource Plan filed per HB 19-1261; Clean Energy Plan approved 2023",
            "data_center_definition_mw": 1,
            "utility_commission":        "Colorado Public Utilities Commission (CPUC-CO) / Minnesota PUC (MPUC)",
        },
    },
}


UTILITY_ALIASES = {
    # Dominion
    "dominion_energy": "dominion", "dev": "dominion", "vepco": "dominion",
    "dominion_va": "dominion", "dominion_nc": "dominion",
    # PG&E
    "pacific_gas": "pge", "pacific_gas_electric": "pge", "pg&e": "pge",
    "pge_california": "pge",
    # ComEd
    "commonwealth_edison": "comed", "com_ed": "comed",
    # Georgia Power
    "georgia_power_company": "georgia_power", "gpc": "georgia_power",
    # APS
    "arizona_public_service": "aps", "aps_arizona": "aps",
    # Oncor
    "oncor_electric": "oncor", "oncor_tx": "oncor",
    # Duke
    "duke": "duke_energy", "dec": "duke_energy", "dep": "duke_energy",
    "duke_carolinas": "duke_energy", "duke_progress": "duke_energy",
    # SCE
    "southern_california_edison": "sce", "sce_california": "sce",
    # Xcel
    "xcel_energy": "xcel", "psco": "xcel", "nsp": "xcel",
    "public_service_colorado": "xcel", "northern_states_power": "xcel",
    "xcel_co": "xcel", "xcel_mn": "xcel",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Voltage selection
# ═══════════════════════════════════════════════════════════════════════════════

def select_voltage(load_mw: float, requested_kv) -> "tuple[float, str]":
    """Return (voltage_kv, voltage_class) based on load size or explicit request."""
    if requested_kv is not None:
        if requested_kv < 35:
            return requested_kv, "distribution"
        elif requested_kv < 100:
            return requested_kv, "sub_transmission"
        else:
            return requested_kv, "transmission"
    # Auto-select by load
    if load_mw <= 5:
        return 12.47, "distribution"
    elif load_mw <= 20:
        return 34.5, "sub_transmission"
    elif load_mw <= 80:
        return 69.0, "sub_transmission"
    elif load_mw <= 300:
        return 115.0, "transmission"
    else:
        return 230.0, "transmission"


# ═══════════════════════════════════════════════════════════════════════════════
# Cost estimators
# ═══════════════════════════════════════════════════════════════════════════════

def estimate_study_deposits(u: dict, load_mw: float) -> dict:
    sf = u["study_fees"]
    sis_base  = sf.get("sis_base_usd", sf.get("tsr_base_usd",
                    sf.get("ercot_reg_base_usd", 30_000)))
    sis_rate  = sf.get("sis_per_mw_usd", sf.get("tsr_per_mw_usd",
                    sf.get("ercot_reg_per_mw_usd", 1_000)))
    fac_base  = sf.get("facilities_base_usd", 75_000)
    fac_rate  = sf.get("facilities_per_mw_usd", 2_000)
    ifs_base  = sf.get("ifs_base_usd", sf.get("dsfs_base_usd", 0))
    ifs_rate  = sf.get("ifs_per_mw_usd", sf.get("dsfs_per_mw_usd", 0))
    ref_pct   = sf.get("sis_refundable_pct", 100)
    fac_ref   = sf.get("facilities_refundable_pct", 100)
    app_fee   = sf.get("application_fee_usd", 0)

    sis_total = sis_base + sis_rate * load_mw
    fac_total = fac_base + fac_rate * load_mw
    ifs_total = ifs_base + ifs_rate * load_mw if ifs_base else 0
    total     = app_fee + sis_total + fac_total + ifs_total

    # $/kW summary
    load_kw   = load_mw * 1000
    dep_low   = sf.get("deposit_per_kw_low",  50)
    dep_high  = sf.get("deposit_per_kw_high", 150)

    return {
        "application_fee_usd":         app_fee,
        "feasibility_ifs_study_usd":   round(ifs_total) if ifs_total else None,
        "system_impact_study_usd":     round(sis_total),
        "facilities_study_usd":        round(fac_total),
        "total_study_deposits_usd":    round(total),
        "refundable_usd":              round(sis_total * ref_pct/100 + fac_total * fac_ref/100),
        "non_refundable_usd":          round(app_fee + sis_total*(1-ref_pct/100) + fac_total*(1-fac_ref/100)),
        "sis_refundable_pct":          ref_pct,
        "facilities_refundable_pct":   fac_ref,
        "deposit_per_kw_range_low":    dep_low,
        "deposit_per_kw_range_high":   dep_high,
        "deposit_range_low_usd":       round(dep_low  * load_kw),
        "deposit_range_high_usd":      round(dep_high * load_kw),
        "deposit_note":                sf.get("deposit_note", ""),
    }


def estimate_network_upgrades(u: dict, load_mw: float, voltage_class: str) -> dict:
    nc    = u["network_upgrade_cost_per_kw"]
    low_k = f"{voltage_class}_low"
    hi_k  = f"{voltage_class}_high"
    low   = nc.get(low_k, 100)
    high  = nc.get(hi_k,  800)
    mult  = nc.get("nova_premium_multiplier", 1.0) if u.get("tier_1_dc_hub") else 1.0
    load_kw = load_mw * 1000

    low_cost  = round(low  * load_kw * mult)
    high_cost = round(high * load_kw * mult)
    mid_cost  = round((low_cost + high_cost) / 2)

    return {
        "low_usd":     low_cost,
        "typical_usd": mid_cost,
        "high_usd":    high_cost,
        "per_kw_low":  low  * mult,
        "per_kw_high": high * mult,
        "note": ("Northern VA premium applied (heavily constrained PJM zone)"
                 if mult > 1.0 else
                 "Actual cost determined by System Impact Study; wide range is normal"),
    }


def estimate_customer_facilities(u: dict, load_mw: float, voltage_class: str) -> dict:
    cf   = u["customer_facilities"]
    mva  = load_mw / 0.85   # assume 0.85 PF
    rate = (cf["distribution_substation_per_mva"]
            if voltage_class == "distribution"
            else cf["transmission_substation_per_mva"])
    sub   = round(rate * mva)
    prot  = cf["protection_relaying_base"]
    scada = cf["scada_rtu_cost"]
    civil = round(load_mw * 8_000)   # $8K/MW civil/grounding/cabling
    total = sub + prot + scada + civil
    return {
        "switchgear_transformer_usd":    sub,
        "protection_relaying_usd":       prot,
        "scada_rtu_usd":                 scada,
        "civil_grounding_usd":           civil,
        "total_customer_facilities_usd": total,
        "note": "Customer is responsible for on-site substation, service entrance cabling, and metering",
    }


def estimate_annual_cost(u: dict, load_mw: float, load_factor: float = 0.85) -> dict:
    r        = u["rates"]
    load_kw  = load_mw * 1000
    hours_yr = 8_760
    kwh_yr   = load_kw * hours_yr * load_factor

    annual_demand       = r["demand_charge_per_kw_month"]         * load_kw * 12
    annual_energy       = r["energy_charge_per_kwh"]               * kwh_yr
    annual_transmission = r["transmission_charge_per_kw_month"]    * load_kw * 12
    annual_ancillary    = r["ancillary_services_per_kw_month"]     * load_kw * 12
    annual_delivery     = r["distribution_delivery_per_kw_month"]  * load_kw * 12
    annual_fuel_adj     = r["fuel_adjustment_per_kwh"]             * kwh_yr
    subtotal            = (annual_demand + annual_energy + annual_transmission +
                           annual_ancillary + annual_delivery + annual_fuel_adj)
    tax                 = subtotal * r["state_tax_rate"]
    total               = subtotal + tax

    return {
        "load_factor_assumed":         load_factor,
        "annual_kwh":                  round(kwh_yr),
        "demand_charges_usd":          round(annual_demand),
        "energy_charges_usd":          round(annual_energy),
        "transmission_charges_usd":    round(annual_transmission),
        "ancillary_services_usd":      round(annual_ancillary),
        "delivery_charges_usd":        round(annual_delivery),
        "fuel_adjustment_usd":         round(annual_fuel_adj),
        "taxes_usd":                   round(tax),
        "total_annual_cost_usd":       round(total),
        "effective_rate_per_kwh":      round(total / kwh_yr, 5),
        "per_mw_per_year_usd":         round(total / load_mw),
        "tariff_schedule":             r["tariff_schedule"],
        "notes":                       r["notes"],
    }


def _get_timeline_for_load(u: dict, load_mw: float) -> dict:
    """Return the per-load-size timeline dict."""
    tbls = u["interconnect"].get("timeline_by_load_size", {})
    if load_mw < 10:
        return tbls.get("1_to_10mw", {})
    elif load_mw < 50:
        return tbls.get("10_to_50mw", {})
    elif load_mw < 100:
        return tbls.get("50_to_100mw", {})
    else:
        return tbls.get("100mw_plus", {})


# ═══════════════════════════════════════════════════════════════════════════════
# Warnings
# ═══════════════════════════════════════════════════════════════════════════════

def _build_warnings(u: dict, load_mw: float, v_class: str, state: str | None) -> list:
    warnings = []
    abbr = u["abbreviation"]
    key  = u.get("utility_key_internal", "")

    # State mismatch
    if state and state.upper() not in [s.upper() for s in u["states"]]:
        warnings.append(
            f"STATE MISMATCH: Requested state '{state.upper()}' is not in {abbr} service territory "
            f"({', '.join(u['states'])}). Verify the correct utility for this location."
        )

    # NOVA congestion
    if u.get("tier_1_dc_hub") and load_mw > 50:
        warnings.append(
            "HIGH DEMAND AREA: Northern VA power queue is severely constrained. "
            "Engage Dominion pre-application team immediately; capacity may not be "
            "available for 5–7 years without an existing queue position. "
            "Consider Richmond or Hampton Roads for faster availability."
        )

    # SCE LA Basin
    if abbr == "SCE" and load_mw > 20:
        warnings.append(
            "LA BASIN ALERT: SCE territory has very limited available transmission capacity. "
            "Inland Empire (San Bernardino/Riverside) is strongly preferred for new large loads. "
            "Expect 5–8 year timeline and $500M–$2B+ network upgrade exposure in the LA Basin."
        )

    # CAISO queue (PG&E)
    if abbr == "PG&E" and load_mw > 30:
        warnings.append(
            "CAISO QUEUE: 180+ GW in CAISO interconnection queue (2024). "
            "Queue position may not be reached for 4–6 years at constrained substations. "
            "Sacramento Valley and Central Valley offer 12–24 months faster timelines."
        )

    # Large load universal
    if v_class == "transmission" and load_mw > 200:
        warnings.append(
            "LARGE LOAD: Loads >200 MW at transmission voltage will likely trigger major "
            "network upgrades. Budget $100M–$2B+ and 4–8 years for permitting and construction."
        )

    # ERCOT deregulation
    if abbr == "Oncor":
        warnings.append(
            "ERCOT MARKET: Texas is deregulated; electricity commodity is not purchased from Oncor. "
            "You must separately procure retail electric service from a licensed REP. "
            "ERCOT 4CP demand charges can add $2–8M/yr for large loads."
        )

    # High rate alert
    if u["rates"]["demand_charge_per_kw_month"] > 18:
        warnings.append(
            f"HIGH RATE ALERT: {abbr} demand charges "
            f"(${u['rates']['demand_charge_per_kw_month']}/kW-mo) are among the highest in the US. "
            "On-site generation and demand response are strongly recommended."
        )

    # Xcel altitude
    if abbr == "Xcel/PSCo" and "CO" in u["states"]:
        warnings.append(
            "HIGH ALTITUDE: Denver Front Range sites (5,000–5,500 ft) require generator derating "
            "(≈15% capacity reduction) and affect cooling equipment sizing. Factor into facility design."
        )

    # MN MISO cluster
    if abbr == "Xcel/PSCo" and state and state.upper() == "MN":
        warnings.append(
            "MINNESOTA / MISO: Northern States Power (MN) uses MISO DPP cluster queue, which adds "
            "6–12 months vs. the Colorado serial queue process. Confirm territory before starting studies."
        )

    return warnings


# ═══════════════════════════════════════════════════════════════════════════════
# Main sizing function
# ═══════════════════════════════════════════════════════════════════════════════

def size_interconnect(
    utility_key: str,
    load_mw: float,
    voltage_kv=None,
    load_type: str = "data_center",
    state: str | None = None,
) -> dict:

    key = UTILITY_ALIASES.get(utility_key.lower(), utility_key.lower())
    if key not in UTILITIES:
        raise ValueError(
            f"Unknown utility '{utility_key}'. Valid keys: "
            + ", ".join(sorted(UTILITIES.keys()))
        )
    if not (1 <= load_mw <= 500):
        raise ValueError(f"load_mw must be 1–500, got {load_mw}")

    u               = UTILITIES[key]
    u["utility_key_internal"] = key   # used in warnings
    ic              = u["interconnect"]
    v_kv, v_class   = select_voltage(load_mw, voltage_kv)

    study_deps  = estimate_study_deposits(u, load_mw)
    net_upgr    = estimate_network_upgrades(u, load_mw, v_class)
    cust_fac    = estimate_customer_facilities(u, load_mw, v_class)
    annual      = estimate_annual_cost(u, load_mw)
    tl_detail   = _get_timeline_for_load(u, load_mw)

    # 10-year NPV of electricity cost (3% escalation, 8% discount rate)
    ann      = annual["total_annual_cost_usd"]
    npv_10yr = round(sum(ann * (1.03**y) / (1.08**y) for y in range(1, 11)))

    # First-year total cost: upfront (low estimate) + first year operating
    first_year_total_low  = study_deps["deposit_range_low_usd"]  + net_upgr["low_usd"]  + cust_fac["total_customer_facilities_usd"] + annual["total_annual_cost_usd"]
    first_year_total_high = study_deps["deposit_range_high_usd"] + net_upgr["high_usd"] + cust_fac["total_customer_facilities_usd"] + annual["total_annual_cost_usd"]

    process = {
        "process_name":              ic["process_name"],
        "tariff_section":            ic.get("tariff_section", ""),
        "queue_approach":            ic.get("queue_approach", ""),
        "timeline_months_min":       tl_detail.get("min",     ic["timeline_months_min"]),
        "timeline_months_typical":   tl_detail.get("typical", ic["timeline_months_typical"]),
        "timeline_months_max":       tl_detail.get("max",     ic["timeline_months_max"]),
        "timeline_note":             tl_detail.get("notes",   ""),
        "steps":                     ic["steps"],
        "constraint_notes":          ic["constraint_notes"],
    }

    return {
        "utility":      u["name"],
        "utility_key":  key,
        "abbreviation": u["abbreviation"],
        "states":       u["states"],
        "territory":    u["territory"],
        "rto_iso":      u["rto_iso"],
        "input": {
            "load_mw":       load_mw,
            "load_kw":       load_mw * 1000,
            "voltage_kv":    v_kv,
            "voltage_class": v_class,
            "load_type":     load_type,
            "state":         state.upper() if state else None,
        },
        "interconnect_process":    process,
        "costs": {
            "study_deposits":              study_deps,
            "network_upgrades_estimate":   net_upgr,
            "customer_facilities_estimate": cust_fac,
            "total_upfront_low_usd":       round(study_deps["total_study_deposits_usd"] + net_upgr["low_usd"]  + cust_fac["total_customer_facilities_usd"]),
            "total_upfront_high_usd":      round(study_deps["total_study_deposits_usd"] + net_upgr["high_usd"] + cust_fac["total_customer_facilities_usd"]),
            "first_year_total_low_usd":    round(first_year_total_low),
            "first_year_total_high_usd":   round(first_year_total_high),
        },
        "annual_operating_cost":       annual,
        "10yr_electricity_npv_usd":    npv_10yr,
        "rate_structure": {
            "tariff":                         u["rates"]["tariff_schedule"],
            "demand_usd_per_kw_month":        u["rates"]["demand_charge_per_kw_month"],
            "energy_usd_per_kwh":             u["rates"]["energy_charge_per_kwh"],
            "transmission_usd_per_kw_month":  u["rates"]["transmission_charge_per_kw_month"],
            "effective_all_in_rate_per_kwh":  annual["effective_rate_per_kwh"],
        },
        "special_programs":  u.get("special_programs", []),
        "competitive_intel": u.get("competitive_intel", []),
        "regulatory":        u.get("regulatory", {}),
        "warnings":          _build_warnings(u, load_mw, v_class, state),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "Usage: utility_interconnect.py <utility> <load_mw> "
            "[voltage_kv|auto] [load_type] [state]",
            file=sys.stderr,
        )
        print("Utilities:", ", ".join(sorted(UTILITIES.keys())), file=sys.stderr)
        sys.exit(1)

    try:
        util    = sys.argv[1]
        load_mw = float(sys.argv[2])
        volt_kv = (float(sys.argv[3])
                   if len(sys.argv) > 3 and sys.argv[3] not in ("auto", "")
                   else None)
        ltype   = sys.argv[4] if len(sys.argv) > 4 else "data_center"
        state   = sys.argv[5] if len(sys.argv) > 5 else None

        result = size_interconnect(util, load_mw, volt_kv, ltype, state)
        print(json.dumps(result, indent=2))
        sys.exit(0)

    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}), file=sys.stderr)
        sys.exit(2)
