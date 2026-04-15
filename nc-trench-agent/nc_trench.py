#!/usr/bin/env python3
"""
NC Trench Agent
===============
Models underground conduit and trench routing requirements for data center
power and telecom infrastructure in North Carolina.

Calculates trench dimensions, conduit fill, soil classification costs,
NCDOT encroachment permit timelines, and OSHA trench safety requirements
based on NC-specific soil conditions and utility right-of-way rules.

Based on:
  - NCDOT Utility Accommodation Policy (2024)
  - NC Building Code (2024 edition, based on ICC)
  - OSHA 29 CFR 1926 Subpart P (Excavation)
  - NEC Article 300 (Wiring Methods) / Article 310 (Conductors)
  - IEEE C2-2023 (National Electrical Safety Code)

Usage:
    python nc_trench.py <route_length_ft> <conduit_count> <conduit_size_in>
                        <soil_type> <voltage_class> <county> <crossing_type>

Output: JSON to stdout, errors to stderr, exit 0 on success.
"""

import sys
import json
import math

# ─── NC Soil classifications & cost multipliers ─────────────────────────────
# Based on NC Geological Survey soil reports and NCDOT excavation bid data.

SOIL_TYPES = {
    "clay": {
        "description": "Piedmont red clay — common in Mecklenburg, Wake, Durham counties",
        "osha_class": "Type B",
        "excavation_difficulty": "moderate",
        "cost_per_linear_ft_base": 28.0,
        "compaction_factor": 1.15,
        "dewatering_risk": "low",
        "slope_ratio": "1:1",
        "shoring_required_above_ft": 5,
    },
    "sandy_loam": {
        "description": "Coastal Plain sandy loam — common in Pitt, Craven, Onslow counties",
        "osha_class": "Type C",
        "excavation_difficulty": "easy",
        "cost_per_linear_ft_base": 22.0,
        "compaction_factor": 1.25,
        "dewatering_risk": "high",
        "slope_ratio": "1.5:1",
        "shoring_required_above_ft": 4,
    },
    "rock": {
        "description": "Blue Ridge / foothills rock — common in Buncombe, Henderson, Burke counties",
        "osha_class": "Type A (Stable Rock)",
        "excavation_difficulty": "hard",
        "cost_per_linear_ft_base": 55.0,
        "compaction_factor": 1.0,
        "dewatering_risk": "low",
        "slope_ratio": "vertical (stable rock)",
        "shoring_required_above_ft": 20,
    },
    "fill": {
        "description": "Previously disturbed / fill material — common on brownfield sites",
        "osha_class": "Type C",
        "excavation_difficulty": "variable",
        "cost_per_linear_ft_base": 35.0,
        "compaction_factor": 1.30,
        "dewatering_risk": "medium",
        "slope_ratio": "1.5:1",
        "shoring_required_above_ft": 4,
    },
}

# ─── Voltage class determines burial depth & separation ─────────────────────
# Per NEC Article 300.5 and NC amendments.

VOLTAGE_CLASSES = {
    "low_voltage": {
        "label": "Low Voltage (≤ 600V)",
        "min_burial_depth_in": 24,
        "separation_from_telecom_in": 12,
        "conduit_type": "Schedule 40 PVC or HDPE",
        "inspection_required": True,
        "nc_electrical_permit": True,
    },
    "medium_voltage": {
        "label": "Medium Voltage (601V – 35kV)",
        "min_burial_depth_in": 36,
        "separation_from_telecom_in": 24,
        "conduit_type": "Schedule 80 PVC or concrete-encased duct bank",
        "inspection_required": True,
        "nc_electrical_permit": True,
    },
    "high_voltage": {
        "label": "High Voltage (> 35kV)",
        "min_burial_depth_in": 48,
        "separation_from_telecom_in": 36,
        "conduit_type": "Concrete-encased duct bank with thermal backfill",
        "inspection_required": True,
        "nc_electrical_permit": True,
    },
    "telecom": {
        "label": "Telecom / Fiber Only",
        "min_burial_depth_in": 18,
        "separation_from_telecom_in": 0,
        "conduit_type": "Schedule 40 PVC or microduct",
        "inspection_required": False,
        "nc_electrical_permit": False,
    },
}

# ─── Crossing types & NCDOT permit requirements ─────────────────────────────

