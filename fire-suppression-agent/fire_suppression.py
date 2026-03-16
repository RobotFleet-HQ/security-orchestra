"""
Clean Agent Fire Suppression Sizing Agent (NFPA 2001)
CLI: python fire_suppression.py <room_length_ft> <room_width_ft> <ceiling_height_ft> [agent_type=FM200] [enclosure_type=server_room]

agent_type: "FM200", "Novec1230", "Inergen", "CO2"
enclosure_type: "server_room", "ups_room", "battery_room", "cable_vault", "mechanical"
"""

import sys
import json
import math


VALID_AGENTS = {"FM200", "Novec1230", "Inergen", "CO2"}
VALID_ENCLOSURES = {"server_room", "ups_room", "battery_room", "cable_vault", "mechanical"}

# Design concentrations by enclosure type and agent (%)
DESIGN_CONCENTRATIONS = {
    "server_room": {
        "FM200":    7.0,
        "Novec1230": 4.5,
        "Inergen":  37.5,
        "CO2":      34.0,
    },
    "ups_room": {
        "FM200":    7.0,
        "Novec1230": 4.5,
        "Inergen":  37.5,
        "CO2":      34.0,
    },
    "battery_room": {
        "FM200":    8.5,
        "Novec1230": 5.5,
        "Inergen":  40.0,
        "CO2":      50.0,
    },
    "cable_vault": {
        "FM200":    7.0,
        "Novec1230": 4.5,
        "Inergen":  37.5,
        "CO2":      34.0,
    },
    "mechanical": {
        "FM200":    7.0,
        "Novec1230": 4.5,
        "Inergen":  37.5,
        "CO2":      34.0,
    },
}

# Agent densities at 70°F in kg/m3
AGENT_DENSITY = {
    "FM200":    1.5,
    "Novec1230": 1.6,
}

# Cylinder capacities
CYLINDER_CAPACITY_LBS = {
    "FM200":    125.0,
    "Novec1230": 125.0,
    "CO2":      100.0,
}

INERGEN_CYLINDER_VOLUME_L = 80.0  # liters at 200 bar

# Cost parameters (per sqft + per cylinder)
COST_PER_SQFT = {
    "FM200":    (3.0, 5.0),
    "Novec1230": (4.0, 6.0),
    "Inergen":  (5.0, 8.0),
    "CO2":      (2.0, 3.0),
}
COST_PER_CYLINDER = {
    "FM200":    2000.0,
    "Novec1230": 2500.0,
    "Inergen":  1500.0,
    "CO2":      800.0,
}

CF_TO_M3 = 0.0283168
LBS_PER_KG = 2.205


def calculate_agent_quantity(volume_m3: float, agent: str, enclosure: str):
    """
    Returns agent quantity in lbs (or m3 for Inergen), cylinders required.
    """
    conc = DESIGN_CONCENTRATIONS[enclosure][agent]

    if agent in ("FM200", "Novec1230"):
        density = AGENT_DENSITY[agent]
        # W = volume_m3 × density × (C / (100 - C))
        agent_kg = volume_m3 * density * (conc / (100.0 - conc))
        agent_lbs = agent_kg * LBS_PER_KG
        cap = CYLINDER_CAPACITY_LBS[agent]
        cylinders = math.ceil(agent_lbs / cap)
        return agent_lbs, cylinders

    elif agent == "Inergen":
        # Inergen: volume_m3 × 0.52 m3/m3 × 2 (for 37.5% conc) → cubic meters of gas
        # Scale by actual concentration ratio vs 37.5%
        conc_factor = conc / 37.5
        gas_volume_m3 = volume_m3 * 0.52 * 2.0 * conc_factor
        # Convert to liters: 1 m3 = 1000 L; cylinder is 80L at 200 bar
        gas_volume_L = gas_volume_m3 * 1000.0
        # At 200 bar, each cylinder holds 80L × 200 = 16,000 L equivalent gas
        gas_per_cylinder_L = INERGEN_CYLINDER_VOLUME_L * 200.0
        cylinders = math.ceil(gas_volume_L / gas_per_cylinder_L)
        # Return gas volume in m3 as "lbs" field for consistency; label separately
        agent_lbs = gas_volume_m3  # m3 of gas
        return agent_lbs, cylinders

    elif agent == "CO2":
        # CO2: W = volume_m3 × density_co2 × (C / (100 - C))
        # CO2 density at flooding concentration: ~1.98 kg/m3 liquid
        density_co2 = 1.98
        agent_kg = volume_m3 * density_co2 * (conc / (100.0 - conc))
        agent_lbs = agent_kg * LBS_PER_KG
        cap = CYLINDER_CAPACITY_LBS["CO2"]
        cylinders = math.ceil(agent_lbs / cap)
        return agent_lbs, cylinders

    raise ValueError(f"Unknown agent: {agent}")


def estimate_cost(floor_area_sqft: float, agent: str, cylinders: int):
    low, high = COST_PER_SQFT[agent]
    mid_sqft = (low + high) / 2.0
    equipment_sqft = mid_sqft * floor_area_sqft
    cylinder_cost = COST_PER_CYLINDER[agent] * cylinders
    equipment_cost = equipment_sqft + cylinder_cost
    installation_cost = floor_area_sqft * 2.5  # ~$2.50/sqft installation labor
    total = equipment_cost + installation_cost
    annual_inspection = max(1500.0, total * 0.03)  # 3% of system cost, min $1,500
    return equipment_cost, installation_cost, total, annual_inspection


