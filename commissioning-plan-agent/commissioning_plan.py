"""
Commissioning Plan Generator
Usage: commissioning_plan.py <capacity_mw> <tier> [systems_count=0]

tier: 1-4
systems_count: 0 = auto-calculate
"""

import sys
import json
import math


TIER_BASE_SYSTEMS = {1: 30, 2: 60, 3: 120, 4: 200}

COST_PER_HOUR = 150  # $/hr for commissioning technician


def main() -> None:
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(json.dumps({"error": "Usage: commissioning_plan.py <capacity_mw> <tier> [systems_count=0]"}), file=sys.stderr)
        sys.exit(1)

    try:
        capacity_mw = float(sys.argv[1])
        tier = int(sys.argv[2])
        systems_count_input = int(sys.argv[3]) if len(sys.argv) == 4 else 0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if capacity_mw < 0.1 or capacity_mw > 500:
        print(json.dumps({"error": "capacity_mw must be 0.1-500"}), file=sys.stderr)
        sys.exit(1)
    if tier < 1 or tier > 4:
        print(json.dumps({"error": "tier must be 1-4"}), file=sys.stderr)
        sys.exit(1)
    if systems_count_input < 0 or systems_count_input > 500:
        print(json.dumps({"error": "systems_count must be 0-500"}), file=sys.stderr)
        sys.exit(1)

    # Scale factor by capacity
    if capacity_mw < 1:
        scale = 0.5
    elif capacity_mw <= 10:
        scale = 1.0
    elif capacity_mw <= 100:
        scale = 2.0
    else:
        scale = 3.0

    if systems_count_input > 0:
        systems = systems_count_input
    else:
        systems = round(TIER_BASE_SYSTEMS[tier] * scale)

    # Test hours
    l1_hrs = systems * 0.25   # component
    l2_hrs = systems * 1.0    # functional
    l3_hrs = systems * 4.0    # integrated
    l4_hrs = tier * 8.0 if tier >= 3 else 0  # scenario (Tier3+)
    total_hours = l1_hrs + l2_hrs + l3_hrs + l4_hrs

    # Duration
    tech_per_team = 4
    duration_days_raw = total_hours / 8 / tech_per_team
    duration_days = math.ceil(duration_days_raw * 1.20)  # 20% buffer

    # IST (integrated systems testing) duration
    ist_duration_days = math.ceil(l3_hrs / 8 / tech_per_team * 1.1)

    # Staffing
    technician_count = math.ceil(systems / 15) + 2
    cxa_count = math.ceil(capacity_mw / 5) + 1  # commissioning agents

    # Estimated cost
    estimated_cost = round(total_hours * COST_PER_HOUR * 1.5, 0)  # 1.5x for overhead

    documentation = [
        "Basis of Design (BOD) document",
        "Commissioning Plan and Schedule",
        "Pre-functional inspection checklists (per system)",
        "Functional performance test procedures",
        "Integrated Systems Test (IST) procedures",
        "Issues/deficiencies log",
        "Final commissioning report",
        "O&M manuals and as-built drawings",
        "Training documentation and records",
    ]

    output = {
        "input": {
            "capacity_mw": capacity_mw,
            "tier": tier,
            "systems_count": systems,
        },
        "test_levels": {
            "L1_component_hrs": round(l1_hrs, 1),
            "L2_functional_hrs": round(l2_hrs, 1),
            "L3_integrated_hrs": round(l3_hrs, 1),
            "L4_scenario_hrs": round(l4_hrs, 1),
        },
        "total_test_hours": round(total_hours, 1),
        "commissioning_duration_days": duration_days,
        "integrated_systems_test_duration_days": ist_duration_days,
        "technician_count": technician_count,
        "cxa_count": cxa_count,
        "documentation_items": documentation,
        "estimated_commissioning_cost": estimated_cost,
        "standards": ["ASHRAE Guideline 1.2-2010", "Uptime Institute Tier Standard", "ANSI/BICSI 002"],
        "notes": [
            f"Tier {tier} facility at {capacity_mw} MW: {systems} systems to commission.",
            f"{duration_days} calendar days including 20% buffer; {technician_count} technicians + {cxa_count} CxA(s).",
            f"IST is the critical path at {ist_duration_days} days.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
