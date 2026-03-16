"""
Physical Security Design Agent
Usage: physical_security.py <facility_sqft> <tier> [perimeter_ft=0]

tier: 1-4
"""

import sys
import json
import math


def main() -> None:
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(json.dumps({"error": "Usage: physical_security.py <facility_sqft> <tier> [perimeter_ft=0]"}), file=sys.stderr)
        sys.exit(1)

    try:
        facility_sqft = float(sys.argv[1])
        tier = int(sys.argv[2])
        perimeter_ft = float(sys.argv[3]) if len(sys.argv) == 4 else 0.0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if facility_sqft < 1000 or facility_sqft > 5000000:
        print(json.dumps({"error": "facility_sqft must be 1000-5000000"}), file=sys.stderr)
        sys.exit(1)
    if tier < 1 or tier > 4:
        print(json.dumps({"error": "tier must be 1-4"}), file=sys.stderr)
        sys.exit(1)
    if perimeter_ft < 0 or perimeter_ft > 50000:
        print(json.dumps({"error": "perimeter_ft must be 0-50000"}), file=sys.stderr)
        sys.exit(1)

    # Security zones by tier
    security_zones = tier + 1  # Tier1=2, Tier2=3, Tier3=4, Tier4=5

    # Mantraps
    mantrap_count = security_zones - 1

    # Access control points
    access_control_points = 2 * security_zones

    # Guard staffing
    if perimeter_ft > 0:
        guards_per_shift = math.ceil(perimeter_ft / 500)
    else:
        guards_per_shift = math.ceil(facility_sqft / 50000) + 1

    guard_count_total = guards_per_shift * 3  # 3 shifts for 24/7

    # Cameras
    cameras_interior = math.ceil(facility_sqft / 500)
    cameras_perimeter = math.ceil(perimeter_ft / 100) if perimeter_ft > 0 else math.ceil(math.sqrt(facility_sqft) * 4 / 100)

    # Badge readers
    badge_reader_count = access_control_points * 2

    # Visitor management desks
    visitor_desks = max(1, math.ceil(facility_sqft / 50000))

    # Estimated annual security cost
    guard_annual_cost = guard_count_total * 65000  # $65K per guard/year
    camera_cost = (cameras_interior + cameras_perimeter) * 2000  # $2K amortized/camera/year
    access_control_cost = badge_reader_count * 500  # $500/reader/year
    estimated_annual_cost = guard_annual_cost + camera_cost + access_control_cost

    output = {
        "input": {
            "facility_sqft": facility_sqft,
            "tier": tier,
            "perimeter_ft": perimeter_ft,
        },
        "security_zone_count": security_zones,
        "mantrap_count": mantrap_count,
        "access_control_points": access_control_points,
        "camera_count_interior": cameras_interior,
        "camera_count_perimeter": cameras_perimeter,
        "guard_count_per_shift": guards_per_shift,
        "guard_count_total_24x7": guard_count_total,
        "badge_reader_count": badge_reader_count,
        "visitor_management_desks": visitor_desks,
        "estimated_annual_security_cost": round(estimated_annual_cost, 0),
        "standards_references": ["ANSI/BICSI 005-2016", "Uptime Institute Tier Standard", "NIST SP 800-116"],
        "notes": [
            f"Tier {tier} facility requires {security_zones} security zones with {mantrap_count} mantrap(s).",
            f"{guards_per_shift} guards per shift ({guard_count_total} total for 24/7 coverage).",
            f"{cameras_interior + cameras_perimeter} total cameras: {cameras_interior} interior, {cameras_perimeter} perimeter.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