CROSSING_TYPES = {
    "private_land": {
        "description": "Entirely on private property — no NCDOT involvement",
        "ncdot_permit_required": False,
        "permit_timeline_weeks": (0, 0),
        "boring_required": False,
        "additional_cost_per_crossing": 0,
    },
    "state_road": {
        "description": "Crosses NC state-maintained road — NCDOT encroachment agreement required",
        "ncdot_permit_required": True,
        "permit_timeline_weeks": (6, 12),
        "boring_required": True,
        "additional_cost_per_crossing": 8500,
    },
    "us_highway": {
        "description": "Crosses US highway in NC — NCDOT + FHWA coordination",
        "ncdot_permit_required": True,
        "permit_timeline_weeks": (8, 16),
        "boring_required": True,
        "additional_cost_per_crossing": 15000,
    },
    "railroad": {
        "description": "Crosses railroad ROW — Norfolk Southern or CSX agreement required",
        "ncdot_permit_required": False,
        "permit_timeline_weeks": (12, 24),
        "boring_required": True,
        "additional_cost_per_crossing": 25000,
    },
    "municipal_road": {
        "description": "Crosses city/county-maintained road — local encroachment permit",
        "ncdot_permit_required": False,
        "permit_timeline_weeks": (4, 8),
        "boring_required": True,
        "additional_cost_per_crossing": 5000,
    },
}

# ─── NC county → region mapping (for soil default) ──────────────────────────

PIEDMONT_COUNTIES = [
    "Mecklenburg", "Wake", "Durham", "Guilford", "Forsyth", "Cabarrus",
    "Union", "Iredell", "Rowan", "Davidson", "Alamance", "Orange",
    "Chatham", "Randolph", "Davie", "Lincoln", "Gaston", "Catawba",
]

COASTAL_COUNTIES = [
    "New Hanover", "Brunswick", "Pender", "Onslow", "Carteret", "Craven",
    "Pitt", "Beaufort", "Dare", "Currituck", "Pasquotank", "Pamlico",
]

MOUNTAIN_COUNTIES = [
    "Buncombe", "Henderson", "Transylvania", "Madison", "Yancey",
    "Mitchell", "Avery", "Watauga", "Burke", "McDowell",
]


def suggest_soil_type(county):
    """Suggest likely soil type based on NC county region."""
    c = county.title()
    if c in MOUNTAIN_COUNTIES:
        return "rock"
    if c in COASTAL_COUNTIES:
        return "sandy_loam"
    if c in PIEDMONT_COUNTIES:
        return "clay"
    return "clay"  # default for unrecognized


def calculate_conduit_fill(conduit_count, conduit_size_in):
    """Calculate conduit fill ratio and trench width per NEC Chapter 9."""
    conduit_od = {
        1.0: 1.315, 1.5: 1.900, 2.0: 2.375, 3.0: 3.500,
        4.0: 4.500, 5.0: 5.563, 6.0: 6.625,
    }
    od = conduit_od.get(conduit_size_in, conduit_size_in * 1.15)

    # Duct bank layout: rows of 3 conduits max, stacked
    cols = min(conduit_count, 3)
    rows = math.ceil(conduit_count / 3)

    spacing_in = 3.0  # 3-inch minimum conduit-to-conduit spacing (NEC)
    edge_clearance_in = 3.0  # 3-inch edge clearance in duct bank

    bank_width_in = (cols * od) + ((cols - 1) * spacing_in) + (2 * edge_clearance_in)
    bank_height_in = (rows * od) + ((rows - 1) * spacing_in) + (2 * edge_clearance_in)

    # Trench width = duct bank width + 6 inches each side for working room
    trench_width_in = bank_width_in + 12

    return {
        "conduit_od_in": round(od, 3),
        "duct_bank_layout": f"{cols} wide × {rows} high",
        "duct_bank_width_in": round(bank_width_in, 1),
        "duct_bank_height_in": round(bank_height_in, 1),
        "trench_width_in": round(trench_width_in, 1),
        "trench_width_ft": round(trench_width_in / 12, 2),
        "conduit_rows": rows,
        "conduit_cols": cols,
    }


