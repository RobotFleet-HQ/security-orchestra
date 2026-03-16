"""
Permitting Timeline Agent for Data Center Projects
CLI: python permit_timeline.py <jurisdiction> <project_sqft> <generator_count> [project_type=new]

project_type: "new" or "renovation"
"""

import sys
import json
import math


MAJOR_CITIES = {"nyc", "new york", "new york city", "la", "los angeles", "sf", "san francisco",
                "chicago", "boston"}
MID_CITIES = {"charlotte", "nashville", "raleigh", "phoenix", "denver"}


def classify_jurisdiction(jurisdiction: str) -> str:
    j = jurisdiction.lower().strip()
    for city in MAJOR_CITIES:
        if city in j:
            return "major"
    for city in MID_CITIES:
        if city in j:
            return "mid"
    return "small"


def building_permit_duration(jurisdiction: str, project_type: str):
    tier = classify_jurisdiction(jurisdiction)
    if project_type == "renovation":
        durations = {
            "major": (12, 16, 14),
            "mid":   (6,  10, 8),
            "small": (4,  6,  5),
        }
    else:
        durations = {
            "major": (20, 28, 24),
            "mid":   (10, 16, 13),
            "small": (6,  10, 8),
        }
    return durations[tier]


def electrical_permit_duration(project_sqft: int):
    # Proportional to project size: small <50k: 4-6, mid 50-200k: 6-10, large >200k: 8-12
    if project_sqft < 50_000:
        return (4, 6, 5)
    elif project_sqft < 200_000:
        return (6, 10, 8)
    else:
        return (8, 12, 10)


def mechanical_permit_duration(project_sqft: int):
    if project_sqft < 50_000:
        return (4, 6, 5)
    elif project_sqft < 200_000:
        return (5, 8, 6)
    else:
        return (6, 10, 8)


def environmental_review_duration(project_sqft: int, generator_count: int):
    if project_sqft > 100_000 or generator_count > 5:
        return (16, 52, 30), "NEPA Review (EA/EIS)"
    else:
        return (4, 8, 6), "Categorical Exclusion"


def utility_interconnect_duration(project_sqft: int, generator_count: int):
    # Larger projects need more coordination
    if project_sqft > 200_000 or generator_count > 10:
        return (16, 24, 20)
    elif project_sqft > 50_000 or generator_count > 4:
        return (12, 18, 15)
    else:
        return (8, 14, 11)


def zoning_permit_duration(project_sqft: int, project_type: str):
    # Special use permit often needed for large new data centers
    if project_sqft > 100_000 or project_type == "new":
        return (8, 20, 14), True
    else:
        return (8, 20, 14), False


