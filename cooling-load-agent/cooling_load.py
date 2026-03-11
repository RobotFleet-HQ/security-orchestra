#!/usr/bin/env python3
"""Data center cooling load calculations per ASHRAE TC 9.9."""

import sys
import json
import math


UNIT_SIZES = [2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100]


def validate_inputs(it_load_kw, ups_capacity_kw, room_sqft, ceiling_height_ft, ambient_temp_f):
    errors = []
    if not (1 <= it_load_kw <= 500000):
        errors.append(f"it_load_kw must be 1–500000, got {it_load_kw}")
    if not (1 <= ups_capacity_kw <= 500000):
        errors.append(f"ups_capacity_kw must be 1–500000, got {ups_capacity_kw}")
    if not (100 <= room_sqft <= 1000000):
        errors.append(f"room_sqft must be 100–1000000, got {room_sqft}")
    if not (8 <= ceiling_height_ft <= 40):
        errors.append(f"ceiling_height_ft must be 8–40, got {ceiling_height_ft}")
    if not (32 <= ambient_temp_f <= 120):
        errors.append(f"ambient_temp_f must be 32–120, got {ambient_temp_f}")
    return errors


def classify_unit_size(it_load_kw):
    if it_load_kw < 100:
        preferred = [s for s in UNIT_SIZES if 5 <= s <= 15]
    elif it_load_kw <= 500:
        preferred = [s for s in UNIT_SIZES if 20 <= s <= 40]
    else:
        preferred = [s for s in UNIT_SIZES if 50 <= s <= 100]
    return preferred[-1] if preferred else UNIT_SIZES[-1]