def calculate_costs(route_length_ft, conduit_count, conduit_size_in,
                    soil, voltage, crossing, trench_depth_in, trench_width_ft):
    """Calculate total project costs."""
    soil_data = SOIL_TYPES[soil]
    crossing_data = CROSSING_TYPES[crossing]

    # Base excavation cost
    base_cost = soil_data["cost_per_linear_ft_base"] * route_length_ft

    # Depth multiplier (deeper = more expensive)
    depth_mult = 1.0 + max(0, (trench_depth_in - 24) / 24) * 0.3
    excavation_cost = base_cost * depth_mult

    # Conduit material cost
    conduit_cost_per_ft = {
        1.0: 1.50, 1.5: 2.00, 2.0: 2.80, 3.0: 4.50,
        4.0: 6.00, 5.0: 8.50, 6.0: 11.00,
    }
    mat_cost_per_ft = conduit_cost_per_ft.get(conduit_size_in, conduit_size_in * 2.5)
    conduit_material_cost = mat_cost_per_ft * route_length_ft * conduit_count

    # Backfill & compaction
    cu_yd_per_ft = (trench_width_ft * (trench_depth_in / 12)) / 27
    backfill_cost = cu_yd_per_ft * route_length_ft * 18.0 * soil_data["compaction_factor"]

    # Concrete encasement for medium/high voltage
    concrete_cost = 0
    if voltage in ("medium_voltage", "high_voltage"):
        concrete_cost = route_length_ft * 22.0  # per LF for duct bank encasement

    # Crossing costs
    crossing_cost = crossing_data["additional_cost_per_crossing"]

    # Warning tape & tracer wire
    warning_tape_cost = route_length_ft * 0.50

    # Inspection & testing
    inspection_cost = max(500, route_length_ft * 1.50)

    # Mobilization / demobilization (flat)
    mobilization = 3500

    subtotal = (excavation_cost + conduit_material_cost + backfill_cost +
                concrete_cost + crossing_cost + warning_tape_cost +
                inspection_cost + mobilization)

    # 15% contingency
    contingency = subtotal * 0.15

    return {
        "excavation_cost_usd": round(excavation_cost),
        "conduit_material_cost_usd": round(conduit_material_cost),
        "backfill_compaction_cost_usd": round(backfill_cost),
        "concrete_encasement_cost_usd": round(concrete_cost),
        "crossing_cost_usd": round(crossing_cost),
        "warning_tape_tracer_wire_usd": round(warning_tape_cost),
        "inspection_testing_usd": round(inspection_cost),
        "mobilization_usd": mobilization,
        "subtotal_usd": round(subtotal),
        "contingency_15pct_usd": round(contingency),
        "total_estimated_cost_usd": round(subtotal + contingency),
        "cost_per_linear_ft_usd": round((subtotal + contingency) / route_length_ft, 2),
    }


def osha_requirements(soil, trench_depth_in):
    """OSHA 29 CFR 1926 Subpart P requirements."""
    soil_data = SOIL_TYPES[soil]
    depth_ft = trench_depth_in / 12

    reqs = {
        "osha_soil_class": soil_data["osha_class"],
        "trench_depth_ft": round(depth_ft, 1),
        "protective_system_required": depth_ft >= 5,
        "slope_ratio": soil_data["slope_ratio"],
        "competent_person_required": True,
        "daily_inspection_required": True,
        "egress_every_25ft": depth_ft >= 4,
        "spoil_pile_setback_ft": max(2, depth_ft),
    }

    if depth_ft >= 5 and depth_ft < soil_data["shoring_required_above_ft"]:
        reqs["protective_method"] = "Sloping or benching per soil classification"
    elif depth_ft >= soil_data["shoring_required_above_ft"]:
        reqs["protective_method"] = "Shoring, shielding (trench box), or engineered slope required"
    else:
        reqs["protective_method"] = "No protective system required (depth < 5 ft)"

    if depth_ft >= 20:
        reqs["engineered_design_required"] = True
        reqs["pe_stamp_required"] = True
        reqs["note"] = "Excavations ≥ 20 ft require design by a registered Professional Engineer per OSHA 1926.652(b)"

    return reqs


