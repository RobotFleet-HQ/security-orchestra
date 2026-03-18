#!/usr/bin/env python3
"""
Tier Certification Checker Agent
=================================
Evaluates data center readiness for Uptime Institute Tier I, II, III, or IV
certification and produces a gap analysis with remediation cost estimates.

Usage:
    python tier_certification.py <generator_config> <ups_topology> <cooling_redundancy>
                                 <power_paths> <fuel_runtime_hours> <transfer_switch_type>
                                 <has_concurrent_maintainability> <has_fault_tolerance>
                                 <target_tier>

Output: JSON to stdout, errors to stderr, exit 0 on success.
"""

import sys
import json
import math


# ─── Tier Requirements ────────────────────────────────────────────────────────
# Based on Uptime Institute Tier Standard: Topology (2017 edition)

TIER_REQUIREMENTS = {
    "Tier I": {
        "min_power_paths":          1,
        "requires_n_plus_1":        False,
        "requires_concurrent_maint": False,
        "requires_fault_tolerance": False,
        "min_fuel_runtime_hours":   12,
        "ats_required":             True,
        "sts_required":             False,
        "uptime_pct":               99.671,
        "downtime_hrs_yr":          28.8,
        "description": "Basic site infrastructure with no redundancy",
    },
    "Tier II": {
        "min_power_paths":          1,
        "requires_n_plus_1":        True,
        "requires_concurrent_maint": False,
        "requires_fault_tolerance": False,
        "min_fuel_runtime_hours":   12,
        "ats_required":             True,
        "sts_required":             False,
        "uptime_pct":               99.741,
        "downtime_hrs_yr":          22.0,
        "description": "Redundant capacity components, single distribution path",
    },
    "Tier III": {
        "min_power_paths":          2,
        "requires_n_plus_1":        True,
        "requires_concurrent_maint": True,
        "requires_fault_tolerance": False,
        "min_fuel_runtime_hours":   72,
        "ats_required":             True,
        "sts_required":             False,
        "uptime_pct":               99.982,
        "downtime_hrs_yr":          1.6,
        "description": "Multiple paths, concurrent maintainability (one active path)",
    },
    "Tier IV": {
        "min_power_paths":          2,
        "requires_n_plus_1":        True,
        "requires_concurrent_maint": True,
        "requires_fault_tolerance": True,
        "min_fuel_runtime_hours":   96,
        "ats_required":             True,
        "sts_required":             True,
        "uptime_pct":               99.995,
        "downtime_hrs_yr":          0.44,
        "description": "Fault tolerant — all components 2N, dual active paths",
    },
}

# Gap cost estimates (USD) — typical data center retrofit costs
GAP_COSTS = {
    "add_redundant_generator":      (150_000, 400_000, "Add N+1 generator with ATS"),
    "upgrade_ups_topology":         (80_000,  300_000, "Upgrade UPS to 2N topology"),
    "add_redundant_cooling":        (120_000, 350_000, "Add redundant cooling units"),
    "add_second_power_path":        (200_000, 600_000, "Install independent second power distribution path"),
    "extend_fuel_storage_to_72h":   (30_000,  100_000, "Expand fuel storage to 72-hour runtime"),
    "extend_fuel_storage_to_96h":   (45_000,  130_000, "Expand fuel storage to 96-hour runtime"),
    "implement_concurrent_maint":   (50_000,  200_000, "Redesign topology for concurrent maintainability"),
    "implement_fault_tolerance":    (300_000, 800_000, "Upgrade all systems to 2N fault-tolerant configuration"),
    "add_sts":                      (40_000,  120_000, "Install Static Transfer Switches for sub-cycle failover"),
    "upgrade_transfer_switch":      (15_000,  50_000,  "Upgrade manual/ATS to STS transfer switch"),
}


def parse_bool(val: str) -> bool:
    return val.lower() in ("true", "1", "yes")


def detect_n_plus_1(config: str) -> bool:
    """Detect if a config string implies N+1 or 2N redundancy."""
    upper = config.upper()
    return any(k in upper for k in ["N+1", "2N", "N+2", "REDUNDANT", "DUAL"])


def detect_2n(config: str) -> bool:
    """Detect if a config string implies 2N (fault tolerant)."""
    upper = config.upper()
    return "2N" in upper


