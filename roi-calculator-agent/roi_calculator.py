"""
ROI Calculator Agent
Usage: roi_calculator.py <capex> <annual_opex> <revenue_per_year> <project_lifetime_years> [discount_rate=0.10]

Prints JSON to stdout on success.
Prints JSON {"error": "..."} to stderr and exits 1 on failure.
"""

import sys
import json
import math


def _err(msg: str) -> None:
    json.dump({"error": msg}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def _npv(capex: float, annual_net: float, r: float, n: int) -> float:
    """Net Present Value: sum of discounted cash flows minus initial investment."""
    total = 0.0
    for t in range(1, n + 1):
        total += annual_net / ((1.0 + r) ** t)
    return total - capex


def _npv_variable(capex: float, cashflows: list, r: float) -> float:
    """NPV for a list of annual net cash flows (year 0 = -capex)."""
    total = -capex
    for t, cf in enumerate(cashflows, start=1):
        total += cf / ((1.0 + r) ** t)
    return total


def _irr_bisection(capex: float, annual_net: float, n: int,
                   lo: float = -0.50, hi: float = 2.00,
                   tol: float = 1e-8, max_iter: int = 200) -> float:
    """Bisection method to find IRR where NPV = 0."""
    f_lo = _npv(capex, annual_net, lo, n)
    f_hi = _npv(capex, annual_net, hi, n)

    # If both sides same sign, IRR may not exist in range
    if f_lo * f_hi > 0:
        # Try to find a bracket
        if annual_net <= 0:
            return float("nan")
        # For positive cash flows, IRR exists; extend range
        hi = 10.0
        f_hi = _npv(capex, annual_net, hi, n)
        if f_lo * f_hi > 0:
            return float("nan")

    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        f_mid = _npv(capex, annual_net, mid, n)
        if abs(f_mid) < tol or (hi - lo) / 2.0 < tol:
            return mid
        if f_lo * f_mid < 0:
            hi = mid
            f_hi = f_mid
        else:
            lo = mid
            f_lo = f_mid

    return (lo + hi) / 2.0


def _sensitivity_npv_payback(capex: float, rev: float, opex: float,
                              r: float, n: int) -> dict:
    annual_net = rev - opex
    npv_val = _npv(capex, annual_net, r, n)
    if annual_net > 0:
        payback_months = (capex / annual_net) * 12.0
    else:
        payback_months = float("inf")
    return {"npv": round(npv_val, 2), "payback_months": round(payback_months, 2)}


def _colo_npv_5yr(it_load_kw: float, r: float) -> float:
    """
    Estimate colo cost NPV over 5 years.
    Assume 10 kW per rack as a rough midpoint, $150/kW/month.
    Total kW assumed to need colocation = it_load_kw.
    """
    monthly_cost = 150.0 * it_load_kw
    annual_cost = monthly_cost * 12.0
    npv_val = 0.0
    for t in range(1, 6):
        npv_val += annual_cost / ((1.0 + r) ** t)
    return npv_val


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 4:
        _err(
            "Usage: roi_calculator.py <capex> <annual_opex> <revenue_per_year> "
            "<project_lifetime_years> [discount_rate=0.10]"
        )

    try:
        capex = float(args[0])
        annual_opex = float(args[1])
        revenue_per_year = float(args[2])
        project_lifetime_years = int(args[3])
        discount_rate = float(args[4]) if len(args) >= 5 else 0.10
    except ValueError as exc:
        _err(f"Invalid numeric argument: {exc}")

    # Validation
    if capex < 0:
        _err("capex must be >= 0")
    if project_lifetime_years < 1:
        _err("project_lifetime_years must be >= 1")
    if discount_rate <= -1.0:
        _err("discount_rate must be > -1.0")

    n = project_lifetime_years
    r = discount_rate
    annual_net = revenue_per_year - annual_opex

    # ── Simple payback ────────────────────────────────────────────────────────
    if annual_net > 0:
        payback_months = (capex / annual_net) * 12.0
    elif annual_net == 0:
        payback_months = float("inf")
    else:
        payback_months = float("inf")  # never pays back

    # ── NPV ───────────────────────────────────────────────────────────────────
    npv_dollars = _npv(capex, annual_net, r, n)

    # ── IRR ───────────────────────────────────────────────────────────────────
    irr_raw = _irr_bisection(capex, annual_net, n)
    irr_percent = irr_raw * 100.0 if not math.isnan(irr_raw) else None

    # ── Summary metrics ───────────────────────────────────────────────────────
    total_revenue = revenue_per_year * n
    total_opex = annual_opex * n
    net_profit = total_revenue - total_opex - capex
    roi_percent = (net_profit / capex * 100.0) if capex > 0 else None

    # ── Cash flow by year ─────────────────────────────────────────────────────
    cashflow_by_year = []
    cumulative = -capex  # initial investment at time 0
    for t in range(1, n + 1):
        net = annual_net
        pv = net / ((1.0 + r) ** t)
        cumulative += net
        cashflow_by_year.append({
            "year": t,
            "revenue": round(revenue_per_year, 2),
            "opex": round(annual_opex, 2),
            "net": round(net, 2),
            "cumulative": round(cumulative, 2),
            "pv": round(pv, 2),
        })

    # ── Build vs Buy vs Colo comparison (5-year window) ───────────────────────
    compare_years = 5
    compare_r = r

    # Build
    build_capex = capex
    build_total_5yr = build_capex + annual_opex * compare_years
    build_npv_5yr = _npv(build_capex, annual_net, compare_r, compare_years)

    # Buy (acquire existing): 70% of capex estimate + same opex
    buy_capex = capex * 0.70
    buy_annual_net = revenue_per_year - annual_opex
    buy_total_5yr = buy_capex + annual_opex * compare_years
    buy_npv_5yr = _npv(buy_capex, buy_annual_net, compare_r, compare_years)

    # Colo: no capex, but monthly cost replaces opex (opex still applies for operations)
    colo_capex = 0.0
    # Estimate IT load from capex: $8M/MW → MW = capex/(8e6), kW = MW*1000
    estimated_it_kw = (capex / 8_000_000.0) * 1000.0
    colo_monthly = 150.0 * estimated_it_kw
    colo_annual = colo_monthly * 12.0
    colo_total_5yr = colo_annual * compare_years
    colo_npv_5yr = 0.0
    for t in range(1, compare_years + 1):
        # Colo cost offsets revenue; net = revenue - colo_annual
        colo_net_t = revenue_per_year - colo_annual
        colo_npv_5yr += colo_net_t / ((1.0 + compare_r) ** t)
    colo_npv_5yr -= colo_capex

    # ── Sensitivity analysis (±10%, ±20%) ────────────────────────────────────
    sens = {}
    for label, rev_mult, opex_mult in [
        ("revenue_plus_20pct",  1.20, 1.00),
        ("revenue_minus_20pct", 0.80, 1.00),
        ("opex_plus_20pct",     1.00, 1.20),
        ("opex_minus_20pct",    1.00, 0.80),
    ]:
        sens[label] = _sensitivity_npv_payback(
            capex,
            revenue_per_year * rev_mult,
            annual_opex * opex_mult,
            r, n,
        )

    # ── Recommendation ────────────────────────────────────────────────────────
    if irr_percent is not None and irr_percent > discount_rate * 100.0 and npv_dollars > 0:
        if payback_months <= 36:
            rec = (
                f"Strong investment case: IRR of {irr_percent:.1f}% exceeds hurdle rate, "
                f"positive NPV of ${npv_dollars:,.0f}, payback in {payback_months:.1f} months. "
                "Recommend proceeding with Build option."
            )
        else:
            rec = (
                f"Viable investment: IRR {irr_percent:.1f}%, NPV ${npv_dollars:,.0f}. "
                f"Payback of {payback_months:.1f} months is longer-term — consider phased deployment."
            )
    elif npv_dollars > 0:
        rec = (
            f"Positive NPV of ${npv_dollars:,.0f} indicates value creation over {n} years, "
            "but verify IRR meets internal hurdle rate before committing capital."
        )
    else:
        rec = (
            f"Negative NPV of ${npv_dollars:,.0f} suggests this project does not meet the "
            f"{discount_rate*100:.1f}% discount rate threshold. Consider Buy or Colo alternatives, "
            "or renegotiate revenue contracts before proceeding."
        )

    # ── Assemble output ───────────────────────────────────────────────────────
    output = {
        "input": {
            "capex": capex,
            "annual_opex": annual_opex,
            "revenue_per_year": revenue_per_year,
            "project_lifetime_years": n,
            "discount_rate": r,
        },
        "roi_summary": {
            "payback_months": round(payback_months, 2) if payback_months != float("inf") else None,
            "npv_dollars": round(npv_dollars, 2),
            "irr_percent": round(irr_percent, 4) if irr_percent is not None else None,
            "total_revenue": round(total_revenue, 2),
            "total_opex": round(total_opex, 2),
            "net_profit": round(net_profit, 2),
            "roi_percent": round(roi_percent, 4) if roi_percent is not None else None,
        },
        "cashflow_by_year": cashflow_by_year,
        "comparison_matrix": {
            "build": {
                "capex": round(build_capex, 2),
                "total_5yr_cost": round(build_total_5yr, 2),
                "npv_5yr": round(build_npv_5yr, 2),
            },
            "buy": {
                "capex": round(buy_capex, 2),
                "total_5yr_cost": round(buy_total_5yr, 2),
                "npv_5yr": round(buy_npv_5yr, 2),
            },
            "colo": {
                "capex": 0,
                "total_5yr_cost": round(colo_total_5yr, 2),
                "npv_5yr": round(colo_npv_5yr, 2),
                "monthly_rate_per_kw": 150,
            },
        },
        "sensitivity_analysis": sens,
        "recommendation": rec,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