def nc_permit_requirements(voltage, crossing, county):
    """NC-specific permit and inspection requirements."""
    voltage_data = VOLTAGE_CLASSES[voltage]
    crossing_data = CROSSING_TYPES[crossing]

    permits = []

    if voltage_data["nc_electrical_permit"]:
        permits.append({
            "permit": "NC Electrical Permit",
            "issuing_authority": f"{county} County Inspections Department",
            "typical_timeline_weeks": (1, 3),
            "note": "Required for all power conduit installations per NC Building Code",
        })

    if crossing_data["ncdot_permit_required"]:
        permits.append({
            "permit": "NCDOT Encroachment Agreement",
            "issuing_authority": "NC Department of Transportation",
            "typical_timeline_weeks": crossing_data["permit_timeline_weeks"],
            "application_url": "https://connect.ncdot.gov/municipalities/Utilities/Pages/default.aspx",
            "note": "Required for any utility crossing of NCDOT-maintained right-of-way",
        })

    if crossing == "railroad":
        permits.append({
            "permit": "Railroad Crossing License",
            "issuing_authority": "Norfolk Southern or CSX (depending on corridor)",
            "typical_timeline_weeks": crossing_data["permit_timeline_weeks"],
            "note": "Directional bore required — open cut not permitted on active rail corridors",
        })

    if crossing in ("municipal_road",):
        permits.append({
            "permit": "Municipal Encroachment Permit",
            "issuing_authority": f"{county} County or municipality",
            "typical_timeline_weeks": crossing_data["permit_timeline_weeks"],
            "note": "Contact local planning/public works department",
        })

    if voltage_data["inspection_required"]:
        permits.append({
            "permit": "Electrical Inspection (final)",
            "issuing_authority": f"{county} County Inspections",
            "typical_timeline_weeks": (1, 2),
            "note": "Schedule with 48-hour advance notice. Conduit must be visible before backfill.",
        })

    return permits


def data_center_considerations(route_length_ft, conduit_count, voltage, crossing):
    """Data center-specific notes."""
    notes = [
        "For redundant power feeds, route A-side and B-side conduit banks in separate trenches with minimum 20 ft lateral separation.",
        "Install spare conduit (minimum 2 spare per bank) for future capacity — re-trenching is 3–5× more expensive than initial installation.",
        "Mark all conduit routes with permanent above-grade markers at 200 ft intervals and at every direction change.",
        "NC 811 (Call Before You Dig) notification required 3 full working days before excavation — call 811 or submit online at nc811.org.",
    ]
    if route_length_ft > 1000:
        notes.append("Routes > 1,000 ft should include pull boxes / manholes every 500–600 ft to facilitate cable pulling and future maintenance.")
    if conduit_count > 6:
        notes.append("Large conduit banks (> 6 conduits) may require thermal analysis to prevent cable derating due to mutual heating.")
    if voltage in ("medium_voltage", "high_voltage"):
        notes.append("Medium/high voltage duct banks require thermal backfill (Fluidized Thermal Backfill or controlled low-strength material) per IEEE 835.")
    if crossing == "railroad":
        notes.append("Railroad crossings typically require steel casing pipe around conduit bundle — confirm gauge with railroad engineering.")
    return notes