def achieved_tier(
    power_paths: int,
    has_n_plus_1: bool,
    has_concurrent: bool,
    has_fault_tolerance: bool,
    fuel_hours: float,
    has_sts: bool,
) -> str:
    """Return the highest Uptime Institute tier the facility achieves."""
    if (power_paths >= 2 and has_n_plus_1 and has_concurrent
            and has_fault_tolerance and fuel_hours >= 96 and has_sts):
        return "Tier IV"
    if power_paths >= 2 and has_n_plus_1 and has_concurrent and fuel_hours >= 72:
        return "Tier III"
    if has_n_plus_1 and fuel_hours >= 12:
        return "Tier II"
    return "Tier I"


def build_gap_analysis(current_tier: str, target_tier: str, params: dict) -> dict:
    """Compare current capabilities against target tier requirements."""
    target_req = TIER_REQUIREMENTS[target_tier]
    gaps = []
    remediation_cost_low = 0
    remediation_cost_high = 0

    # Power paths
    if params["power_paths"] < target_req["min_power_paths"]:
        g = GAP_COSTS["add_second_power_path"]
        gaps.append({
            "gap": f"Insufficient independent power paths (have {params['power_paths']}, need {target_req['min_power_paths']})",
            "requirement": f"{target_req['min_power_paths']} independent power distribution paths",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "HIGH",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    # N+1 redundancy
    if target_req["requires_n_plus_1"] and not params["has_n_plus_1"]:
        g = GAP_COSTS["add_redundant_generator"]
        gaps.append({
            "gap": "Generator and/or UPS lacks N+1 redundancy",
            "requirement": "All critical systems must have N+1 redundant capacity",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "HIGH",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    # Cooling redundancy
    if target_req["requires_n_plus_1"] and "N+1" not in params["cooling_redundancy"].upper() and "2N" not in params["cooling_redundancy"].upper():
        g = GAP_COSTS["add_redundant_cooling"]
        gaps.append({
            "gap": "Cooling system does not meet N+1 redundancy",
            "requirement": "Cooling must be N+1 or 2N redundant",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "HIGH",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    # Concurrent maintainability
    if target_req["requires_concurrent_maint"] and not params["has_concurrent"]:
        g = GAP_COSTS["implement_concurrent_maint"]
        gaps.append({
            "gap": "Topology does not support concurrent maintainability",
            "requirement": "Any component can be removed for maintenance without IT load impact",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "HIGH",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    # Fault tolerance
    if target_req["requires_fault_tolerance"] and not params["has_fault_tolerance"]:
        g = GAP_COSTS["implement_fault_tolerance"]
        gaps.append({
            "gap": "Facility is not fault tolerant (2N required for Tier IV)",
            "requirement": "All infrastructure must be 2N — a single failure cannot affect IT load",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "CRITICAL",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    # Fuel runtime
    if params["fuel_hours"] < target_req["min_fuel_runtime_hours"]:
        if target_req["min_fuel_runtime_hours"] >= 96:
            g = GAP_COSTS["extend_fuel_storage_to_96h"]
        else:
            g = GAP_COSTS["extend_fuel_storage_to_72h"]
        gaps.append({
            "gap": f"Fuel runtime {params['fuel_hours']}h is below {target_req['min_fuel_runtime_hours']}h minimum",
            "requirement": f"Minimum {target_req['min_fuel_runtime_hours']} hours of on-site fuel storage",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "MEDIUM",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    # STS for Tier IV
    if target_req["sts_required"] and not params["has_sts"]:
        g = GAP_COSTS["add_sts"]
        gaps.append({
            "gap": "No Static Transfer Switches (STS) installed",
            "requirement": "Tier IV requires STS for sub-cycle power path switchover",
            "remediation": g[2],
            "estimated_cost_low_usd": g[0],
            "estimated_cost_high_usd": g[1],
            "priority": "HIGH",
        })
        remediation_cost_low += g[0]
        remediation_cost_high += g[1]

    return {
        "current_tier":             current_tier,
        "target_tier":              target_tier,
        "already_qualifies":        current_tier >= target_tier,
        "gap_count":                len(gaps),
        "gaps":                     gaps,
        "total_remediation_cost_low_usd":  remediation_cost_low,
        "total_remediation_cost_high_usd": remediation_cost_high,
    }


def readiness_score(current_tier: str, target_tier: str, gap_count: int) -> float:
    """Return 0–100 readiness score."""
    tier_order = ["Tier I", "Tier II", "Tier III", "Tier IV"]
    c_idx = tier_order.index(current_tier)
    t_idx = tier_order.index(target_tier)

    if c_idx >= t_idx:
        return 100.0

    max_gaps = {
        ("Tier I", "Tier II"): 3,
        ("Tier I", "Tier III"): 6,
        ("Tier I", "Tier IV"): 8,
        ("Tier II", "Tier III"): 4,
        ("Tier II", "Tier IV"): 7,
        ("Tier III", "Tier IV"): 4,
    }.get((current_tier, target_tier), 5)

    score = max(0.0, (1.0 - gap_count / max_gaps) * 100.0)
    return round(score, 1)


def priority_steps(gaps: list) -> list:
    """Return ordered remediation steps from gap analysis."""
    priority_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    sorted_gaps = sorted(gaps, key=lambda g: priority_order.get(g["priority"], 99))
    return [
        f"[{g['priority']}] {g['remediation']} — Est. ${g['estimated_cost_low_usd']:,}–${g['estimated_cost_high_usd']:,}"
        for g in sorted_gaps
    ]


def main():
    if len(sys.argv) < 10:
        err = {
            "error": (
                "Usage: tier_certification.py <generator_config> <ups_topology> "
                "<cooling_redundancy> <power_paths> <fuel_runtime_hours> "
                "<transfer_switch_type> <has_concurrent_maintainability> "
                "<has_fault_tolerance> <target_tier>"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    generator_config    = sys.argv[1]
    ups_topology        = sys.argv[2]
    cooling_redundancy  = sys.argv[3]
    power_paths         = int(sys.argv[4])
    fuel_hours          = float(sys.argv[5])
    transfer_switch     = sys.argv[6]
    has_concurrent      = parse_bool(sys.argv[7])
    has_fault_tolerance = parse_bool(sys.argv[8])
    target_tier         = sys.argv[9]

    if target_tier not in TIER_REQUIREMENTS:
        err = {"error": f"Invalid target_tier '{target_tier}'. Must be one of: {', '.join(TIER_REQUIREMENTS)}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    has_n_plus_1 = detect_n_plus_1(generator_config) or detect_n_plus_1(ups_topology)
    has_2n       = detect_2n(generator_config) and detect_2n(ups_topology)
    has_sts      = "STS" in transfer_switch.upper()

    # If fault tolerance not explicitly set but 2N detected, infer it
    if has_2n and not has_fault_tolerance:
        has_fault_tolerance = True

    current = achieved_tier(
        power_paths, has_n_plus_1, has_concurrent, has_fault_tolerance,
        fuel_hours, has_sts
    )
    gap = build_gap_analysis(current, target_tier, {
        "power_paths":       power_paths,
        "has_n_plus_1":      has_n_plus_1,
        "has_concurrent":    has_concurrent,
        "has_fault_tolerance": has_fault_tolerance,
        "fuel_hours":        fuel_hours,
        "has_sts":           has_sts,
        "cooling_redundancy": cooling_redundancy,
    })

    score = readiness_score(current, target_tier, gap["gap_count"])
    steps = priority_steps(gap["gaps"])

    target_req = TIER_REQUIREMENTS[target_tier]
    current_req = TIER_REQUIREMENTS[current]

    result = {
        "current_tier":          current,
        "target_tier":           target_tier,
        "qualifies_for_target":  gap["already_qualifies"],
        "readiness_score_pct":   score,
        "current_tier_details": {
            "description":      current_req["description"],
            "uptime_pct":       current_req["uptime_pct"],
            "downtime_hrs_yr":  current_req["downtime_hrs_yr"],
        },
        "target_tier_details": {
            "description":      target_req["description"],
            "uptime_pct":       target_req["uptime_pct"],
            "downtime_hrs_yr":  target_req["downtime_hrs_yr"],
        },
        "assessed_capabilities": {
            "generator_config":    generator_config,
            "ups_topology":        ups_topology,
            "cooling_redundancy":  cooling_redundancy,
            "power_paths":         power_paths,
            "fuel_runtime_hours":  fuel_hours,
            "transfer_switch_type": transfer_switch,
            "has_n_plus_1":        has_n_plus_1,
            "has_concurrent_maintainability": has_concurrent,
            "has_fault_tolerance": has_fault_tolerance,
            "has_sts":             has_sts,
        },
        "gap_analysis":          gap,
        "priority_remediation_steps": steps,
        "total_remediation_cost_low_usd":  gap["total_remediation_cost_low_usd"],
        "total_remediation_cost_high_usd": gap["total_remediation_cost_high_usd"],
        "disclaimer": (
            "This is a readiness assessment, not official Uptime Institute certification. "
            "Official certification requires on-site audit by Uptime Institute-accredited engineers. "
            "See uptimeinstitute.com for official certification process."
        ),
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
