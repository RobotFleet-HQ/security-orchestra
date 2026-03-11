#!/usr/bin/env python3
"""
Data Center Construction Cost Agent  v1.0
==========================================
Estimates construction costs for data center development projects using
industry benchmark data from JLL, CBRE, Cushman & Wakefield, and Turner &
Townsend Global Data Center Cost Index 2023-2024.

    Base: New-build Tier III in Southeast/Mid-Atlantic (US average market)
    Regional, tier, and building-type multipliers applied on top of base.

Usage:
    python construction_cost.py <capacity_mw>
        [tier]
        [region]
        [building_type]
        [electricity_rate_per_kwh]

    capacity_mw             : IT load capacity in MW (0.1–1000)
    tier                    : tier1 | tier2 | tier3 | tier4  (default: tier3)
    region                  : northeast | mid_atlantic | southeast | midwest |
                              southwest | mountain | pacific | pacific_nw  (default: southeast)
    building_type           : new_build | shell_core | retrofit  (default: new_build)
    electricity_rate_per_kwh: $/kWh for annual opex estimate  (default: 0.07)

Output: JSON to stdout, diagnostics to stderr.
"""

import sys, json, math

# ═══════════════════════════════════════════════════════════════════════════════
# Base costs ($/MW of IT load)  —  Tier III, new build, Southeast / US average
# Source: JLL Data Center Outlook 2024, Turner & Townsend GDCCI 2023,
#         CBRE Global Data Center Trends 2024
# ═══════════════════════════════════════════════════════════════════════════════

BASE_COSTS_PER_MW = {
    # ── Shell & Civil ─────────────────────────────────────────────────────────
    "site_prep_earthwork":      {"low": 180_000, "typical": 280_000, "high": 420_000},
    "building_structure":       {"low": 750_000, "typical": 1_100_000, "high": 1_600_000},
    "roofing_envelope":         {"low": 180_000, "typical": 280_000, "high": 420_000},
    # ── Electrical ────────────────────────────────────────────────────────────
    "mv_switchgear_transformers": {"low": 380_000, "typical": 580_000, "high": 820_000},
    "ups_systems":              {"low": 550_000, "typical": 820_000, "high": 1_150_000},
    "generators_fuel_systems":  {"low": 480_000, "typical": 720_000, "high": 1_050_000},
    "pdu_lv_distribution":      {"low": 180_000, "typical": 280_000, "high": 420_000},
    "busway_cable_management":  {"low": 130_000, "typical": 200_000, "high": 300_000},
    # ── Mechanical ────────────────────────────────────────────────────────────
    "chilled_water_plant":      {"low": 750_000, "typical": 1_100_000, "high": 1_600_000},
    "cooling_units_crac_crah":  {"low": 280_000, "typical": 420_000, "high": 620_000},
    "piping_hvac_plumbing":     {"low": 360_000, "typical": 540_000, "high": 800_000},
    "bms_controls":             {"low": 90_000,  "typical": 140_000, "high": 200_000},
    # ── IT Infrastructure ─────────────────────────────────────────────────────
    "raised_floor_structure":   {"low": 70_000,  "typical": 110_000, "high": 160_000},
    "cable_trays_pathways":     {"low": 90_000,  "typical": 140_000, "high": 210_000},
    "fiber_structured_cabling": {"low": 70_000,  "typical": 110_000, "high": 160_000},
    "dcim_monitoring":          {"low": 45_000,  "typical": 70_000,  "high": 110_000},
    # ── Security & Fire ───────────────────────────────────────────────────────
    "physical_security":        {"low": 70_000,  "typical": 110_000, "high": 160_000},
    "fire_suppression":         {"low": 110_000, "typical": 170_000, "high": 260_000},
}

