"""
TCO Analyzer Agent
Usage: tco_analyzer.py <it_load_kw> <power_rate_kwh> <years> <pue>
                       [labor_cost_annual=250000] [refresh_cycle_years=4]

Prints JSON to stdout on success.
Prints JSON {"error": "..."} to stderr and exits 1 on failure.
"""

import sys
import json


def _err(msg: str) -> None:
    json.dump({"error": msg}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 4:
        _err(
            "Usage: tco_analyzer.py <it_load_kw> <power_rate_kwh> <years> <pue> "
            "[labor_cost_annual=250000] [refresh_cycle_years=4]"
        )

    try:
        it_load_kw = float(args[0])
        power_rate_kwh = float(args[1])
        years = int(args[2])
        pue = float(args[3])
        labor_cost_annual = float(args[4]) if len(args) >= 5 else 250_000.0
        refresh_cycle_years = int(args[5]) if len(args) >= 6 else 4
    except ValueError as exc:
        _err(f"Invalid numeric argument: {exc}")

    # Validation
    if it_load_kw <= 0:
        _err("it_load_kw must be > 0")
    if power_rate_kwh <= 0:
        _err("power_rate_kwh must be > 0")
    if years < 1:
        _err("years must be >= 1")
    if pue < 1.0:
        _err("pue must be >= 1.0")
    if labor_cost_annual < 0:
        _err("labor_cost_annual must be >= 0")
    if refresh_cycle_years < 1:
        _err("refresh_cycle_years must be >= 1")

    # ── CapEx Estimate ────────────────────────────────────────────────────────
    # $8M per MW of IT load (= $8,000 per kW)
    capex_per_kw = 8_000.0
    total_capex = it_load_kw * capex_per_kw
    capex_per_kw_out = total_capex / it_load_kw  # == capex_per_kw

    # ── Annual Power Cost (Year 1) ────────────────────────────────────────────
    # Total facility power = IT load × PUE
    # Annual kWh = it_load_kw × pue × 8760 hrs/yr
    hours_per_year = 8_760.0
    annual_kwh = it_load_kw * pue * hours_per_year
    power_cost_year1 = annual_kwh * power_rate_kwh

    # ── Annual Maintenance (Year 1) ───────────────────────────────────────────
    # 3% of CapEx
    maintenance_year1 = 0.03 * total_capex

    # ── IT Refresh (annual amortization) ─────────────────────────────────────
    # 25% of $3M/MW IT equipment cost, amortized over refresh_cycle_years
    it_equipment_cost_per_mw = 3_000_000.0
    it_load_mw = it_load_kw / 1000.0
    it_equipment_total = it_equipment_cost_per_mw * it_load_mw
    refresh_annual = (0.25 * it_equipment_total) / refresh_cycle_years

    # ── Decommissioning Reserve (annual) ─────────────────────────────────────
    # 5% of CapEx spread over project life
    decom_annual = (0.05 * total_capex) / years

    # ── Year-by-Year Table with 3% annual inflation on opex ──────────────────
    inflation = 0.03
    cashflow_by_year = []
    cumulative = 0.0

    for yr in range(1, years + 1):
        inf_factor = (1.0 + inflation) ** (yr - 1)
        power_yr = power_cost_year1 * inf_factor
        maint_yr = maintenance_year1 * inf_factor
        labor_yr = labor_cost_annual * inf_factor
        refresh_yr = refresh_annual * inf_factor
        decom_yr = decom_annual  # reserve stays flat (not inflated)
        total_yr = power_yr + maint_yr + labor_yr + refresh_yr + decom_yr
        cumulative += total_yr
        cashflow_by_year.append({
            "year": yr,
            "power": round(power_yr, 2),
            "maintenance": round(maint_yr, 2),
            "labor": round(labor_yr, 2),
            "refresh": round(refresh_yr, 2),
            "decommissioning_reserve": round(decom_yr, 2),
            "total": round(total_yr, 2),
            "cumulative": round(cumulative, 2),
        })

    total_tco = cumulative
    average_annual_cost = total_tco / years

    # cost_per_kw_per_month = average annual / (it_load_kw × 12)
    cost_per_kw_per_month = average_annual_cost / (it_load_kw * 12.0)

    # cost_per_kwh_effective = total_tco / total IT kWh consumed over life
    total_it_kwh = it_load_kw * hours_per_year * years
    cost_per_kwh_effective = total_tco / total_it_kwh if total_it_kwh > 0 else 0.0

    # ── Assemble output ───────────────────────────────────────────────────────
    total_year1 = (
        power_cost_year1 + maintenance_year1 + labor_cost_annual
        + refresh_annual + decom_annual
    )

    output = {
        "input": {
            "it_load_kw": it_load_kw,
            "power_rate_kwh": power_rate_kwh,
            "years": years,
            "pue": pue,
            "labor_cost_annual": labor_cost_annual,
            "refresh_cycle_years": refresh_cycle_years,
        },
        "capex_estimate": {
            "total_capex": round(total_capex, 2),
            "per_kw": round(capex_per_kw_out, 2),
        },
        "annual_costs": {
            "power_cost_year1": round(power_cost_year1, 2),
            "maintenance_year1": round(maintenance_year1, 2),
            "labor_year1": round(labor_cost_annual, 2),
            "it_refresh_annual": round(refresh_annual, 2),
            "decommissioning_reserve_annual": round(decom_annual, 2),
            "total_year1": round(total_year1, 2),
        },
        "cashflow_by_year": cashflow_by_year,
        "tco_summary": {
            "total_tco": round(total_tco, 2),
            "cost_per_kw_per_month": round(cost_per_kw_per_month, 4),
            "cost_per_kwh_effective": round(cost_per_kwh_effective, 6),
            "average_annual_cost": round(average_annual_cost, 2),
        },
        "benchmarks": {
            "industry_avg_cost_per_kw_month": 120,
            "hyperscale_cost_per_kw_month": 65,
            "enterprise_colo_cost_per_kw_month": 150,
        },
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
