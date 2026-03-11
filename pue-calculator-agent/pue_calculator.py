#!/usr/bin/env python3
"""
PUE Calculator Agent  v1.0
============================
Calculates Power Usage Effectiveness (PUE) and comprehensive data center
efficiency metrics per The Green Grid TGG-IDC-1 standard.

    PUE = Total Facility Power / IT Equipment Power
    DCiE = 1 / PUE  (expressed as %)

Data: The Green Grid whitepapers, Uptime Institute Global Data Center Survey
2023 (average PUE 1.58), EPA ENERGY STAR Data Center guidance, ASHRAE TC 9.9.

Usage:
    python pue_calculator.py <it_load_kw>
        [cooling_load_kw|auto]
        [ups_efficiency_pct]
        [pdu_loss_pct]
        [lighting_kw|auto]
        [cooling_type]
        [electricity_rate_per_kwh]

    it_load_kw              : IT equipment load in kW (1–500000)
    cooling_load_kw|auto    : Measured cooling load, or "auto" to estimate (default: auto)
    ups_efficiency_pct      : UPS efficiency % (50–100, default: 94)
    pdu_loss_pct            : PDU/cabling loss % of IT load (0–20, default: 1.0)
    lighting_kw|auto        : Lighting load in kW, or "auto" to estimate (default: auto)
    cooling_type            : air_cooled | water_cooled | free_cooling |
                              hybrid | liquid_immersion  (default: air_cooled)
    electricity_rate_per_kwh: Blended electricity rate $/kWh (default: 0.07)

Output: JSON to stdout, diagnostics to stderr.
"""

import sys, json, math


# ═══════════════════════════════════════════════════════════════════════════════
# PUE rating thresholds (per Uptime Institute / Green Grid guidance)
# ═══════════════════════════════════════════════════════════════════════════════

PUE_RATINGS = [
    (1.0,  1.2,  "excellent",     "Excellent — hyperscale / best-in-class"),
    (1.2,  1.4,  "good",          "Good — modern efficient data center"),
    (1.4,  1.6,  "average",       "Average — meets industry median"),
    (1.6,  2.0,  "below_average", "Below average — improvement opportunities exist"),
    (2.0, 99.0,  "poor",          "Poor — significant inefficiency; priority for remediation"),
]

# Cooling overhead ratio by cooling type (fraction of IT load)
COOLING_RATIOS = {
    "air_cooled":        0.45,   # Traditional CRAC/CRAH; typical enterprise DC
    "water_cooled":      0.30,   # Chilled water with cooling towers
    "free_cooling":      0.15,   # Economizer/adiabatic; climate-dependent
    "hybrid":            0.25,   # Mix of mechanical and free cooling
    "liquid_immersion":  0.07,   # Single-phase or two-phase immersion
}

COOLING_TYPE_LABELS = {
    "air_cooled":       "Air-cooled (CRAC/CRAH)",
    "water_cooled":     "Water-cooled (chilled water / cooling towers)",
    "free_cooling":     "Free cooling / economizer",
    "hybrid":           "Hybrid (mechanical + economizer)",
    "liquid_immersion": "Liquid / immersion cooling",
}

# EPA eGRID 2023 national average: 0.386 kg CO2e/kWh
CO2_KG_PER_KWH = 0.386

# Uptime Institute 2023 global average PUE
INDUSTRY_AVG_PUE = 1.58

# Best-practice target
BEST_PRACTICE_PUE = 1.20

# Hours per year
HOURS_YR = 8_760


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def rate_pue(pue: float) -> tuple:
    for lo, hi, key, label in PUE_RATINGS:
        if lo <= pue < hi:
            return key, label
    return "poor", "Poor — significant inefficiency"


def estimate_cooling(it_load_kw: float, cooling_type: str) -> float:
    ratio = COOLING_RATIOS.get(cooling_type, 0.45)
    return round(it_load_kw * ratio, 1)


def estimate_lighting(it_load_kw: float) -> float:
    """~0.5% of IT load; floor 3 kW, ceiling 80 kW."""
    return round(max(3.0, min(80.0, it_load_kw * 0.005)), 1)


# ═══════════════════════════════════════════════════════════════════════════════
# Core calculation
# ═══════════════════════════════════════════════════════════════════════════════