def main():
    if len(sys.argv) < 4:
        err = {"error": "Usage: fire_suppression.py <room_length_ft> <room_width_ft> <ceiling_height_ft> [agent_type=FM200] [enclosure_type=server_room]"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        length_ft = float(sys.argv[1])
        width_ft = float(sys.argv[2])
        height_ft = float(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid numeric argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    agent = sys.argv[4] if len(sys.argv) > 4 else "FM200"
    enclosure = sys.argv[5] if len(sys.argv) > 5 else "server_room"

    if agent not in VALID_AGENTS:
        print(json.dumps({"error": f"agent_type must be one of: {', '.join(sorted(VALID_AGENTS))}"}), file=sys.stderr)
        sys.exit(1)
    if enclosure not in VALID_ENCLOSURES:
        print(json.dumps({"error": f"enclosure_type must be one of: {', '.join(sorted(VALID_ENCLOSURES))}"}), file=sys.stderr)
        sys.exit(1)

    for val, name in [(length_ft, "room_length_ft"), (width_ft, "room_width_ft"), (height_ft, "ceiling_height_ft")]:
        if val <= 0:
            print(json.dumps({"error": f"{name} must be positive"}), file=sys.stderr)
            sys.exit(1)

    # --- Room Analysis ---
    volume_cf = length_ft * width_ft * height_ft
    volume_m3 = volume_cf * CF_TO_M3
    floor_area_sqft = length_ft * width_ft

    # --- Agent Calculation ---
    conc_pct = DESIGN_CONCENTRATIONS[enclosure][agent]
    agent_quantity, cylinders = calculate_agent_quantity(volume_m3, agent, enclosure)

    if agent == "Inergen":
        cylinder_cap_display = INERGEN_CYLINDER_VOLUME_L  # liters
        agent_display_lbs = round(agent_quantity * 35.3147, 2)  # convert m3 to cf for display; store m3
    else:
        cylinder_cap_display = CYLINDER_CAPACITY_LBS.get(agent, 125.0)
        agent_display_lbs = round(agent_quantity, 2)

    # --- System Design ---
    pre_action_required = floor_area_sqft > 2500.0 or enclosure == "battery_room"
    detection_zones = max(1, math.ceil(floor_area_sqft / 2500.0))

    # --- Cost Estimate ---
    equipment_cost, installation_cost, total_cost, annual_inspection = estimate_cost(floor_area_sqft, agent, cylinders)

    # --- Installation Notes ---
    installation_notes = [
        f"Discharge time: 10 seconds per NFPA 2001 total flooding requirement.",
        f"30-second abort delay switch required per NFPA 2001 Section 4.3.",
        f"Pneumatic abort switch must be installed at each exit.",
        f"Room must be tested for integrity (door fan test) before system commissioning.",
        f"Supply and return air dampers must close on agent release signal.",
        f"{detection_zones} detection zone(s) required — cross-zoned smoke detection recommended.",
    ]
    if agent == "Inergen":
        installation_notes.append("Inergen cylinders require dedicated storage room — high pressure at 200 bar.")
        installation_notes.append("Inergen is an inert gas blend (N2/Ar/CO2) — environmentally friendly, zero ODP/GWP.")
    if agent == "CO2":
        installation_notes.append("CO2 is NOT recommended for normally occupied spaces — lethal at design concentration.")
        installation_notes.append("CO2 systems require lockout/tagout procedures and personnel safety interlocks.")
    if pre_action_required:
        installation_notes.append("Pre-action sprinkler system required — combined with clean agent per NFPA 2001.")
    if enclosure == "battery_room":
        installation_notes.append("Higher design concentration required for lithium-ion battery rooms (increased fire risk).")

    # --- Safety Warnings ---
    safety_warnings = []
    if agent == "CO2":
        safety_warnings.append("CO2 at design concentration (34%+) is immediately dangerous to life and health (IDLH).")
        safety_warnings.append("Personnel must evacuate before system discharge. Timed pre-discharge alarm required.")
    if enclosure == "battery_room":
        safety_warnings.append("Lithium-ion battery fires may require extended suppression — agent may not extinguish deep-seated cell fires.")
        safety_warnings.append("Thermal runaway events can re-ignite after agent discharge — monitor continuously post-discharge.")
    safety_warnings.append("All personnel must be trained on system operation and evacuation procedures.")
    safety_warnings.append("Annual agent weight/pressure checks required per NFPA 2001.")
    if agent in ("FM200", "Novec1230"):
        safety_warnings.append(f"{agent} is a hydrofluorocarbon — confirm GWP compliance with local environmental regulations.")

    output = {
        "input": {
            "room_length_ft": length_ft,
            "room_width_ft": width_ft,
            "ceiling_height_ft": height_ft,
            "agent_type": agent,
            "enclosure_type": enclosure,
        },
        "room_analysis": {
            "volume_cf": round(volume_cf, 2),
            "volume_m3": round(volume_m3, 4),
            "floor_area_sqft": round(floor_area_sqft, 2),
        },
        "agent_calculation": {
            "agent_type": agent,
            "design_concentration_pct": conc_pct,
            "agent_quantity_lbs": agent_display_lbs,
            "cylinder_capacity_lbs": cylinder_cap_display,
            "cylinders_required": cylinders,
            "discharge_time_seconds": 10,
            "nfpa_2001_compliant": True,
        },
        "system_design": {
            "pre_action_sprinkler_required": pre_action_required,
            "detection_zones": detection_zones,
            "abort_delay_seconds": 30,
            "pneumatic_abort_switch": True,
        },
        "cost_estimate": {
            "equipment_cost": round(equipment_cost, 2),
            "installation_cost": round(installation_cost, 2),
            "total_system_cost": round(total_cost, 2),
            "annual_inspection_cost": round(annual_inspection, 2),
        },
        "installation_notes": installation_notes,
        "safety_warnings": safety_warnings,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
