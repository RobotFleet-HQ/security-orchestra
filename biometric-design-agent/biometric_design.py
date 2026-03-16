"""
Biometric Access Control Design Agent
Usage: biometric_design.py <staff_count> <security_zones> <biometric_type>

biometric_type: fingerprint | iris | face | palm | multifactor
"""

import sys
import json
import math


BIOMETRIC_SPECS = {
    "fingerprint": {
        "far_pct": 0.001,
        "frr_pct": 0.1,
        "throughput_per_min": 20,
        "template_kb": 1,
        "cost_per_reader": 2500,
    },
    "iris": {
        "far_pct": 0.0001,
        "frr_pct": 0.1,
        "throughput_per_min": 15,
        "template_kb": 2,
        "cost_per_reader": 8000,
    },
    "face": {
        "far_pct": 0.01,
        "frr_pct": 1.0,
        "throughput_per_min": 25,
        "template_kb": 5,
        "cost_per_reader": 5000,
    },
    "palm": {
        "far_pct": 0.001,
        "frr_pct": 0.1,
        "throughput_per_min": 20,
        "template_kb": 2,
        "cost_per_reader": 3500,
    },
    "multifactor": {
        "far_pct": 0.00001,
        "frr_pct": 0.5,
        "throughput_per_min": 12,
        "template_kb": 10,
        "cost_per_reader": 12000,
    },
}


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: biometric_design.py <staff_count> <security_zones> <biometric_type>"}), file=sys.stderr)
        sys.exit(1)

    try:
        staff_count = int(sys.argv[1])
        security_zones = int(sys.argv[2])
        biometric_type = sys.argv[3].lower()
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if staff_count < 1 or staff_count > 100000:
        print(json.dumps({"error": "staff_count must be 1-100000"}), file=sys.stderr)
        sys.exit(1)
    if security_zones < 1 or security_zones > 10:
        print(json.dumps({"error": "security_zones must be 1-10"}), file=sys.stderr)
        sys.exit(1)
    if biometric_type not in BIOMETRIC_SPECS:
        print(json.dumps({"error": "biometric_type must be: fingerprint, iris, face, palm, or multifactor"}), file=sys.stderr)
        sys.exit(1)

    specs = BIOMETRIC_SPECS[biometric_type]

    # Readers: 2 per zone (entry + exit)
    total_readers = security_zones * 2

    # Peak throughput
    peak_throughput_per_min = total_readers * specs["throughput_per_min"]

    # Enrollment DB size
    enrollment_db_mb = (staff_count * specs["template_kb"]) / 1024.0

    # System cost estimate
    reader_cost = total_readers * specs["cost_per_reader"]
    server_cost = math.ceil(staff_count / 5000) * 15000  # $15K per enrollment server
    software_cost = staff_count * 50  # $50/user license
    estimated_system_cost = reader_cost + server_cost + software_cost

    output = {
        "input": {
            "staff_count": staff_count,
            "security_zones": security_zones,
            "biometric_type": biometric_type,
        },
        "total_readers": total_readers,
        "reader_type": biometric_type,
        "far_pct": specs["far_pct"],
        "frr_pct": specs["frr_pct"],
        "peak_throughput_per_min": peak_throughput_per_min,
        "enrollment_db_size_mb": round(enrollment_db_mb, 2),
        "backup_auth_method": "PIN + proximity card (FIPS 201 PIV recommended)",
        "estimated_system_cost": round(estimated_system_cost, 0),
        "compliance_notes": [
            "FedRAMP/HSPD-12 requires FIPS 201 PIV card as primary with biometric as secondary.",
            "GDPR/CCPA: biometric data requires explicit consent and secure storage.",
            f"FAR {specs['far_pct']}%: 1 in {int(100/specs['far_pct']):,} unauthorized access attempts.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
