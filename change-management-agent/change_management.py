"""
Change Management Process Design Agent
Usage: change_management.py <tier> <change_volume_per_month> <staff_count>

tier: 1-4
"""

import sys
import json
import math


TIER_CONFIG = {
    1: {
        "change_windows": "any_time",
        "change_windows_per_year": 52 * 5,  # any business day
        "cab_frequency": "weekly",
        "approval_levels": 1,
        "rollback_minutes": 240,
        "success_rate_pct": 95.0,
    },
    2: {
        "change_windows": "weekends_only",
        "change_windows_per_year": 52,
        "cab_frequency": "bi-weekly",
        "approval_levels": 2,
        "rollback_minutes": 60,
        "success_rate_pct": 98.0,
    },
    3: {
        "change_windows": "monthly_4hr",
        "change_windows_per_year": 12,
        "cab_frequency": "weekly",
        "approval_levels": 3,
        "rollback_minutes": 30,
        "success_rate_pct": 99.5,
    },
    4: {
        "change_windows": "quarterly_4hr",
        "change_windows_per_year": 4,
        "cab_frequency": "bi-weekly",
        "approval_levels": 4,
        "rollback_minutes": 15,
        "success_rate_pct": 99.9,
    },
}


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: change_management.py <tier> <change_volume_per_month> <staff_count>"}), file=sys.stderr)
        sys.exit(1)

    try:
        tier = int(sys.argv[1])
        change_volume = int(sys.argv[2])
        staff_count = int(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if tier < 1 or tier > 4:
        print(json.dumps({"error": "tier must be 1-4"}), file=sys.stderr)
        sys.exit(1)
    if change_volume < 1 or change_volume > 1000:
        print(json.dumps({"error": "change_volume_per_month must be 1-1000"}), file=sys.stderr)
        sys.exit(1)
    if staff_count < 1 or staff_count > 10000:
        print(json.dumps({"error": "staff_count must be 1-10000"}), file=sys.stderr)
        sys.exit(1)

    config = TIER_CONFIG[tier]

    normal_changes = round(change_volume * 0.70)
    standard_changes = round(change_volume * 0.25)
    emergency_changes = round(change_volume * 0.05)

    # CAB members
    cab_members = min(math.ceil(staff_count / 50) + 3, 12)

    # CMDB size: unique CIs (configuration items)
    cmdb_size = staff_count * 15  # ~15 CIs per staff member

    output = {
        "input": {
            "tier": tier,
            "change_volume_per_month": change_volume,
            "staff_count": staff_count,
        },
        "change_windows": config["change_windows"],
        "change_windows_per_year": config["change_windows_per_year"],
        "cab_frequency": config["cab_frequency"],
        "cab_member_count": cab_members,
        "approval_levels_required": config["approval_levels"],
        "change_breakdown_per_month": {
            "normal_changes": normal_changes,
            "standard_changes": standard_changes,
            "emergency_changes": emergency_changes,
        },
        "rollback_time_requirement_minutes": config["rollback_minutes"],
        "change_success_rate_target_pct": config["success_rate_pct"],
        "recommended_cmdb_size": cmdb_size,
        "notes": [
            f"Tier {tier}: {config['change_windows'].replace('_', ' ')} change windows, {config['cab_frequency']} CAB.",
            f"{emergency_changes} emergency changes/month expected — each requires pre-authorized rollback plan.",
            f"Rollback SLA: {config['rollback_minutes']} minutes for Tier {tier}.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
