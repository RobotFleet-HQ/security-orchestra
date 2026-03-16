"""
Chiller Plant Sizing Agent
Usage: chiller_sizing.py <it_load_kw> <pue> <cooling_type> <redundancy>

cooling_type: air_cooled | water_cooled | free_cooling
redundancy: N+1 | 2N
"""

import sys
import json
import math


CHILLER_EFFICIENCY = {
    "air_cooled":   0.70,  # kW/ton
    "water_cooled": 0.50,
    "free_cooling":  0.30,
}

STANDARD_CHILLER_SIZES = [100, 200, 300, 500, 750, 1000, 1500, 2000]

COST_PER_TON = {
    "air_cooled":   800,
    "water_cooled": 600,
    "free_cooling":  700,
}


def _next_standard_size(tons: float) -> int:
    for size in STANDARD_CHILLER_SIZES:
        if size >= tons:
            return size
    return STANDARD_CHILLER_SIZES[-1]


def main() -> None:
    if len(sys.argv) != 5:
        print(json.dumps({"error": "Usage: chiller_sizing.py <it_load_kw> <pue> <cooling_type> <redundancy>"}), file=sys.stderr)
        sys.exit(1)

    try:
        it_load_kw = float(sys.argv[1])
        pue = float(sys.argv[2])
        cooling_type = sys.argv[3].lower()
        redundancy = sys.argv[4]
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if it_load_kw < 1 or it_load_kw > 500000:
        print(json.dumps({"error": "it_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if pue < 1.0 or pue > 3.0:
        print(json.dumps({"error": "pue must be 1.0-3.0"}), file=sys.stderr)
        sys.exit(1)
    if cooling_type not in CHILLER_EFFICIENCY:
        print(json.dumps({"error": "cooling_type must be: air_cooled, water_cooled, or free_cooling"}), file=sys.stderr)
        sys.exit(1)
    if redundancy not in ("N+1", "2N"):
        print(json.dumps({"error": "redundancy must be N+1 or 2N"}), file=sys.stderr)
        sys.exit(1)

    # Total heat dissipation
    total_heat_kw = it_load_kw * pue
    cooling_tons = total_heat_kw * 0.2843  # kW to tons of refrigeration

    # Chiller power
    efficiency = CHILLER_EFFICIENCY[cooling_type]
    chiller_power_kw = cooling_tons * efficiency

    # Maximum single chiller size
    max_chiller_tons = STANDARD_CHILLER_SIZES[-1]  # 2000 tons

    if redundancy == "N+1":
        n_chillers = math.ceil(cooling_tons / max_chiller_tons)
        if n_chillers == 0:
            n_chillers = 1
        each_size_tons = math.ceil(cooling_tons / n_chillers / 100) * 100
        each_size_tons = _next_standard_size(each_size_tons)
        total_chillers = n_chillers + 1
    else:  # 2N
        base_chillers = math.ceil(cooling_tons / max_chiller_tons)
        if base_chillers == 0:
            base_chillers = 1
        each_size_tons = math.ceil(cooling_tons / base_chillers / 100) * 100
        each_size_tons = _next_standard_size(each_size_tons)
        total_chillers = base_chillers * 2

    # Condenser water flow: 3 gpm/ton
    condenser_water_flow_gpm = round(cooling_tons * 3.0, 0)

    # Cooling tower sizing: 1.25x chiller capacity
    cooling_tower_tons = round(cooling_tons * 1.25, 0)

    # Cost estimate
    cost_per_ton = COST_PER_TON[cooling_type]
    total_installed_capacity_tons = each_size_tons * total_chillers
    estimated_cost = total_installed_capacity_tons * cost_per_ton

    output = {
        "input": {
            "it_load_kw": it_load_kw,
            "pue": pue,
            "cooling_type": cooling_type,
            "redundancy": redundancy,
        },
        "cooling_load_tons": round(cooling_tons, 1),
        "total_heat_kw": round(total_heat_kw, 1),
        "chiller_count": total_chillers,
        "chiller_size_tons_each": each_size_tons,
        "chiller_power_kw": round(chiller_power_kw, 1),
        "condenser_water_flow_gpm": condenser_water_flow_gpm,
        "cooling_tower_tons": cooling_tower_tons if cooling_type == "water_cooled" else 0,
        "redundancy_config": redundancy,
        "estimated_chiller_cost": round(estimated_cost, 0),
        "notes": [
            f"Total cooling load: {cooling_tons:.1f} tons for {it_load_kw} kW IT at PUE {pue}.",
            f"{total_chillers} x {each_size_tons}-ton {cooling_type.replace('_', ' ')} chillers ({redundancy} redundancy).",
            f"Chiller efficiency: {efficiency} kW/ton per ASHRAE 90.1.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
