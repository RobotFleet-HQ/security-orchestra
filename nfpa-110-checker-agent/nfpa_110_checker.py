"""
NFPA 110-2021 Compliance Checker for Emergency Power Systems
CLI: python nfpa_110_checker.py <generator_kw> <fuel_capacity_gallons> <runtime_hours> <ats_transfer_time_seconds> <level> <fuel_type>
"""

import sys
import json
import math


DIESEL_CONSUMPTION_RATE = 0.068  # gal/kWh at full load
PROPANE_MULTIPLIER = 1.53        # propane volume vs diesel volume
NATURAL_GAS_BTU_PER_KWH = 10000
NATURAL_GAS_CFH_PER_KW = 7.0   # ft3/kWh

LEVEL1_REQUIRED_RUNTIME = 24.0
LEVEL2_REQUIRED_RUNTIME = 6.0
LEVEL1_RECOMMENDED_RUNTIME = 24.0
LEVEL2_RECOMMENDED_RUNTIME = 48.0  # data center standard

LEVEL1_MAX_ATS_SECONDS = 10
LEVEL2_MAX_ATS_SECONDS = 60

STANDARD_ATS_RATINGS = [100, 150, 200, 225, 260, 400, 600, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000]


def parse_args(argv):
    if len(argv) < 6:
        raise ValueError(
            "Usage: nfpa_110_checker.py <generator_kw> <fuel_capacity_gallons> "
            "<runtime_hours> <ats_transfer_time_seconds> <level> [fuel_type]"
        )

    generator_kw = float(argv[1])
    if not (1 <= generator_kw <= 50000):
        raise ValueError(f"generator_kw must be between 1 and 50000, got {generator_kw}")

    fuel_capacity_gallons = float(argv[2])
    if fuel_capacity_gallons <= 0:
        raise ValueError(f"fuel_capacity_gallons must be > 0, got {fuel_capacity_gallons}")

    runtime_hours = float(argv[3])
    ats_transfer_time_seconds = float(argv[4])

    level = int(argv[5])
    if level not in (1, 2):
        raise ValueError(f"level must be 1 or 2, got {level}")

    fuel_type = argv[6].lower() if len(argv) > 6 else "diesel"
    if fuel_type not in ("diesel", "natural_gas", "propane"):
        raise ValueError(f"fuel_type must be diesel, natural_gas, or propane, got {fuel_type}")

    return generator_kw, fuel_capacity_gallons, runtime_hours, ats_transfer_time_seconds, level, fuel_type


def compute_consumption_gph(generator_kw, fuel_type):
    if fuel_type == "diesel":
        return generator_kw * DIESEL_CONSUMPTION_RATE
    elif fuel_type == "propane":
        return generator_kw * DIESEL_CONSUMPTION_RATE * PROPANE_MULTIPLIER
    else:
        return None  # natural gas measured differently


def compute_max_runtime(fuel_capacity_gallons, consumption_gph):
    if consumption_gph is None or consumption_gph == 0:
        return None
    return fuel_capacity_gallons / consumption_gph


def analyze_fuel(generator_kw, fuel_capacity_gallons, runtime_hours, level, fuel_type):
    consumption_gph = compute_consumption_gph(generator_kw, fuel_type)
    computed_max_runtime = compute_max_runtime(fuel_capacity_gallons, consumption_gph)

    required_runtime = LEVEL1_REQUIRED_RUNTIME if level == 1 else LEVEL2_REQUIRED_RUNTIME
    recommended_runtime = LEVEL1_RECOMMENDED_RUNTIME if level == 1 else LEVEL2_RECOMMENDED_RUNTIME

    if computed_max_runtime is not None:
        fuel_margin_pct = ((computed_max_runtime - required_runtime) / required_runtime) * 100.0
        if computed_max_runtime >= recommended_runtime:
            fuel_status = "compliant"
        elif computed_max_runtime >= required_runtime:
            fuel_status = "marginal"
        else:
            fuel_status = "non_compliant"
    else:
        fuel_margin_pct = None
        fuel_status = "compliant"  # natural gas runtime user-supplied; mark compliant if runtime_hours >= required

    return {
        "consumption_gph": round(consumption_gph, 4) if consumption_gph is not None else None,
        "computed_max_runtime_hours": round(computed_max_runtime, 2) if computed_max_runtime is not None else None,
        "required_runtime_hours": required_runtime,
        "recommended_runtime_hours": recommended_runtime,
        "fuel_margin_pct": round(fuel_margin_pct, 2) if fuel_margin_pct is not None else None,
        "status": fuel_status,
    }


def analyze_ats(ats_transfer_time_seconds, level):
    max_allowed = LEVEL1_MAX_ATS_SECONDS if level == 1 else LEVEL2_MAX_ATS_SECONDS
    status = "compliant" if ats_transfer_time_seconds <= max_allowed else "non_compliant"
    return {
        "transfer_time_seconds": ats_transfer_time_seconds,
        "max_allowed_seconds": max_allowed,
        "status": status,
    }


