#!/usr/bin/env python3
"""
Fuel Storage Sizing Agent
CLI: python fuel_storage.py <generator_kw> <target_runtime_hours> <tank_type> <jurisdiction>
"""

import sys
import json


CONSUMPTION_RATE_GPH_PER_KW = 0.068
SAFETY_MARGIN = 1.10

STANDARD_TANK_SIZES = [275, 500, 550, 1000, 1500, 2000, 2500, 5000, 10000, 15000, 20000, 25000, 30000]

VALID_TANK_TYPES = {"above_ground", "underground", "day_tank"}
VALID_JURISDICTIONS = {"epa", "california", "nfpa30"}

EPA_SPCC_THRESHOLD = 1320
DAY_TANK_MAX_GALLONS = 660
NFPA30_INSIDE_MAX = 660

CONTAINMENT_FACTOR = 1.10


def validate_inputs(generator_kw, target_runtime_hours, tank_type, jurisdiction):
    if not (1 <= generator_kw <= 50000):
        raise ValueError(f"generator_kw must be between 1 and 50000, got {generator_kw}")
    if not (1 <= target_runtime_hours <= 480):
        raise ValueError(f"target_runtime_hours must be between 1 and 480, got {target_runtime_hours}")
    if tank_type not in VALID_TANK_TYPES:
        raise ValueError(f"tank_type must be one of {sorted(VALID_TANK_TYPES)}, got '{tank_type}'")
    if jurisdiction not in VALID_JURISDICTIONS:
        raise ValueError(f"jurisdiction must be one of {sorted(VALID_JURISDICTIONS)}, got '{jurisdiction}'")


def select_standard_tank(design_gallons):
    for size in STANDARD_TANK_SIZES:
        if size >= design_gallons:
            return size, 1
    # Multiple tanks required
    largest = STANDARD_TANK_SIZES[-1]
    num_tanks = math.ceil(design_gallons / largest)
    return largest, num_tanks


def compute_fuel_requirements(generator_kw, target_runtime_hours, tank_type):
    consumption_gph = generator_kw * CONSUMPTION_RATE_GPH_PER_KW
    required_gallons = consumption_gph * target_runtime_hours
    design_gallons = required_gallons * SAFETY_MARGIN

    # Day tank is capped at 660 gal inside; size for that if applicable
    if tank_type == "day_tank":
        effective_design = min(design_gallons, DAY_TANK_MAX_GALLONS)
    else:
        effective_design = design_gallons

    selected_size, num_tanks = select_standard_tank(effective_design)

    total_capacity = selected_size * num_tanks
    actual_runtime = total_capacity / consumption_gph if consumption_gph > 0 else 0

    return {
        "consumption_gph": round(consumption_gph, 3),
        "required_gallons_no_margin": round(required_gallons, 1),
        "design_gallons_with_10pct_margin": round(design_gallons, 1),
        "selected_tank_size_gallons": selected_size,
        "number_of_tanks": num_tanks,
        "actual_runtime_hours": round(actual_runtime, 2),
    }


def compute_tank_specification(tank_type, selected_gallons):
    if tank_type == "underground":
        construction = "double-wall fiberglass"
        material = "fiberglass reinforced plastic (FRP)"
        ul_listing = "UL 1746 for fiberglass underground"
    elif tank_type == "above_ground":
        if selected_gallons > EPA_SPCC_THRESHOLD:
            construction = "double-wall steel"
        else:
            construction = "single-wall steel"
        material = "carbon steel"
        ul_listing = "UL 142 for above-ground steel"
    else:  # day_tank
        construction = "single-wall steel"
        material = "carbon steel"
        ul_listing = "UL 142 for above-ground steel"

    return {
        "tank_type": tank_type,
        "construction": construction,
        "material": material,
        "ul_listing": ul_listing,
    }