def calculate(it_load_kw, ups_capacity_kw, room_sqft, ceiling_height_ft, ambient_temp_f):
    # 1. IT heat rejection
    it_btu = it_load_kw * 3412.14

    # 2. UPS heat loss (6% of UPS capacity)
    ups_btu = ups_capacity_kw * (1 - 0.94) * 3412.14

    # 3. Lighting heat
    lighting_btu = room_sqft * 6.824

    # 4. Building envelope gain
    perimeter = 4 * math.sqrt(room_sqft)
    wall_area = perimeter * ceiling_height_ft
    roof_area = room_sqft
    delta_t = max(0.0, ambient_temp_f - 70.0)
    wall_gain = wall_area * 0.05 * delta_t
    roof_gain = roof_area * 0.04 * delta_t
    envelope_btu = wall_gain + roof_gain

    # 5. Miscellaneous (5% of IT load)
    misc_btu = it_btu * 0.05

    # 6. Total
    total_btu = it_btu + ups_btu + lighting_btu + envelope_btu + misc_btu

    # 7. Tons
    total_tons = total_btu / 12000.0

    # 8. Design tons with 10% margin
    design_tons = total_tons * 1.10

    # Airflow: CFM = total_btu / (1.1 * 20)
    delta_t_supply = 20.0
    total_cfm = total_btu / (1.1 * delta_t_supply)
    cfm_per_kw = total_cfm / it_load_kw

    # Unit selection
    unit_size = classify_unit_size(it_load_kw)
    units_n = math.ceil(design_tons / unit_size)
    if units_n < 1:
        units_n = 1
    units_n1 = units_n + 1  # N+1
    if units_n1 < 2:
        units_n1 = 2
    total_installed_tons = units_n1 * unit_size
    redundancy_pct = (total_installed_tons - design_tons) / design_tons * 100.0

    # Derived metrics
    btu_per_sqft = total_btu / room_sqft
    watts_per_sqft = (it_load_kw * 1000.0) / room_sqft

    # ASHRAE compliance
    ashrae_class = "A1" if ambient_temp_f <= 95 else "A2"
    if ashrae_class == "A1":
        supply_temp_range = "59–77°F"
        return_temp_max = 80
    else:
        supply_temp_range = "50–95°F"
        return_temp_max = 95

    # Recommendations
    recommendations = []

    if it_load_kw / room_sqft > 0.3:
        recommendations.append(
            "High power density detected (>300W/sqft). Consider high-density cooling strategies such as rear-door heat exchangers or in-row cooling."
        )

    if delta_t == 0:
        recommendations.append(
            "Outdoor ambient is at or below 70°F setpoint. Economizer/free-cooling operation is viable and recommended to reduce mechanical cooling hours."
        )
    elif ambient_temp_f >= 100:
        recommendations.append(
            "High outdoor design temperature. Ensure condensing equipment is rated for elevated ambient conditions. Consider evaporative pre-cooling."
        )

    if total_tons > 500:
        recommendations.append(
            "Large cooling plant (>500 tons). Evaluate chilled-water plant with centrifugal chillers and cooling towers for optimal efficiency."
        )

    if cfm_per_kw < 100:
        recommendations.append(
            "Low CFM/kW ratio. Verify hot-aisle/cold-aisle containment is in place to prevent recirculation."
        )
    elif cfm_per_kw > 200:
        recommendations.append(
            "High CFM/kW ratio may indicate over-ventilation. Audit airflow paths and seal unused rack U-spaces."
        )

    if redundancy_pct < 10:
        recommendations.append(
            "N+1 redundancy margin is less than 10%. Consider adding an additional cooling unit."
        )

    if ashrae_class == "A2":
        recommendations.append(
            "Design falls within ASHRAE A2 envelope. Validate that all installed equipment supports A2 operating conditions."
        )

    recommendations.append(
        "Implement continuous monitoring of supply and return air temperatures with automated alerts at ±2°F from setpoints."
    )
    recommendations.append(
        "Commission hot-aisle/cold-aisle containment to eliminate bypass and recirculation airflow."
    )

    return {
        "input": {
            "it_load_kw": it_load_kw,
            "ups_capacity_kw": ups_capacity_kw,
            "room_sqft": room_sqft,
            "ceiling_height_ft": ceiling_height_ft,
            "ambient_temp_f": ambient_temp_f,
        },
        "heat_sources_btu_hr": {
            "it_equipment": round(it_btu, 2),
            "ups_losses": round(ups_btu, 2),
            "lighting": round(lighting_btu, 2),
            "building_envelope": round(envelope_btu, 2),
            "miscellaneous": round(misc_btu, 2),
            "total": round(total_btu, 2),
        },
        "cooling_requirements": {
            "total_btu_hr": round(total_btu, 2),
            "total_tons": round(total_tons, 3),
            "design_tons_with_margin": round(design_tons, 3),
            "btu_per_sqft": round(btu_per_sqft, 2),
            "watts_per_sqft": round(watts_per_sqft, 2),
        },
        "airflow": {
            "total_cfm": round(total_cfm, 1),
            "cfm_per_kw_it": round(cfm_per_kw, 2),
            "supply_temp_f": 65,
            "return_temp_setpoint_f": 80,
            "delta_t_f": 20,
        },
        "unit_selection": {
            "selected_unit_size_tons": unit_size,
            "units_required_n": units_n,
            "units_recommended_n_plus_1": units_n1,
            "total_installed_tons": round(total_installed_tons, 2),
            "redundancy_pct": round(redundancy_pct, 2),
        },
        "ashrae_compliance": {
            "class": ashrae_class,
            "supply_temp_range_f": supply_temp_range,
            "return_temp_max_f": return_temp_max,
            "humidity_range_rh": "20–80% RH (non-condensing)",
        },
        "recommendations": recommendations,
    }


def main():
    if len(sys.argv) < 4:
        err = {
            "error": (
                "Usage: python cooling_load.py <it_load_kw> <ups_capacity_kw> "
                "<room_sqft> [ceiling_height_ft] [ambient_temp_f]"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        it_load_kw = float(sys.argv[1])
        ups_capacity_kw = float(sys.argv[2])
        room_sqft = float(sys.argv[3])
        ceiling_height_ft = float(sys.argv[4]) if len(sys.argv) > 4 else 12.0
        ambient_temp_f = float(sys.argv[5]) if len(sys.argv) > 5 else 95.0
    except ValueError as exc:
        err = {"error": f"Invalid numeric argument: {exc}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    errors = validate_inputs(it_load_kw, ups_capacity_kw, room_sqft, ceiling_height_ft, ambient_temp_f)
    if errors:
        err = {"error": "; ".join(errors)}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    result = calculate(it_load_kw, ups_capacity_kw, room_sqft, ceiling_height_ft, ambient_temp_f)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
