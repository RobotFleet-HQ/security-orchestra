#!/usr/bin/env python3
"""Rack power density analysis for data centers."""

import sys
import json
import math

VALID_CABINET_HEIGHTS = {36, 42, 45, 47, 48, 52}
VALID_COOLING_TYPES = {"air", "liquid", "hybrid"}
STANDARD_BREAKERS = [15, 20, 30, 40, 50, 60, 70, 80, 100]


def validate_inputs(total_it_load_kw, rack_count, cabinet_height_u, cooling_type, target_density_kw_per_rack):
    errors = []
    if not (0.1 <= total_it_load_kw <= 500000):
        errors.append(f"total_it_load_kw must be 0.1–500000, got {total_it_load_kw}")
    if not (1 <= rack_count <= 100000):
        errors.append(f"rack_count must be 1–100000, got {rack_count}")
    if cabinet_height_u not in VALID_CABINET_HEIGHTS:
        errors.append(f"cabinet_height_u must be one of {sorted(VALID_CABINET_HEIGHTS)}, got {cabinet_height_u}")
    if cooling_type not in VALID_COOLING_TYPES:
        errors.append(f"cooling_type must be one of {sorted(VALID_COOLING_TYPES)}, got {cooling_type}")
    if not (1 <= target_density_kw_per_rack <= 100):
        errors.append(f"target_density_kw_per_rack must be 1–100, got {target_density_kw_per_rack}")
    return errors


def classify_density(kw_per_rack):
    if kw_per_rack < 5:
        return "Low"
    elif kw_per_rack < 10:
        return "Medium"
    elif kw_per_rack < 20:
        return "High"
    elif kw_per_rack < 30:
        return "Very High"
    else:
        return "Ultra High"


def cooling_type_required(kw_per_rack):
    if kw_per_rack <= 15:
        return "air"
    elif kw_per_rack <= 30:
        return "air (hot-aisle containment required)"
    elif kw_per_rack <= 60:
        return "liquid (rear-door heat exchanger or in-row)"
    else:
        return "liquid (immersion or direct liquid cooling)"


def select_breaker(amps):
    for b in STANDARD_BREAKERS:
        if b >= amps:
            return b
    return STANDARD_BREAKERS[-1]


