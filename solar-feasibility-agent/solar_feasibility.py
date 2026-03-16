"""
Solar PV Feasibility Agent
Usage: solar_feasibility.py <facility_sqft> <it_load_kw> <state> [roof_available_sqft=0]

state: 2-letter US state code
roof_available_sqft=0 means auto-calculate (30% of facility_sqft)
"""

import sys
import json


# Solar irradiance by state (kWh/m²/day)
IRRADIANCE_BY_STATE = {
    "AZ": 6.5, "CA": 5.5, "TX": 5.0, "FL": 5.5, "NV": 6.5,
    "NC": 4.5, "VA": 4.0, "OR": 3.5, "WA": 3.5, "NY": 3.5,
    "MA": 3.5, "GA": 5.0, "CO": 5.5, "IL": 4.0, "NJ": 4.0,
    "NM": 6.0, "UT": 5.5, "ID": 4.5, "MT": 4.0, "WY": 5.0,
    "HI": 6.0, "AK": 3.0, "MN": 4.0, "WI": 4.0, "MI": 3.5,
    "OH": 4.0, "PA": 4.0, "MD": 4.5, "SC": 5.0, "TN": 4.5,
}
IRRADIANCE_DEFAULT = 4.5

PANEL_DENSITY_W_PER_SQFT = 15.0  # monocrystalline
DERATING_FACTOR = 0.80            # system losses
PUE_ASSUMED = 1.4                 # for energy offset calculation
IRA_CREDIT_PCT = 0.30             # 30% Investment Tax Credit (IRA 2022)
ROOFTOP_COST_PER_KW = 1500
UTILITY_SCALE_COST_PER_KW = 1000
ELECTRICITY_RATE = 0.08           # $/kWh
CO2_LBS_PER_KWH = 0.78
LBS_PER_METRIC_TON = 2204.6

SQFT_PER_M2 = 10.764


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: solar_feasibility.py <facility_sqft> <it_load_kw> <state> [roof_available_sqft=0]"}), file=sys.stderr)
        sys.exit(1)

    try:
        facility_sqft = float(sys.argv[1])
        it_load_kw = float(sys.argv[2])
        state = sys.argv[3].upper()
        roof_available = float(sys.argv[4]) if len(sys.argv) == 5 else 0.0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if facility_sqft < 1000 or facility_sqft > 5000000:
        print(json.dumps({"error": "facility_sqft must be 1000-5000000"}), file=sys.stderr)
        sys.exit(1)
    if it_load_kw < 1 or it_load_kw > 500000:
        print(json.dumps({"error": "it_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if len(state) != 2 or not state.isalpha():
        print(json.dumps({"error": "state must be a 2-letter US state code"}), file=sys.stderr)
        sys.exit(1)

    if roof_available <= 0:
        roof_available = facility_sqft * 0.30

    irradiance = IRRADIANCE_BY_STATE.get(state, IRRADIANCE_DEFAULT)

    # System capacity
    system_capacity_kw = roof_available * PANEL_DENSITY_W_PER_SQFT / 1000.0

    # Annual generation
    annual_generation_kwh = system_capacity_kw * irradiance * 365 * DERATING_FACTOR

    # Facility total load
    facility_annual_kwh = it_load_kw * PUE_ASSUMED * 8760

    # Energy offset
    energy_offset_pct = (annual_generation_kwh / facility_annual_kwh) * 100.0

    # Self-consumption
    self_consumption_kwh = min(annual_generation_kwh, facility_annual_kwh)
    self_consumption_rate_pct = (self_consumption_kwh / annual_generation_kwh) * 100.0 if annual_generation_kwh > 0 else 0

    # Cost analysis
    if system_capacity_kw > 1000:
        cost_per_kw = UTILITY_SCALE_COST_PER_KW
    else:
        cost_per_kw = ROOFTOP_COST_PER_KW
    system_cost = system_capacity_kw * cost_per_kw
    ira_credit = system_cost * IRA_CREDIT_PCT
    net_cost = system_cost - ira_credit

    # Annual savings
    annual_savings = annual_generation_kwh * ELECTRICITY_RATE
    payback_years = net_cost / annual_savings if annual_savings > 0 else float("inf")

    # CO2 offset
    co2_offset_lbs = annual_generation_kwh * CO2_LBS_PER_KWH
    co2_offset_mt = co2_offset_lbs / LBS_PER_METRIC_TON

    output = {
        "input": {
            "facility_sqft": facility_sqft,
            "it_load_kw": it_load_kw,
            "state": state,
            "roof_available_sqft": roof_available,
        },
        "solar_irradiance_kwh_m2_day": irradiance,
        "system_capacity_kw": round(system_capacity_kw, 1),
        "annual_generation_kwh": round(annual_generation_kwh, 0),
        "energy_offset_pct": round(energy_offset_pct, 1),
        "self_consumption_rate_pct": round(self_consumption_rate_pct, 1),
        "system_cost": round(system_cost, 0),
        "ira_credit_value": round(ira_credit, 0),
        "net_cost": round(net_cost, 0),
        "annual_savings": round(annual_savings, 0),
        "simple_payback_years": round(payback_years, 1) if payback_years != float("inf") else None,
        "co2_offset_metric_tons_per_year": round(co2_offset_mt, 1),
        "notes": [
            f"{state} solar irradiance: {irradiance} kWh/m²/day. System: {system_capacity_kw:.0f} kW on {roof_available:,.0f} sqft.",
            f"Annual generation {annual_generation_kwh:,.0f} kWh offsets {energy_offset_pct:.1f}% of facility load.",
            f"After 30% IRA credit: ${net_cost:,.0f} net cost, {payback_years:.1f}-year payback." if payback_years != float("inf") else "Insufficient generation data.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
