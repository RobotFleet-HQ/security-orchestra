"""
Airflow Modeling Agent
Usage: airflow_modeling.py <rack_count> <avg_kw_per_rack> <room_sqft> <containment_type>

containment_type: none | hot_aisle | cold_aisle | full_chimney
"""

import sys
import json
import math


CFM_PER_KW = {
    "none":          150,
    "hot_aisle":     130,
    "cold_aisle":    120,
    "full_chimney":  100,
}

CONTAINMENT_EFFICIENCY = {
    "none":          60,
    "hot_aisle":     75,
    "cold_aisle":    80,
    "full_chimney":  95,
}

SUPPLY_TEMP_F = 65.0  # ASHRAE A1 envelope supply air temperature


def main() -> None:
    if len(sys.argv) != 5:
        print(json.dumps({"error": "Usage: airflow_modeling.py <rack_count> <avg_kw_per_rack> <room_sqft> <containment_type>"}), file=sys.stderr)
        sys.exit(1)

    try:
        rack_count = int(sys.argv[1])
        avg_kw_per_rack = float(sys.argv[2])
        room_sqft = float(sys.argv[3])
        containment_type = sys.argv[4].lower()
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if rack_count < 1 or rack_count > 10000:
        print(json.dumps({"error": "rack_count must be 1-10000"}), file=sys.stderr)
        sys.exit(1)
    if avg_kw_per_rack < 0.1 or avg_kw_per_rack > 100:
        print(json.dumps({"error": "avg_kw_per_rack must be 0.1-100"}), file=sys.stderr)
        sys.exit(1)
    if room_sqft < 100 or room_sqft > 500000:
        print(json.dumps({"error": "room_sqft must be 100-500000"}), file=sys.stderr)
        sys.exit(1)
    if containment_type not in CFM_PER_KW:
        print(json.dumps({"error": "containment_type must be: none, hot_aisle, cold_aisle, or full_chimney"}), file=sys.stderr)
        sys.exit(1)

    total_it_kw = rack_count * avg_kw_per_rack
    cfm_per_kw = CFM_PER_KW[containment_type]
    total_cfm = total_it_kw * cfm_per_kw

    # CRAC units: assume 10,000 CFM per unit
    crac_unit_count = math.ceil(total_cfm / 10000)

    # Raised floor depth
    if avg_kw_per_rack < 5:
        raised_floor_depth_in = 24
    elif avg_kw_per_rack <= 10:
        raised_floor_depth_in = 30
    else:
        raised_floor_depth_in = 36

    containment_eff = CONTAINMENT_EFFICIENCY[containment_type]

    # Return air temperature using simplified heat balance
    # Q = 1.1 * CFM * delta_T  →  delta_T = Q / (1.1 * CFM)
    # Q in BTU/hr = kW * 3412
    total_btu_hr = total_it_kw * 3412
    delta_t_f = total_btu_hr / (1.1 * total_cfm) if total_cfm > 0 else 0
    return_temp_f = SUPPLY_TEMP_F + delta_t_f

    # Hotspot risk
    if delta_t_f > 20:
        hotspot_risk = "high"
    elif delta_t_f > 15:
        hotspot_risk = "medium"
    else:
        hotspot_risk = "low"

    # Containment upgrade recommendation
    upgrade_map = {
        "none": "hot_aisle",
        "hot_aisle": "cold_aisle",
        "cold_aisle": "full_chimney",
        "full_chimney": None,
    }
    recommended_upgrade = upgrade_map[containment_type]

    output = {
        "input": {
            "rack_count": rack_count,
            "avg_kw_per_rack": avg_kw_per_rack,
            "room_sqft": room_sqft,
            "containment_type": containment_type,
        },
        "total_it_load_kw": round(total_it_kw, 1),
        "total_cfm_required": round(total_cfm, 0),
        "crac_unit_count": crac_unit_count,
        "raised_floor_depth_inches": raised_floor_depth_in,
        "containment_efficiency_pct": containment_eff,
        "supply_temp_f": SUPPLY_TEMP_F,
        "return_temp_f": round(return_temp_f, 1),
        "delta_t_f": round(delta_t_f, 1),
        "hotspot_risk": hotspot_risk,
        "recommended_containment_upgrade": recommended_upgrade,
        "notes": [
            f"Total IT load {total_it_kw:.0f} kW requires {total_cfm:,.0f} CFM at {cfm_per_kw} CFM/kW.",
            f"Delta-T {delta_t_f:.1f}°F ({SUPPLY_TEMP_F}°F supply → {return_temp_f:.1f}°F return). Hotspot risk: {hotspot_risk}.",
            f"Containment efficiency {containment_eff}%." + (f" Upgrade to {recommended_upgrade.replace('_', ' ')} to improve to {CONTAINMENT_EFFICIENCY[recommended_upgrade]}%." if recommended_upgrade else " Maximum containment achieved."),
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