def compute_regulatory_requirements(tank_type, selected_gallons, num_tanks, jurisdiction):
    total_gallons = selected_gallons * num_tanks
    spcc_required = (tank_type in {"above_ground", "day_tank"}) and (total_gallons > EPA_SPCC_THRESHOLD)
    underground_registration = tank_type == "underground"

    if spcc_required:
        spcc_note = (
            f"Total above-ground storage {total_gallons:,} gal exceeds {EPA_SPCC_THRESHOLD:,} gal "
            "EPA SPCC threshold. A Spill Prevention, Control and Countermeasure (SPCC) Plan "
            "is required under 40 CFR Part 112."
        )
    else:
        spcc_note = (
            f"Total above-ground storage {total_gallons:,} gal is at or below {EPA_SPCC_THRESHOLD:,} gal "
            "EPA SPCC threshold. SPCC Plan not required under federal rule; verify state requirements."
        )

    secondary_containment_gallons = round(selected_gallons * CONTAINMENT_FACTOR, 1)
    containment_note = (
        f"Secondary containment must hold 110% of the largest single tank volume "
        f"({secondary_containment_gallons:,.0f} gal per NFPA 30 Section 9.4)."
    )

    regulations = []
    if jurisdiction == "epa" or jurisdiction in {"california", "nfpa30"}:
        regulations.append("40 CFR Part 112 (SPCC)")
        regulations.append("NFPA 30 - Flammable and Combustible Liquids Code")
        regulations.append("NFPA 110 - Standard for Emergency and Standby Power Systems")
    if underground_registration:
        regulations.append("40 CFR Part 280 (Underground Storage Tank regulations)")
        regulations.append("State UST registration required")
    if jurisdiction == "california":
        regulations.append("California Fire Code Chapter 57")
        regulations.append("California Health & Safety Code Chapter 6.7 (UST Program)")
        regulations.append("CARB diesel fuel regulations")
    regulations.append("Local Fire Code (AHJ)")
    regulations.append("IFC (International Fire Code)")

    return {
        "spcc_plan_required": spcc_required,
        "spcc_threshold_note": spcc_note,
        "secondary_containment_gallons": secondary_containment_gallons,
        "containment_note": containment_note,
        "underground_registration": underground_registration,
        "applicable_regulations": regulations,
    }


def compute_piping_specification(selected_gallons):
    fill_pipe = 2.0

    if selected_gallons < 550:
        vent_pipe = 1.25
    elif selected_gallons <= 2500:
        vent_pipe = 2.0
    else:
        vent_pipe = 3.0

    return {
        "fill_pipe_diameter_inches": fill_pipe,
        "vent_pipe_diameter_inches": vent_pipe,
        "emergency_vent": "Size per API 2000 based on tank volume and fire exposure",
        "check_valve_required": True,
    }


def compute_day_tank_recommendation(generator_kw, target_runtime_hours, tank_type):
    if generator_kw > 100 and target_runtime_hours > 8:
        recommended = True
        reason = (
            f"Generator rated {generator_kw} kW with {target_runtime_hours} hr runtime. "
            "Day tank + main tank configuration is recommended for generators >100 kW "
            "with runtime >8 hours. Day tank provides local fuel supply and reduces "
            "wear on fuel transfer pump."
        )
        day_tank_size = 275  # smallest standard; often 275 or 500 gal for day tanks
        transfer_pump_gph = round(generator_kw * CONSUMPTION_RATE_GPH_PER_KW * 1.25, 1)
    elif tank_type == "day_tank":
        recommended = True
        reason = "Day tank specified directly. Connect to main storage tank via transfer pump."
        day_tank_size = 275
        transfer_pump_gph = round(generator_kw * CONSUMPTION_RATE_GPH_PER_KW * 1.25, 1)
    else:
        recommended = False
        reason = (
            "Day tank not required for this configuration. "
            "Single tank with direct engine fuel connection is acceptable."
        )
        day_tank_size = None
        transfer_pump_gph = None

    return {
        "recommended": recommended,
        "reason": reason,
        "day_tank_size_gallons": day_tank_size,
        "transfer_pump_gph": transfer_pump_gph,
    }


def fire_separation_distance(selected_gallons):
    if selected_gallons < 660:
        return 5
    elif selected_gallons <= 2500:
        return 10
    else:
        return 25


