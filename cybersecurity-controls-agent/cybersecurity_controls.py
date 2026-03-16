"""
Cybersecurity Controls Design Agent
Usage: cybersecurity_controls.py <facility_type> <compliance_framework> <network_zones>

facility_type: colo | hyperscale | enterprise | edge
compliance_framework: soc2 | pci_dss | hipaa | fedramp | iso27001
"""

import sys
import json
import math


FRAMEWORK_CONTROLS = {
    "soc2":     64,
    "pci_dss":  300,
    "hipaa":    75,
    "fedramp":  325,
    "iso27001": 114,
}

SIEM_EPS_BY_TYPE = {
    "enterprise":  5000,
    "colo":        10000,
    "hyperscale":  50000,
    "edge":        1000,
}


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: cybersecurity_controls.py <facility_type> <compliance_framework> <network_zones>"}), file=sys.stderr)
        sys.exit(1)

    try:
        facility_type = sys.argv[1].lower()
        compliance_framework = sys.argv[2].lower()
        network_zones = int(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if facility_type not in SIEM_EPS_BY_TYPE:
        print(json.dumps({"error": "facility_type must be: colo, hyperscale, enterprise, or edge"}), file=sys.stderr)
        sys.exit(1)
    if compliance_framework not in FRAMEWORK_CONTROLS:
        print(json.dumps({"error": "compliance_framework must be: soc2, pci_dss, hipaa, fedramp, or iso27001"}), file=sys.stderr)
        sys.exit(1)
    if network_zones < 1 or network_zones > 20:
        print(json.dumps({"error": "network_zones must be 1-20"}), file=sys.stderr)
        sys.exit(1)

    total_controls = FRAMEWORK_CONTROLS[compliance_framework]

    # Firewall pairs: network_zones + 2 (internet perimeter + OOB)
    firewall_pair_count = network_zones + 2

    # IDS/IPS sensors
    ids_ips_count = network_zones * 2

    # SIEM
    eps = SIEM_EPS_BY_TYPE[facility_type]
    # Storage (90 days): eps * 500 bytes * 86400 * 90 / GB_per_TB
    siem_storage_tb = (eps * 500 * 86400 * 90) / (1024 ** 4)

    # Vulnerability scanners
    vuln_scanner_count = math.ceil(network_zones / 5)

    # Pen test frequency
    if compliance_framework in ("fedramp", "pci_dss"):
        pentest_frequency = "quarterly"
    else:
        pentest_frequency = "annual"

    # Zero-trust requirement
    zero_trust_required = compliance_framework == "fedramp"
    zero_trust_recommended = compliance_framework in ("pci_dss",)

    # Annual security budget estimate
    firewall_cost = firewall_pair_count * 2 * 50000  # $50K per FW/year
    ids_cost = ids_ips_count * 20000
    siem_cost = 200000 + (eps * 10)  # base + per-EPS
    compliance_cost = total_controls * 500  # $500/control/year for maintenance
    estimated_annual_budget = firewall_cost + ids_cost + siem_cost + compliance_cost

    output = {
        "input": {
            "facility_type": facility_type,
            "compliance_framework": compliance_framework,
            "network_zones": network_zones,
        },
        "total_controls": total_controls,
        "firewall_pair_count": firewall_pair_count,
        "ids_ips_sensor_count": ids_ips_count,
        "siem_eps": eps,
        "siem_storage_90day_tb": round(siem_storage_tb, 2),
        "vuln_scanner_count": max(vuln_scanner_count, 1),
        "pentest_frequency": pentest_frequency,
        "zero_trust_required": zero_trust_required,
        "zero_trust_recommended": zero_trust_recommended,
        "estimated_annual_security_budget": round(estimated_annual_budget, 0),
        "notes": [
            f"{compliance_framework.upper()}: {total_controls} controls, {pentest_frequency} pen testing.",
            f"SIEM sized for {eps:,} EPS with {siem_storage_tb:.1f} TB 90-day retention.",
            "Zero-trust architecture required." if zero_trust_required else "Zero-trust architecture recommended." if zero_trust_recommended else "Perimeter-based security acceptable for this framework.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
