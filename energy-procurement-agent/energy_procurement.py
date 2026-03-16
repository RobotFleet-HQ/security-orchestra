"""
Energy Procurement Strategy Agent
Usage: energy_procurement.py <annual_consumption_mwh> <state> <contract_term_years> [renewable_target_pct=0]

state: 2-letter US state code
"""

import sys
import json


# Electricity rates by state ($/MWh)
RATES_BY_STATE = {
    "TX": 35,  "CA": 80,  "NY": 75,  "VA": 55,  "OR": 50,
    "WA": 40,  "GA": 60,  "NC": 55,  "AZ": 65,  "IL": 60,
    "FL": 70,  "NJ": 75,  "PA": 65,  "OH": 55,  "MI": 65,
    "MN": 60,  "CO": 60,  "NV": 65,  "MD": 70,  "MA": 90,
}
RATE_DEFAULT = 65  # $/MWh

GREEN_PREMIUM = 5.0   # $/MWh for green tariff
PPA_DISCOUNT = 0.87   # 87% of retail rate
PPA_ESCALATOR = 0.02  # 2%/year escalator reduction
REC_COST_PER_MWH = 2.0  # $/MWh for RECs


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: energy_procurement.py <annual_consumption_mwh> <state> <contract_term_years> [renewable_target_pct=0]"}), file=sys.stderr)
        sys.exit(1)

    try:
        annual_mwh = float(sys.argv[1])
        state = sys.argv[2].upper()
        contract_years = int(sys.argv[3])
        renewable_pct = float(sys.argv[4]) if len(sys.argv) == 5 else 0.0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if annual_mwh < 1 or annual_mwh > 10000000:
        print(json.dumps({"error": "annual_consumption_mwh must be 1-10000000"}), file=sys.stderr)
        sys.exit(1)
    if len(state) != 2 or not state.isalpha():
        print(json.dumps({"error": "state must be a 2-letter US state code"}), file=sys.stderr)
        sys.exit(1)
    if contract_years < 1 or contract_years > 20:
        print(json.dumps({"error": "contract_term_years must be 1-20"}), file=sys.stderr)
        sys.exit(1)
    if renewable_pct < 0 or renewable_pct > 100:
        print(json.dumps({"error": "renewable_target_pct must be 0-100"}), file=sys.stderr)
        sys.exit(1)

    rate = RATES_BY_STATE.get(state, RATE_DEFAULT)

    # Cost scenarios ($/year)
    utility_annual = annual_mwh * rate
    ppa_rate = rate * PPA_DISCOUNT * (1 - PPA_ESCALATOR * contract_years)
    ppa_annual = annual_mwh * ppa_rate
    green_tariff_annual = annual_mwh * (rate + GREEN_PREMIUM)
    renewable_mwh = annual_mwh * renewable_pct / 100.0
    hybrid_annual = annual_mwh * ppa_rate + renewable_mwh * REC_COST_PER_MWH

    ppa_savings = utility_annual - ppa_annual

    # Recommendation
    if renewable_pct >= 100:
        strategy = "green_tariff_or_ppa_with_recs"
        strategy_reason = "100% renewable target best met with green tariff or PPA bundled with RECs."
    elif renewable_pct >= 50:
        strategy = "hybrid_ppa_plus_recs"
        strategy_reason = f"Partial renewable target ({renewable_pct}%) most cost-effective via PPA with separate REC purchase."
    elif annual_mwh > 50000 and contract_years >= 5:
        strategy = "ppa"
        strategy_reason = f"Large load ({annual_mwh:,.0f} MWh/yr) + long term ({contract_years}yr) makes PPA most cost-effective, saving ${ppa_savings:,.0f}/yr."
    else:
        strategy = "utility_tariff"
        strategy_reason = "Smaller load or short term; utility tariff offers flexibility without commitment risk."

    # 10-year cost comparison
    ten_yr_utility = utility_annual * 10
    ten_yr_ppa = sum(annual_mwh * rate * PPA_DISCOUNT * (1 - PPA_ESCALATOR * y) for y in range(1, 11))
    ten_yr_green = green_tariff_annual * 10

    output = {
        "input": {
            "annual_consumption_mwh": annual_mwh,
            "state": state,
            "contract_term_years": contract_years,
            "renewable_target_pct": renewable_pct,
        },
        "utility_tariff_rate_per_mwh": rate,
        "utility_annual_cost": round(utility_annual, 0),
        "ppa_rate_per_mwh": round(ppa_rate, 2),
        "ppa_annual_cost": round(ppa_annual, 0),
        "ppa_savings_vs_utility": round(ppa_savings, 0),
        "green_tariff_annual_cost": round(green_tariff_annual, 0),
        "recs_required_mwh": round(renewable_mwh, 0),
        "rec_cost_annual": round(renewable_mwh * REC_COST_PER_MWH, 0),
        "hybrid_ppa_plus_recs_annual_cost": round(hybrid_annual, 0),
        "recommended_strategy": strategy,
        "strategy_reason": strategy_reason,
        "10yr_cost_comparison": {
            "utility_tariff": round(ten_yr_utility, 0),
            "ppa": round(ten_yr_ppa, 0),
            "green_tariff": round(ten_yr_green, 0),
            "ppa_10yr_savings": round(ten_yr_utility - ten_yr_ppa, 0),
        },
        "renewable_pct_achieved": renewable_pct,
        "notes": [
            f"{state} electricity rate: ${rate}/MWh. PPA at {PPA_DISCOUNT*100:.0f}% of retail = ${ppa_rate:.2f}/MWh.",
            f"Recommended: {strategy.replace('_', ' ')}. 10-year PPA savings: ${ten_yr_utility - ten_yr_ppa:,.0f} vs utility.",
            f"RECs: {renewable_mwh:,.0f} MWh at ${REC_COST_PER_MWH}/MWh = ${renewable_mwh * REC_COST_PER_MWH:,.0f}/yr for {renewable_pct}% renewable." if renewable_pct > 0 else "No renewable target specified.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
