"""
Incentive Finder Agent
Usage: incentive_finder.py <state> <capex> <it_load_mw>
                           [renewable_percentage=0] [new_jobs_created=0]

Prints JSON to stdout on success.
Prints JSON {"error": "..."} to stderr and exits 1 on failure.
"""

import sys
import json


def _err(msg: str) -> None:
    json.dump({"error": msg}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def _incentive(name: str, itype: str, amount: float, capex: float,
               requirements: list, application_process: str, timeline_months: int) -> dict:
    return {
        "name": name,
        "type": itype,
        "amount_dollars": round(amount, 2),
        "percent_of_capex": round((amount / capex * 100.0) if capex > 0 else 0.0, 4),
        "requirements": requirements,
        "application_process": application_process,
        "timeline_months": timeline_months,
    }


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 3:
        _err(
            "Usage: incentive_finder.py <state> <capex> <it_load_mw> "
            "[renewable_percentage=0] [new_jobs_created=0]"
        )

    try:
        state = args[0].strip().upper()
        capex = float(args[1])
        it_load_mw = float(args[2])
        renewable_pct = float(args[3]) if len(args) >= 4 else 0.0
        new_jobs = int(args[4]) if len(args) >= 5 else 0
    except ValueError as exc:
        _err(f"Invalid argument: {exc}")

    if capex <= 0:
        _err("capex must be > 0")
    if it_load_mw <= 0:
        _err("it_load_mw must be > 0")
    if not (0.0 <= renewable_pct <= 100.0):
        _err("renewable_percentage must be between 0 and 100")
    if new_jobs < 0:
        _err("new_jobs_created must be >= 0")

    eligible_incentives = []
    notes = []

    # ── Federal ITC: 30% on renewable energy equipment ───────────────────────
    if renewable_pct > 0:
        renewable_capex = capex * (renewable_pct / 100.0)
        itc_amount = renewable_capex * 0.30
        eligible_incentives.append(_incentive(
            name="Federal Investment Tax Credit (ITC) – Clean Energy",
            itype="federal_tax_credit",
            amount=itc_amount,
            capex=capex,
            requirements=[
                "Eligible renewable energy equipment (solar panels, wind turbines, battery storage)",
                f"Renewable portion of project: {renewable_pct:.1f}% of capex",
                "Equipment must be placed in service during tax year",
                "IRS Form 3468 required",
            ],
            application_process="Claim on IRS Form 3468 with annual federal tax return. "
                                 "Pre-filing registration required via IRS Energy Credits Online portal (post-IRA).",
            timeline_months=12,
        ))
    else:
        notes.append(
            "Federal ITC (30%) not applicable: renewable_percentage is 0. "
            "Consider adding solar or wind capacity to qualify."
        )

    # ── Federal 179D: $5/sqft energy-efficient commercial buildings ───────────
    # 1 MW ≈ 5,000 sqft estimate
    sqft_estimate = it_load_mw * 5_000.0
    deduction_179d = sqft_estimate * 5.0  # $5/sqft
    # 179D is a deduction, not a credit; effective value at 21% corporate rate
    effective_179d = deduction_179d * 0.21
    eligible_incentives.append(_incentive(
        name="Federal 179D Energy-Efficient Commercial Building Deduction",
        itype="federal_tax_credit",
        amount=effective_179d,
        capex=capex,
        requirements=[
            "Building must achieve 25%+ energy savings vs ASHRAE 90.1 baseline",
            "Qualified energy assessor certification required",
            f"Estimated building size: {sqft_estimate:,.0f} sqft (based on {it_load_mw} MW IT load)",
            "Deduction up to $5.00/sqft for maximum savings (50%+ reduction)",
        ],
        application_process="Claim as business deduction on federal tax return. "
                             "Requires energy model certification by a qualified engineer/RESNET rater.",
        timeline_months=18,
    ))
    notes.append(
        f"179D effective value shown at 21% corporate rate on ${deduction_179d:,.0f} deduction "
        f"({sqft_estimate:,.0f} sqft × $5/sqft)."
    )

    # ── State-Specific Incentives ─────────────────────────────────────────────
    state_found = True

    if state == "TX":
        # 10% capex if 20+ jobs and $150M+ investment
        if capex >= 150_000_000 and new_jobs >= 20:
            tx_amount = capex * 0.10
            eligible_incentives.append(_incentive(
                name="Texas Data Center Sales and Use Tax Exemption (Chapter 151)",
                itype="state_tax_exemption",
                amount=tx_amount,
                capex=capex,
                requirements=[
                    "Minimum $150M capital investment",
                    f"Minimum 20 new qualifying jobs (provided: {new_jobs})",
                    "Must register with Texas Comptroller",
                    "Qualifying computer hardware, software, electricity",
                ],
                application_process="Apply to Texas Comptroller of Public Accounts for qualified data center status. "
                                     "Pre-application meeting with Economic Development & Tourism recommended.",
                timeline_months=6,
            ))
        else:
            notes.append(
                f"Texas data center exemption requires $150M+ investment (provided: ${capex:,.0f}) "
                f"AND 20+ jobs (provided: {new_jobs}). Threshold not met."
            )

    elif state == "VA":
        # Full sales tax exemption on servers >$150M investment
        if capex >= 150_000_000:
            # Virginia sales tax is 5.3%; estimate 40% of capex is taxable equipment
            taxable_equipment = capex * 0.40
            va_sales_tax_rate = 0.053
            va_amount = taxable_equipment * va_sales_tax_rate
            eligible_incentives.append(_incentive(
                name="Virginia Data Center Sales Tax Exemption (§ 58.1-609.3)",
                itype="state_tax_exemption",
                amount=va_amount,
                capex=capex,
                requirements=[
                    "Minimum $150M capital investment",
                    "Data center must be located in Virginia",
                    "Exempt equipment: servers, power/cooling infrastructure",
                    "Annual reporting to VA Department of Taxation",
                ],
                application_process="File Form ST-11A with Virginia Department of Taxation. "
                                     "Obtain exemption certificate prior to equipment purchases.",
                timeline_months=3,
            ))
        else:
            notes.append(
                f"Virginia sales tax exemption requires $150M+ investment (provided: ${capex:,.0f})."
            )

    elif state == "NC":
        # 80% machinery exemption + job tax credits ($3,000–$25,000/job)
        machinery_value = capex * 0.50  # estimate 50% of capex is machinery
        nc_exemption = machinery_value * 0.80 * 0.0475  # NC sales tax 4.75%
        eligible_incentives.append(_incentive(
            name="North Carolina Machinery & Equipment Sales Tax Exemption (80%)",
            itype="state_tax_exemption",
            amount=nc_exemption,
            capex=capex,
            requirements=[
                "Data center qualifying under G.S. § 105-164.13(55)",
                "Machinery and equipment used in data center operations",
                "80% of sales tax on qualifying purchases exempt",
            ],
            application_process="File Form E-595E (Streamlined Sales Tax Certificate of Exemption) "
                                 "with North Carolina Department of Revenue.",
            timeline_months=3,
        ))
        if new_jobs > 0:
            # Job tax credit: $3,000–$25,000/job depending on county tier
            avg_job_credit = 12_000.0  # midpoint of range
            nc_job_credit = new_jobs * avg_job_credit
            eligible_incentives.append(_incentive(
                name="North Carolina Job Development Investment Grant (JDIG)",
                itype="state_tax_exemption",
                amount=nc_job_credit,
                capex=capex,
                requirements=[
                    f"New full-time jobs created: {new_jobs}",
                    "Jobs must meet county wage standard (avg. $3,000–$25,000/job by tier)",
                    "Must apply before project begins",
                    "Annual certification of job retention",
                ],
                application_process="Apply to NC Department of Commerce Economic Development. "
                                     "Committee approval required before construction begins.",
                timeline_months=9,
            ))

    elif state == "GA":
        # Job tax credit ($3,750–$17,500/job) + sales tax exemption on servers
        if new_jobs > 0:
            avg_ga_credit = 8_000.0  # conservative midpoint
            ga_job_credit = new_jobs * avg_ga_credit
            eligible_incentives.append(_incentive(
                name="Georgia Job Tax Credit (O.C.G.A. § 48-7-40)",
                itype="state_tax_exemption",
                amount=ga_job_credit,
                capex=capex,
                requirements=[
                    f"New full-time jobs: {new_jobs} (minimum 2–10 depending on county tier)",
                    "Jobs must pay above county average wage",
                    "Credit: $3,750–$17,500 per job depending on tier designation",
                    "5-year carry-forward allowed",
                ],
                application_process="File Form IT-CA with Georgia Department of Revenue. "
                                     "Coordinate with Georgia Department of Economic Development.",
                timeline_months=6,
            ))
        # Sales tax exemption on servers
        server_value = capex * 0.35  # estimate 35% of capex is servers
        ga_sales_tax_rate = 0.04  # state rate (4%)
        ga_server_exemption = server_value * ga_sales_tax_rate
        eligible_incentives.append(_incentive(
            name="Georgia Computer Equipment Sales Tax Exemption",
            itype="state_tax_exemption",
            amount=ga_server_exemption,
            capex=capex,
            requirements=[
                "Qualifying computer equipment used in data center",
                "Must be used primarily for data processing",
                "Georgia sales tax exemption on eligible purchases",
            ],
            application_process="File Form ST-5 (Certificate of Exemption) with Georgia DOR. "
                                 "Maintain records for audit purposes.",
            timeline_months=2,
        ))

    elif state == "AZ":
        # TPT exemption on computer hardware
        hardware_value = capex * 0.45
        az_tpt_rate = 0.056
        az_amount = hardware_value * az_tpt_rate
        eligible_incentives.append(_incentive(
            name="Arizona Transaction Privilege Tax (TPT) Exemption – Computer Hardware",
            itype="state_tax_exemption",
            amount=az_amount,
            capex=capex,
            requirements=[
                "Computer hardware used in data center operations",
                "Arizona TPT classification: qualifying equipment",
                "Must apply for exemption certificate prior to purchases",
                "Annual reporting to Arizona DOR",
            ],
            application_process="Obtain exemption certificate from Arizona Department of Revenue. "
                                 "File TPT return with exemption applied.",
            timeline_months=3,
        ))

    elif state == "OR":
        # No state income tax + enterprise zone property tax exemption
        # Enterprise zone: up to 5 years property tax exemption
        # Property tax savings estimate: 1.5% of capex annually × 5 years
        property_tax_annual = capex * 0.015
        or_ez_amount = property_tax_annual * 5.0
        eligible_incentives.append(_incentive(
            name="Oregon Enterprise Zone Property Tax Exemption",
            itype="state_tax_exemption",
            amount=or_ez_amount,
            capex=capex,
            requirements=[
                "Data center must be located within a designated Oregon Enterprise Zone",
                "3–5 year exemption (up to 15 years for long-term rural zones)",
                "Employment commitment may be required",
                "Sponsor agreement with local government",
            ],
            application_process="Apply to local Enterprise Zone manager (city/county). "
                                 "Authorization required before construction. File with Oregon DOR.",
            timeline_months=6,
        ))
        notes.append(
            "Oregon has no state corporate income tax, providing additional ongoing tax advantage "
            "not quantified in one-time savings above."
        )

    elif state == "NV":
        # Sales tax abatement 75% for 2 years + property tax 75% for up to 10 years
        # Nevada sales tax 6.85%; estimate 40% of capex is taxable
        nv_taxable = capex * 0.40
        nv_sales_savings = nv_taxable * 0.0685 * 0.75
        eligible_incentives.append(_incentive(
            name="Nevada Sales Tax Abatement – Data Center Equipment (75% for 2 years)",
            itype="state_tax_exemption",
            amount=nv_sales_savings,
            capex=capex,
            requirements=[
                "Minimum $1M capital investment in Nevada",
                "Qualifying computer equipment and software",
                "Application to Nevada Governor's Office of Economic Development (GOED)",
                "75% abatement on state and local sales/use tax",
            ],
            application_process="Apply to Nevada GOED for abatement approval before equipment purchase. "
                                 "Board of Economic Development approval required.",
            timeline_months=4,
        ))
        # Property tax abatement: estimate 0.75% annual rate, 75% reduction for 10 years
        nv_prop_tax_annual = capex * 0.0075
        nv_prop_savings = nv_prop_tax_annual * 0.75 * 10.0
        eligible_incentives.append(_incentive(
            name="Nevada Property Tax Abatement – Data Center (75% for up to 10 years)",
            itype="state_tax_exemption",
            amount=nv_prop_savings,
            capex=capex,
            requirements=[
                "Minimum $25M capital investment",
                "Data center operations qualifying under NRS 360.750",
                "10-year abatement at 75% of assessed property tax",
                "Annual compliance reporting",
            ],
            application_process="Apply through Nevada GOED. Requires Nevada Tax Commission approval. "
                                 "Submit Form APP-01 with business plan.",
            timeline_months=6,
        ))

    elif state == "OH":
        # Commercial Activity Tax (CAT) exemption + data center equipment exemption
        # Ohio sales tax 5.75% on eligible equipment
        oh_equipment = capex * 0.40
        oh_sales_savings = oh_equipment * 0.0575
        eligible_incentives.append(_incentive(
            name="Ohio Data Center Sales Tax Exemption (ORC § 5739.02)",
            itype="state_tax_exemption",
            amount=oh_sales_savings,
            capex=capex,
            requirements=[
                "Qualifying data center equipment (servers, storage, network gear)",
                "Data center must have $100M+ in capital investment over 3 years",
                "Ohio Tax Commissioner certification required",
                "Equipment used to provide internet data hosting services",
            ],
            application_process="Apply to Ohio Department of Taxation for exemption certificate. "
                                 "File Consumer Use Tax Return (UST 1) with exemption claimed.",
            timeline_months=4,
        ))

    elif state == "IA":
        # Sales tax exemption + property tax abatement
        ia_equipment = capex * 0.45
        ia_sales_savings = ia_equipment * 0.06  # Iowa 6% sales tax
        eligible_incentives.append(_incentive(
            name="Iowa Data Center Sales Tax Exemption (Iowa Code § 423.3(91))",
            itype="state_tax_exemption",
            amount=ia_sales_savings,
            capex=capex,
            requirements=[
                "Minimum $200M capital investment in Iowa",
                "Qualifying data center equipment purchases",
                "Must create or retain 10 qualifying jobs",
                "Iowa Economic Development Authority (IEDA) certification",
            ],
            application_process="Apply to Iowa Economic Development Authority. "
                                 "Complete Data Center Tax Incentive application. Approval before purchases required.",
            timeline_months=5,
        ))
        # Property tax abatement: estimate 1% annual rate, 10-year abatement
        ia_prop_savings = capex * 0.01 * 10.0
        eligible_incentives.append(_incentive(
            name="Iowa Property Tax Abatement – Data Center (10-Year)",
            itype="state_tax_exemption",
            amount=ia_prop_savings,
            capex=capex,
            requirements=[
                "Minimum $200M capital investment",
                "IEDA certification as qualifying data center",
                "10-year property tax abatement on qualifying improvements",
            ],
            application_process="Coordinated with IEDA application. Local assessor notification required.",
            timeline_months=6,
        ))

    elif state == "SC":
        # Job development credit + property tax fee-in-lieu
        if new_jobs > 0:
            sc_job_credit = new_jobs * 1_500.0  # conservative SC job credit estimate
            eligible_incentives.append(_incentive(
                name="South Carolina Job Development Credit",
                itype="state_tax_exemption",
                amount=sc_job_credit,
                capex=capex,
                requirements=[
                    f"New full-time jobs: {new_jobs}",
                    "Jobs must pay 110%+ of county average wage",
                    "SC Commerce approval required",
                    "Credit against withholding taxes paid on new employee wages",
                ],
                application_process="Apply to South Carolina Department of Commerce. "
                                     "Executed Fee Agreement required before project begins.",
                timeline_months=6,
            ))
        # Fee-in-lieu of property tax (FILOT): negotiate reduced effective rate
        # Typical FILOT: 6% assessment ratio vs 10.5% standard → ~43% reduction
        # Property tax estimate: 1% of capex annually
        sc_prop_annual = capex * 0.01
        sc_filot_savings = sc_prop_annual * 0.43 * 20.0  # 20-year FILOT typical
        eligible_incentives.append(_incentive(
            name="South Carolina Fee-In-Lieu of Property Tax (FILOT)",
            itype="state_tax_exemption",
            amount=sc_filot_savings,
            capex=capex,
            requirements=[
                "Minimum $2.5M capital investment",
                "Agreement with county council",
                "Reduced assessment ratio: 6% vs standard 10.5%",
                "Typically structured as 20-30 year agreement",
            ],
            application_process="Negotiate FILOT Agreement with county council. "
                                 "Requires multi-stage approval including county ordinance.",
            timeline_months=9,
        ))

    else:
        state_found = False
        # Generic WOTC + standard depreciation for unlisted states
        if new_jobs > 0:
            wotc_amount = new_jobs * 1_500.0  # conservative average
            eligible_incentives.append(_incentive(
                name="Federal Work Opportunity Tax Credit (WOTC)",
                itype="federal_tax_credit",
                amount=wotc_amount,
                capex=capex,
                requirements=[
                    "Hire from qualifying target groups (veterans, long-term unemployed, etc.)",
                    f"Estimated for {new_jobs} new hires",
                    "Pre-screening (IRS Form 8850) within 28 days of hire",
                    "Department of Labor certification required",
                ],
                application_process="Submit IRS Form 8850 and ETA Form 9061 to state workforce agency "
                                     "within 28 days of hire. Claim credit on Form 5884.",
                timeline_months=6,
            ))
        notes.append(
            f"State '{state}' not in specialized program database. "
            "Consult state economic development agency for available incentives. "
            "Common programs include sales tax exemptions on server equipment, "
            "enterprise zones, and job creation credits."
        )

    # ── Utility Rebates ───────────────────────────────────────────────────────
    # Demand response: $50–$150/kW of enrolled capacity
    it_load_kw = it_load_mw * 1000.0
    dr_rate_per_kw = 100.0  # midpoint $50–$150
    dr_amount = it_load_kw * dr_rate_per_kw
    eligible_incentives.append(_incentive(
        name="Utility Demand Response Program Enrollment Incentive",
        itype="utility_rebate",
        amount=dr_amount,
        capex=capex,
        requirements=[
            "Enrollment in local utility demand response program",
            "Ability to shed or curtail load within 10–30 minutes of notice",
            "Backup generation or flexible load required",
            f"Estimated sheddable capacity: {it_load_kw:,.0f} kW",
        ],
        application_process="Contact local utility account manager for demand response enrollment. "
                             "Programs typically available through ISO/RTO or directly through utility.",
        timeline_months=3,
    ))

    # Energy efficiency rebate: $0.10–$0.30/kWh saved
    # Estimate 10% kWh savings vs baseline PUE of 2.0
    baseline_kwh_per_year = it_load_kw * 2.0 * 8_760.0
    efficient_kwh_per_year = it_load_kw * 1.5 * 8_760.0  # assume PUE 1.5 target
    kwh_saved = baseline_kwh_per_year - efficient_kwh_per_year
    ee_rate = 0.15  # midpoint $0.10–$0.30
    ee_amount = kwh_saved * ee_rate
    eligible_incentives.append(_incentive(
        name="Utility Energy Efficiency Rebate (Cooling/Lighting Upgrades)",
        itype="utility_rebate",
        amount=ee_amount,
        capex=capex,
        requirements=[
            "Energy audit required before project",
            "Must demonstrate kWh savings vs baseline",
            f"Estimated savings: {kwh_saved:,.0f} kWh/yr (PUE 2.0 → 1.5)",
            "Rebate: $0.10–$0.30/kWh saved (first-year savings basis)",
            "Pre-approval from utility before equipment installation",
        ],
        application_process="Submit utility rebate application with energy audit and equipment specs. "
                             "Post-installation verification required. Contact utility energy efficiency team.",
        timeline_months=4,
    ))

    # ── USDA REAP (Rural Energy) ──────────────────────────────────────────────
    notes.append(
        "USDA Rural Energy for America Program (REAP) grants up to 25% of project cost "
        "are available if the project site qualifies as a rural area (population < 50,000). "
        "Contact your local USDA Rural Development office to determine eligibility."
    )
    # Add as conditional
    reap_amount = capex * 0.25
    eligible_incentives.append(_incentive(
        name="USDA REAP Grant – Rural Renewable Energy (up to 25% of project cost)",
        itype="grant",
        amount=reap_amount,
        capex=capex,
        requirements=[
            "Project must be located in a rural area (population < 50,000)",
            "Renewable energy system or energy efficiency improvement",
            "Agricultural producer OR rural small business eligibility",
            "Competitive application process; not guaranteed",
            "Match funding typically required",
        ],
        application_process="Apply through USDA Rural Development State Office. "
                             "Applications accepted on rolling basis. Contact state office for current deadlines.",
        timeline_months=12,
    ))

    # ── Totals ────────────────────────────────────────────────────────────────
    total_potential_savings = sum(i["amount_dollars"] for i in eligible_incentives)
    effective_capex = capex - total_potential_savings

    # ── Top Recommendation ────────────────────────────────────────────────────
    # Sort by amount descending for recommendation
    top = sorted(eligible_incentives, key=lambda x: x["amount_dollars"], reverse=True)
    top_rec_name = top[0]["name"] if top else "No specific incentive identified"
    top_rec_amount = top[0]["amount_dollars"] if top else 0.0

    top_recommendation = (
        f"Prioritize '{top_rec_name}' (${top_rec_amount:,.0f} estimated value). "
        f"Total identified incentives: ${total_potential_savings:,.0f} "
        f"({total_potential_savings/capex*100:.1f}% of CapEx). "
        "Engage a tax incentive consultant and state economic development agency early — "
        "many programs require pre-approval before construction begins."
    )

    output = {
        "input": {
            "state": state,
            "capex": capex,
            "it_load_mw": it_load_mw,
            "renewable_percentage": renewable_pct,
            "new_jobs_created": new_jobs,
        },
        "eligible_incentives": eligible_incentives,
        "total_potential_savings": round(total_potential_savings, 2),
        "effective_capex_after_incentives": round(effective_capex, 2),
        "top_recommendation": top_recommendation,
        "notes": notes,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