COST_CATEGORIES = {
    "shell_civil": [
        "site_prep_earthwork", "building_structure", "roofing_envelope",
    ],
    "electrical": [
        "mv_switchgear_transformers", "ups_systems", "generators_fuel_systems",
        "pdu_lv_distribution", "busway_cable_management",
    ],
    "mechanical": [
        "chilled_water_plant", "cooling_units_crac_crah",
        "piping_hvac_plumbing", "bms_controls",
    ],
    "it_infrastructure": [
        "raised_floor_structure", "cable_trays_pathways",
        "fiber_structured_cabling", "dcim_monitoring",
    ],
    "security_fire": [
        "physical_security", "fire_suppression",
    ],
}

COST_LABELS = {
    "site_prep_earthwork":        "Site prep & earthwork",
    "building_structure":         "Building structure",
    "roofing_envelope":           "Roofing & building envelope",
    "mv_switchgear_transformers": "MV switchgear & transformers",
    "ups_systems":                "UPS systems",
    "generators_fuel_systems":    "Generators & fuel systems",
    "pdu_lv_distribution":        "PDUs & LV distribution",
    "busway_cable_management":    "Busway & cable management",
    "chilled_water_plant":        "Chilled water plant & towers",
    "cooling_units_crac_crah":    "Cooling units (CRAC/CRAH)",
    "piping_hvac_plumbing":       "Piping, HVAC & plumbing",
    "bms_controls":               "BMS & controls",
    "raised_floor_structure":     "Raised floor",
    "cable_trays_pathways":       "Cable trays & pathways",
    "fiber_structured_cabling":   "Fiber & structured cabling",
    "dcim_monitoring":            "DCIM & monitoring",
    "physical_security":          "Physical security",
    "fire_suppression":           "Fire suppression",
}

# ═══════════════════════════════════════════════════════════════════════════════
# Tier multipliers  (relative to Tier III)
# ═══════════════════════════════════════════════════════════════════════════════

