#!/usr/bin/env python3
"""
Data center redundancy architecture validator.
Usage: python redundancy_validator.py <design_type> <total_load_kw> <generator_count>
       <generator_capacity_kw> <ups_count> <ups_capacity_kw> <cooling_units> <has_bypass>
"""

import sys
import json
import math


TIER_DATA = {
    "Tier I":   {"uptime_pct": 99.671, "downtime_hrs": 28.8},
    "Tier II":  {"uptime_pct": 99.741, "downtime_hrs": 22.7},
    "Tier III": {"uptime_pct": 99.982, "downtime_hrs": 1.6},
    "Tier IV":  {"uptime_pct": 99.995, "downtime_hrs": 0.4},
}

VALID_DESIGN_TYPES = {"N", "N+1", "2N", "2N+1"}


def parse_bool(value: str) -> bool:
    return value.strip().lower() in ("true", "1", "yes")


def classify_redundancy(unit_count: int, unit_capacity: float, total_load: float) -> str:
    if unit_capacity <= 0:
        return "undersized"
    minimum_needed = math.ceil(total_load / unit_capacity)
    total_capacity = unit_count * unit_capacity

    if total_capacity < total_load:
        return "undersized"

    if unit_count >= minimum_needed * 2 + 1:
        return "2N+1"
    elif unit_count >= minimum_needed * 2:
        return "2N"
    elif unit_count == minimum_needed + 1:
        return "N+1"
    elif unit_count == minimum_needed:
        return "N"
    else:
        return "undersized"


def classify_cooling_redundancy(cooling_units: int, design_type: str) -> str:
    if cooling_units == 1:
        return "N"
    if design_type in ("2N", "2N+1"):
        if cooling_units >= 4:
            return "2N"
        elif cooling_units >= 2:
            return "N+1"
        else:
            return "N"
    elif design_type in ("N+1",):
        if cooling_units >= 2:
            return "N+1"
        else:
            return "N"
    else:
        if cooling_units >= 4:
            return "2N"
        elif cooling_units >= 2:
            return "N+1"
        else:
            return "N"


def determine_achieved_tier(
    actual_gen: str,
    actual_ups: str,
    actual_cooling: str,
    has_bypass: bool,
    concurrent_maintainability: bool,
    fault_tolerant: bool,
) -> str:
    def redundancy_rank(r: str) -> int:
        return {"undersized": -1, "N": 0, "N+1": 1, "2N": 2, "2N+1": 3}.get(r, -1)

    min_rank = min(
        redundancy_rank(actual_gen),
        redundancy_rank(actual_ups),
        redundancy_rank(actual_cooling),
    )

    if min_rank < 0:
        return "Tier I"

    if fault_tolerant and min_rank >= 2:
        return "Tier IV"

    if concurrent_maintainability and min_rank >= 1:
        if has_bypass:
            return "Tier III"
        # Without bypass, concurrent maintainability is questionable — still Tier III but noted
        return "Tier III"

    if min_rank >= 1:
        return "Tier II"

    return "Tier I"