def calculate_pue(
    it_load_kw:              float,
    cooling_load_kw:         float | None,
    ups_efficiency_pct:      float,
    pdu_loss_pct:            float,
    lighting_kw:             float | None,
    cooling_type:            str,
    electricity_rate_per_kwh: float,
) -> dict:

    # ── Derive missing inputs ─────────────────────────────────────────────────
    if cooling_load_kw is None:
        cooling_load_kw = estimate_cooling(it_load_kw, cooling_type)
        cooling_estimated = True
    else:
        cooling_estimated = False

    if lighting_kw is None:
        lighting_kw = estimate_lighting(it_load_kw)
        lighting_estimated = True
    else:
        lighting_estimated = False

    # ── Power chain losses ────────────────────────────────────────────────────
    # IT servers draw it_load_kw.
    # Upstream: UPS must supply it_load_kw / ups_efficiency to deliver it_load_kw.
    ups_eff      = ups_efficiency_pct / 100.0
    ups_input_kw = it_load_kw / ups_eff          # power drawn from utility for IT path
    ups_losses_kw = ups_input_kw - it_load_kw    # heat dissipated by UPS

    pdu_losses_kw = it_load_kw * (pdu_loss_pct / 100.0)

    # BMS, security, misc: ~0.5% of IT load (floor 2 kW)
    misc_kw = max(2.0, it_load_kw * 0.005)

    total_facility_kw = (
        ups_input_kw      # IT load + UPS losses
        + pdu_losses_kw
        + cooling_load_kw
        + lighting_kw
        + misc_kw
    )

    pue   = round(total_facility_kw / it_load_kw, 4)
    dcie  = round(100.0 / pue, 2)
    rating_key, rating_label = rate_pue(pue)

    # ── Annual energy ─────────────────────────────────────────────────────────
    it_kwh_yr    = it_load_kw    * HOURS_YR
    total_kwh_yr = total_facility_kw * HOURS_YR
    overhead_kwh = total_kwh_yr - it_kwh_yr

    # ── Annual cost ───────────────────────────────────────────────────────────
    total_cost_usd    = round(total_kwh_yr    * electricity_rate_per_kwh)
    it_cost_usd       = round(it_kwh_yr       * electricity_rate_per_kwh)
    overhead_cost_usd = round(overhead_kwh    * electricity_rate_per_kwh)

    # ── Carbon ───────────────────────────────────────────────────────────────
    annual_co2_tonnes      = round(total_kwh_yr * CO2_KG_PER_KWH / 1000.0, 1)
    overhead_co2_tonnes    = round(overhead_kwh * CO2_KG_PER_KWH / 1000.0, 1)

    # ── Benchmarks ───────────────────────────────────────────────────────────
    # vs. industry average PUE 1.58
    industry_total_kw    = it_load_kw * INDUSTRY_AVG_PUE
    industry_total_kwh   = industry_total_kw * HOURS_YR
    vs_industry_kwh_delta = round(industry_total_kwh - total_kwh_yr)
    vs_industry_cost      = round(vs_industry_kwh_delta * electricity_rate_per_kwh)
    vs_industry_co2       = round(vs_industry_kwh_delta * CO2_KG_PER_KWH / 1000.0, 1)

    # vs. best practice PUE 1.20
    best_total_kw      = it_load_kw * BEST_PRACTICE_PUE
    best_total_kwh     = best_total_kw * HOURS_YR
    vs_best_kwh_delta  = round(total_kwh_yr - best_total_kwh)
    vs_best_cost       = round(vs_best_kwh_delta * electricity_rate_per_kwh)

    # ── Improvement scenarios ─────────────────────────────────────────────────
    scenarios = []

    # Scenario: upgrade UPS to 96%
    if ups_efficiency_pct < 96:
        new_ups_input  = it_load_kw / 0.96
        new_total      = total_facility_kw - ups_input_kw + new_ups_input
        new_pue        = round(new_total / it_load_kw, 4)
        saved_kw       = total_facility_kw - new_total
        saved_kwh      = round(saved_kw * HOURS_YR)
        saved_usd      = round(saved_kwh * electricity_rate_per_kwh)
        scenarios.append({
            "name":             "Upgrade UPS to 96% efficiency",
            "new_pue":          new_pue,
            "pue_improvement":  round(pue - new_pue, 4),
            "annual_savings_kwh": saved_kwh,
            "annual_savings_usd": saved_usd,
            "notes": "Modern double-conversion UPS units achieve 95–98% efficiency (ECO mode can reach 99%).",
        })

    # Scenario: UPS ECO mode (98%)
    if ups_efficiency_pct < 98:
        new_ups_input  = it_load_kw / 0.98
        new_total      = total_facility_kw - ups_input_kw + new_ups_input
        new_pue        = round(new_total / it_load_kw, 4)
        saved_kw       = total_facility_kw - new_total
        saved_kwh      = round(saved_kw * HOURS_YR)
        saved_usd      = round(saved_kwh * electricity_rate_per_kwh)
        scenarios.append({
            "name":             "UPS ECO / high-efficiency mode (98%)",
            "new_pue":          new_pue,
            "pue_improvement":  round(pue - new_pue, 4),
            "annual_savings_kwh": saved_kwh,
            "annual_savings_usd": saved_usd,
            "notes": "ECO mode bypasses inverter under stable grid; verify load criticality before enabling.",
        })

    # Scenario: hot/cold aisle containment (reduces cooling by 15%)
    if cooling_load_kw > it_load_kw * 0.10:
        new_cooling    = cooling_load_kw * 0.85
        new_total      = total_facility_kw - cooling_load_kw + new_cooling
        new_pue        = round(new_total / it_load_kw, 4)
        saved_kw       = total_facility_kw - new_total
        saved_kwh      = round(saved_kw * HOURS_YR)
        saved_usd      = round(saved_kwh * electricity_rate_per_kwh)
        scenarios.append({
            "name":             "Implement hot/cold aisle containment",
            "new_pue":          new_pue,
            "pue_improvement":  round(pue - new_pue, 4),
            "annual_savings_kwh": saved_kwh,
            "annual_savings_usd": saved_usd,
            "notes": "Containment typically reduces cooling energy 15–30% by eliminating hot/cold air mixing.",
        })

    # Scenario: raise supply air temperature to ASHRAE A2 (80.6°F)
    if cooling_type in ("air_cooled", "hybrid") and cooling_load_kw > it_load_kw * 0.10:
        new_cooling    = cooling_load_kw * 0.88  # ~12% reduction from warmer setpoint
        new_total      = total_facility_kw - cooling_load_kw + new_cooling
        new_pue        = round(new_total / it_load_kw, 4)
        saved_kw       = total_facility_kw - new_total
        saved_kwh      = round(saved_kw * HOURS_YR)
        saved_usd      = round(saved_kwh * electricity_rate_per_kwh)
        scenarios.append({
            "name":             "Raise supply air temp to ASHRAE A2 (80.6°F / 27°C)",
            "new_pue":          new_pue,
            "pue_improvement":  round(pue - new_pue, 4),
            "annual_savings_kwh": saved_kwh,
            "annual_savings_usd": saved_usd,
            "notes": "Every 1°C rise in supply temp reduces cooling energy ~3–4%. Modern servers support 80°F+.",
        })

    # Scenario: switch to water cooling (if currently air-cooled)
    if cooling_type == "air_cooled":
        new_cooling    = estimate_cooling(it_load_kw, "water_cooled")
        new_total      = total_facility_kw - cooling_load_kw + new_cooling
        new_pue        = round(new_total / it_load_kw, 4)
        saved_kw       = total_facility_kw - new_total
        saved_kwh      = round(saved_kw * HOURS_YR)
        saved_usd      = round(saved_kwh * electricity_rate_per_kwh)
        capex_est      = round(it_load_kw * 200)  # ~$200/kW for chilled water retrofit
        payback_yrs    = round(capex_est / saved_usd, 1) if saved_usd > 0 else None
        scenarios.append({
            "name":               "Convert to water-cooled / chilled water system",
            "new_pue":            new_pue,
            "pue_improvement":    round(pue - new_pue, 4),
            "annual_savings_kwh": saved_kwh,
            "annual_savings_usd": saved_usd,
            "estimated_capex_usd": capex_est,
            "simple_payback_years": payback_yrs,
            "notes": "Chilled water reduces cooling overhead from ~45% to ~30% of IT load. Best ROI for loads >500 kW.",
        })

    # Scenario: add economizer/free cooling (if not already)
    if cooling_type not in ("free_cooling", "liquid_immersion"):
        new_cooling    = estimate_cooling(it_load_kw, "free_cooling")
        new_total      = total_facility_kw - cooling_load_kw + new_cooling
        new_pue        = round(new_total / it_load_kw, 4)
        saved_kw       = total_facility_kw - new_total
        saved_kwh      = round(saved_kw * HOURS_YR)
        saved_usd      = round(saved_kwh * electricity_rate_per_kwh)
        capex_est      = round(it_load_kw * 150)
        payback_yrs    = round(capex_est / saved_usd, 1) if saved_usd > 0 else None
        scenarios.append({
            "name":               "Add economizer / free cooling (suitable climates)",
            "new_pue":            new_pue,
            "pue_improvement":    round(pue - new_pue, 4),
            "annual_savings_kwh": saved_kwh,
            "annual_savings_usd": saved_usd,
            "estimated_capex_usd": capex_est,
            "simple_payback_years": payback_yrs,
            "notes": ("Best in climates with ≥4,000 hrs/yr below 55°F (Seattle, Chicago, Denver, Dublin). "
                      "Can reduce cooling energy 40–70% in cool climates."),
        })

    # ── Recommendations ───────────────────────────────────────────────────────
    recs = []

    if pue >= 2.0:
        recs.append("PRIORITY: PUE ≥ 2.0 indicates severe inefficiency. Immediate audit of cooling "
                    "infrastructure and power chain is recommended before any capacity expansion.")
    if pue >= 1.6:
        recs.append("Implement hot/cold aisle containment — highest ROI first step for air-cooled facilities. "
                    "Typical payback 6–18 months.")
    if ups_efficiency_pct < 94:
        recs.append(f"UPS efficiency is {ups_efficiency_pct}% — modern units achieve 94–98%. "
                    "Replacing aging UPS can reduce losses significantly.")
    if ups_efficiency_pct < 98:
        recs.append("Evaluate UPS ECO/high-efficiency mode. When grid quality permits, this can push "
                    "effective UPS efficiency to 98–99%.")
    if pdu_loss_pct > 2:
        recs.append(f"PDU losses are {pdu_loss_pct}% — review cable management, PDU age, and "
                    "branching circuit load balancing. Target <1.5%.")
    if cooling_type == "air_cooled" and it_load_kw >= 500:
        recs.append("For loads ≥500 kW, water-cooled chilled water systems typically achieve 30–40% "
                    "lower cooling overhead than air-cooled CRAC/CRAH units.")
    if cooling_type in ("air_cooled", "water_cooled") and it_load_kw >= 200:
        recs.append("Evaluate free cooling / economizer hours for your climate zone. "
                    "Even partial economization (1,000–4,000 hrs/yr) can reduce annual cooling costs 15–40%.")
    if pue <= 1.4:
        recs.append("PUE is well-optimized. Focus on IT equipment efficiency (server utilization, "
                    "virtualization density, storage tiering) for further gains — these don't appear in PUE.")
    if not recs:
        recs.append("Facility is performing at industry average. Review improvement scenarios above for "
                    "prioritized capex opportunities.")

    # ── Assemble output ───────────────────────────────────────────────────────
    return {
        "input": {
            "it_load_kw":               it_load_kw,
            "cooling_load_kw":          cooling_load_kw,
            "cooling_load_estimated":   cooling_estimated,
            "ups_efficiency_pct":       ups_efficiency_pct,
            "pdu_loss_pct":             pdu_loss_pct,
            "lighting_kw":              lighting_kw,
            "lighting_estimated":       lighting_estimated,
            "cooling_type":             cooling_type,
            "cooling_type_label":       COOLING_TYPE_LABELS.get(cooling_type, cooling_type),
            "electricity_rate_per_kwh": electricity_rate_per_kwh,
        },
        "power_breakdown_kw": {
            "it_load":        round(it_load_kw, 2),
            "ups_losses":     round(ups_losses_kw, 2),
            "pdu_losses":     round(pdu_losses_kw, 2),
            "cooling":        round(cooling_load_kw, 2),
            "lighting":       round(lighting_kw, 2),
            "misc_bms":       round(misc_kw, 2),
            "total_facility": round(total_facility_kw, 2),
        },
        "power_breakdown_pct": {
            "it_load":  round(it_load_kw    / total_facility_kw * 100, 1),
            "ups_losses": round(ups_losses_kw / total_facility_kw * 100, 1),
            "pdu_losses": round(pdu_losses_kw / total_facility_kw * 100, 1),
            "cooling":  round(cooling_load_kw / total_facility_kw * 100, 1),
            "lighting": round(lighting_kw     / total_facility_kw * 100, 1),
            "misc_bms": round(misc_kw         / total_facility_kw * 100, 1),
        },
        "pue": {
            "value":        pue,
            "dcie_pct":     dcie,
            "rating":       rating_key,
            "rating_label": rating_label,
            "industry_avg": INDUSTRY_AVG_PUE,
            "best_practice": BEST_PRACTICE_PUE,
            "vs_industry_avg": round(pue - INDUSTRY_AVG_PUE, 4),
            "vs_best_practice": round(pue - BEST_PRACTICE_PUE, 4),
        },
        "annual_energy": {
            "it_kwh":       round(it_kwh_yr),
            "total_kwh":    round(total_kwh_yr),
            "overhead_kwh": round(overhead_kwh),
            "overhead_pct": round(overhead_kwh / total_kwh_yr * 100, 1),
        },
        "annual_cost_usd": {
            "total":    total_cost_usd,
            "it":       it_cost_usd,
            "overhead": overhead_cost_usd,
            "per_kw_it_per_year": round(total_cost_usd / it_load_kw),
        },
        "carbon": {
            "annual_co2_tonnes":     annual_co2_tonnes,
            "overhead_co2_tonnes":   overhead_co2_tonnes,
            "grid_factor_kg_per_kwh": CO2_KG_PER_KWH,
            "note": "Based on US national average grid emissions (EPA eGRID 2023). Use regional factor for site-specific analysis.",
        },
        "benchmarks": {
            "vs_industry_avg_pue_1_58": {
                "kwh_delta":    vs_industry_kwh_delta,
                "cost_delta_usd": vs_industry_cost,
                "co2_delta_tonnes": vs_industry_co2,
                "interpretation": (
                    f"{'Saves' if vs_industry_kwh_delta > 0 else 'Consumes'} "
                    f"{abs(vs_industry_kwh_delta):,} kWh/yr "
                    f"({'better' if vs_industry_kwh_delta > 0 else 'worse'} than industry average)"
                ),
            },
            "gap_to_best_practice_1_20": {
                "kwh_gap":    max(0, vs_best_kwh_delta),
                "cost_gap_usd": max(0, vs_best_cost),
                "interpretation": (
                    f"Closing PUE to 1.20 would save {max(0, vs_best_kwh_delta):,} kWh/yr "
                    f"(${max(0, vs_best_cost):,}/yr at ${electricity_rate_per_kwh}/kWh)"
                    if pue > BEST_PRACTICE_PUE
                    else "Facility already meets or beats best-practice PUE 1.20."
                ),
            },
        },
        "improvement_scenarios": scenarios,
        "recommendations": recs,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            "Usage: pue_calculator.py <it_load_kw> [cooling_load_kw|auto] "
            "[ups_efficiency_pct] [pdu_loss_pct] [lighting_kw|auto] "
            "[cooling_type] [electricity_rate_per_kwh]",
            file=sys.stderr,
        )
        print(f"cooling_type options: {', '.join(COOLING_RATIOS.keys())}", file=sys.stderr)
        sys.exit(1)

    try:
        it_load_kw = float(sys.argv[1])
        if not (1 <= it_load_kw <= 500_000):
            raise ValueError(f"it_load_kw must be 1–500000, got {it_load_kw}")

        raw_cooling = sys.argv[2] if len(sys.argv) > 2 else "auto"
        cooling_load_kw = (None if raw_cooling in ("auto", "")
                           else float(raw_cooling))

        ups_efficiency_pct = float(sys.argv[3]) if len(sys.argv) > 3 else 94.0
        if not (50 <= ups_efficiency_pct <= 100):
            raise ValueError(f"ups_efficiency_pct must be 50–100, got {ups_efficiency_pct}")

        pdu_loss_pct = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
        if not (0 <= pdu_loss_pct <= 20):
            raise ValueError(f"pdu_loss_pct must be 0–20, got {pdu_loss_pct}")

        raw_lighting = sys.argv[5] if len(sys.argv) > 5 else "auto"
        lighting_kw = (None if raw_lighting in ("auto", "")
                       else float(raw_lighting))

        cooling_type = sys.argv[6] if len(sys.argv) > 6 else "air_cooled"
        if cooling_type not in COOLING_RATIOS:
            raise ValueError(
                f"Unknown cooling_type '{cooling_type}'. "
                f"Must be one of: {', '.join(COOLING_RATIOS.keys())}"
            )

        electricity_rate = float(sys.argv[7]) if len(sys.argv) > 7 else 0.07
        if not (0.01 <= electricity_rate <= 2.0):
            raise ValueError(f"electricity_rate_per_kwh must be 0.01–2.0, got {electricity_rate}")

        result = calculate_pue(
            it_load_kw, cooling_load_kw, ups_efficiency_pct,
            pdu_loss_pct, lighting_kw, cooling_type, electricity_rate,
        )
        print(json.dumps(result, indent=2))
        sys.exit(0)

    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}), file=sys.stderr)
        sys.exit(2)