def main():
    if len(sys.argv) < 8:
        err = {
            "error": (
                "Usage: nc_trench.py <route_length_ft> <conduit_count> <conduit_size_in> "
                "<soil_type> <voltage_class> <county> <crossing_type>"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    route_length_ft = float(sys.argv[1])
    conduit_count   = int(sys.argv[2])
    conduit_size_in = float(sys.argv[3])
    soil_type       = sys.argv[4].strip().lower()
    voltage_class   = sys.argv[5].strip().lower()
    county          = sys.argv[6].strip()
    crossing_type   = sys.argv[7].strip().lower()

    # Validate soil type
    if soil_type not in SOIL_TYPES:
        err = {"error": f"Unknown soil_type '{soil_type}'. Must be: {', '.join(SOIL_TYPES.keys())}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    # Validate voltage class
    if voltage_class not in VOLTAGE_CLASSES:
        err = {"error": f"Unknown voltage_class '{voltage_class}'. Must be: {', '.join(VOLTAGE_CLASSES.keys())}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    # Validate crossing type
    if crossing_type not in CROSSING_TYPES:
        err = {"error": f"Unknown crossing_type '{crossing_type}'. Must be: {', '.join(CROSSING_TYPES.keys())}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    soil_data    = SOIL_TYPES[soil_type]
    voltage_data = VOLTAGE_CLASSES[voltage_class]
    crossing_data = CROSSING_TYPES[crossing_type]

    # Conduit fill & duct bank layout
    conduit_fill = calculate_conduit_fill(conduit_count, conduit_size_in)

    # Trench dimensions
    trench_depth_in = voltage_data["min_burial_depth_in"] + conduit_fill["duct_bank_height_in"] + 6  # 6-in bedding
    trench_width_ft = conduit_fill["trench_width_ft"]

    # Costs
    costs = calculate_costs(
        route_length_ft, conduit_count, conduit_size_in,
        soil_type, voltage_class, crossing_type,
        trench_depth_in, trench_width_ft,
    )

    # OSHA
    osha = osha_requirements(soil_type, trench_depth_in)

    # NC permits
    permits = nc_permit_requirements(voltage_class, crossing_type, county)

    # Data center notes
    dc_notes = data_center_considerations(route_length_ft, conduit_count, voltage_class, crossing_type)

    # Suggested soil if county known
    suggested_soil = suggest_soil_type(county)

    # Total permit timeline
    permit_weeks_low  = sum(p["typical_timeline_weeks"][0] for p in permits if "typical_timeline_weeks" in p)
    permit_weeks_high = sum(p["typical_timeline_weeks"][1] for p in permits if "typical_timeline_weeks" in p)

    # Construction timeline estimate
    construction_days = max(5, math.ceil(route_length_ft / 150))  # ~150 ft/day typical
    if soil_type == "rock":
        construction_days = math.ceil(construction_days * 1.8)
    if crossing_data["boring_required"]:
        construction_days += 3  # add bore setup/execution time

    result = {
        "route_length_ft": route_length_ft,
        "county": county,
        "suggested_soil_type": suggested_soil,
        "soil_match_note": (
            f"You specified '{soil_type}' — matches expected soil for {county} County."
            if soil_type == suggested_soil
            else f"You specified '{soil_type}' — typical soil for {county} County is '{suggested_soil}'. Verify with site-specific geotechnical report."
        ),
        "input": {
            "route_length_ft": route_length_ft,
            "conduit_count": conduit_count,
            "conduit_size_in": conduit_size_in,
            "soil_type": soil_type,
            "voltage_class": voltage_class,
            "county": county,
            "crossing_type": crossing_type,
        },
        "voltage_requirements": {
            "class": voltage_class,
            "label": voltage_data["label"],
            "min_burial_depth_in": voltage_data["min_burial_depth_in"],
            "separation_from_telecom_in": voltage_data["separation_from_telecom_in"],
            "conduit_type": voltage_data["conduit_type"],
        },
        "soil_classification": {
            "type": soil_type,
            "description": soil_data["description"],
            "osha_class": soil_data["osha_class"],
            "excavation_difficulty": soil_data["excavation_difficulty"],
            "dewatering_risk": soil_data["dewatering_risk"],
        },
        "trench_dimensions": {
            "trench_depth_in": round(trench_depth_in, 1),
            "trench_depth_ft": round(trench_depth_in / 12, 2),
            "trench_width_in": conduit_fill["trench_width_in"],
            "trench_width_ft": trench_width_ft,
            "duct_bank_layout": conduit_fill["duct_bank_layout"],
            "duct_bank_width_in": conduit_fill["duct_bank_width_in"],
            "duct_bank_height_in": conduit_fill["duct_bank_height_in"],
            "conduit_od_in": conduit_fill["conduit_od_in"],
        },
        "crossing_details": {
            "type": crossing_type,
            "description": crossing_data["description"],
            "boring_required": crossing_data["boring_required"],
            "ncdot_permit_required": crossing_data["ncdot_permit_required"],
        },
        "cost_estimate": costs,
        "osha_requirements": osha,
        "nc_permits": permits,
        "timeline_estimate": {
            "permit_weeks_low": permit_weeks_low,
            "permit_weeks_high": permit_weeks_high,
            "construction_days": construction_days,
            "total_weeks_low": permit_weeks_low + math.ceil(construction_days / 5),
            "total_weeks_high": permit_weeks_high + math.ceil(construction_days / 5),
            "note": "Permit timelines run concurrently where possible. Construction estimate assumes single crew, 150 ft/day in normal soil.",
        },
        "data_center_considerations": dc_notes,
        "disclaimer": (
            "Cost and timeline estimates are based on NC-specific soil data, NCDOT permit "
            "experience, and industry benchmarks. Actual costs depend on site-specific "
            "geotechnical conditions, contractor availability, and permit processing times. "
            "Always obtain a site-specific geotechnical report before final design."
        ),
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