def run_validation(
    design_type: str,
    total_load_kw: float,
    generator_count: int,
    generator_capacity_kw: float,
    ups_count: int,
    ups_capacity_kw: float,
    cooling_units: int,
    has_bypass: bool,
) -> dict:

    # ── Derived capacities ──────────────────────────────────────────────────
    total_gen_capacity = generator_count * generator_capacity_kw
    total_ups_capacity = ups_count * ups_capacity_kw

    min_gen_needed = math.ceil(total_load_kw / generator_capacity_kw) if generator_capacity_kw > 0 else generator_count
    min_ups_needed = math.ceil(total_load_kw / ups_capacity_kw) if ups_capacity_kw > 0 else ups_count

    gen_ratio = total_gen_capacity / total_load_kw if total_load_kw > 0 else 0.0
    ups_ratio = total_ups_capacity / total_load_kw if total_load_kw > 0 else 0.0
    gen_margin_pct = (gen_ratio - 1.0) * 100.0
    ups_margin_pct = (ups_ratio - 1.0) * 100.0

    # ── Classify redundancy ──────────────────────────────────────────────────
    actual_gen_red = classify_redundancy(generator_count, generator_capacity_kw, total_load_kw)
    actual_ups_red = classify_redundancy(ups_count, ups_capacity_kw, total_load_kw)
    actual_cooling_red = classify_cooling_redundancy(cooling_units, design_type)

    def redundancy_rank(r: str) -> int:
        return {"undersized": -1, "N": 0, "N+1": 1, "2N": 2, "2N+1": 3}.get(r, -1)

    min_rank = min(
        redundancy_rank(actual_gen_red),
        redundancy_rank(actual_ups_red),
        redundancy_rank(actual_cooling_red),
    )

    concurrent_maintainability = (
        min_rank >= 1
        and generator_count > min_gen_needed
        and ups_count > min_ups_needed
        and cooling_units >= 2
    )

    fault_tolerant = (
        redundancy_rank(actual_gen_red) >= 2
        and redundancy_rank(actual_ups_red) >= 2
        and cooling_units >= 4
    )

    # ── SPOF analysis ────────────────────────────────────────────────────────
    spofs = []

    if generator_count == 1:
        spofs.append({
            "component": "generator",
            "description": "Single generator — any failure causes total loss of backup power.",
            "severity": "critical",
        })

    if total_gen_capacity < total_load_kw:
        spofs.append({
            "component": "generator",
            "description": f"Total generator capacity ({total_gen_capacity:.1f} kW) is less than load ({total_load_kw:.1f} kW). System is undersized.",
            "severity": "critical",
        })
    elif total_gen_capacity < total_load_kw * 1.1 and generator_count > 1:
        spofs.append({
            "component": "generator",
            "description": f"Generator capacity margin is tight ({gen_margin_pct:.1f}%). Loss of a single unit may cause overload.",
            "severity": "major",
        })

    if ups_count == 1:
        spofs.append({
            "component": "ups",
            "description": "Single UPS module — any failure or maintenance causes loss of power conditioning.",
            "severity": "critical",
        })

    if total_ups_capacity < total_load_kw:
        spofs.append({
            "component": "ups",
            "description": f"Total UPS capacity ({total_ups_capacity:.1f} kW) is less than load ({total_load_kw:.1f} kW). System is undersized.",
            "severity": "critical",
        })
    elif total_ups_capacity < total_load_kw * 1.1 and ups_count > 1:
        spofs.append({
            "component": "ups",
            "description": f"UPS capacity margin is tight ({ups_margin_pct:.1f}%). Loss of a single module may cause overload.",
            "severity": "major",
        })

    if cooling_units == 1:
        spofs.append({
            "component": "cooling",
            "description": "Single cooling unit — any failure causes potential thermal shutdown.",
            "severity": "critical",
        })

    if not has_bypass and ups_count == 1:
        spofs.append({
            "component": "ups_bypass",
            "description": "No static bypass and single UPS path — UPS maintenance requires load shutdown.",
            "severity": "major",
        })

    if design_type in ("2N", "2N+1") and generator_count < min_gen_needed * 2:
        spofs.append({
            "component": "generator",
            "description": f"Design claims {design_type} but generator count ({generator_count}) is less than 2× minimum required ({min_gen_needed * 2}). True fault tolerance not achieved.",
            "severity": "critical",
        })

    has_critical_spofs = any(s["severity"] == "critical" for s in spofs)

    # ── Validation checks ────────────────────────────────────────────────────
    checks = []

    # Generator capacity check
    if total_gen_capacity >= total_load_kw:
        checks.append({
            "check": "generator_total_capacity",
            "status": "pass",
            "detail": f"Total generator capacity {total_gen_capacity:.1f} kW meets load {total_load_kw:.1f} kW (ratio {gen_ratio:.2f}).",
        })
    else:
        checks.append({
            "check": "generator_total_capacity",
            "status": "fail",
            "detail": f"Total generator capacity {total_gen_capacity:.1f} kW is INSUFFICIENT for load {total_load_kw:.1f} kW.",
        })

    # Generator redundancy match
    if actual_gen_red == design_type:
        checks.append({
            "check": "generator_redundancy_match",
            "status": "pass",
            "detail": f"Generator redundancy matches claimed design type ({design_type}).",
        })
    else:
        checks.append({
            "check": "generator_redundancy_match",
            "status": "fail" if redundancy_rank(actual_gen_red) < redundancy_rank(design_type) else "warning",
            "detail": f"Claimed {design_type} but actual generator redundancy is {actual_gen_red}.",
        })

    # UPS capacity check
    if total_ups_capacity >= total_load_kw:
        checks.append({
            "check": "ups_total_capacity",
            "status": "pass",
            "detail": f"Total UPS capacity {total_ups_capacity:.1f} kW meets load {total_load_kw:.1f} kW (ratio {ups_ratio:.2f}).",
        })
    else:
        checks.append({
            "check": "ups_total_capacity",
            "status": "fail",
            "detail": f"Total UPS capacity {total_ups_capacity:.1f} kW is INSUFFICIENT for load {total_load_kw:.1f} kW.",
        })

    # UPS redundancy match
    if actual_ups_red == design_type:
        checks.append({
            "check": "ups_redundancy_match",
            "status": "pass",
            "detail": f"UPS redundancy matches claimed design type ({design_type}).",
        })
    else:
        checks.append({
            "check": "ups_redundancy_match",
            "status": "fail" if redundancy_rank(actual_ups_red) < redundancy_rank(design_type) else "warning",
            "detail": f"Claimed {design_type} but actual UPS redundancy is {actual_ups_red}.",
        })

    # Cooling check
    if cooling_units >= 2:
        status = "pass"
        detail = f"{cooling_units} cooling units provide {actual_cooling_red} cooling redundancy."
    else:
        status = "fail"
        detail = "Single cooling unit is a critical SPOF. Minimum 2 units required for any redundancy."
    checks.append({"check": "cooling_redundancy", "status": status, "detail": detail})

    # Bypass check
    if has_bypass:
        checks.append({
            "check": "static_bypass",
            "status": "pass",
            "detail": "Static bypass is present, enabling UPS maintenance without load interruption.",
        })
    else:
        if design_type in ("N+1", "2N", "2N+1"):
            checks.append({
                "check": "static_bypass",
                "status": "warning",
                "detail": "No static bypass. Recommended for Tier III+ designs to enable concurrent maintainability.",
            })
        else:
            checks.append({
                "check": "static_bypass",
                "status": "warning",
                "detail": "No static bypass. UPS maintenance will require controlled load shutdown.",
            })

    # Concurrent maintainability check
    checks.append({
        "check": "concurrent_maintainability",
        "status": "pass" if concurrent_maintainability else "fail",
        "detail": (
            "System supports concurrent maintainability (Tier III requirement met)."
            if concurrent_maintainability
            else "System does NOT support concurrent maintainability. N+1 minimum required for all systems."
        ),
    })

    # Fault tolerance check
    checks.append({
        "check": "fault_tolerance",
        "status": "pass" if fault_tolerant else "fail",
        "detail": (
            "System is fault tolerant (Tier IV requirement met)."
            if fault_tolerant
            else "System is NOT fully fault tolerant. 2N required for all systems including cooling (min 4 units)."
        ),
    })

    # Tier III bypass warning
    if design_type == "2N" and not has_bypass:
        checks.append({
            "check": "tier_iii_bypass_requirement",
            "status": "warning",
            "detail": "Tier III concurrent maintainability requires static bypass for UPS path maintenance.",
        })

    # ── Tier assessment ──────────────────────────────────────────────────────
    achieved_tier = determine_achieved_tier(
        actual_gen_red, actual_ups_red, actual_cooling_red,
        has_bypass, concurrent_maintainability, fault_tolerant,
    )

    tier_info = TIER_DATA[achieved_tier]
    uptime_pct = tier_info["uptime_pct"]
    downtime_hrs = tier_info["downtime_hrs"]
    downtime_mins = downtime_hrs * 60.0

    # Determine if certification-ready (claimed design_type matches achieved tier or better)
    design_tier_map = {"N": "Tier I", "N+1": "Tier II", "2N": "Tier IV", "2N+1": "Tier IV"}
    required_tier = design_tier_map.get(design_type, "Tier I")
    tier_order = ["Tier I", "Tier II", "Tier III", "Tier IV"]
    achieved_rank = tier_order.index(achieved_tier)
    required_rank = tier_order.index(required_tier)
    tier_certification_ready = achieved_rank >= required_rank and not has_critical_spofs

    # Gaps to next tier
    gaps = []
    if achieved_tier != "Tier IV":
        next_tier_idx = achieved_rank + 1
        next_tier = tier_order[next_tier_idx]
        if next_tier == "Tier II":
            if redundancy_rank(actual_gen_red) < 1:
                gaps.append("Increase generator count to achieve N+1 generator redundancy.")
            if redundancy_rank(actual_ups_red) < 1:
                gaps.append("Increase UPS module count to achieve N+1 UPS redundancy.")
            if cooling_units < 2:
                gaps.append("Add at least one additional cooling unit for N+1 cooling redundancy.")
        elif next_tier == "Tier III":
            if not concurrent_maintainability:
                gaps.append("Achieve N+1 redundancy on all systems to enable concurrent maintainability.")
            if not has_bypass:
                gaps.append("Install static bypass on UPS for concurrent UPS maintenance capability.")
            if cooling_units < 2:
                gaps.append("Add cooling units to support concurrent maintenance (min 2).")
        elif next_tier == "Tier IV":
            if redundancy_rank(actual_gen_red) < 2:
                gaps.append(f"Upgrade generators to 2N redundancy (need at least {min_gen_needed * 2} generators).")
            if redundancy_rank(actual_ups_red) < 2:
                gaps.append(f"Upgrade UPS to 2N redundancy (need at least {min_ups_needed * 2} modules).")
            if cooling_units < 4:
                gaps.append(f"Add cooling units for 2N cooling redundancy (need at least 4, currently {cooling_units}).")

    # ── Remediation steps ────────────────────────────────────────────────────
    remediation = []

    if total_gen_capacity < total_load_kw:
        deficit = total_load_kw - total_gen_capacity
        extra_gens = math.ceil(deficit / generator_capacity_kw)
        remediation.append(
            f"CRITICAL: Add {extra_gens} generator(s) of {generator_capacity_kw:.1f} kW each to cover load deficit of {deficit:.1f} kW."
        )

    if total_ups_capacity < total_load_kw:
        deficit = total_load_kw - total_ups_capacity
        extra_ups = math.ceil(deficit / ups_capacity_kw)
        remediation.append(
            f"CRITICAL: Add {extra_ups} UPS module(s) of {ups_capacity_kw:.1f} kW each to cover UPS deficit of {deficit:.1f} kW."
        )

    if generator_count == 1:
        remediation.append(
            "Add at least one additional generator to eliminate single-generator SPOF and achieve N+1 redundancy."
        )

    if ups_count == 1:
        remediation.append(
            "Add at least one additional UPS module to eliminate single-UPS SPOF and achieve N+1 redundancy."
        )

    if cooling_units == 1:
        remediation.append(
            "Add at least one additional cooling unit to eliminate single-cooling SPOF."
        )

    if not has_bypass and design_type in ("N+1", "2N", "2N+1"):
        remediation.append(
            "Install static bypass on UPS system to enable concurrent maintainability without load interruption."
        )

    if design_type in ("2N", "2N+1") and generator_count < min_gen_needed * 2:
        remediation.append(
            f"Increase generator count from {generator_count} to {min_gen_needed * 2} to achieve true 2N redundancy."
        )

    if gen_margin_pct < 10.0 and total_gen_capacity >= total_load_kw:
        remediation.append(
            f"Generator margin is {gen_margin_pct:.1f}%. Consider adding capacity for a safety margin of at least 10%."
        )

    if ups_margin_pct < 10.0 and total_ups_capacity >= total_load_kw:
        remediation.append(
            f"UPS margin is {ups_margin_pct:.1f}%. Consider adding capacity for a safety margin of at least 10%."
        )

    # ── Compliance notes ─────────────────────────────────────────────────────
    nfpa_level = "Level 1" if achieved_tier in ("Tier III", "Tier IV") else "Level 2"

    # ── Assemble output ──────────────────────────────────────────────────────
    output = {
        "input": {
            "design_type": design_type,
            "total_load_kw": total_load_kw,
            "generator_count": generator_count,
            "generator_capacity_kw": generator_capacity_kw,
            "total_generator_capacity_kw": total_gen_capacity,
            "ups_count": ups_count,
            "ups_capacity_kw": ups_capacity_kw,
            "total_ups_capacity_kw": total_ups_capacity,
            "cooling_units": cooling_units,
            "has_bypass": has_bypass,
        },
        "capacity_analysis": {
            "generator_capacity_ratio": round(gen_ratio, 4),
            "ups_capacity_ratio": round(ups_ratio, 4),
            "cooling_units_count": cooling_units,
            "generator_margin_pct": round(gen_margin_pct, 2),
            "ups_margin_pct": round(ups_margin_pct, 2),
        },
        "redundancy_assessment": {
            "claimed_design_type": design_type,
            "actual_generator_redundancy": actual_gen_red,
            "actual_ups_redundancy": actual_ups_red,
            "actual_cooling_redundancy": actual_cooling_red,
            "concurrent_maintainability": concurrent_maintainability,
            "fault_tolerant": fault_tolerant,
        },
        "tier_assessment": {
            "claimed_design_type": design_type,
            "achieved_tier": achieved_tier,
            "uptime_pct": uptime_pct,
            "downtime_hrs_per_year": downtime_hrs,
            "downtime_minutes_per_year": round(downtime_mins, 1),
            "tier_certification_ready": tier_certification_ready,
            "gaps_to_next_tier": gaps,
        },
        "spof_analysis": {
            "spofs_found": len(spofs),
            "critical_spofs": spofs,
            "has_critical_spofs": has_critical_spofs,
        },
        "validation_checks": checks,
        "remediation_steps": remediation,
        "compliance_notes": {
            "uptime_institute_tier": achieved_tier,
            "nfpa_110_level": nfpa_level,
            "concurrent_maintainability_standard": "Uptime Institute Tier III",
        },
    }

    return output