def main():
    if len(sys.argv) < 4:
        err = {"error": "Usage: permit_timeline.py <jurisdiction> <project_sqft> <generator_count> [project_type=new]"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    jurisdiction = sys.argv[1]
    try:
        project_sqft = int(sys.argv[2])
        generator_count = int(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid numeric argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    project_type = sys.argv[4] if len(sys.argv) > 4 else "new"
    if project_type not in ("new", "renovation"):
        print(json.dumps({"error": "project_type must be 'new' or 'renovation'"}), file=sys.stderr)
        sys.exit(1)

    # --- Building Permit ---
    bp_min, bp_max, bp_typ = building_permit_duration(jurisdiction, project_type)
    tier = classify_jurisdiction(jurisdiction)
    agency_map = {"major": "City Department of Buildings", "mid": "City Building & Safety", "small": "County Building Department"}
    building_permit = {
        "permit_name": "Building Permit",
        "duration_weeks_min": bp_min,
        "duration_weeks_max": bp_max,
        "duration_weeks_typical": bp_typ,
        "sequential_dependency": None,
        "agency": agency_map[tier],
        "notes": f"Classified as {tier}-city jurisdiction. {project_type.capitalize()} construction.",
    }

    # --- Electrical Permit ---
    ep_min, ep_max, ep_typ = electrical_permit_duration(project_sqft)
    electrical_permit = {
        "permit_name": "Electrical Permit",
        "duration_weeks_min": ep_min,
        "duration_weeks_max": ep_max,
        "duration_weeks_typical": ep_typ,
        "sequential_dependency": "Building Permit",
        "agency": "State Electrical Division / AHJ",
        "notes": f"Duration proportional to project size ({project_sqft:,} sqft). Includes generator electrical systems.",
    }

    # --- Mechanical Permit ---
    mp_min, mp_max, mp_typ = mechanical_permit_duration(project_sqft)
    mechanical_permit = {
        "permit_name": "Mechanical Permit",
        "duration_weeks_min": mp_min,
        "duration_weeks_max": mp_max,
        "duration_weeks_typical": mp_typ,
        "sequential_dependency": "Building Permit",
        "agency": "State Mechanical Division / AHJ",
        "notes": "Covers HVAC, cooling systems, and generator exhaust routing.",
    }

    # --- Environmental Review ---
    (er_min, er_max, er_typ), er_type = environmental_review_duration(project_sqft, generator_count)
    env_review = {
        "permit_name": "Environmental Review",
        "duration_weeks_min": er_min,
        "duration_weeks_max": er_max,
        "duration_weeks_typical": er_typ,
        "sequential_dependency": None,
        "agency": "EPA / State Environmental Agency",
        "notes": f"{er_type} required. {'NEPA review triggered by project size or generator count.' if project_sqft > 100_000 or generator_count > 5 else 'Categorical exclusion applies for smaller projects.'}",
    }

    # --- Fire Marshal Approval ---
    fire_marshal = {
        "permit_name": "Fire Marshal Approval",
        "duration_weeks_min": 4,
        "duration_weeks_max": 8,
        "duration_weeks_typical": 6,
        "sequential_dependency": "Building Permit",
        "agency": "State / Local Fire Marshal",
        "notes": "Covers fire suppression systems, egress, generator fuel storage, and life safety systems.",
    }

    # --- Stormwater / Grading ---
    stormwater = {
        "permit_name": "Stormwater / Grading Permit",
        "duration_weeks_min": 6,
        "duration_weeks_max": 12,
        "duration_weeks_typical": 9,
        "sequential_dependency": None,
        "agency": "State Environmental / County Engineering",
        "notes": "NPDES Construction General Permit and local grading plan approval. Typically processed in parallel.",
    }

    # --- Utility Interconnect ---
    ui_min, ui_max, ui_typ = utility_interconnect_duration(project_sqft, generator_count)
    utility_interconnect = {
        "permit_name": "Utility Interconnect Coordination",
        "duration_weeks_min": ui_min,
        "duration_weeks_max": ui_max,
        "duration_weeks_typical": ui_typ,
        "sequential_dependency": None,
        "agency": "Local Utility / ISO/RTO",
        "notes": "Includes interconnection study, metering installation, and service agreement. Can run parallel to permitting but often gating for occupancy.",
    }

    # --- Zoning / Special Use ---
    (zu_min, zu_max, zu_typ), zoning_needed = zoning_permit_duration(project_sqft, project_type)
    zoning_permit = {
        "permit_name": "Zoning / Special Use Permit",
        "duration_weeks_min": zu_min,
        "duration_weeks_max": zu_max,
        "duration_weeks_typical": zu_typ,
        "sequential_dependency": None,
        "agency": "Local Planning / Zoning Board",
        "notes": f"{'Required for new data center development or large projects. Public hearing typically required.' if zoning_needed else 'May not be required for renovation within existing permitted use.'}",
    }

    permit_list = [
        building_permit,
        electrical_permit,
        mechanical_permit,
        env_review,
        fire_marshal,
        stormwater,
        utility_interconnect,
        zoning_permit,
    ]

    # --- Critical Path ---
    # Critical path: Zoning → Environmental Review (parallel, take longer) → Building Permit → Electrical + Fire Marshal
    # Longest sequential chain:
    # Track A: Zoning/SUP (zu_typ) → Building Permit (bp_typ) → Electrical (ep_typ)
    # Track B: Environmental Review (er_typ) [can run parallel to zoning but often sequential in practice]
    # Track C: Utility Interconnect (ui_typ) [parallel but often longest overall]

    # Build sequential critical path
    # Most common CP for data center: Env Review → Building Permit → Electrical → Fire Marshal
    env_to_bp = er_typ + bp_typ
    bp_chain = bp_typ + ep_typ  # electrical depends on building permit

    # Compare zoning start vs env review start (both start at t=0)
    # After zoning, building permit starts
    zoning_then_bp = zu_typ + bp_typ + ep_typ

    # Environmental review can block building permit if it takes longer than zoning
    env_blocks_bp = max(er_typ, zu_typ) + bp_typ + ep_typ

    # Utility interconnect is independent but often longest
    critical_path_typ = max(env_blocks_bp, ui_typ, zu_typ + bp_typ + ep_typ)

    # Min/max estimates
    env_blocks_bp_min = max(er_min, zu_min) + bp_min + ep_min
    env_blocks_bp_max = max(er_max, zu_max) + bp_max + ep_max
    critical_path_min = max(env_blocks_bp_min, ui_min, zu_min + bp_min + ep_min)
    critical_path_max = max(env_blocks_bp_max, ui_max, zu_max + bp_max + ep_max)

    # Determine which path is critical
    if ui_typ >= env_blocks_bp and ui_typ >= zoning_then_bp:
        critical_sequence = ["Utility Interconnect Coordination"]
    else:
        critical_sequence = ["Environmental Review", "Building Permit", "Electrical Permit"]
        if zu_typ > er_typ:
            critical_sequence = ["Zoning / Special Use Permit", "Building Permit", "Electrical Permit"]

    critical_path = {
        "sequence": critical_sequence,
        "total_weeks_min": critical_path_min,
        "total_weeks_max": critical_path_max,
        "total_months_typical": round(critical_path_typ / 4.33, 1),
    }

    # --- Parallel Tracks ---
    parallel_tracks = [
        ["Environmental Review", "Stormwater / Grading Permit", "Utility Interconnect Coordination"],
        ["Electrical Permit", "Mechanical Permit", "Fire Marshal Approval"],
    ]

    # --- Expedite Options ---
    expedite_options = [
        {
            "option": "Pre-application meeting with Building Department",
            "weeks_saved": 4,
            "cost_premium": 0.0,
        },
        {
            "option": "Fast-track / concurrent review program",
            "weeks_saved": 8,
            "cost_premium": 15000.0,
        },
        {
            "option": "Third-party plan review (where permitted by AHJ)",
            "weeks_saved": 6,
            "cost_premium": 8000.0,
        },
        {
            "option": "Expedited environmental consultant for NEPA coordination",
            "weeks_saved": 12,
            "cost_premium": 50000.0,
        },
        {
            "option": "Utility interconnect pre-application coordination",
            "weeks_saved": 4,
            "cost_premium": 5000.0,
        },
    ]

    # --- Risk Factors ---
    risk_factors = []
    if tier == "major":
        risk_factors.append("Major city jurisdictions have complex review processes and high variability in permit timelines.")
    if project_sqft > 100_000 or generator_count > 5:
        risk_factors.append("NEPA environmental review required — significant schedule risk if EA or EIS required.")
    if generator_count > 10:
        risk_factors.append("Large generator count may trigger Title V air permit, adding 6-18 months.")
    if project_type == "new":
        risk_factors.append("New construction requires full building permit review vs. renovation/alteration.")
    risk_factors.append("Utility interconnect timelines vary significantly by local utility queue congestion.")
    risk_factors.append("Community opposition can extend zoning/special use permit timeline unpredictably.")

    total_months = round(critical_path_typ / 4.33, 1)

    output = {
        "input": {
            "jurisdiction": jurisdiction,
            "project_sqft": project_sqft,
            "generator_count": generator_count,
            "project_type": project_type,
        },
        "permit_list": permit_list,
        "critical_path": critical_path,
        "parallel_tracks": parallel_tracks,
        "expedite_options": expedite_options,
        "total_timeline_months": total_months,
        "risk_factors": risk_factors,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
