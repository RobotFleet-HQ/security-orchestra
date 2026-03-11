#!/usr/bin/env python3
"""
UPS Sizing Agent
CLI: python ups_sizing.py <load_kw> <runtime_minutes> <redundancy> <voltage> <battery_type>
"""

import sys
import json
import math


POWER_FACTOR = 0.9
HEADROOM_FACTOR = 1.25
DC_BUS_VOLTAGE = 240

BATTERY_SPECS = {
    "VRLA": {
        "dod": 0.80,
        "charge_efficiency": 0.95,
        "cell_voltage": 2.0,
        "cells_per_string": 120,
        "cost_per_kwh_low": 150,
        "cost_per_kwh_high": 200,
        "standard_ah": [7, 12, 18, 26, 33, 40, 55, 75, 100, 150, 200],
    },
    "Li-ion": {
        "dod": 0.90,
        "charge_efficiency": 0.97,
        "cell_voltage": 3.2,
        "cells_per_string": 75,
        "cost_per_kwh_low": 400,
        "cost_per_kwh_high": 600,
        "standard_ah": [20, 40, 50, 100, 200],
    },
}

STANDARD_UPS_KVA = [
    10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 225,
    250, 300, 400, 500, 600, 750, 800, 1000, 1200, 1500, 2000,
]

UPS_COST_PER_KVA_LOW = 80
UPS_COST_PER_KVA_HIGH = 120

VALID_REDUNDANCY = {"N", "N+1", "2N"}
VALID_VOLTAGE = {208, 480}
VALID_BATTERY_TYPE = {"VRLA", "Li-ion"}


def validate_inputs(load_kw, runtime_minutes, redundancy, voltage, battery_type):
    if not (0.1 <= load_kw <= 100000):
        raise ValueError(f"load_kw must be between 0.1 and 100000, got {load_kw}")
    if not (1 <= runtime_minutes <= 480):
        raise ValueError(f"runtime_minutes must be between 1 and 480, got {runtime_minutes}")
    if redundancy not in VALID_REDUNDANCY:
        raise ValueError(f"redundancy must be one of {sorted(VALID_REDUNDANCY)}, got '{redundancy}'")
    if voltage not in VALID_VOLTAGE:
        raise ValueError(f"voltage must be one of {sorted(VALID_VOLTAGE)}, got {voltage}")
    if battery_type not in VALID_BATTERY_TYPE:
        raise ValueError(f"battery_type must be one of {sorted(VALID_BATTERY_TYPE)}, got '{battery_type}'")


def select_standard(value, standards):
    for s in sorted(standards):
        if s >= value:
            return s
    return None  # exceeds all standard sizes


def compute_ups_sizing(load_kw, redundancy):
    load_kva = load_kw / POWER_FACTOR
    design_kva = load_kva * HEADROOM_FACTOR

    selected_module_kva = select_standard(design_kva, STANDARD_UPS_KVA)
    if selected_module_kva is None:
        selected_module_kva = STANDARD_UPS_KVA[-1]

    if redundancy == "N":
        module_count = 1
        configuration = "N"
        configuration_description = (
            "Single UPS module; no redundancy. Loss of module results in loss of power."
        )
    elif redundancy == "N+1":
        module_count = 2
        configuration = "N+1"
        configuration_description = (
            "Two UPS modules in parallel; one module can fail and load is maintained."
        )
    else:  # 2N
        module_count = 2
        configuration = "2N"
        configuration_description = (
            "Two fully independent UPS systems each rated for 100% of load; "
            "complete isolation between systems."
        )

    total_installed_kva = selected_module_kva * module_count

    return {
        "load_kva": round(load_kva, 2),
        "design_kva_with_headroom": round(design_kva, 2),
        "selected_module_kva": selected_module_kva,
        "module_count": module_count,
        "configuration": configuration,
        "configuration_description": configuration_description,
        "total_installed_kva": float(total_installed_kva),
    }


def compute_battery_sizing(load_kw, runtime_minutes, redundancy, battery_type):
    specs = BATTERY_SPECS[battery_type]
    dod = specs["dod"]
    charge_efficiency = specs["charge_efficiency"]
    cells_per_string = specs["cells_per_string"]
    standard_ah = specs["standard_ah"]

    runtime_hr = runtime_minutes / 60.0
    required_wh = (load_kw * 1000 * runtime_hr) / dod / charge_efficiency
    required_ah = required_wh / DC_BUS_VOLTAGE

    selected_ah = select_standard(required_ah, standard_ah)
    if selected_ah is None:
        selected_ah = standard_ah[-1]

    if redundancy == "N":
        parallel_strings = 1
    elif redundancy == "N+1":
        parallel_strings = 2
    else:  # 2N — two independent systems each with own battery
        parallel_strings = 2

    total_battery_units = cells_per_string * parallel_strings
    total_energy_kwh = (selected_ah * DC_BUS_VOLTAGE * parallel_strings) / 1000.0

    return {
        "dc_bus_voltage_v": DC_BUS_VOLTAGE,
        "required_ah_per_string": round(required_ah, 2),
        "selected_ah_per_string": selected_ah,
        "cells_per_string": cells_per_string,
        "parallel_strings": parallel_strings,
        "total_battery_units": total_battery_units,
        "total_energy_kwh": round(total_energy_kwh, 2),
        "battery_type": battery_type,
        "depth_of_discharge_pct": round(dod * 100, 1),
    }


