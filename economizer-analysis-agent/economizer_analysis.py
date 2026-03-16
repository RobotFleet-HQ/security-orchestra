"""
Economizer Free Cooling Analysis Agent
Usage: economizer_analysis.py <location> <it_load_kw> <pue_mechanical> <economizer_type>

economizer_type: air_side | water_side | hybrid
"""

import sys
import json


# Free cooling hours by climate keyword match (hours/year)
FREE_COOLING_HOURS_BY_KEYWORD = [
    (["seattle", "portland", "pacific nw", "washington state"], 7000),
    (["san francisco", "bay area", "sf ", " sf,", "silicon valley"], 6500),
    (["denver", "colorado", "mountain", "boulder"], 5000),
    (["chicago", "midwest", "minneapolis", "detroit", "ohio", "indiana"], 4000),
    (["atlanta", "southeast", "charlotte", "raleigh", "virginia"], 2500),
    (["phoenix", "tucson", "desert", "arizona", "las vegas", "nevada"], 1500),
    (["miami", "florida", "houston", "new orleans", "gulf coast"], 500),
]

FREE_COOLING_DEFAULT = 3500

ECONOMIZER_EFFICIENCY = {
    "air_side":   1.00,
    "water_side": 0.90,
    "hybrid":     0.95,
}

# Cost per MW of IT load
ECONOMIZER_COST_PER_MW = {
    "air_side":   200000,
    "water_side": 500000,
    "hybrid":     350000,
}

ELECTRICITY_RATE = 0.08  # $/kWh
CO2_LBS_PER_KWH = 0.78   # average US grid


def _free_cooling_hours(location: str) -> int:
    loc = location.lower()
    for keywords, hours in FREE_COOLING_HOURS_BY_KEYWORD:
        for kw in keywords:
            if kw in loc:
                return hours
    return FREE_COOLING_DEFAULT


def main() -> None:
    if len(sys.argv) != 5:
        print(json.dumps({"error": "Usage: economizer_analysis.py <location> <it_load_kw> <pue_mechanical> <economizer_type>"}), file=sys.stderr)
        sys.exit(1)

    try:
        location = sys.argv[1]
        it_load_kw = float(sys.argv[2])
        pue_mechanical = float(sys.argv[3])
        economizer_type = sys.argv[4].lower()
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if it_load_kw < 1 or it_load_kw > 500000:
        print(json.dumps({"error": "it_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if pue_mechanical < 1.1 or pue_mechanical > 2.5:
        print(json.dumps({"error": "pue_mechanical must be 1.1-2.5"}), file=sys.stderr)
        sys.exit(1)
    if economizer_type not in ECONOMIZER_EFFICIENCY:
        print(json.dumps({"error": "economizer_type must be: air_side, water_side, or hybrid"}), file=sys.stderr)
        sys.exit(1)

    base_free_hours = _free_cooling_hours(location)
    efficiency = ECONOMIZER_EFFICIENCY[economizer_type]
    effective_free_hours = base_free_hours * efficiency

    # Blended PUE
    pue_free = 1.05  # near-ideal during free cooling
    mechanical_fraction = (8760 - effective_free_hours) / 8760
    free_fraction = effective_free_hours / 8760
    pue_blend = (mechanical_fraction * pue_mechanical) + (free_fraction * pue_free)

    # Energy savings
    annual_energy_savings_kwh = it_load_kw * (pue_mechanical - pue_blend) * 8760
    annual_cost_savings = annual_energy_savings_kwh * ELECTRICITY_RATE

    # CO2 reduction
    co2_reduction_lbs = annual_energy_savings_kwh * CO2_LBS_PER_KWH
    co2_reduction_metric_tons = co2_reduction_lbs / 2204.6

    # Economizer cost
    it_mw = it_load_kw / 1000.0
    economizer_cost = it_mw * ECONOMIZER_COST_PER_MW[economizer_type]

    # Payback
    payback_years = economizer_cost / annual_cost_savings if annual_cost_savings > 0 else float("inf")

    output = {
        "input": {
            "location": location,
            "it_load_kw": it_load_kw,
            "pue_mechanical": pue_mechanical,
            "economizer_type": economizer_type,
        },
        "free_cooling_hours_per_year": int(effective_free_hours),
        "effective_free_cooling_pct": round(free_fraction * 100, 1),
        "blended_pue": round(pue_blend, 3),
        "pue_improvement": round(pue_mechanical - pue_blend, 3),
        "annual_energy_savings_kwh": round(annual_energy_savings_kwh, 0),
        "annual_cost_savings": round(annual_cost_savings, 0),
        "economizer_cost": round(economizer_cost, 0),
        "payback_years": round(payback_years, 1) if payback_years != float("inf") else None,
        "co2_reduction_metric_tons_per_year": round(co2_reduction_metric_tons, 1),
        "notes": [
            f"{location}: {int(base_free_hours)} base free cooling hrs/yr, {int(effective_free_hours)} effective with {economizer_type.replace('_', '-')} economizer.",
            f"PUE blended {pue_blend:.3f} vs mechanical {pue_mechanical} — saving ${annual_cost_savings:,.0f}/yr.",
            f"Payback: {payback_years:.1f} years on ${economizer_cost:,.0f} investment." if payback_years != float("inf") else "No positive savings; reconsider economizer type.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
