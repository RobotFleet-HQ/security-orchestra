"""
Demand Response Revenue Agent
Usage: demand_response.py <generator_capacity_kw> <critical_load_kw> <utility_provider>
                          [annual_events_expected=12]

Prints JSON to stdout on success.
Prints JSON {"error": "..."} to stderr and exits 1 on failure.
"""

import sys
import json


def _err(msg: str) -> None:
    json.dump({"error": msg}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def _program(name: str, rate_desc: str, annual_rev: float,
             requirements: list) -> dict:
    return {
        "program_name": name,
        "rate_description": rate_desc,
        "annual_revenue_estimate": round(annual_rev, 2),
        "requirements": requirements,
    }


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 3:
        _err(
            "Usage: demand_response.py <generator_capacity_kw> <critical_load_kw> "
            "<utility_provider> [annual_events_expected=12]"
        )

    try:
        generator_capacity_kw = float(args[0])
        critical_load_kw = float(args[1])
        utility_provider = args[2].strip()
        annual_events = int(args[3]) if len(args) >= 4 else 12
    except ValueError as exc:
        _err(f"Invalid argument: {exc}")

    if generator_capacity_kw <= 0:
        _err("generator_capacity_kw must be > 0")
    if critical_load_kw < 0:
        _err("critical_load_kw must be >= 0")
    if critical_load_kw >= generator_capacity_kw:
        _err("critical_load_kw must be less than generator_capacity_kw")
    if annual_events < 0:
        _err("annual_events_expected must be >= 0")

    sheddable_kw = generator_capacity_kw - critical_load_kw
    sheddable_pct = (sheddable_kw / generator_capacity_kw) * 100.0
    sheddable_mw = sheddable_kw / 1000.0

    # Normalize provider for matching
    provider_upper = utility_provider.upper()

    program_options = []

    # ── PJM (VA, PA, MD, OH, IL) ──────────────────────────────────────────────
    pjm_keywords = ["PJM", "DOMINION", "BGE", "PEPCO", "PPL", "AECO", "PSEG", "COMED",
                    "APS", "AEP", "DAYTON", "OHIO"]
    is_pjm = any(k in provider_upper for k in pjm_keywords)

    if is_pjm:
        # Capacity market: midpoint $115/MW-day × 365 days
        pjm_capacity_rate = 115.0  # $/MW-day (midpoint of $50–$180)
        pjm_capacity_rev = sheddable_mw * pjm_capacity_rate * 365.0
        program_options.append(_program(
            name="PJM Reliability Pricing Model (RPM) Capacity Market",
            rate_desc="$50–$180/MW-day capacity payment (current auction clearing price ~$115/MW-day)",
            annual_rev=pjm_capacity_rev,
            requirements=[
                "Minimum 0.1 MW (100 kW) resource capability",
                "Must pass PJM capacity performance testing",
                "Annual baseline demand submission",
                "Real-time telemetry to PJM EMS required",
                "Performance penalty for non-performance during emergency",
            ],
        ))
        # Emergency Load Response Program (ELRP): $500–$2,000/MW-event
        pjm_emergency_rate = 1_250.0  # $/MW-event midpoint
        pjm_emergency_rev = sheddable_mw * pjm_emergency_rate * annual_events
        program_options.append(_program(
            name="PJM Emergency Load Response Program (ELRP)",
            rate_desc=f"$500–$2,000/MW-event emergency payment ({annual_events} events/yr estimated)",
            annual_rev=pjm_emergency_rev,
            requirements=[
                "Minimum 100 kW sheddable load",
                "2-hour advance notice curtailment capability",
                "Maximum 10 curtailment hours per event",
                "Registered as Curtailment Service Provider (CSP) participant",
                "Smart meter or interval metering required",
            ],
        ))

    # ── ERCOT (Texas) ─────────────────────────────────────────────────────────
    ercot_keywords = ["ERCOT", "ONCOR", "AEP TEXAS", "CENTERPOINT", "TNMP",
                      "ENTERGY TEXAS", "TXU", "RELIANT", "LUMINANT"]
    is_ercot = any(k in provider_upper for k in ercot_keywords)

    if is_ercot:
        # Load Resource program: $35–$80/kW-year
        ercot_lr_rate = 57.5  # midpoint $/kW-year
        ercot_lr_rev = sheddable_kw * ercot_lr_rate
        program_options.append(_program(
            name="ERCOT Load Resource (LR) Ancillary Service",
            rate_desc="$35–$80/kW-year for qualified load resource capacity",
            annual_rev=ercot_lr_rev,
            requirements=[
                "Minimum 1 MW resource size",
                "Must be registered as Load Resource with ERCOT",
                "Real-time automated response capability (< 10 min)",
                "Qualified Scheduling Entity (QSE) required",
                "ERCOT Protocol Section 7 compliance",
            ],
        ))
        # ORDC (Operating Reserve Demand Curve): highly variable $0–$9,000/MWh
        # Conservative estimate: 50 hrs/year at $100/MWh average
        ercot_ordc_hrs = 50.0
        ercot_ordc_avg = 100.0  # $/MWh conservative average
        ercot_ordc_rev = sheddable_mw * ercot_ordc_avg * ercot_ordc_hrs
        program_options.append(_program(
            name="ERCOT Operating Reserve Demand Curve (ORDC) – Real-Time Market",
            rate_desc=f"$0–$9,000/MWh real-time price adder; est. {ercot_ordc_hrs:.0f} hrs/yr at avg ${ercot_ordc_avg}/MWh",
            annual_rev=ercot_ordc_rev,
            requirements=[
                "Real-time price-responsive load curtailment",
                "Registration as Load Resource or Demand Response resource",
                "Automated controls with sub-10-minute response",
                "Revenue highly variable with grid stress events",
            ],
        ))

    # ── CAISO (California: PG&E, SCE, SDG&E) ─────────────────────────────────
    caiso_keywords = ["CAISO", "PG&E", "PGE", "SCE", "SDG&E", "SDGE",
                      "PACIFIC GAS", "SOUTHERN CALIFORNIA EDISON"]
    is_caiso = any(k in provider_upper for k in caiso_keywords)

    if is_caiso:
        # Base Interruptible Program: $8.22/kW-month
        caiso_bip_rate = 8.22  # $/kW-month
        caiso_bip_rev = sheddable_kw * caiso_bip_rate * 12.0
        program_options.append(_program(
            name="CAISO Base Interruptible Program (BIP)",
            rate_desc="$8.22/kW-month for enrolled interruptible capacity",
            annual_rev=caiso_bip_rev,
            requirements=[
                "Minimum 100 kW interruptible load",
                "Must respond within 30 minutes of utility notification",
                "Maximum 3 interruptions per month, 4 hours each",
                "Must maintain interruption capability year-round",
                "Service Agreement with participating utility required",
            ],
        ))

    # ── ISO-NE (New England) ──────────────────────────────────────────────────
    isone_keywords = ["ISO-NE", "ISONE", "EVERSOURCE", "NATIONAL GRID", "UNITIL",
                      "GREEN MOUNTAIN", "CENTRAL MAINE", "CMP", "NSTAR", "WMECO"]
    is_isone = any(k in provider_upper for k in isone_keywords)

    if is_isone:
        # Forward Capacity Market: $3–$7/kW-month
        isone_fcm_rate = 5.0  # $/kW-month midpoint
        isone_fcm_rev = sheddable_kw * isone_fcm_rate * 12.0
        program_options.append(_program(
            name="ISO-NE Forward Capacity Market (FCM)",
            rate_desc="$3–$7/kW-month for qualified capacity resource",
            annual_rev=isone_fcm_rev,
            requirements=[
                "Minimum 100 kW resource",
                "Must pass Forward Capacity Auction (FCA) qualification",
                "Real-time data reporting to ISO-NE",
                "Capacity Supply Obligation for 3-year forward period",
                "Performance obligations during capacity scarcity events",
            ],
        ))

    # ── MISO (Midwest: ComEd, etc.) ───────────────────────────────────────────
    miso_keywords = ["MISO", "COMED", "COM ED", "AMEREN", "CONSUMERS ENERGY",
                     "DTE", "INDIANA MICHIGAN", "WEPCO", "CLECO", "ENTERGY AR",
                     "ENTERGY LA", "ENTERGY MS"]
    is_miso = any(k in provider_upper for k in miso_keywords)

    if is_miso:
        # $1–$3/kW-month
        miso_rate = 2.0  # $/kW-month midpoint
        miso_rev = sheddable_kw * miso_rate * 12.0
        program_options.append(_program(
            name="MISO Demand Response Resource (DRR)",
            rate_desc="$1–$3/kW-month for qualified demand response resource",
            annual_rev=miso_rev,
            requirements=[
                "Minimum 0.1 MW (100 kW) resource",
                "Registration with MISO through a Demand Response Resource Provider",
                "10-minute response capability",
                "Telemetry and metering meeting MISO requirements",
                "Must clear in MISO Planning Resource Auction (PRA)",
            ],
        ))

    # ── Dominion Energy ───────────────────────────────────────────────────────
    dominion_keywords = ["DOMINION", "DOM", "VIRGINIA POWER", "DOMINION ENERGY",
                         "SOUTH CAROLINA GAS AND ELECTRIC", "SCANA"]
    # Check separately from PJM (Dominion is in PJM but has its own rider)
    is_dominion = any(k in provider_upper for k in dominion_keywords)

    if is_dominion and not is_pjm:
        # $8–$12/kW-year
        dom_rate = 10.0  # $/kW-year midpoint
        dom_rev = sheddable_kw * dom_rate
        program_options.append(_program(
            name="Dominion Energy Demand Response Rider (Schedule DR)",
            rate_desc="$8–$12/kW-year for enrolled interruptible capacity",
            annual_rev=dom_rev,
            requirements=[
                "Minimum 500 kW enrolled capacity",
                "Must interrupt within 1 hour of request",
                "Maximum 10 interruptions per year, 4 hours each",
                "Service agreement and baseline metering required",
            ],
        ))
    elif is_dominion and is_pjm:
        # Already captured in PJM programs; add note
        pass

    # ── Generic / Other ───────────────────────────────────────────────────────
    if not any([is_pjm, is_ercot, is_caiso, is_isone, is_miso, is_dominion]):
        generic_rate = 50.0  # $/kW-year estimate
        generic_rev = sheddable_kw * generic_rate
        program_options.append(_program(
            name="Generic Utility Demand Response Program",
            rate_desc=f"~$50/kW-year estimated (contact '{utility_provider}' for specific rates)",
            annual_rev=generic_rev,
            requirements=[
                "Contact utility account manager for enrollment details",
                "Minimum capacity thresholds vary by utility (typically 100–500 kW)",
                "Baseline load documentation required",
                "Automated or manual load curtailment capability",
            ],
        ))

    # ── Peak Shaving / Demand Charge Savings ─────────────────────────────────
    # $15/kW/month × 12 months on sheddable capacity
    peak_shaving_monthly_rate = 15.0  # $/kW/month
    peak_shaving_annual = sheddable_kw * peak_shaving_monthly_rate * 12.0

    # ── Economics ─────────────────────────────────────────────────────────────
    # Best annual DR revenue = highest single program
    if program_options:
        best_annual_revenue = max(p["annual_revenue_estimate"] for p in program_options)
    else:
        best_annual_revenue = 0.0

    total_annual_benefit = best_annual_revenue + peak_shaving_annual

    # Generator cost estimate: $500/kW installed
    generator_installed_rate = 500.0  # $/kW
    estimated_generator_cost = generator_capacity_kw * generator_installed_rate

    if total_annual_benefit > 0:
        payback_years = estimated_generator_cost / total_annual_benefit
    else:
        payback_years = float("inf")

    # ── Participation Requirements ────────────────────────────────────────────
    participation_requirements = [
        "Interval (15-minute or hourly) metering required for most programs",
        "Communication link to utility/ISO for real-time monitoring and dispatch",
        "Automated load control system or manual response procedures",
        "Baseline load documentation (typically 10-day rolling average)",
        "Signed demand response service agreement with utility or CSP",
        "Compliance testing: at least one verified curtailment per year",
        "Notification capability: phone, email, or automated signal",
    ]

    # ── Recommendation ────────────────────────────────────────────────────────
    if best_annual_revenue > 100_000:
        rec = (
            f"Strong DR revenue opportunity: ${best_annual_revenue:,.0f}/yr from best program + "
            f"${peak_shaving_annual:,.0f}/yr peak shaving = ${total_annual_benefit:,.0f}/yr total. "
            f"Generator investment of ${estimated_generator_cost:,.0f} pays back in "
            f"{payback_years:.1f} years from DR revenue alone. Enroll immediately."
        )
    elif best_annual_revenue > 20_000:
        rec = (
            f"Moderate DR opportunity: ${total_annual_benefit:,.0f}/yr combined benefit. "
            f"Payback of {payback_years:.1f} years. Recommend enrolling in the highest-paying "
            "available program and stacking with peak shaving to maximize value."
        )
    else:
        rec = (
            f"Limited DR revenue from {utility_provider} ({sheddable_kw:.0f} kW sheddable). "
            "Consider registering as an aggregated DR resource or exploring bilateral "
            "demand response contracts with the utility. Peak shaving savings "
            f"(${peak_shaving_annual:,.0f}/yr) may provide better near-term value."
        )

    output = {
        "input": {
            "generator_capacity_kw": generator_capacity_kw,
            "critical_load_kw": critical_load_kw,
            "utility_provider": utility_provider,
            "annual_events_expected": annual_events,
        },
        "capacity_analysis": {
            "generator_capacity_kw": round(generator_capacity_kw, 2),
            "critical_load_kw": round(critical_load_kw, 2),
            "sheddable_capacity_kw": round(sheddable_kw, 2),
            "sheddable_percent": round(sheddable_pct, 2),
        },
        "program_options": program_options,
        "economics": {
            "best_annual_revenue": round(best_annual_revenue, 2),
            "peak_shaving_savings_annual": round(peak_shaving_annual, 2),
            "total_annual_benefit": round(total_annual_benefit, 2),
            "estimated_generator_cost": round(estimated_generator_cost, 2),
            "payback_years_from_dr": round(payback_years, 4) if payback_years != float("inf") else None,
        },
        "participation_requirements": participation_requirements,
        "recommendation": rec,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
