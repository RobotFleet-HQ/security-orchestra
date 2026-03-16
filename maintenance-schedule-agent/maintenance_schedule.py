"""
Preventive Maintenance Schedule Generator
Usage: maintenance_schedule.py <generator_count> <ups_count> <cooling_units> <tier>

tier: 1-4
"""

import sys
import json
import math


TIER_MODIFIER = {1: 0.8, 2: 1.0, 3: 1.2, 4: 1.5}

# Annual PM hours per unit
GEN_PM_HRS = 52 * 1 + 12 * 2 + 4 * 8 + 2 * 16 + 1 * 40   # 180 hrs
UPS_PM_HRS = 12 * 1 + 4 * 4 + 1 * 16                        # 44 hrs
COOL_PM_HRS = 52 * 0.5 + 12 * 2 + 4 * 8 + 1 * 24           # 106 hrs

# Annual parts budget per unit
GEN_PARTS = 2000
UPS_PARTS = 500
COOL_PARTS = 800

FTE_HOURS_PER_YEAR = 52 * 40  # 2080 hrs


def main() -> None:
    if len(sys.argv) != 5:
        print(json.dumps({"error": "Usage: maintenance_schedule.py <generator_count> <ups_count> <cooling_units> <tier>"}), file=sys.stderr)
        sys.exit(1)

    try:
        generator_count = int(sys.argv[1])
        ups_count = int(sys.argv[2])
        cooling_units = int(sys.argv[3])
        tier = int(sys.argv[4])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if generator_count < 1 or generator_count > 100:
        print(json.dumps({"error": "generator_count must be 1-100"}), file=sys.stderr)
        sys.exit(1)
    if ups_count < 1 or ups_count > 200:
        print(json.dumps({"error": "ups_count must be 1-200"}), file=sys.stderr)
        sys.exit(1)
    if cooling_units < 1 or cooling_units > 500:
        print(json.dumps({"error": "cooling_units must be 1-500"}), file=sys.stderr)
        sys.exit(1)
    if tier < 1 or tier > 4:
        print(json.dumps({"error": "tier must be 1-4"}), file=sys.stderr)
        sys.exit(1)

    modifier = TIER_MODIFIER[tier]

    gen_hrs = round(generator_count * GEN_PM_HRS * modifier, 0)
    ups_hrs = round(ups_count * UPS_PM_HRS * modifier, 0)
    cool_hrs = round(cooling_units * COOL_PM_HRS * modifier, 0)
    total_hrs = gen_hrs + ups_hrs + cool_hrs

    # FTE calculation
    fte_required = math.ceil(total_hrs / FTE_HOURS_PER_YEAR) + 1  # +1 supervisor

    # Parts budget
    parts_budget = (generator_count * GEN_PARTS + ups_count * UPS_PARTS + cooling_units * COOL_PARTS)

    schedule_summary = {
        "generators": {
            "weekly": "Visual inspection, fluid level checks, battery voltage",
            "monthly": "Run test under load (30 min), fuel consumption check",
            "quarterly": "Oil/filter change, cooling system flush, governor test",
            "semi_annual": "Full load bank test, fuel polishing",
            "annual": "Comprehensive overhaul, injector test, vibration analysis",
        },
        "ups": {
            "monthly": "Battery voltage/impedance check, alarm test",
            "quarterly": "Load transfer test, cooling inspection, filter cleaning",
            "annual": "Full discharge test, capacitor inspection, firmware update",
        },
        "cooling": {
            "weekly": "Visual inspection, temperature trending",
            "monthly": "Filter replacement, coil cleaning inspection",
            "quarterly": "Refrigerant charge check, belt/bearing inspection, water treatment",
            "annual": "Coil cleaning, compressor oil analysis, control calibration",
        },
    }

    output = {
        "input": {
            "generator_count": generator_count,
            "ups_count": ups_count,
            "cooling_units": cooling_units,
            "tier": tier,
        },
        "tier_modifier": modifier,
        "annual_pm_hours_generators": gen_hrs,
        "annual_pm_hours_ups": ups_hrs,
        "annual_pm_hours_cooling": cool_hrs,
        "total_annual_pm_hours": total_hrs,
        "technician_fte_required": fte_required,
        "annual_parts_budget": parts_budget,
        "maintenance_schedule_summary": schedule_summary,
        "notes": [
            f"Tier {tier} modifier {modifier}x applied to all PM intervals.",
            f"Total {total_hrs:.0f} PM hours/year requires {fte_required} FTE technician(s).",
            f"Annual parts budget: ${parts_budget:,} ({generator_count} generators + {ups_count} UPS + {cooling_units} cooling units).",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