def run_checks(generator_kw, fuel_capacity_gallons, runtime_hours, ats_transfer_time_seconds, level, fuel_type, fuel_analysis, ats_analysis):
    violations = []
    warnings = []
    passed_checks = []

    # --- Fuel runtime check ---
    computed_max = fuel_analysis["computed_max_runtime_hours"]
    required = fuel_analysis["required_runtime_hours"]

    if fuel_type == "natural_gas":
        if runtime_hours >= required:
            passed_checks.append(
                f"Natural gas runtime ({runtime_hours:.1f} hr) meets Level {level} minimum ({required:.0f} hr)"
            )
        else:
            violations.append({
                "code": f"NFPA110-7.9.3.{level}",
                "description": (
                    f"Provided runtime ({runtime_hours:.1f} hr) is less than the Level {level} "
                    f"minimum requirement ({required:.0f} hr). "
                    "Natural gas runtime must be verified against firm supply agreement."
                ),
                "severity": "critical" if level == 1 else "major",
            })
    else:
        if computed_max is not None:
            if computed_max >= required:
                passed_checks.append(
                    f"Fuel supply ({computed_max:.1f} hr) meets Level {level} minimum requirement "
                    f"(NFPA 110-2021 Section 7.9.3.{level}: {required:.0f} hr)"
                )
            else:
                violations.append({
                    "code": f"NFPA110-7.9.3.{level}",
                    "description": (
                        f"Computed maximum runtime ({computed_max:.1f} hr) is less than Level {level} "
                        f"minimum ({required:.0f} hr) per NFPA 110-2021 Section 7.9.3.{level}. "
                        f"Increase fuel capacity from {fuel_capacity_gallons:.1f} gal."
                    ),
                    "severity": "critical",
                })

            recommended = fuel_analysis["recommended_runtime_hours"]
            if computed_max < recommended:
                warnings.append(
                    f"Computed runtime ({computed_max:.1f} hr) is below recommended {recommended:.0f} hr "
                    f"for Level {level} installations (data center / critical facility best practice)."
                )

        # Consistency check: user-provided runtime vs computed
        if computed_max is not None:
            discrepancy_pct = abs(runtime_hours - computed_max) / computed_max * 100 if computed_max > 0 else 0
            if discrepancy_pct > 10:
                warnings.append(
                    f"User-provided runtime ({runtime_hours:.1f} hr) differs from fuel-derived maximum "
                    f"({computed_max:.1f} hr) by {discrepancy_pct:.1f}%. "
                    "Verify fuel capacity, consumption rate, and derating factors."
                )

    # --- ATS transfer time check ---
    if ats_analysis["status"] == "compliant":
        passed_checks.append(
            f"ATS transfer time ({ats_transfer_time_seconds:.1f} s) meets Level {level} limit "
            f"(NFPA 110-2021 Section 6.4.1: ≤{ats_analysis['max_allowed_seconds']} s)"
        )
    else:
        violations.append({
            "code": "NFPA110-6.4.1",
            "description": (
                f"ATS transfer time ({ats_transfer_time_seconds:.1f} s) exceeds Level {level} maximum "
                f"({ats_analysis['max_allowed_seconds']} s) per NFPA 110-2021 Section 6.4.1."
            ),
            "severity": "critical",
        })

    # --- Battery system check ---
    if level == 1:
        warnings.append(
            "Level 1: Dual battery systems required for starting per NFPA 110-2021 Section 5.6.7. "
            "Verify dual-redundant starting battery banks are installed."
        )
    else:
        passed_checks.append("Level 2: Single battery starting system acceptable per NFPA 110-2021.")

    # --- Natural gas firm supply agreement ---
    if level == 1 and fuel_type == "natural_gas":
        violations.append({
            "code": "NFPA110-7.9.2",
            "description": (
                "Level 1 system with natural gas fuel requires a firm gas supply agreement ensuring "
                "uninterruptible delivery per NFPA 110-2021 Section 7.9.2. "
                "Verify utility interruptible vs. firm service classification."
            ),
            "severity": "major",
        })

    # --- Level 2 DC standard note ---
    if level == 2:
        warnings.append(
            "Note: While NFPA 110 Section 7.9.3.2 requires 6 hr minimum for Level 2, "
            "data center standards (e.g., Uptime Institute Tier III/IV) typically require 24–96 hr. "
            "Confirm applicable facility standards."
        )

    # Determine overall status
    has_critical = any(v["severity"] == "critical" for v in violations)
    has_major = any(v["severity"] == "major" for v in violations)

    if has_critical:
        overall_status = "fail"
    elif has_major or warnings:
        overall_status = "conditional_pass" if not violations else "fail"
    else:
        overall_status = "pass"

    if violations:
        overall_status = "fail" if has_critical else "conditional_pass"
    elif warnings:
        overall_status = "conditional_pass"
    else:
        overall_status = "pass"

    return overall_status, violations, warnings, passed_checks