def compute_runtime_analysis(load_kw, battery_sizing, battery_type):
    specs = BATTERY_SPECS[battery_type]
    dod = specs["dod"]
    efficiency = specs["charge_efficiency"]

    selected_ah = battery_sizing["selected_ah_per_string"]

    def runtime_at_load(load_factor):
        actual_load_kw = load_factor * load_kw
        if actual_load_kw == 0:
            return float("inf")
        rt_hr = (selected_ah * DC_BUS_VOLTAGE * dod * efficiency) / (actual_load_kw * 1000)
        return round(rt_hr * 60, 1)

    return {
        "at_100pct_load_minutes": runtime_at_load(1.0),
        "at_75pct_load_minutes": runtime_at_load(0.75),
        "at_50pct_load_minutes": runtime_at_load(0.50),
        "design_runtime_minutes": runtime_at_load(1.0),
    }


def compute_cost_estimate(ups_sizing, battery_sizing, battery_type):
    specs = BATTERY_SPECS[battery_type]
    total_installed_kva = ups_sizing["total_installed_kva"]
    total_energy_kwh = battery_sizing["total_energy_kwh"]

    ups_low = int(total_installed_kva * UPS_COST_PER_KVA_LOW)
    ups_high = int(total_installed_kva * UPS_COST_PER_KVA_HIGH)
    bat_low = int(total_energy_kwh * specs["cost_per_kwh_low"])
    bat_high = int(total_energy_kwh * specs["cost_per_kwh_high"])

    return {
        "ups_modules_low_usd": ups_low,
        "ups_modules_high_usd": ups_high,
        "batteries_low_usd": bat_low,
        "batteries_high_usd": bat_high,
        "total_low_usd": ups_low + bat_low,
        "total_high_usd": ups_high + bat_high,
        "note": (
            "Rough order-of-magnitude estimate. Does not include installation labor, "
            "switchgear, conduit, civil works, or engineering fees. "
            "Obtain competitive bids for budget planning."
        ),
    }


def build_installation_notes(load_kw, runtime_minutes, redundancy, voltage, battery_type, ups_sizing, battery_sizing):
    notes = []

    notes.append(
        f"UPS output voltage {voltage}V AC; verify input voltage matches facility distribution."
    )

    if redundancy == "2N":
        notes.append(
            "2N configuration requires two independent electrical feeds, two transfer switches, "
            "and physical separation of each system."
        )
    elif redundancy == "N+1":
        notes.append(
            "N+1 parallel modules require static bypass and automatic load transfer capability."
        )

    if battery_type == "VRLA":
        notes.append(
            "VRLA batteries require ventilated enclosure per IEEE 1187. "
            "Hydrogen accumulation must be managed per NFPA 111."
        )
        notes.append(
            "VRLA battery room temperature should be maintained at 20-25°C (68-77°F) "
            "to achieve rated capacity and service life."
        )
    else:
        notes.append(
            "Li-ion batteries require battery management system (BMS) communication "
            "with UPS for state-of-charge monitoring and cell balancing."
        )
        notes.append(
            "Li-ion installation requires thermal runaway protection per NFPA 855 "
            "and fire suppression review with AHJ."
        )

    if battery_sizing["selected_ah_per_string"] == BATTERY_SPECS[battery_type]["standard_ah"][-1]:
        if battery_sizing["required_ah_per_string"] > battery_sizing["selected_ah_per_string"]:
            notes.append(
                "WARNING: Required Ah per string exceeds largest standard size. "
                "Additional parallel strings may be required. Consult battery manufacturer."
            )

    notes.append(
        f"Total DC bus: {DC_BUS_VOLTAGE}V; verify UPS rectifier and inverter ratings match."
    )
    notes.append(
        "Commissioning must include battery discharge test to rated capacity per IEEE 1188."
    )
    notes.append(
        "Maintenance plan: VRLA annual capacity test per IEEE 1188; Li-ion per manufacturer schedule."
    )

    if load_kw >= 500:
        notes.append(
            "Large UPS systems (>500 kW): coordinate inrush current and harmonic distortion "
            "with utility and facility transformer sizing."
        )

    return notes


def size_ups(load_kw, runtime_minutes, redundancy, voltage, battery_type):
    validate_inputs(load_kw, runtime_minutes, redundancy, voltage, battery_type)

    ups_sizing = compute_ups_sizing(load_kw, redundancy)
    battery_sizing = compute_battery_sizing(load_kw, runtime_minutes, redundancy, battery_type)
    runtime_analysis = compute_runtime_analysis(load_kw, battery_sizing, battery_type)
    cost_estimate = compute_cost_estimate(ups_sizing, battery_sizing, battery_type)
    installation_notes = build_installation_notes(
        load_kw, runtime_minutes, redundancy, voltage, battery_type,
        ups_sizing, battery_sizing
    )

    return {
        "input": {
            "load_kw": load_kw,
            "runtime_minutes": runtime_minutes,
            "redundancy": redundancy,
            "voltage": voltage,
            "battery_type": battery_type,
            "power_factor": POWER_FACTOR,
        },
        "ups_sizing": ups_sizing,
        "battery_sizing": battery_sizing,
        "runtime_analysis": runtime_analysis,
        "cost_estimate": cost_estimate,
        "installation_notes": installation_notes,
        "compliance_standards": ["IEEE 485", "IEEE 1184", "NFPA 111", "IEC 62040-3"],
    }


def main():
    if len(sys.argv) < 3:
        error = {
            "error": (
                "Usage: python ups_sizing.py <load_kw> <runtime_minutes> "
                "[redundancy] [voltage] [battery_type]"
            )
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    try:
        load_kw = float(sys.argv[1])
        runtime_minutes = float(sys.argv[2])
        redundancy = sys.argv[3] if len(sys.argv) > 3 else "N+1"
        voltage = int(sys.argv[4]) if len(sys.argv) > 4 else 480
        battery_type = sys.argv[5] if len(sys.argv) > 5 else "VRLA"

        result = size_ups(load_kw, runtime_minutes, redundancy, voltage, battery_type)
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
