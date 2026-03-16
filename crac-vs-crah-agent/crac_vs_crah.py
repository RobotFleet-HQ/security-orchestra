"""
CRAC vs CRAH Cooling Unit Comparison Agent
Usage: crac_vs_crah.py <it_load_kw> <room_sqft> <water_available> [climate_zone=mild]

water_available: yes | no
climate_zone: hot_dry | hot_humid | mild | cold
"""

import sys
import json
import math


CLIMATE_PUES = {
    "hot_dry":   {"crac_pue_add": 0.45, "crah_pue_add": 0.20},
    "hot_humid": {"crac_pue_add": 0.50, "crah_pue_add": 0.25},
    "mild":      {"crac_pue_add": 0.35, "crah_pue_add": 0.18},
    "cold":      {"crac_pue_add": 0.30, "crah_pue_add": 0.15},
}

ELECTRICITY_RATE = 0.08  # $/kWh assumption


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: crac_vs_crah.py <it_load_kw> <room_sqft> <water_available> [climate_zone=mild]"}), file=sys.stderr)
        sys.exit(1)

    try:
        it_load_kw = float(sys.argv[1])
        room_sqft = float(sys.argv[2])
        water_available = sys.argv[3].lower()
        climate_zone = sys.argv[4].lower() if len(sys.argv) == 5 else "mild"
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if it_load_kw < 1 or it_load_kw > 50000:
        print(json.dumps({"error": "it_load_kw must be 1-50000"}), file=sys.stderr)
        sys.exit(1)
    if room_sqft < 100 or room_sqft > 100000:
        print(json.dumps({"error": "room_sqft must be 100-100000"}), file=sys.stderr)
        sys.exit(1)
    if water_available not in ("yes", "no"):
        print(json.dumps({"error": "water_available must be yes or no"}), file=sys.stderr)
        sys.exit(1)
    if climate_zone not in CLIMATE_PUES:
        print(json.dumps({"error": "climate_zone must be: hot_dry, hot_humid, mild, or cold"}), file=sys.stderr)
        sys.exit(1)

    climate = CLIMATE_PUES[climate_zone]
    crac_pue_add = climate["crac_pue_add"]
    crah_pue_add = climate["crah_pue_add"]

    # CRAC units: N+1 sizing, 40 kW per unit
    crac_unit_kw = 40
    crac_unit_count = math.ceil(it_load_kw / crac_unit_kw) + 1  # N+1

    # CRAH units: N+1 sizing, 150 kW per unit
    crah_unit_kw = 150
    crah_unit_count = math.ceil(it_load_kw / crah_unit_kw) + 1  # N+1

    # Annual energy cost
    annual_energy_crac = it_load_kw * (1 + crac_pue_add) * 8760 * ELECTRICITY_RATE
    annual_energy_crah = it_load_kw * (1 + crah_pue_add) * 8760 * ELECTRICITY_RATE
    annual_savings_crah = annual_energy_crac - annual_energy_crah

    # Recommendation
    if water_available == "no":
        recommendation = "CRAC"
        reason = "No chilled water infrastructure available. CRAC (DX) is the only viable option."
    elif it_load_kw > 1000:
        recommendation = "CRAH"
        reason = f"Large load ({it_load_kw} kW) with chilled water available. CRAH provides superior efficiency (EER 18-25 vs 10-14 for CRAC), saving ${annual_savings_crah:,.0f}/year."
    else:
        recommendation = "CRAC"
        reason = f"Small load ({it_load_kw} kW). CRAC simpler to install and maintain without chiller plant investment."

    output = {
        "input": {
            "it_load_kw": it_load_kw,
            "room_sqft": room_sqft,
            "water_available": water_available,
            "climate_zone": climate_zone,
        },
        "recommendation": recommendation,
        "reason": reason,
        "crac_unit_count": crac_unit_count,
        "crah_unit_count": crah_unit_count,
        "recommended_unit_count": crac_unit_count if recommendation == "CRAC" else crah_unit_count,
        "pue_impact": {
            "crac_pue_addition": crac_pue_add,
            "crah_pue_addition": crah_pue_add,
            "pue_improvement_with_crah": round(crac_pue_add - crah_pue_add, 2),
        },
        "annual_energy_cost_crac": round(annual_energy_crac, 0),
        "annual_energy_cost_crah": round(annual_energy_crah, 0),
        "annual_savings_with_crah": round(annual_savings_crah, 0),
        "notes": [
            f"CRAC EER 10-14 (self-contained DX); CRAH EER 18-25 (requires chilled water plant).",
            f"Annual energy savings with CRAH over CRAC: ${annual_savings_crah:,.0f} at ${ELECTRICITY_RATE}/kWh.",
            "CRAH requires chiller plant investment ($500-800/ton installed); evaluate total cost.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