def calculate(total_it_load_kw, rack_count, cabinet_height_u, cooling_type, target_density_kw_per_rack):
    current_kw_per_rack = total_it_load_kw / rack_count
    classification = classify_density(current_kw_per_rack)

    # Target density analysis
    target_total_kw = target_density_kw_per_rack * rack_count
    load_increase_kw = max(0.0, target_total_kw - total_it_load_kw)
    required_cooling = cooling_type_required(target_density_kw_per_rack)

    if cooling_type == "liquid":
        max_per_rack = 60.0
    elif cooling_type == "hybrid":
        max_per_rack = 30.0
    else:
        max_per_rack = 20.0

    feasible = target_density_kw_per_rack <= max_per_rack

    # Airflow requirements (air-based calculation regardless of type for reference)
    cfm_per_rack = current_kw_per_rack * 160.0
    total_cfm = cfm_per_rack * rack_count

    if cooling_type == "air":
        cooling_notes = (
            f"Air cooling. CFM/rack based on 160 CFM/kW rule of thumb. "
            f"Verify raised-floor plenum velocity <600 FPM."
        )
    elif cooling_type == "liquid":
        cooling_notes = (
            "Liquid cooling in use. Airflow values provided for reference only. "
            "Liquid loop sizing required separately."
        )
    else:
        cooling_notes = (
            "Hybrid cooling. Airflow values cover sensible load not captured by liquid loop. "
            "Coordinate liquid and air system capacities."
        )

    # PDU recommendations
    pdus_per_rack = 2  # Redundant A+B feeds per NEC 645
    voltage = 208.0

    if current_kw_per_rack > 15:
        circuit_type = "3-phase 60A (NEMA L15-60 or equivalent)"
        circuit_amperage = 60
        # 3-phase: I = kW * 1000 / (sqrt(3) * 208) * 1.25
        load_amps = (current_kw_per_rack * 1000.0) / (math.sqrt(3) * voltage)
        design_amps = load_amps * 1.25
    elif current_kw_per_rack > 5:
        circuit_type = "single-phase 30A (NEMA L6-30)"
        circuit_amperage = 30
        load_amps = (current_kw_per_rack * 1000.0) / voltage
        design_amps = load_amps * 1.25
    else:
        circuit_type = "single-phase 20A (NEMA L6-20)"
        circuit_amperage = 20
        load_amps = (current_kw_per_rack * 1000.0) / voltage
        design_amps = load_amps * 1.25

    recommended_breaker = select_breaker(design_amps)

    # Branch circuits per PDU: assume PDU serves one rack, half load per feed
    # Each branch circuit at circuit_amperage; circuits needed = ceil(load_amps / circuit_amperage)
    amps_per_feed = load_amps / 2.0  # split between A and B feeds
    branch_circuits = max(1, math.ceil(amps_per_feed / circuit_amperage))
    total_pdus = pdus_per_rack * rack_count

    # Cabinet capacity
    reserved_u = 4
    usable_u = cabinet_height_u - reserved_u

    # Expansion capacity
    if cooling_type == "liquid":
        max_kw_per_rack_cooling = 60.0
    elif cooling_type == "hybrid":
        max_kw_per_rack_cooling = 30.0
    else:
        max_kw_per_rack_cooling = 20.0

    max_supported_kw = rack_count * max_kw_per_rack_cooling
    headroom_kw = max(0.0, max_supported_kw - total_it_load_kw)
    headroom_pct = (headroom_kw / max_supported_kw * 100.0) if max_supported_kw > 0 else 0.0
    racks_at_target = math.ceil(total_it_load_kw / target_density_kw_per_rack) if target_density_kw_per_rack > 0 else rack_count

    # Recommendations
    recommendations = []

    if current_kw_per_rack > 30:
        recommendations.append(
            "Ultra-high density (>30 kW/rack) detected. Liquid cooling (immersion or direct liquid) is required. "
            "Air cooling alone cannot support this density."
        )
    elif current_kw_per_rack > 20:
        recommendations.append(
            "Very high density (>20 kW/rack). Hot-aisle containment and precision cooling are mandatory. "
            "Evaluate liquid-assisted cooling solutions."
        )
    elif current_kw_per_rack > 15 and cooling_type == "air":
        recommendations.append(
            "Density exceeds 15 kW/rack with air cooling. Implement hot-aisle containment and "
            "ensure CRAC/CRAH units are positioned for optimal airflow."
        )

    if not feasible:
        recommendations.append(
            f"Target density of {target_density_kw_per_rack} kW/rack exceeds the {cooling_type} cooling limit "
            f"of {max_per_rack} kW/rack. Upgrade to liquid or hybrid cooling to meet target."
        )

    if headroom_pct < 20:
        recommendations.append(
            "Cooling headroom is below 20%. Plan capacity expansion before adding significant IT load."
        )

    if current_kw_per_rack < 5:
        recommendations.append(
            "Low density (<5 kW/rack). Consolidation opportunity exists. "
            "Evaluate server virtualization or hardware refresh to improve utilization."
        )

    recommendations.append(
        "Deploy dual redundant PDUs (A+B feeds) to every rack per NEC 645 requirements."
    )
    recommendations.append(
        "Install rack-level power monitoring (per-outlet metering) to track actual load vs. rated capacity."
    )
    recommendations.append(
        "Maintain branch circuit loading at ≤80% of rated ampacity per NEC 210.20 for continuous loads."
    )

    return {
        "input": {
            "total_it_load_kw": total_it_load_kw,
            "rack_count": rack_count,
            "cabinet_height_u": cabinet_height_u,
            "cooling_type": cooling_type,
            "target_density_kw_per_rack": target_density_kw_per_rack,
        },
        "current_density": {
            "kw_per_rack": round(current_kw_per_rack, 3),
            "classification": classification,
            "total_load_kw": round(total_it_load_kw, 2),
            "rack_count": rack_count,
        },
        "target_density_analysis": {
            "target_kw_per_rack": round(target_density_kw_per_rack, 2),
            "target_total_load_kw": round(target_total_kw, 2),
            "load_increase_kw": round(load_increase_kw, 2),
            "cooling_type_required": required_cooling,
            "feasible_with_current_cooling": feasible,
        },
        "airflow_requirements": {
            "cfm_per_rack": round(cfm_per_rack, 1),
            "total_cfm": round(total_cfm, 1),
            "cooling_type_notes": cooling_notes,
        },
        "pdu_recommendations": {
            "pdus_per_rack": pdus_per_rack,
            "circuit_amperage": circuit_amperage,
            "circuit_type": circuit_type,
            "branch_circuits_per_pdu": branch_circuits,
            "total_pdus_required": total_pdus,
        },
        "breaker_sizing": {
            "load_amps_per_rack": round(load_amps, 2),
            "design_amps_125pct": round(design_amps, 2),
            "recommended_breaker_amps": recommended_breaker,
        },
        "cabinet_capacity": {
            "total_u_available": cabinet_height_u,
            "reserved_u_per_rack": reserved_u,
            "usable_u_per_rack": usable_u,
        },
        "expansion_capacity": {
            "max_supported_kw_current_cooling": round(max_supported_kw, 2),
            "headroom_kw": round(headroom_kw, 2),
            "headroom_pct": round(headroom_pct, 2),
            "racks_at_target_density": racks_at_target,
        },
        "recommendations": recommendations,
    }


def main():
    if len(sys.argv) < 3:
        err = {
            "error": (
                "Usage: python power_density.py <total_it_load_kw> <rack_count> "
                "[cabinet_height_u] [cooling_type] [target_density_kw_per_rack]"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        total_it_load_kw = float(sys.argv[1])
        rack_count = int(sys.argv[2])
        cabinet_height_u = int(sys.argv[3]) if len(sys.argv) > 3 else 42
        cooling_type = sys.argv[4] if len(sys.argv) > 4 else "air"
        target_density_kw_per_rack = float(sys.argv[5]) if len(sys.argv) > 5 else 10.0
    except ValueError as exc:
        err = {"error": f"Invalid argument: {exc}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    errors = validate_inputs(total_it_load_kw, rack_count, cabinet_height_u, cooling_type, target_density_kw_per_rack)
    if errors:
        err = {"error": "; ".join(errors)}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    result = calculate(total_it_load_kw, rack_count, cabinet_height_u, cooling_type, target_density_kw_per_rack)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
