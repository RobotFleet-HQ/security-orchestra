"""
Harmonic Analysis Agent — IEEE 519-2022
CLI: <total_load_kva> <ups_percentage> <vfd_percentage> <transformer_kva>
"""

import sys
import json
import math


def main():
    if len(sys.argv) != 5:
        err = {"error": "Usage: harmonic_analysis.py <total_load_kva> <ups_percentage> <vfd_percentage> <transformer_kva>"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        total_load_kva = float(sys.argv[1])
        ups_percentage = float(sys.argv[2])
        vfd_percentage = float(sys.argv[3])
        transformer_kva = float(sys.argv[4])
    except ValueError as e:
        err = {"error": f"Invalid numeric argument: {e}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    if total_load_kva <= 0:
        err = {"error": "total_load_kva must be positive"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if not (0 <= ups_percentage <= 100):
        err = {"error": "ups_percentage must be 0-100"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if not (0 <= vfd_percentage <= 100):
        err = {"error": "vfd_percentage must be 0-100"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if ups_percentage + vfd_percentage > 100:
        err = {"error": "ups_percentage + vfd_percentage cannot exceed 100"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if transformer_kva <= 0:
        err = {"error": "transformer_kva must be positive"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    # ── System parameters ────────────────────────────────────────────────────
    VOLTAGE_LL = 480.0          # line-to-line volts (480V system)
    TRANSFORMER_Z = 0.0575      # 5.75% impedance (per unit)

    # Fundamental load current (3-phase)
    # S = √3 × V_LL × I  →  I = S / (√3 × V_LL)
    i_fundamental = (total_load_kva * 1000.0) / (math.sqrt(3) * VOLTAGE_LL)

    # Load fractions
    ups_fraction = ups_percentage / 100.0
    vfd_fraction = vfd_percentage / 100.0
    linear_fraction = 1.0 - ups_fraction - vfd_fraction

    i_ups = i_fundamental * ups_fraction
    i_vfd = i_fundamental * vfd_fraction

    # ── UPS (6-pulse) harmonic current fractions relative to fundamental ────
    # 5th: 17.5%, 7th: 11.1%, 11th: 4.5%, 13th: 2.9%
    ups_thd_fractions = {5: 0.175, 7: 0.111, 11: 0.045, 13: 0.029}

    # ── VFD (6-pulse) harmonic current fractions relative to fundamental ────
    # 5th: 25%, 7th: 8%, 11th: 3.5%, 13th: 2%
    vfd_thd_fractions = {5: 0.25, 7: 0.08, 11: 0.035, 13: 0.02}

    harmonic_orders = [5, 7, 11, 13]
    order_names = {5: "5th", 7: "7th", 11: "11th", 13: "13th"}

    # Harmonic current per order (RSS of UPS and VFD contributions)
    # I_h = sqrt( (I_ups * frac_ups_h)^2 + (I_vfd * frac_vfd_h)^2 )
    harmonic_currents = {}
    sum_ih_squared = 0.0
    for h in harmonic_orders:
        i_h_ups = i_ups * ups_thd_fractions[h]
        i_h_vfd = i_vfd * vfd_thd_fractions[h]
        i_h = math.sqrt(i_h_ups**2 + i_h_vfd**2)
        harmonic_currents[order_names[h]] = round(i_h, 4)
        sum_ih_squared += i_h**2

    # Total RMS harmonic current
    i_rms_harmonic = math.sqrt(sum_ih_squared)

    # THD_I (%)
    thd_i_percent = (i_rms_harmonic / i_fundamental) * 100.0 if i_fundamental > 0 else 0.0

    # Voltage THD at PCC — simplified: THD_V ≈ THD_I% × transformer_Z_pu × (Z_source/Z_load factor)
    # THD_V ≈ THD_I_percent × 0.057  (for 5.75% transformer impedance)
    thd_v_percent = thd_i_percent * TRANSFORMER_Z

    # ── K-factor ─────────────────────────────────────────────────────────────
    # K = Σ(I_h² × h²) / Σ(I_h²)
    # Include fundamental (h=1) in denominator
    sum_ih2_h2 = 0.0
    sum_ih2_all = i_fundamental**2  # start with fundamental
    for h in harmonic_orders:
        i_h_ups = i_ups * ups_thd_fractions[h]
        i_h_vfd = i_vfd * vfd_thd_fractions[h]
        i_h = math.sqrt(i_h_ups**2 + i_h_vfd**2)
        sum_ih2_h2 += i_h**2 * h**2
        sum_ih2_all += i_h**2

    k_factor = sum_ih2_h2 / sum_ih2_all if sum_ih2_all > 0 else 1.0

    # ── IEEE 519 compliance ──────────────────────────────────────────────────
    # ISC/IL ratio = (transformer_kva / total_load_kva) × (1 / transformer_Z_pu)
    isc_il_ratio = (transformer_kva / total_load_kva) * (1.0 / TRANSFORMER_Z)

    # THD_I limits (IEEE 519-2022 Table 2, for systems ≤69 kV)
    if isc_il_ratio < 20:
        thd_i_limit = 5.0
    elif isc_il_ratio < 50:
        thd_i_limit = 8.0
    elif isc_il_ratio < 100:
        thd_i_limit = 12.0
    else:
        thd_i_limit = 15.0

    thd_v_limit = 5.0  # IEEE 519-2022 for ≤69 kV PCC

    current_compliant = thd_i_percent < thd_i_limit
    voltage_compliant = thd_v_percent < thd_v_limit
    overall_compliant = current_compliant and voltage_compliant

    # ── Non-linear load kVA ─────────────────────────────────────────────────
    nonlinear_kva = total_load_kva * (ups_fraction + vfd_fraction)
    nonlinear_kw = nonlinear_kva * 0.9  # assume PF = 0.9

    # ── Filter recommendations ───────────────────────────────────────────────
    filter_recommendations = []

    # 1) Passive harmonic filter (5th harmonic tuned)
    passive_size_kvar = nonlinear_kva * 0.25  # 20-30%, use 25%
    # Passive filter reduces THD_I by ~50% for 5th/7th harmonics
    thd_after_passive = thd_i_percent * 0.50
    passive_cost = passive_size_kvar * 45.0  # ~$45/kVAR installed
    filter_recommendations.append({
        "type": "passive_filter",
        "description": (
            "5th-harmonic-tuned passive filter (LC shunt). Reduces 5th and 7th harmonics "
            "by ~50%. Low cost but fixed tuning; risk of resonance with utility capacitors."
        ),
        "size_kvar_or_kva": round(passive_size_kvar, 1),
        "thd_after_filter_percent": round(thd_after_passive, 2),
        "cost_estimate": round(passive_cost, 0)
    })

    # 2) Active harmonic filter
    active_size_kva = nonlinear_kw * 0.30
    thd_after_active = min(thd_i_percent * 0.10, 4.9)  # achieves < 5%
    active_cost = active_size_kva * 150.0  # ~$150/kVA installed
    filter_recommendations.append({
        "type": "active_filter",
        "description": (
            "Active harmonic filter (current-injection type). Achieves THD_I < 5% across "
            "all harmonic orders. Adapts to load changes automatically. Higher cost."
        ),
        "size_kvar_or_kva": round(active_size_kva, 1),
        "thd_after_filter_percent": round(thd_after_active, 2),
        "cost_estimate": round(active_cost, 0)
    })

    # 3) 12-pulse transformer upgrade
    # Eliminates 5th and 7th harmonics; remaining THD dominated by 11th and 13th
    remaining_ih2 = 0.0
    for h in [11, 13]:
        i_h_ups = i_ups * ups_thd_fractions[h]
        i_h_vfd = i_vfd * vfd_thd_fractions[h]
        i_h = math.sqrt(i_h_ups**2 + i_h_vfd**2)
        remaining_ih2 += i_h**2
    thd_after_12pulse = (math.sqrt(remaining_ih2) / i_fundamental * 100.0) if i_fundamental > 0 else 0.0
    transformer_upgrade_cost = transformer_kva * 18.0  # ~$18/kVA for 12-pulse transformer
    filter_recommendations.append({
        "type": "12pulse_transformer",
        "description": (
            "Upgrade to 12-pulse input transformer (delta-wye / delta-delta dual secondary). "
            "Eliminates characteristic 5th and 7th harmonics. Requires physical transformer "
            "replacement; best applied at design stage or during major renovation."
        ),
        "size_kvar_or_kva": round(transformer_kva, 1),
        "thd_after_filter_percent": round(thd_after_12pulse, 2),
        "cost_estimate": round(transformer_upgrade_cost, 0)
    })

    # ── K-rated transformer recommendation ──────────────────────────────────
    if k_factor <= 1.0:
        k_rating_required = 1
        standard_adequate = True
    elif k_factor <= 4.0:
        k_rating_required = 4
        standard_adequate = False
    elif k_factor <= 13.0:
        k_rating_required = 13
        standard_adequate = False
    else:
        k_rating_required = 20
        standard_adequate = False

    k_notes = (
        f"Calculated K-factor = {k_factor:.2f}. "
        f"Select K-{k_rating_required} rated transformer per ANSI/IEEE C57.110."
    )

    # ── Notes ────────────────────────────────────────────────────────────────
    notes = []
    if ups_fraction + vfd_fraction == 0:
        notes.append("No non-linear loads specified; harmonic content is zero.")
    if not overall_compliant:
        notes.append(
            f"System is NOT IEEE 519-2022 compliant. THD_I = {thd_i_percent:.2f}% "
            f"(limit {thd_i_limit:.1f}%), THD_V = {thd_v_percent:.2f}% (limit 5.0%). "
            "Harmonic mitigation is required."
        )
    else:
        notes.append(
            f"System meets IEEE 519-2022 requirements. THD_I = {thd_i_percent:.2f}% "
            f"(limit {thd_i_limit:.1f}%), THD_V = {thd_v_percent:.2f}% (limit 5.0%)."
        )
    notes.append(
        "Harmonic analysis uses simplified 6-pulse UPS/VFD model. "
        "Actual measurements per IEEE 519 monitoring protocol are recommended."
    )
    notes.append(
        "Voltage THD estimate uses simplified formula: THD_V ≈ THD_I × Z_transformer. "
        "Detailed power flow study recommended for final design."
    )
    if thd_v_percent > 3.0:
        notes.append(
            "THD_V exceeds 3% advisory level. Sensitive IT equipment may be affected. "
            "Consider PQ monitoring per IEEE 1159."
        )

    result = {
        "input": {
            "total_load_kva": total_load_kva,
            "ups_percentage": ups_percentage,
            "vfd_percentage": vfd_percentage,
            "transformer_kva": transformer_kva
        },
        "harmonic_analysis": {
            "fundamental_load_amps": round(i_fundamental, 2),
            "harmonic_currents": {k: round(v, 4) for k, v in harmonic_currents.items()},
            "thd_current_percent": round(thd_i_percent, 3),
            "thd_voltage_percent": round(thd_v_percent, 3),
            "k_factor": round(k_factor, 3)
        },
        "ieee519_compliance": {
            "isc_il_ratio": round(isc_il_ratio, 2),
            "thd_i_limit_percent": thd_i_limit,
            "thd_v_limit_percent": 5.0,
            "current_compliant": current_compliant,
            "voltage_compliant": voltage_compliant,
            "overall_compliant": overall_compliant
        },
        "filter_recommendations": filter_recommendations,
        "transformer_recommendation": {
            "k_rating_required": k_rating_required,
            "standard_rating_adequate": standard_adequate,
            "notes": k_notes
        },
        "notes": notes
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