def build_installation_notes(generator_kw, target_runtime_hours, tank_type, jurisdiction,
                              fuel_requirements, tank_spec, regulatory):
    notes = []

    notes.append(
        "Fuel consumption rate of 0.068 gal/kWh is based on full-load operation. "
        "Partial load operation will extend actual runtime."
    )

    if tank_type == "underground":
        notes.append(
            "Underground tanks require corrosion protection, interstitial monitoring, "
            "and overfill protection per 40 CFR Part 280."
        )
        notes.append(
            "Underground tank installation requires licensed contractor and permits. "
            "Submit plans to AHJ and state UST program prior to installation."
        )

    if tank_type == "above_ground":
        notes.append(
            "Above-ground tank must be installed on level, compacted pad. "
            "Anchor bolts or hold-downs required in seismic zones."
        )

    if regulatory["spcc_plan_required"]:
        notes.append(
            "SPCC Plan must be prepared by a licensed Professional Engineer "
            "and implemented before fuel delivery."
        )

    if jurisdiction == "california":
        notes.append(
            "California requires Hazardous Materials Business Plan (HMBP) filing "
            "with CUPA if >55 gallons of diesel stored."
        )
        notes.append(
            "CARB requires low-sulfur ultra-low-sulfur diesel (ULSD, <15 ppm sulfur) "
            "for all stationary diesel engines."
        )

    notes.append(
        "Fuel additives and biocide treatment recommended for tanks storing fuel >6 months "
        "to prevent microbial growth and fuel degradation."
    )
    notes.append(
        "Annual fuel polishing and tank inspection recommended per NFPA 110 Section 8.3."
    )
    notes.append(
        "Overfill protection required: high-level alarm at 90% capacity, "
        "automatic shut-off or flow restrictor at 95% capacity."
    )
    notes.append(
        "Coordinate with AHJ for required permits: building, fire, environmental, and utility."
    )

    selected_gal = fuel_requirements["selected_tank_size_gallons"]
    num_tanks = fuel_requirements["number_of_tanks"]
    if num_tanks > 1:
        notes.append(
            f"Multiple tanks ({num_tanks} × {selected_gal:,} gal) required. "
            "Manifolding and equalization piping required between tanks."
        )

    return notes


import math


def size_fuel_storage(generator_kw, target_runtime_hours, tank_type, jurisdiction):
    validate_inputs(generator_kw, target_runtime_hours, tank_type, jurisdiction)

    fuel_requirements = compute_fuel_requirements(generator_kw, target_runtime_hours, tank_type)
    selected_gallons = fuel_requirements["selected_tank_size_gallons"]
    num_tanks = fuel_requirements["number_of_tanks"]

    tank_spec = compute_tank_specification(tank_type, selected_gallons)
    regulatory = compute_regulatory_requirements(tank_type, selected_gallons, num_tanks, jurisdiction)
    piping = compute_piping_specification(selected_gallons)
    day_tank = compute_day_tank_recommendation(generator_kw, target_runtime_hours, tank_type)
    fire_sep = fire_separation_distance(selected_gallons)
    installation_notes = build_installation_notes(
        generator_kw, target_runtime_hours, tank_type, jurisdiction,
        fuel_requirements, tank_spec, regulatory
    )

    return {
        "input": {
            "generator_kw": generator_kw,
            "target_runtime_hours": target_runtime_hours,
            "tank_type": tank_type,
            "jurisdiction": jurisdiction,
        },
        "fuel_requirements": fuel_requirements,
        "tank_specification": tank_spec,
        "regulatory_requirements": regulatory,
        "piping_specification": piping,
        "day_tank_recommendation": day_tank,
        "installation_notes": installation_notes,
        "fire_separation_ft": fire_sep,
    }


def main():
    if len(sys.argv) < 3:
        error = {
            "error": (
                "Usage: python fuel_storage.py <generator_kw> <target_runtime_hours> "
                "[tank_type] [jurisdiction]"
            )
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    try:
        generator_kw = float(sys.argv[1])
        target_runtime_hours = float(sys.argv[2])
        tank_type = sys.argv[3] if len(sys.argv) > 3 else "above_ground"
        jurisdiction = sys.argv[4] if len(sys.argv) > 4 else "epa"

        result = size_fuel_storage(generator_kw, target_runtime_hours, tank_type, jurisdiction)
        print(json.dumps(result, indent=2))

    except (ValueError, KeyError) as exc:
        error = {"error": str(exc)}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        error = {"error": f"Unexpected error: {exc}"}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
