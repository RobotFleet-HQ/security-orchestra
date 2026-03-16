"""
Compliance Checker Agent (Multi-Framework)
Usage: compliance_checker.py <frameworks> <facility_type> <current_tier>

frameworks: comma-separated list of: soc2,pci_dss,hipaa,fedramp,iso27001,nist_csf
facility_type: colo | hyperscale | enterprise | edge
current_tier: 1-4
"""

import sys
import json
import math


FRAMEWORK_DATA = {
    "soc2": {
        "controls": 64,
        "audit_frequency": "annual",
        "cert_cost_low": 50000,
        "cert_cost_high": 150000,
        "tier_requirement": 2,
        "formal_certification": True,
    },
    "pci_dss": {
        "controls": 300,
        "audit_frequency": "quarterly + annual",
        "cert_cost_low": 30000,
        "cert_cost_high": 200000,
        "tier_requirement": 2,
        "formal_certification": True,
    },
    "hipaa": {
        "controls": 75,
        "audit_frequency": "annual",
        "cert_cost_low": 20000,
        "cert_cost_high": 80000,
        "tier_requirement": 2,
        "formal_certification": False,
    },
    "fedramp": {
        "controls": 325,
        "audit_frequency": "annual + continuous",
        "cert_cost_low": 500000,
        "cert_cost_high": 2000000,
        "tier_requirement": 2,
        "formal_certification": True,
    },
    "iso27001": {
        "controls": 114,
        "audit_frequency": "annual + surveillance",
        "cert_cost_low": 30000,
        "cert_cost_high": 100000,
        "tier_requirement": 1,
        "formal_certification": True,
    },
    "nist_csf": {
        "controls": 108,
        "audit_frequency": "self-assessed",
        "cert_cost_low": 0,
        "cert_cost_high": 50000,
        "tier_requirement": 1,
        "formal_certification": False,
    },
}

VALID_FRAMEWORKS = set(FRAMEWORK_DATA.keys())


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: compliance_checker.py <frameworks> <facility_type> <current_tier>"}), file=sys.stderr)
        sys.exit(1)

    try:
        frameworks_raw = sys.argv[1]
        facility_type = sys.argv[2].lower()
        current_tier = int(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    frameworks = [f.strip().lower() for f in frameworks_raw.split(",") if f.strip()]
    invalid = [f for f in frameworks if f not in VALID_FRAMEWORKS]
    if invalid:
        print(json.dumps({"error": f"Unknown frameworks: {invalid}. Valid: {sorted(VALID_FRAMEWORKS)}"}), file=sys.stderr)
        sys.exit(1)
    if not frameworks:
        print(json.dumps({"error": "At least one framework required"}), file=sys.stderr)
        sys.exit(1)

    if facility_type not in ("colo", "hyperscale", "enterprise", "edge"):
        print(json.dumps({"error": "facility_type must be: colo, hyperscale, enterprise, or edge"}), file=sys.stderr)
        sys.exit(1)
    if current_tier < 1 or current_tier > 4:
        print(json.dumps({"error": "current_tier must be 1-4"}), file=sys.stderr)
        sys.exit(1)

    # Per-framework details
    framework_details = {}
    total_raw_controls = 0
    total_cost_low = 0
    total_cost_high = 0
    tier_gaps = []

    for fw in frameworks:
        data = FRAMEWORK_DATA[fw]
        total_raw_controls += data["controls"]
        total_cost_low += data["cert_cost_low"]
        total_cost_high += data["cert_cost_high"]
        if data["tier_requirement"] > current_tier:
            tier_gaps.append(f"{fw.upper()} requires Tier {data['tier_requirement']} (current: Tier {current_tier})")
        framework_details[fw] = {
            "controls": data["controls"],
            "audit_frequency": data["audit_frequency"],
            "cert_cost_range": f"${data['cert_cost_low']:,}-${data['cert_cost_high']:,}",
            "tier_requirement": data["tier_requirement"],
            "formal_certification": data["formal_certification"],
        }

    # Overlap: ~30% of controls overlap between frameworks
    overlapping_controls = math.floor(total_raw_controls * 0.30) if len(frameworks) > 1 else 0
    total_unique_controls = total_raw_controls - overlapping_controls

    # Annual cost estimate (midpoint)
    estimated_annual_cost = (total_cost_low + total_cost_high) // 2

    # Quick wins: frameworks with low cost and high value
    quick_wins = []
    if "iso27001" in frameworks:
        quick_wins.append("ISO 27001 maps to most other frameworks — certify first to reduce effort")
    if "nist_csf" in frameworks:
        quick_wins.append("NIST CSF self-assessment provides roadmap without formal audit cost")
    if "soc2" in frameworks and "iso27001" in frameworks:
        quick_wins.append("SOC 2 and ISO 27001 share ~40% controls — pursue simultaneously")

    output = {
        "input": {
            "frameworks": frameworks,
            "facility_type": facility_type,
            "current_tier": current_tier,
        },
        "frameworks_analyzed": len(frameworks),
        "total_unique_controls": total_unique_controls,
        "overlapping_controls": overlapping_controls,
        "framework_details": framework_details,
        "tier_gaps": tier_gaps,
        "estimated_total_annual_compliance_cost": estimated_annual_cost,
        "cost_range": f"${total_cost_low:,}-${total_cost_high:,}",
        "prioritized_quick_wins": quick_wins,
        "notes": [
            f"Analyzing {len(frameworks)} framework(s): {', '.join(f.upper() for f in frameworks)}.",
            f"Total unique controls after ~30% overlap reduction: {total_unique_controls}.",
            f"Tier gaps: {tier_gaps if tier_gaps else 'None — current Tier meets all framework requirements.'}",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