def build_remediation(violations, warnings, level, fuel_type, fuel_analysis, ats_analysis):
    steps = []
    step = 1

    for v in violations:
        if "7.9.3" in v["code"]:
            required = fuel_analysis["required_runtime_hours"]
            gph = fuel_analysis["consumption_gph"]
            if gph:
                min_gallons = required * gph
                steps.append(
                    f"Step {step}: Increase fuel storage to at least {min_gallons:.0f} gallons "
                    f"(= {required:.0f} hr × {gph:.2f} GPH) to meet NFPA 110-2021 Section 7.9.3.{level}."
                )
            else:
                steps.append(
                    f"Step {step}: Verify natural gas supply agreement provides at least {required:.0f} hr "
                    "of uninterrupted service per NFPA 110-2021 Section 7.9.3."
                )
            step += 1

        if "6.4.1" in v["code"]:
            max_s = ats_analysis["max_allowed_seconds"]
            steps.append(
                f"Step {step}: Replace or reconfigure ATS to achieve transfer time ≤{max_s} seconds "
                "per NFPA 110-2021 Section 6.4.1. Verify closed-transition or open-transition timing."
            )
            step += 1

        if "7.9.2" in v["code"]:
            steps.append(
                f"Step {step}: Obtain a firm (non-interruptible) natural gas supply agreement from the utility "
                "and document it in the EPSS maintenance file per NFPA 110-2021 Section 7.9.2."
            )
            step += 1

    if level == 1:
        steps.append(
            f"Step {step}: Verify dual-redundant starting battery banks are installed and tested "
            "per NFPA 110-2021 Section 5.6.7. Replace batteries on manufacturer-specified schedule."
        )
        step += 1

    steps.append(
        f"Step {step}: Establish a testing and maintenance program: monthly 30-minute loaded exercise "
        "and annual full-load test per NFPA 110-2021 Chapter 8."
    )
    step += 1

    steps.append(
        f"Step {step}: Maintain a written log of all tests, inspections, and fuel deliveries "
        "as required by NFPA 110-2021 Section 8.4."
    )

    return steps


def build_testing_requirements(level):
    if level == 1:
        return {
            "monthly_minutes": 30,
            "annual_test": "Full-load test at rated load for minimum 4 hours per NFPA 110-2021 Section 8.4.2",
            "load_bank_required": True,
        }
    else:
        return {
            "monthly_minutes": 30,
            "annual_test": "Load test per NFPA 110-2021 Section 8.4.2; load bank recommended if facility load insufficient",
            "load_bank_required": False,
        }


def main():
    try:
        generator_kw, fuel_capacity_gallons, runtime_hours, ats_transfer_time_seconds, level, fuel_type = parse_args(sys.argv)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected argument error: {e}"}), file=sys.stderr)
        sys.exit(2)

    try:
        consumption_gph = compute_consumption_gph(generator_kw, fuel_type)
        computed_max_runtime = compute_max_runtime(fuel_capacity_gallons, consumption_gph)

        fuel_analysis = analyze_fuel(
            generator_kw, fuel_capacity_gallons, runtime_hours, level, fuel_type
        )
        ats_analysis = analyze_ats(ats_transfer_time_seconds, level)

        overall_status, violations, warnings, passed_checks = run_checks(
            generator_kw, fuel_capacity_gallons, runtime_hours,
            ats_transfer_time_seconds, level, fuel_type,
            fuel_analysis, ats_analysis
        )

        remediation = build_remediation(violations, warnings, level, fuel_type, fuel_analysis, ats_analysis)
        testing_requirements = build_testing_requirements(level)

        # Natural gas extra warning
        if fuel_type == "natural_gas":
            warnings.append(
                "Natural gas: consumption is approximately 10,000 BTU/kWh (~7 ft³/kWh). "
                "Runtime hours must be verified via utility supply capacity and meter sizing, "
                "not volumetric tank calculation."
            )

        output = {
            "input": {
                "generator_kw": generator_kw,
                "fuel_capacity_gallons": fuel_capacity_gallons,
                "runtime_hours": runtime_hours,
                "ats_transfer_time_seconds": ats_transfer_time_seconds,
                "level": level,
                "fuel_type": fuel_type,
                "fuel_consumption_gph": round(consumption_gph, 4) if consumption_gph is not None else None,
                "computed_max_runtime_hours": round(computed_max_runtime, 2) if computed_max_runtime is not None else None,
            },
            "compliance": {
                "overall_status": overall_status,
                "level": level,
                "violations": violations,
                "warnings": warnings,
                "passed_checks": passed_checks,
            },
            "fuel_analysis": fuel_analysis,
            "ats_analysis": ats_analysis,
            "remediation": remediation,
            "testing_requirements": testing_requirements,
        }

        print(json.dumps(output, indent=2))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"error": f"Internal error: {e}"}), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
