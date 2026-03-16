"""
Capacity Planning Agent
Usage: capacity_planning.py <current_load_kw> <current_capacity_kw> <growth_rate_pct_per_year> [design_life_years=10]
"""

import sys
import json
import math


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: capacity_planning.py <current_load_kw> <current_capacity_kw> <growth_rate_pct_per_year> [design_life_years=10]"}), file=sys.stderr)
        sys.exit(1)

    try:
        current_load_kw = float(sys.argv[1])
        current_capacity_kw = float(sys.argv[2])
        growth_rate_pct = float(sys.argv[3])
        design_life_years = int(sys.argv[4]) if len(sys.argv) == 5 else 10
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if current_load_kw < 1 or current_load_kw > 500000:
        print(json.dumps({"error": "current_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if current_capacity_kw < 1 or current_capacity_kw > 500000:
        print(json.dumps({"error": "current_capacity_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if growth_rate_pct < 0.1 or growth_rate_pct > 100:
        print(json.dumps({"error": "growth_rate_pct_per_year must be 0.1-100"}), file=sys.stderr)
        sys.exit(1)
    if design_life_years < 1 or design_life_years > 30:
        print(json.dumps({"error": "design_life_years must be 1-30"}), file=sys.stderr)
        sys.exit(1)

    current_utilization = (current_load_kw / current_capacity_kw) * 100.0

    rate = growth_rate_pct / 100.0

    # Years to 80% utilization
    target_load_80 = current_capacity_kw * 0.80
    if current_load_kw >= target_load_80:
        years_to_80 = 0.0
    else:
        years_to_80 = math.log(target_load_80 / current_load_kw) / math.log(1 + rate)

    # Years to 100% capacity
    if current_load_kw >= current_capacity_kw:
        years_to_100 = 0.0
    else:
        years_to_100 = math.log(current_capacity_kw / current_load_kw) / math.log(1 + rate)

    # Projected loads
    load_5yr = current_load_kw * ((1 + rate) ** 5)
    load_10yr = current_load_kw * ((1 + rate) ** 10)

    # Expansion trigger year
    expansion_trigger_year = math.ceil(years_to_80)

    # Recommended expansion capacity
    # Plan 3 years ahead at projected growth
    years_ahead = 3
    recommended_expansion_kw = current_capacity_kw * ((1 + rate) ** years_ahead) * 1.20  # 20% headroom

    # Risk assessment
    if current_utilization >= 80 or years_to_80 < 1:
        risk = "critical"
    elif years_to_80 < 2:
        risk = "high"
    elif years_to_80 < 5:
        risk = "medium"
    else:
        risk = "low"

    # Power density note
    density_note = None
    if growth_rate_pct > 20:
        density_note = "Growth rate >20%/yr suggests density increase likely; plan for higher kW/rack infrastructure."

    output = {
        "input": {
            "current_load_kw": current_load_kw,
            "current_capacity_kw": current_capacity_kw,
            "growth_rate_pct_per_year": growth_rate_pct,
            "design_life_years": design_life_years,
        },
        "current_utilization_pct": round(current_utilization, 1),
        "years_to_80pct_utilization": round(years_to_80, 1),
        "years_to_full_capacity": round(years_to_100, 1),
        "expansion_trigger_year": expansion_trigger_year,
        "projected_load_at_5yr_kw": round(load_5yr, 0),
        "projected_load_at_10yr_kw": round(load_10yr, 0),
        "recommended_expansion_capacity_kw": round(recommended_expansion_kw, 0),
        "capacity_planning_risk": risk,
        "density_trend_note": density_note,
        "notes": [
            f"Current utilization: {current_utilization:.1f}%. Expansion trigger at 80%: Year {expansion_trigger_year}.",
            f"At {growth_rate_pct}% annual growth: {load_5yr:,.0f} kW in 5 years, {load_10yr:,.0f} kW in 10 years.",
            f"Risk level: {risk}. Recommended expansion: {recommended_expansion_kw:,.0f} kW capacity addition.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