TIER_CONFIG = {
    "tier1": {
        "label":       "Tier I — Basic capacity",
        "multiplier":  0.65,
        "description": "Single path, no redundancy. N infrastructure. Suitable for non-critical workloads.",
        "uptime_pct":  99.671,
        "downtime_hrs_yr": 28.8,
        "redundancy":  "N",
    },
    "tier2": {
        "label":       "Tier II — Redundant components",
        "multiplier":  0.80,
        "description": "Single path with redundant components (N+1). Planned maintenance without shutdown.",
        "uptime_pct":  99.741,
        "downtime_hrs_yr": 22.7,
        "redundancy":  "N+1",
    },
    "tier3": {
        "label":       "Tier III — Concurrently maintainable",
        "multiplier":  1.00,
        "description": "Multiple paths with redundant components. All maintenance without IT shutdown.",
        "uptime_pct":  99.982,
        "downtime_hrs_yr": 1.6,
        "redundancy":  "N+1 or 2N partial",
    },
    "tier4": {
        "label":       "Tier IV — Fault tolerant",
        "multiplier":  1.55,
        "description": "Multiple active paths, 2N redundancy throughout. Fault tolerant to any single failure.",
        "uptime_pct":  99.995,
        "downtime_hrs_yr": 0.4,
        "redundancy":  "2N",
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# Regional cost multipliers  (relative to Southeast / US average)
# Sources: RS Means City Cost Index 2024, Turner & Townsend GDCCI 2023
# ═══════════════════════════════════════════════════════════════════════════════

REGION_CONFIG = {
    "northeast": {
        "label":      "Northeast (NY, NJ, CT, MA, RI, VT, ME, NH)",
        "multiplier": 1.35,
        "notes":      "Highest US construction labor costs; NYC/Boston among most expensive globally.",
        "key_markets": ["New York City", "Boston", "Northern NJ"],
    },
    "mid_atlantic": {
        "label":      "Mid-Atlantic (VA, MD, DC, PA, DE)",
        "multiplier": 1.18,
        "notes":      "Northern VA (Ashburn/Loudoun) premium from high demand and labor competition. DC corridor elevated.",
        "key_markets": ["Northern Virginia (Ashburn)", "Washington DC", "Philadelphia", "Baltimore"],
    },
    "southeast": {
        "label":      "Southeast (NC, SC, GA, FL, TN, AL, MS)",
        "multiplier": 1.00,
        "notes":      "Competitive construction market; Atlanta, Charlotte, and Raleigh are active data center markets.",
        "key_markets": ["Atlanta", "Charlotte", "Raleigh-Durham", "Jacksonville"],
    },
    "midwest": {
        "label":      "Midwest (IL, OH, IN, MI, WI, MN, IA, MO)",
        "multiplier": 0.93,
        "notes":      "Favorable construction costs; Chicago slightly above average. Columbus and Indianapolis competitive.",
        "key_markets": ["Chicago", "Columbus", "Indianapolis", "Minneapolis", "Kansas City"],
    },
    "southwest": {
        "label":      "Southwest (TX, AZ, NV, NM, OK, LA)",
        "multiplier": 0.90,
        "notes":      "Low construction costs; Phoenix and Las Vegas are major growth markets. Dallas DFW very competitive.",
        "key_markets": ["Dallas-Fort Worth", "Phoenix", "Las Vegas", "San Antonio"],
    },
    "mountain": {
        "label":      "Mountain (CO, UT, ID, MT, WY, SD, ND)",
        "multiplier": 1.00,
        "notes":      "Denver Front Range near US average; altitude impacts HVAC sizing (~15% capacity derating at 5,280 ft).",
        "key_markets": ["Denver", "Salt Lake City", "Boise"],
    },
    "pacific": {
        "label":      "Pacific / California (CA)",
        "multiplier": 1.45,
        "notes":      "Highest construction costs in US; LA Basin and Bay Area most expensive. Long permitting timelines add cost.",
        "key_markets": ["San Jose / Silicon Valley", "Los Angeles", "Sacramento", "San Diego"],
    },
    "pacific_nw": {
        "label":      "Pacific Northwest (WA, OR)",
        "multiplier": 1.15,
        "notes":      "Seattle labor costs elevated; Portland more moderate. Favorable power rates and climate for free cooling.",
        "key_markets": ["Seattle / Puget Sound", "Portland", "Hillsboro OR"],
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# Building type multipliers
# ═══════════════════════════════════════════════════════════════════════════════

BUILDING_TYPE_CONFIG = {
    "new_build": {
        "label":       "New build (greenfield)",
        "multiplier":  1.00,
        "description": "Ground-up construction on raw land. Full design flexibility, longest schedule.",
        "schedule_months_per_mw": {"low": 18, "typical": 24, "high": 36},
        "contingency_pct": 12,
        "soft_cost_pct":   16,
    },
    "shell_core": {
        "label":       "Shell & core (existing building)",
        "multiplier":  0.78,
        "description": "Fit-out of existing shell building. Faster schedule, lower cost but structural constraints.",
        "schedule_months_per_mw": {"low": 12, "typical": 18, "high": 24},
        "contingency_pct": 14,
        "soft_cost_pct":   14,
    },
    "retrofit": {
        "label":       "Retrofit / conversion",
        "multiplier":  0.92,
        "description": "Conversion of existing facility (office, warehouse, industrial). Variable cost based on condition.",
        "schedule_months_per_mw": {"low": 14, "typical": 20, "high": 30},
        "contingency_pct": 18,
        "soft_cost_pct":   15,
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# Soft cost breakdown (as % of hard costs)
# ═══════════════════════════════════════════════════════════════════════════════

SOFT_COST_COMPONENTS_PCT = {
    "design_ae":          0.07,   # Architecture & engineering
    "permits_fees":       0.025,  # Permitting, inspections, utility connection fees
    "commissioning":      0.015,  # Cx agent, BMS commissioning, load bank testing
    "program_management": 0.025,  # Owner's rep / project management
    "legal_insurance":    0.010,  # Construction legal, builder's risk insurance
    "other":              0.005,  # Contingency in soft costs
}


# ═══════════════════════════════════════════════════════════════════════════════
# Construction timeline estimate
# ═══════════════════════════════════════════════════════════════════════════════

def estimate_timeline(capacity_mw: float, building_type: str) -> dict:
    bt   = BUILDING_TYPE_CONFIG[building_type]
    sch  = bt["schedule_months_per_mw"]
    # Timeline scales sub-linearly with MW (parallel construction crews)
    scale = max(1.0, math.log10(capacity_mw + 1) * 1.5)
    low     = round(sch["low"]     * scale)
    typical = round(sch["typical"] * scale)
    high    = round(sch["high"]    * scale)
    # Cap at reasonable maximums
    return {
        "low_months":     min(low,     12 + round(capacity_mw * 0.08)),
        "typical_months": min(typical, 18 + round(capacity_mw * 0.10)),
        "high_months":    min(high,    30 + round(capacity_mw * 0.14)),
        "notes": (
            "Large campuses (>100 MW) are typically phased into 20–50 MW increments "
            "to accelerate time-to-revenue. First phase often delivers in 18–24 months."
            if capacity_mw > 50 else
            "Timeline from NTP (Notice to Proceed) to substantial completion."
        ),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Main estimation function
# ═══════════════════════════════════════════════════════════════════════════════

def estimate_construction_cost(
    capacity_mw:              float,
    tier:                     str   = "tier3",
    region:                   str   = "southeast",
    building_type:            str   = "new_build",
    electricity_rate_per_kwh: float = 0.07,
) -> dict:

    tier_cfg  = TIER_CONFIG[tier]
    region_cfg = REGION_CONFIG[region]
    bt_cfg    = BUILDING_TYPE_CONFIG[building_type]

    tier_mult   = tier_cfg["multiplier"]
    region_mult = region_cfg["multiplier"]
    bt_mult     = bt_cfg["multiplier"]
    combined    = tier_mult * region_mult * bt_mult

    # ── Line-item costs ───────────────────────────────────────────────────────
    line_items = {}
    for item, base in BASE_COSTS_PER_MW.items():
        line_items[item] = {
            "label":      COST_LABELS[item],
            "low_usd":    round(base["low"]     * combined * capacity_mw),
            "typical_usd": round(base["typical"] * combined * capacity_mw),
            "high_usd":   round(base["high"]    * combined * capacity_mw),
        }

    # ── Category subtotals ────────────────────────────────────────────────────
    categories = {}
    hard_low = hard_typ = hard_high = 0
    for cat, items in COST_CATEGORIES.items():
        cl = ch = ct = 0
        for item in items:
            cl += line_items[item]["low_usd"]
            ct += line_items[item]["typical_usd"]
            ch += line_items[item]["high_usd"]
        categories[cat] = {"low_usd": cl, "typical_usd": ct, "high_usd": ch}
        hard_low  += cl
        hard_typ  += ct
        hard_high += ch

    # ── Soft costs ────────────────────────────────────────────────────────────
    sc_pct = bt_cfg["soft_cost_pct"] / 100.0
    soft_breakdown = {}
    soft_low = soft_typ = soft_high = 0
    for component, frac in SOFT_COST_COMPONENTS_PCT.items():
        weight = frac / sum(SOFT_COST_COMPONENTS_PCT.values())
        portion = weight * sc_pct
        sl = round(hard_low  * portion)
        st = round(hard_typ  * portion)
        sh = round(hard_high * portion)
        soft_breakdown[component] = {"low_usd": sl, "typical_usd": st, "high_usd": sh}
        soft_low  += sl
        soft_typ  += st
        soft_high += sh

    # ── Contingency ───────────────────────────────────────────────────────────
    cont_pct = bt_cfg["contingency_pct"] / 100.0
    cont_low  = round((hard_low  + soft_low)  * cont_pct)
    cont_typ  = round((hard_typ  + soft_typ)  * cont_pct)
    cont_high = round((hard_high + soft_high) * cont_pct)

    # ── Total project cost ────────────────────────────────────────────────────
    total_low  = hard_low  + soft_low  + cont_low
    total_typ  = hard_typ  + soft_typ  + cont_typ
    total_high = hard_high + soft_high + cont_high

    # ── $/MW metrics ──────────────────────────────────────────────────────────
    cost_per_mw_low  = round(total_low  / capacity_mw)
    cost_per_mw_typ  = round(total_typ  / capacity_mw)
    cost_per_mw_high = round(total_high / capacity_mw)

    # ── Annual opex estimate (power only) ─────────────────────────────────────
    # Assume PUE 1.4 for Tier III, scaled by tier
    tier_pue = {"tier1": 1.80, "tier2": 1.55, "tier3": 1.40, "tier4": 1.30}[tier]
    facility_kw    = capacity_mw * 1000 * tier_pue
    annual_kwh     = facility_kw * 8_760
    annual_power_cost = round(annual_kwh * electricity_rate_per_kwh)

    # ── Category % of total ───────────────────────────────────────────────────
    cat_pct = {cat: round(v["typical_usd"] / total_typ * 100, 1)
               for cat, v in categories.items()}
    cat_pct["soft_costs"]  = round(soft_typ  / total_typ * 100, 1)
    cat_pct["contingency"] = round(cont_typ  / total_typ * 100, 1)

    # ── Timeline ─────────────────────────────────────────────────────────────
    timeline = estimate_timeline(capacity_mw, building_type)

    # ── Recommendations ───────────────────────────────────────────────────────
    recs = []
    if capacity_mw > 50:
        recs.append(
            f"Phased development: break {capacity_mw} MW into 20–50 MW phases to accelerate "
            "time-to-revenue, reduce financing cost, and de-risk design iterations."
        )
    if tier == "tier4":
        recs.append(
            "Tier IV 2N redundancy significantly increases capex. Verify that workload SLA "
            "requirements actually mandate Tier IV vs. Tier III + robust DR strategy."
        )
    if region in ("pacific", "northeast"):
        recs.append(
            f"{'California' if region == 'pacific' else 'Northeast'} construction costs are "
            f"{round((region_cfg['multiplier'] - 1) * 100)}% above US average. "
            "Evaluate adjacent markets for cost savings if latency requirements permit."
        )
    if building_type == "retrofit":
        recs.append(
            "Retrofit contingency (18%) is elevated — conduct full structural, MEP, and "
            "environmental assessment before committing to budget."
        )
    if building_type == "shell_core":
        recs.append(
            "Shell & core fit-out saves ~22% vs. greenfield and compresses schedule by "
            "6–12 months. Confirm slab load capacity (≥300 lbs/ft² for dense deployments)."
        )
    if capacity_mw >= 10 and tier in ("tier3", "tier4"):
        recs.append(
            "For projects ≥10 MW, conduct a competitive GMP (Guaranteed Maximum Price) "
            "tender with ≥3 qualified mission-critical contractors to validate cost estimates."
        )
    if not recs:
        recs.append(
            "Validate line-item costs with a local quantity surveyor. Regional sub-contractor "
            "availability and material lead times can move final cost ±15%."
        )

    return {
        "input": {
            "capacity_mw":               capacity_mw,
            "tier":                      tier,
            "tier_label":                tier_cfg["label"],
            "region":                    region,
            "region_label":              region_cfg["label"],
            "building_type":             building_type,
            "building_type_label":       bt_cfg["label"],
            "electricity_rate_per_kwh":  electricity_rate_per_kwh,
        },
        "multipliers": {
            "tier":          tier_mult,
            "region":        region_mult,
            "building_type": bt_mult,
            "combined":      round(combined, 4),
        },
        "tier_specs": {
            "redundancy":       tier_cfg["redundancy"],
            "uptime_pct":       tier_cfg["uptime_pct"],
            "downtime_hrs_yr":  tier_cfg["downtime_hrs_yr"],
            "description":      tier_cfg["description"],
        },
        "total_project_cost": {
            "low_usd":     total_low,
            "typical_usd": total_typ,
            "high_usd":    total_high,
            "cost_per_mw_low":     cost_per_mw_low,
            "cost_per_mw_typical": cost_per_mw_typ,
            "cost_per_mw_high":    cost_per_mw_high,
        },
        "cost_breakdown": {
            "hard_costs": {
                "total_low_usd":     hard_low,
                "total_typical_usd": hard_typ,
                "total_high_usd":    hard_high,
                "categories":        categories,
                "line_items":        line_items,
            },
            "soft_costs": {
                "pct_of_hard":       bt_cfg["soft_cost_pct"],
                "total_low_usd":     soft_low,
                "total_typical_usd": soft_typ,
                "total_high_usd":    soft_high,
                "breakdown":         soft_breakdown,
            },
            "contingency": {
                "pct":               bt_cfg["contingency_pct"],
                "total_low_usd":     cont_low,
                "total_typical_usd": cont_typ,
                "total_high_usd":    cont_high,
            },
        },
        "category_pct_of_total": cat_pct,
        "annual_opex_power": {
            "assumed_pue":              tier_pue,
            "total_facility_kw":        round(facility_kw, 1),
            "annual_kwh":               round(annual_kwh),
            "annual_cost_usd":          annual_power_cost,
            "per_mw_it_per_year_usd":   round(annual_power_cost / capacity_mw),
            "note": "Power cost only. Add staffing (~$2–5M/yr per 10 MW), maintenance (1–2% of capex/yr), and network/colocation fees.",
        },
        "construction_timeline": timeline,
        "region_context": {
            "key_markets":  region_cfg["key_markets"],
            "cost_notes":   region_cfg["notes"],
        },
        "recommendations": recs,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            "Usage: construction_cost.py <capacity_mw> [tier] [region] "
            "[building_type] [electricity_rate_per_kwh]",
            file=sys.stderr,
        )
        print(f"tier:          {', '.join(TIER_CONFIG.keys())}", file=sys.stderr)
        print(f"region:        {', '.join(REGION_CONFIG.keys())}", file=sys.stderr)
        print(f"building_type: {', '.join(BUILDING_TYPE_CONFIG.keys())}", file=sys.stderr)
        sys.exit(1)

    try:
        capacity_mw = float(sys.argv[1])
        if not (0.1 <= capacity_mw <= 1000):
            raise ValueError(f"capacity_mw must be 0.1–1000, got {capacity_mw}")

        tier = sys.argv[2] if len(sys.argv) > 2 else "tier3"
        if tier not in TIER_CONFIG:
            raise ValueError(f"Unknown tier '{tier}'. Must be: {', '.join(TIER_CONFIG.keys())}")

        region = sys.argv[3] if len(sys.argv) > 3 else "southeast"
        if region not in REGION_CONFIG:
            raise ValueError(f"Unknown region '{region}'. Must be: {', '.join(REGION_CONFIG.keys())}")

        building_type = sys.argv[4] if len(sys.argv) > 4 else "new_build"
        if building_type not in BUILDING_TYPE_CONFIG:
            raise ValueError(f"Unknown building_type '{building_type}'. Must be: {', '.join(BUILDING_TYPE_CONFIG.keys())}")

        electricity_rate = float(sys.argv[5]) if len(sys.argv) > 5 else 0.07
        if not (0.01 <= electricity_rate <= 2.0):
            raise ValueError(f"electricity_rate_per_kwh must be 0.01–2.0, got {electricity_rate}")

        result = estimate_construction_cost(
            capacity_mw, tier, region, building_type, electricity_rate
        )
        print(json.dumps(result, indent=2))
        sys.exit(0)

    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}), file=sys.stderr)
        sys.exit(2)
