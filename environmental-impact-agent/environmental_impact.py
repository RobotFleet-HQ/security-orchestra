"""
Environmental Impact / Compliance Agent
CLI: python environmental_impact.py <generator_count> <generator_kw> <site_acres> [proximity_to_wetlands_ft=1000] [state=VA]

Calculations based on EPA Tier 4 emission factors and federal environmental thresholds.
"""

import sys
import json
import math


# EPA Tier 4 emission factors (g/bhp-hr)
NOX_FACTOR_G_BHP_HR = 0.67
CO_FACTOR_G_BHP_HR = 2.61
PM25_FACTOR_G_BHP_HR = 0.02

# Conversion constants
KW_TO_BHP = 1.0 / 0.746          # 1 bhp = 0.746 kW → 1 kW = 1/0.746 bhp
G_PER_TON = 453592.0              # grams per short ton (453.592 g/lb × 2000 lb/ton)
HOURS_PER_YEAR = 8760.0

# Title V major source threshold (short tons/yr)
TITLE_V_THRESHOLD_TONS = 100.0

# Stormwater
IMPERVIOUS_FRACTION = 0.60        # 60% of site is impervious
SQFT_PER_ACRE = 43560.0
RUNOFF_COEFFICIENT = 0.85
RAINFALL_INCHES = 1.5             # design storm
INCHES_TO_FEET = 1.0 / 12.0


def calculate_emissions_per_generator(generator_kw: float) -> dict:
    """Calculate annual emissions in tons/yr for a single generator (EPA Tier 4)."""
    bhp = generator_kw * KW_TO_BHP
    nox_tons = (NOX_FACTOR_G_BHP_HR * bhp * HOURS_PER_YEAR) / G_PER_TON
    co_tons = (CO_FACTOR_G_BHP_HR * bhp * HOURS_PER_YEAR) / G_PER_TON
    pm25_tons = (PM25_FACTOR_G_BHP_HR * bhp * HOURS_PER_YEAR) / G_PER_TON
    return {"nox": nox_tons, "co": co_tons, "pm25": pm25_tons}


def stormwater_analysis(site_acres: float):
    impervious_sqft = IMPERVIOUS_FRACTION * site_acres * SQFT_PER_ACRE
    impervious_acres = impervious_sqft / SQFT_PER_ACRE
    # Retention pond: 1.5" × impervious_area_sqft × (1/12 ft/in) = volume in cf
    pond_cf = RAINFALL_INCHES * impervious_sqft * INCHES_TO_FEET
    # Runoff coefficient adjustment
    pond_cf_adjusted = pond_cf * RUNOFF_COEFFICIENT
    pond_acre_feet = pond_cf_adjusted / SQFT_PER_ACRE  # af = cf / 43560
    # NPDES permit required for sites disturbing ≥1 acre
    npdes_required = site_acres >= 1.0
    # CGP (Construction General Permit) required for ≥1 acre earth disturbance
    cgp_required = site_acres >= 1.0
    return impervious_acres, pond_acre_feet, npdes_required, cgp_required


def wetlands_analysis(proximity_ft: float):
    if proximity_ft < 100.0:
        section_404 = True
        buffer_review = True
        mitigation = True
    elif proximity_ft <= 300.0:
        section_404 = False
        buffer_review = True
        mitigation = False
    else:
        section_404 = False
        buffer_review = False
        mitigation = False
    return section_404, buffer_review, mitigation


def nepa_review_type(site_acres: float, title_v_required: bool, federal_nexus: bool = False):
    if federal_nexus:
        return "EIS", 27.0   # 18-36 months, midpoint
    elif site_acres > 500.0 or title_v_required:
        return "EA", 12.0    # 6-18 months, midpoint
    else:
        return "Categorical Exclusion", 4.5  # 3-6 months, midpoint


def build_permit_list(
    title_v_required: bool,
    air_permit_type: str,
    npdes_required: bool,
    cgp_required: bool,
    section_404: bool,
    buffer_review: bool,
    nepa_type: str,
    nepa_months: float,
    state: str,
):
    permits = []

    # Air permit
    if title_v_required:
        permits.append({
            "permit": "Title V Major Source Air Permit",
            "agency": "State Environmental Agency / EPA Region",
            "estimated_months": 18.0,
            "cost_estimate": 75000.0,
        })
    else:
        permits.append({
            "permit": "State Minor Source Air Permit (BACT Review)",
            "agency": f"{state} Department of Environmental Quality",
            "estimated_months": 6.0,
            "cost_estimate": 15000.0,
        })

    # NEPA
    permits.append({
        "permit": f"NEPA Review — {nepa_type}",
        "agency": "Lead Federal Agency / Council on Environmental Quality",
        "estimated_months": nepa_months,
        "cost_estimate": 50000.0 if nepa_type == "EIS" else (20000.0 if nepa_type == "EA" else 5000.0),
    })

    # NPDES
    if npdes_required:
        permits.append({
            "permit": "NPDES Industrial Stormwater Permit",
            "agency": f"EPA Region / {state} DEQ",
            "estimated_months": 3.0,
            "cost_estimate": 5000.0,
        })

    # CGP
    if cgp_required:
        permits.append({
            "permit": "Construction General Permit (CGP) — Stormwater",
            "agency": f"EPA Region / {state} DEQ",
            "estimated_months": 1.0,
            "cost_estimate": 2500.0,
        })

    # Section 404 / Wetlands
    if section_404:
        permits.append({
            "permit": "Section 404 Permit — Wetlands Fill/Dredge",
            "agency": "U.S. Army Corps of Engineers",
            "estimated_months": 12.0,  # 6-18 months midpoint
            "cost_estimate": 30000.0,
        })
    elif buffer_review:
        permits.append({
            "permit": "Wetlands Buffer Review / State Wetlands Permit",
            "agency": f"{state} Department of Environmental Quality",
            "estimated_months": 4.0,
            "cost_estimate": 10000.0,
        })

    # Spill Prevention (SPCC) for generator fuel
    permits.append({
        "permit": "Spill Prevention, Control & Countermeasure (SPCC) Plan",
        "agency": "EPA / State Environmental Agency",
        "estimated_months": 2.0,
        "cost_estimate": 8000.0,
    })

    return permits


