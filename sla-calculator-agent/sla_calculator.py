"""
SLA Calculator Agent
Usage: sla_calculator.py <tier> <target_availability_pct> [maintenance_windows_per_year=0]

tier: 1-4
"""

import sys
import json
import math


TIER_BENCHMARKS = {
    1: {"availability_pct": 99.671, "downtime_hrs_per_yr": 28.8},
    2: {"availability_pct": 99.741, "downtime_hrs_per_yr": 22.0},
    3: {"availability_pct": 99.982, "downtime_hrs_per_yr": 1.6},
    4: {"availability_pct": 99.995, "downtime_hrs_per_yr": 0.4},
}

ANNUAL_MINUTES = 525960
MAINTENANCE_WINDOW_HRS = 4.0
SLA_CREDIT_PER_HOUR = 150.0  # $/hr typical enterprise SLA credit


def main() -> None:
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(json.dumps({"error": "Usage: sla_calculator.py <tier> <target_availability_pct> [maintenance_windows_per_year=0]"}), file=sys.stderr)
        sys.exit(1)

    try:
        tier = int(sys.argv[1])
        target_avail = float(sys.argv[2])
        maintenance_windows = int(sys.argv[3]) if len(sys.argv) == 4 else 0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if tier < 1 or tier > 4:
        print(json.dumps({"error": "tier must be 1-4"}), file=sys.stderr)
        sys.exit(1)
    if target_avail < 99.0 or target_avail > 100.0:
        print(json.dumps({"error": "target_availability_pct must be 99.0-100.0"}), file=sys.stderr)
        sys.exit(1)
    if maintenance_windows < 0 or maintenance_windows > 52:
        print(json.dumps({"error": "maintenance_windows_per_year must be 0-52"}), file=sys.stderr)
        sys.exit(1)

    # Allowed downtime
    allowed_downtime_minutes = (1 - target_avail / 100.0) * ANNUAL_MINUTES
    allowed_downtime_hours = allowed_downtime_minutes / 60.0

    # Maintenance budget
    maintenance_hours_used = maintenance_windows * MAINTENANCE_WINDOW_HRS
    non_maintenance_budget_minutes = allowed_downtime_minutes - (maintenance_hours_used * 60.0)

    # MTBF (assuming MTTR = 1 hour)
    mttr_hrs = 1.0
    if non_maintenance_budget_minutes > 0:
        incident_budget_hrs = non_maintenance_budget_minutes / 60.0
        mtbf_hrs = 8760.0 / (incident_budget_hrs / mttr_hrs)
    else:
        mtbf_hrs = float("inf")

    # Tier benchmark
    benchmark = TIER_BENCHMARKS[tier]
    meets_tier_benchmark = target_avail >= benchmark["availability_pct"]

    # SLA credit exposure
    sla_credit_per_hour = SLA_CREDIT_PER_HOUR

    output = {
        "input": {
            "tier": tier,
            "target_availability_pct": target_avail,
            "maintenance_windows_per_year": maintenance_windows,
        },
        "allowed_downtime_minutes_per_year": round(allowed_downtime_minutes, 2),
        "allowed_downtime_hours_per_year": round(allowed_downtime_hours, 3),
        "maintenance_budget_used_hours": maintenance_hours_used,
        "unplanned_downtime_budget_minutes": round(max(non_maintenance_budget_minutes, 0), 2),
        "mtbf_target_hours": round(mtbf_hrs, 1) if mtbf_hrs != float("inf") else None,
        "mttr_target_minutes": 60,
        "tier_benchmark": {
            "tier": tier,
            "benchmark_availability_pct": benchmark["availability_pct"],
            "benchmark_downtime_hrs_per_yr": benchmark["downtime_hrs_per_yr"],
            "meets_tier_benchmark": meets_tier_benchmark,
        },
        "sla_credit_exposure_per_hour": sla_credit_per_hour,
        "notes": [
            f"Target {target_avail}% availability = {allowed_downtime_minutes:.1f} min/yr ({allowed_downtime_hours:.2f} hrs) total downtime budget.",
            f"Uptime Institute Tier {tier} benchmark: {benchmark['availability_pct']}% ({benchmark['downtime_hrs_per_yr']} hrs/yr).",
            "Meets tier benchmark." if meets_tier_benchmark else f"Target BELOW Tier {tier} benchmark — consider upgrading to meet SLA obligations.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
