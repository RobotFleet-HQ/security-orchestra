"""
Battery Energy Storage Sizing Agent
Usage: battery_storage.py <it_load_kw> <target_runtime_minutes> <chemistry> [use_case=ups_backup]

chemistry: lithium_ion | lfp | vrla | flow
use_case: ups_backup | peak_shaving | demand_response | islanding
"""

import sys
import json


CHEMISTRY_SPECS = {
    "lithium_ion": {
        "energy_density_wh_per_kg": 200,
        "cycle_life": 3000,
        "cost_per_kwh": 300,
        "c_rate": 1.0,
        "round_trip_eff": 0.94,
        "dod_usable": 0.80,
    },
    "lfp": {
        "energy_density_wh_per_kg": 160,
        "cycle_life": 6000,
        "cost_per_kwh": 280,
        "c_rate": 0.5,
        "round_trip_eff": 0.96,
        "dod_usable": 0.80,
    },
    "vrla": {
        "energy_density_wh_per_kg": 35,
        "cycle_life": 500,
        "cost_per_kwh": 150,
        "c_rate": 0.2,
        "round_trip_eff": 0.85,
        "dod_usable": 0.80,
    },
    "flow": {
        "energy_density_wh_per_kg": 25,
        "cycle_life": 20000,
        "cost_per_kwh": 400,
        "c_rate": 0.25,
        "round_trip_eff": 0.75,
        "dod_usable": 0.80,
    },
}

USE_CASE_CYCLES_PER_DAY = {
    "ups_backup":       4,
    "peak_shaving":     1,
    "demand_response":  2,
    "islanding":        0.5,
}

FLOOR_LOADING_LBS_PER_SQFT = 200.0
KG_TO_LBS = 2.205


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: battery_storage.py <it_load_kw> <target_runtime_minutes> <chemistry> [use_case=ups_backup]"}), file=sys.stderr)
        sys.exit(1)

    try:
        it_load_kw = float(sys.argv[1])
        runtime_minutes = float(sys.argv[2])
        chemistry = sys.argv[3].lower()
        use_case = sys.argv[4].lower() if len(sys.argv) == 5 else "ups_backup"
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if it_load_kw < 1 or it_load_kw > 500000:
        print(json.dumps({"error": "it_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if runtime_minutes < 1 or runtime_minutes > 480:
        print(json.dumps({"error": "target_runtime_minutes must be 1-480"}), file=sys.stderr)
        sys.exit(1)
    if chemistry not in CHEMISTRY_SPECS:
        print(json.dumps({"error": "chemistry must be: lithium_ion, lfp, vrla, or flow"}), file=sys.stderr)
        sys.exit(1)
    if use_case not in USE_CASE_CYCLES_PER_DAY:
        print(json.dumps({"error": "use_case must be: ups_backup, peak_shaving, demand_response, or islanding"}), file=sys.stderr)
        sys.exit(1)

    specs = CHEMISTRY_SPECS[chemistry]

    # Energy needed
    energy_needed_kwh = it_load_kw * runtime_minutes / 60.0
    usable_kwh = energy_needed_kwh / specs["round_trip_eff"]
    system_kwh = usable_kwh / specs["dod_usable"]  # with DOD buffer

    # System power
    system_power_kw = it_load_kw  # must match load

    # Physical sizing
    system_mass_kg = (system_kwh * 1000.0) / specs["energy_density_wh_per_kg"]
    system_mass_lbs = system_mass_kg * KG_TO_LBS
    system_footprint_sqft = system_mass_lbs / FLOOR_LOADING_LBS_PER_SQFT

    # Cost
    system_cost = system_kwh * specs["cost_per_kwh"]

    # Replacement interval
    cycles_per_day = USE_CASE_CYCLES_PER_DAY[use_case]
    if cycles_per_day > 0:
        replacement_years = specs["cycle_life"] / (365 * cycles_per_day)
    else:
        replacement_years = specs["cycle_life"] / 365

    # Chemistry comparison (brief ratings)
    ratings = {
        "lithium_ion": {"cost_rating": "moderate", "cycle_life_rating": "good", "energy_density_rating": "excellent"},
        "lfp": {"cost_rating": "moderate", "cycle_life_rating": "excellent", "energy_density_rating": "good"},
        "vrla": {"cost_rating": "low", "cycle_life_rating": "poor", "energy_density_rating": "poor"},
        "flow": {"cost_rating": "high", "cycle_life_rating": "exceptional", "energy_density_rating": "poor"},
    }

    output = {
        "input": {
            "it_load_kw": it_load_kw,
            "target_runtime_minutes": runtime_minutes,
            "chemistry": chemistry,
            "use_case": use_case,
        },
        "system_capacity_kwh": round(system_kwh, 1),
        "system_power_kw": system_power_kw,
        "system_mass_kg": round(system_mass_kg, 0),
        "system_footprint_sqft": round(system_footprint_sqft, 0),
        "system_cost": round(system_cost, 0),
        "replacement_interval_years": round(replacement_years, 1),
        "chemistry_comparison": ratings,
        "recommended_use_case_fit": use_case,
        "chemistry_specs": {
            "round_trip_efficiency": specs["round_trip_eff"],
            "cycle_life": specs["cycle_life"],
            "c_rate": specs["c_rate"],
        },
        "notes": [
            f"{chemistry.replace('_', ' ').title()}: {system_kwh:.1f} kWh for {runtime_minutes} min runtime at {it_load_kw} kW.",
            f"System footprint: {system_footprint_sqft:.0f} sqft at standard floor loading ({FLOOR_LOADING_LBS_PER_SQFT} lbs/sqft).",
            f"Replacement cycle: {replacement_years:.1f} years at {cycles_per_day} cycles/day for {use_case.replace('_', ' ')}.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
