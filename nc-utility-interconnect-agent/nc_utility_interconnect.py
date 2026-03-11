#!/usr/bin/env python3
"""
NC Utility Interconnect Agent  v1.0
=====================================
Detailed interconnect estimates for loads (1–500 MW) served by the
North Carolina bulk-power provider covering the Carolinas service territory.

Data: FERC OASIS filings, NC OATT tariff schedules, RTO/ISO posted study
fees, NC utility commission proceedings, and industry benchmarks (2024–2025).

Usage:
    python nc_utility_interconnect.py <load_mw> [voltage_kv|auto] [load_type] [state]

    load_mw    : 1 – 500
    voltage_kv : requested delivery voltage, or "auto" to select by load size
    load_type  : data_center | industrial | commercial  (default: data_center)
    state      : two-letter state code (NC or SC recommended; optional)

Output: JSON to stdout, diagnostics to stderr.
"""

import sys, json, math

# ═══════════════════════════════════════════════════════════════════════════════
# NC Utility data
# ═══════════════════════════════════════════════════════════════════════════════

NC_UTILITY = {
    "name":         "NC Utility (Carolinas)",
    "abbreviation": "NCU",
    "states":       ["NC", "SC", "IN", "OH", "FL"],
    "territory":    "Western Carolinas, Charlotte metro, Research Triangle NC, Piedmont NC/SC",
    "rto_iso":      "PJM / SERC Reliability Corp / Carolinas Balancing Authority",
    "ferc_docket":  "ER",
    "interconnect": {
        "large_load_threshold_mw": 5,
        "process_name":   "NC Utility Large Load Interconnection / Transmission Service Request",
        "tariff_section": "NC OATT Schedule 23 / Rate Schedule ED",
        "queue_approach": "Serial FERC queue; utility is own Transmission Owner and Balancing Authority in Carolinas",
        "timeline_by_load_size": {
            "1_to_10mw":   {"min": 10, "typical": 16, "max": 24,
                            "notes": "Distribution service; Large Load Response Team; RTP area load growth accelerating"},
            "10_to_50mw":  {"min": 14, "typical": 22, "max": 34,
                            "notes": "TSR + SIS required; Triad (Greensboro/Winston-Salem) less constrained than Charlotte/RTP"},
            "50_to_100mw": {"min": 18, "typical": 28, "max": 42,
                            "notes": "Transmission-level study; Charlotte I-77 corridor and RTP Area 3 have limited headroom"},
            "100mw_plus":  {"min": 22, "typical": 36, "max": 56,
                            "notes": "NC Carbon Plan accommodates load growth; rural NC Piedmont sites 12–18 months faster than metro"},
        },
        "steps": [
            {"step": "1", "name": "Pre-application / Large Load team engagement",
             "duration_weeks": "2–6",    "cost": "No fee",
             "notes": "Dedicated Large Load Response Team; Charlotte/RTP area very active 2023–2025"},
            {"step": "2", "name": "Transmission Service Request (TSR)",
             "duration_weeks": "4–10",   "cost": "$10,000–$40,000",
             "notes": "Utility evaluates transmission path; RTP sub-market is most loaded"},
            {"step": "3", "name": "System Impact Study (SIS)",
             "duration_weeks": "18–34",  "cost": "$40,000–$200,000",
             "notes": "Identifies network upgrades; Charlotte moderately constrained; Triad/rural sites cheaper"},
            {"step": "4", "name": "Facilities Study",
             "duration_weeks": "16–28",  "cost": "Refundable",
             "notes": "Final engineering; utility constructs delivery point equipment"},
            {"step": "5", "name": "Interconnection Agreement",
             "duration_weeks": "6–14",   "cost": "Legal fees ~$45K",
             "notes": "FERC-approved form; NCUC oversight"},
            {"step": "6", "name": "Construction",
             "duration_weeks": "36–104", "cost": "Customer-funded",
             "notes": "Utility constructs utility portion; 12–36 months for large substations"},
        ],
        "timeline_months_min":     20,
        "timeline_months_typical": 32,
        "timeline_months_max":     54,
        "constraint_notes": [
            "Research Triangle Park and Charlotte are heavily loaded; new substations required for most >50 MW loads",
            "NC Carbon Plan (per NC HB 951) targets 18 GW of new capacity through 2035 to serve load growth",
            "Nuclear baseload provides low-carbon 24/7 power — key draw for hyperscaler renewable energy commitments",
            "Triad (Greensboro/Winston-Salem/High Point) and rural NC Piedmont: less congested, meaningfully lower network upgrade costs",
            "Indiana/Ohio territory is MISO-connected with a different queue process from Carolinas",
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
        "deposit_per_kw_high":          120,
        "deposit_note": "Charlotte/RTP metro at upper end; rural NC Piedmont and Triad typically 30–40% lower",
    },
    "network_upgrade_cost_per_kw": {
        "distribution_low":       35,  "distribution_high":      200,
        "sub_transmission_low":   90,  "sub_transmission_high":  500,
        "transmission_low":      180,  "transmission_high":    1_100,
        "nova_premium_multiplier": 1.0,
    },
    "customer_facilities": {
        "distribution_substation_per_mva":  95_000,
        "transmission_substation_per_mva":  75_000,
        "protection_relaying_base":        270_000,
        "scada_rtu_cost":                  110_000,
    },
    "rates": {
        "tariff_schedule":                    "Schedule EP-5 – Extra Large Power (>1,000 kW)",
        "demand_charge_per_kw_month":          10.20,
        "energy_charge_per_kwh":               0.0322,
        "transmission_charge_per_kw_month":     7.20,
        "ancillary_services_per_kw_month":      0.90,
        "distribution_delivery_per_kw_month":   2.50,
        "fuel_adjustment_per_kwh":             0.0055,
        "state_tax_rate":                      0.0475,
        "notes": "NC data centers exempt from sales tax on electricity if >$75M investment (NCGS 105-164.13). Renewable PPA programs available.",
    },
    "special_programs": [
        {"name": "NC Data Center Sales Tax Exemption",
         "detail": "NCGS 105-164.13: electricity sales tax exemption for data centers investing >$75M and creating 5+ jobs"},
        {"name": "Economic Development Rate (ED)",
         "detail": "Discounted rates for new qualifying large loads; negotiated case-by-case"},
        {"name": "NC Renewable Energy Procurement Program",
         "detail": "Renewable energy PPA options available for hyperscale/sustainability commitments"},
        {"name": "NC OneNC Incentive Package",
         "detail": "State grants and tax credits for large capital investments; EDPNC coordinates"},
    ],
    "competitive_intel": [
        "Research Triangle is a top-5 US data center market; Charlotte is top-10 — both growing rapidly with strong state incentives",
        "NC utility rates are 25–30% lower than northern VA equivalents, with comparable nuclear clean energy story",
        "vs. Georgia Power: GA offers lower rates (~10–15%) and faster typical timeline, but NC has stronger workforce and data center ecosystem",
        "Rural NC Piedmont sites (Alamance, Randolph, Guilford counties) offer the best timeline and cost profile outside metro areas",
    ],
    "regulatory": {
        "irp_process":               "NC Carbon Plan filed per NC HB 951; approved by NCUC",
        "data_center_definition_mw":  1,
        "utility_commission":         "North Carolina Utilities Commission (NCUC) / South Carolina PSC",
    },
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
    if load_mw <= 5:
        return 12.47, "distribution"
    elif load_mw <= 20:
        return 34.5,  "sub_transmission"
    elif load_mw <= 80:
        return 69.0,  "sub_transmission"
    elif load_mw <= 300:
        return 115.0, "transmission"
    else:
        return 230.0, "transmission"


# ═══════════════════════════════════════════════════════════════════════════════
# Cost estimators
# ═══════════════════════════════════════════════════════════════════════════════

def estimate_study_deposits(u: dict, load_mw: float) -> dict:
    sf       = u["study_fees"]
    sis_base = sf.get("sis_base_usd", sf.get("tsr_base_usd", 30_000))
    sis_rate = sf.get("sis_per_mw_usd", sf.get("tsr_per_mw_usd", 1_000))
    fac_base = sf.get("facilities_base_usd", 75_000)
    fac_rate = sf.get("facilities_per_mw_usd", 2_000)
    ref_pct  = sf.get("sis_refundable_pct", 100)
    fac_ref  = sf.get("facilities_refundable_pct", 100)
    app_fee  = sf.get("application_fee_usd", 0)

    sis_total = sis_base + sis_rate * load_mw
    fac_total = fac_base + fac_rate * load_mw
    total     = app_fee + sis_total + fac_total

    load_kw  = load_mw * 1000
    dep_low  = sf.get("deposit_per_kw_low",  50)
    dep_high = sf.get("deposit_per_kw_high", 120)

    return {
        "application_fee_usd":        app_fee,
        "system_impact_study_usd":    round(sis_total),
        "facilities_study_usd":       round(fac_total),
        "total_study_deposits_usd":   round(total),
        "refundable_usd":             round(sis_total * ref_pct/100 + fac_total * fac_ref/100),
        "non_refundable_usd":         round(app_fee + sis_total*(1-ref_pct/100) + fac_total*(1-fac_ref/100)),
        "sis_refundable_pct":         ref_pct,
        "facilities_refundable_pct":  fac_ref,
        "deposit_per_kw_range_low":   dep_low,
        "deposit_per_kw_range_high":  dep_high,
        "deposit_range_low_usd":      round(dep_low  * load_kw),
        "deposit_range_high_usd":     round(dep_high * load_kw),
        "deposit_note":               sf.get("deposit_note", ""),
    }


def estimate_network_upgrades(u: dict, load_mw: float, voltage_class: str) -> dict:
    nc      = u["network_upgrade_cost_per_kw"]
    low_k   = f"{voltage_class}_low"
    hi_k    = f"{voltage_class}_high"
    low     = nc.get(low_k,  100)
    high    = nc.get(hi_k,   800)
    load_kw = load_mw * 1000

    low_cost  = round(low  * load_kw)
    high_cost = round(high * load_kw)
    mid_cost  = round((low_cost + high_cost) / 2)

    return {
        "low_usd":     low_cost,
        "typical_usd": mid_cost,
        "high_usd":    high_cost,
        "per_kw_low":  low,
        "per_kw_high": high,
        "note": "Actual cost determined by System Impact Study; wide range is normal at this stage",
    }


def estimate_customer_facilities(u: dict, load_mw: float, voltage_class: str) -> dict:
    cf   = u["customer_facilities"]
    mva  = load_mw / 0.85
    rate = (cf["distribution_substation_per_mva"]
            if voltage_class == "distribution"
            else cf["transmission_substation_per_mva"])
    sub   = round(rate * mva)
    prot  = cf["protection_relaying_base"]
    scada = cf["scada_rtu_cost"]
    civil = round(load_mw * 8_000)
    total = sub + prot + scada + civil
    return {
        "switchgear_transformer_usd":    sub,
        "protection_relaying_usd":       prot,
        "scada_rtu_usd":                 scada,
        "civil_grounding_usd":           civil,
        "total_customer_facilities_usd": total,
        "note": "Customer responsible for on-site substation, service entrance cabling, and metering",
    }


def estimate_annual_cost(u: dict, load_mw: float, load_factor: float = 0.85) -> dict:
    r        = u["rates"]
    load_kw  = load_mw * 1000
    hours_yr = 8_760
    kwh_yr   = load_kw * hours_yr * load_factor

    annual_demand       = r["demand_charge_per_kw_month"]        * load_kw * 12
    annual_energy       = r["energy_charge_per_kwh"]              * kwh_yr
    annual_transmission = r["transmission_charge_per_kw_month"]   * load_kw * 12
    annual_ancillary    = r["ancillary_services_per_kw_month"]    * load_kw * 12
    annual_delivery     = r["distribution_delivery_per_kw_month"] * load_kw * 12
    annual_fuel_adj     = r["fuel_adjustment_per_kwh"]            * kwh_yr
    subtotal            = (annual_demand + annual_energy + annual_transmission +
                           annual_ancillary + annual_delivery + annual_fuel_adj)
    tax   = subtotal * r["state_tax_rate"]
    total = subtotal + tax

    return {
        "load_factor_assumed":        load_factor,
        "annual_kwh":                 round(kwh_yr),
        "demand_charges_usd":         round(annual_demand),
        "energy_charges_usd":         round(annual_energy),
        "transmission_charges_usd":   round(annual_transmission),
        "ancillary_services_usd":     round(annual_ancillary),
        "delivery_charges_usd":       round(annual_delivery),
        "fuel_adjustment_usd":        round(annual_fuel_adj),
        "taxes_usd":                  round(tax),
        "total_annual_cost_usd":      round(total),
        "effective_rate_per_kwh":     round(total / kwh_yr, 5),
        "per_mw_per_year_usd":        round(total / load_mw),
        "demand_charges_per_mw_year": round(annual_demand / load_mw),
        "tariff_schedule":            r["tariff_schedule"],
        "notes":                      r["notes"],
    }


def _get_timeline_for_load(u: dict, load_mw: float) -> dict:
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

    # State mismatch
    if state and state.upper() not in [s.upper() for s in u["states"]]:
        warnings.append(
            f"STATE MISMATCH: Requested state '{state.upper()}' is not in the NC utility service territory "
            f"({', '.join(u['states'])}). Verify the correct utility for this location."
        )

    # RTP / Charlotte congestion
    if load_mw > 50:
        warnings.append(
            "METRO CONSTRAINT: Research Triangle Park (RTP) and Charlotte I-77 corridor are heavily "
            "loaded. New substations are required for most loads >50 MW. "
            "Consider Triad or rural NC Piedmont sites for 12–18 month timeline savings."
        )

    # Large load universal
    if v_class == "transmission" and load_mw > 200:
        warnings.append(
            "LARGE LOAD: Loads >200 MW at transmission voltage will likely trigger major network "
            "upgrades. Budget $100M–$2B+ and 4–8 years for permitting and construction."
        )

    # NC tax exemption reminder
    if load_mw >= 20:
        warnings.append(
            "NC TAX INCENTIVE: Verify eligibility for NCGS 105-164.13 electricity sales tax exemption "
            "(requires >$75M investment and 5+ jobs). Can significantly reduce operating costs."
        )

    return warnings


# ═══════════════════════════════════════════════════════════════════════════════
# Main sizing function
# ═══════════════════════════════════════════════════════════════════════════════

def size_interconnect(
    load_mw:    float,
    voltage_kv=None,
    load_type:  str = "data_center",
    state:      "str | None" = None,
) -> dict:

    if not (1 <= load_mw <= 500):
        raise ValueError(f"load_mw must be 1–500, got {load_mw}")

    u              = NC_UTILITY
    ic             = u["interconnect"]
    v_kv, v_class  = select_voltage(load_mw, voltage_kv)

    study_deps = estimate_study_deposits(u, load_mw)
    net_upgr   = estimate_network_upgrades(u, load_mw, v_class)
    cust_fac   = estimate_customer_facilities(u, load_mw, v_class)
    annual     = estimate_annual_cost(u, load_mw)
    tl_detail  = _get_timeline_for_load(u, load_mw)

    # 10-year NPV of electricity cost (3% escalation, 8% discount rate)
    ann      = annual["total_annual_cost_usd"]
    npv_10yr = round(sum(ann * (1.03**y) / (1.08**y) for y in range(1, 11)))

    first_year_total_low  = (study_deps["deposit_range_low_usd"]  + net_upgr["low_usd"]
                             + cust_fac["total_customer_facilities_usd"] + annual["total_annual_cost_usd"])
    first_year_total_high = (study_deps["deposit_range_high_usd"] + net_upgr["high_usd"]
                             + cust_fac["total_customer_facilities_usd"] + annual["total_annual_cost_usd"])

    process = {
        "process_name":            ic["process_name"],
        "tariff_section":          ic.get("tariff_section", ""),
        "queue_approach":          ic.get("queue_approach", ""),
        "timeline_months_min":     tl_detail.get("min",     ic["timeline_months_min"]),
        "timeline_months_typical": tl_detail.get("typical", ic["timeline_months_typical"]),
        "timeline_months_max":     tl_detail.get("max",     ic["timeline_months_max"]),
        "timeline_note":           tl_detail.get("notes",   ""),
        "steps":                   ic["steps"],
        "constraint_notes":        ic["constraint_notes"],
    }

    return {
        "utility":      u["name"],
        "utility_key":  "nc_utility",
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
        "annual_operating_cost":     annual,
        "10yr_electricity_npv_usd":  npv_10yr,
        "rate_structure": {
            "tariff":                        u["rates"]["tariff_schedule"],
            "demand_usd_per_kw_month":       u["rates"]["demand_charge_per_kw_month"],
            "energy_usd_per_kwh":            u["rates"]["energy_charge_per_kwh"],
            "transmission_usd_per_kw_month": u["rates"]["transmission_charge_per_kw_month"],
            "effective_all_in_rate_per_kwh": annual["effective_rate_per_kwh"],
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
    if len(sys.argv) < 2:
        print(
            "Usage: nc_utility_interconnect.py <load_mw> [voltage_kv|auto] [load_type] [state]",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        load_mw = float(sys.argv[1])
        volt_kv = (float(sys.argv[2])
                   if len(sys.argv) > 2 and sys.argv[2] not in ("auto", "")
                   else None)
        ltype   = sys.argv[3] if len(sys.argv) > 3 else "data_center"
        state   = sys.argv[4] if len(sys.argv) > 4 else None

        result = size_interconnect(load_mw, volt_kv, ltype, state)
        print(json.dumps(result, indent=2))
        sys.exit(0)

    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}), file=sys.stderr)
        sys.exit(2)