def main() -> None:
    if len(sys.argv) != 9:
        error = {
            "error": (
                "Usage: redundancy_validator.py <design_type> <total_load_kw> "
                "<generator_count> <generator_capacity_kw> <ups_count> "
                "<ups_capacity_kw> <cooling_units> <has_bypass>"
            )
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    _, design_type, total_load_kw_s, gen_count_s, gen_cap_s, ups_count_s, ups_cap_s, cooling_s, bypass_s = sys.argv

    # Validate design_type
    if design_type not in VALID_DESIGN_TYPES:
        print(json.dumps({"error": f"design_type must be one of: {', '.join(sorted(VALID_DESIGN_TYPES))}"}), file=sys.stderr)
        sys.exit(1)

    try:
        total_load_kw = float(total_load_kw_s)
        assert 1 <= total_load_kw <= 500000, "total_load_kw must be between 1 and 500000"
    except (ValueError, AssertionError) as exc:
        print(json.dumps({"error": f"Invalid total_load_kw: {exc}"}), file=sys.stderr)
        sys.exit(1)

    try:
        generator_count = int(gen_count_s)
        assert 1 <= generator_count <= 100, "generator_count must be between 1 and 100"
    except (ValueError, AssertionError) as exc:
        print(json.dumps({"error": f"Invalid generator_count: {exc}"}), file=sys.stderr)
        sys.exit(1)

    try:
        generator_capacity_kw = float(gen_cap_s)
        assert generator_capacity_kw > 0, "generator_capacity_kw must be > 0"
    except (ValueError, AssertionError) as exc:
        print(json.dumps({"error": f"Invalid generator_capacity_kw: {exc}"}), file=sys.stderr)
        sys.exit(1)

    try:
        ups_count = int(ups_count_s)
        assert 1 <= ups_count <= 200, "ups_count must be between 1 and 200"
    except (ValueError, AssertionError) as exc:
        print(json.dumps({"error": f"Invalid ups_count: {exc}"}), file=sys.stderr)
        sys.exit(1)

    try:
        ups_capacity_kw = float(ups_cap_s)
        assert ups_capacity_kw > 0, "ups_capacity_kw must be > 0"
    except (ValueError, AssertionError) as exc:
        print(json.dumps({"error": f"Invalid ups_capacity_kw: {exc}"}), file=sys.stderr)
        sys.exit(1)

    try:
        cooling_units = int(cooling_s)
        assert 1 <= cooling_units <= 500, "cooling_units must be between 1 and 500"
    except (ValueError, AssertionError) as exc:
        print(json.dumps({"error": f"Invalid cooling_units: {exc}"}), file=sys.stderr)
        sys.exit(1)

    has_bypass = parse_bool(bypass_s)

    result = run_validation(
        design_type=design_type,
        total_load_kw=total_load_kw,
        generator_count=generator_count,
        generator_capacity_kw=generator_capacity_kw,
        ups_count=ups_count,
        ups_capacity_kw=ups_capacity_kw,
        cooling_units=cooling_units,
        has_bypass=has_bypass,
    )

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