def main():
    if len(sys.argv) < 4:
        err = {"error": "Usage: environmental_impact.py <generator_count> <generator_kw> <site_acres> [proximity_to_wetlands_ft=1000] [state=VA]"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        generator_count = int(sys.argv[1])
        generator_kw = float(sys.argv[2])
        site_acres = float(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid numeric argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    proximity_ft = float(sys.argv[4]) if len(sys.argv) > 4 else 1000.0
    state = sys.argv[5] if len(sys.argv) > 5 else "VA"

    if generator_count <= 0:
        print(json.dumps({"error": "generator_count must be positive"}), file=sys.stderr)
        sys.exit(1)
    if generator_kw <= 0:
        print(json.dumps({"error": "generator_kw must be positive"}), file=sys.stderr)
        sys.exit(1)
    if site_acres <= 0:
        print(json.dumps({"error": "site_acres must be positive"}), file=sys.stderr)
        sys.exit(1)

    # --- Air Quality ---
    per_gen = calculate_emissions_per_generator(generator_kw)
    nox_total = per_gen["nox"] * generator_count
    co_total = per_gen["co"] * generator_count
    pm25_total = per_gen["pm25"] * generator_count
    title_v_required = nox_total > TITLE_V_THRESHOLD_TONS or co_total > TITLE_V_THRESHOLD_TONS

    if title_v_required:
        air_permit_type = "Title V"
    elif nox_total > 50.0 or co_total > 50.0:
        air_permit_type = "State Minor Source"
    else:
        air_permit_type = "Permit by Rule"

    # --- Stormwater ---
    impervious_acres, pond_acre_feet, npdes_required, cgp_required = stormwater_analysis(site_acres)

    # --- Wetlands ---
    section_404, buffer_review, mitigation = wetlands_analysis(proximity_ft)

    # --- NEPA ---
    nepa_type, nepa_months = nepa_review_type(site_acres, title_v_required, federal_nexus=False)

    # --- Permits ---
    permits = build_permit_list(
        title_v_required=title_v_required,
        air_permit_type=air_permit_type,
        npdes_required=npdes_required,
        cgp_required=cgp_required,
        section_404=section_404,
        buffer_review=buffer_review,
        nepa_type=nepa_type,
        nepa_months=nepa_months,
        state=state,
    )

    total_compliance_cost = sum(p["cost_estimate"] for p in permits)

    # --- Risk Flags ---
    risk_flags = []
    if title_v_required:
        risk_flags.append(
            f"Title V major source threshold exceeded (NOx: {nox_total:.1f} t/yr, CO: {co_total:.1f} t/yr). "
            "Requires public notice, 18-month review, and ongoing compliance monitoring."
        )
    if section_404:
        risk_flags.append(
            f"Wetlands within {proximity_ft} ft — Section 404 permit required. Army Corps review is 6-18 months. "
            "Mitigation banking may be required."
        )
    if buffer_review:
        risk_flags.append(
            f"Wetlands within {proximity_ft} ft — state buffer review required. "
            "Design must maintain minimum buffer setbacks."
        )
    if nepa_type == "EIS":
        risk_flags.append("Full Environmental Impact Statement required — 18-36 month review with public scoping and comment periods.")
    elif nepa_type == "EA":
        risk_flags.append("Environmental Assessment required — 6-18 months. May result in Finding of No Significant Impact (FONSI) or EIS upgrade.")
    if site_acres > 500.0:
        risk_flags.append("Site exceeds 500 acres — NEPA Environmental Assessment likely required.")
    if generator_count > 20:
        risk_flags.append("Large generator fleet — cumulative air impact modeling (AERMOD/AERSCREEN) may be required.")
    if not risk_flags:
        risk_flags.append("No major risk flags identified. Verify local zoning and utility coordination separately.")

    output = {
        "input": {
            "generator_count": generator_count,
            "generator_kw": generator_kw,
            "site_acres": site_acres,
            "proximity_to_wetlands_ft": proximity_ft,
            "state": state,
        },
        "air_quality": {
            "nox_tons_per_year_total": round(nox_total, 4),
            "co_tons_per_year_total": round(co_total, 4),
            "pm25_tons_per_year_total": round(pm25_total, 4),
            "title_v_required": title_v_required,
            "air_permit_type": air_permit_type,
            "annual_operating_hours_assumed": int(HOURS_PER_YEAR),
        },
        "stormwater": {
            "estimated_impervious_acres": round(impervious_acres, 3),
            "retention_pond_acre_feet": round(pond_acre_feet, 4),
            "npdes_permit_required": npdes_required,
            "cgp_construction_permit_required": cgp_required,
        },
        "wetlands": {
            "proximity_ft": proximity_ft,
            "section_404_required": section_404,
            "buffer_review_required": buffer_review,
            "mitigation_required": mitigation,
        },
        "nepa_review": {
            "review_type": nepa_type,
            "estimated_months": nepa_months,
            "federal_nexus_assumed": False,
        },
        "permits_required": permits,
        "total_compliance_cost_estimate": round(total_compliance_cost, 2),
        "risk_flags": risk_flags,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
