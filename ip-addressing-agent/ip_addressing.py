"""
IP Addressing Design Agent
Usage: ip_addressing.py <rack_count> <hosts_per_rack> [vlans_required=10]
"""

import sys
import json
import math


def main() -> None:
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(json.dumps({"error": "Usage: ip_addressing.py <rack_count> <hosts_per_rack> [vlans_required=10]"}), file=sys.stderr)
        sys.exit(1)

    try:
        rack_count = int(sys.argv[1])
        hosts_per_rack = int(sys.argv[2])
        vlans_required = int(sys.argv[3]) if len(sys.argv) == 4 else 10
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if rack_count < 1 or rack_count > 10000:
        print(json.dumps({"error": "rack_count must be 1-10000"}), file=sys.stderr)
        sys.exit(1)
    if hosts_per_rack < 1 or hosts_per_rack > 80:
        print(json.dumps({"error": "hosts_per_rack must be 1-80"}), file=sys.stderr)
        sys.exit(1)
    if vlans_required < 1 or vlans_required > 4094:
        print(json.dumps({"error": "vlans_required must be 1-4094"}), file=sys.stderr)
        sys.exit(1)

    total_hosts = rack_count * hosts_per_rack
    total_hosts_with_growth = math.ceil(total_hosts * 1.2)  # 20% growth buffer

    # Subnet per rack: /25 gives 126 hosts
    subnet_per_rack = "/25"

    # Pod subnet: /24 gives 254 hosts (1 pod = ~2 racks at 126 hosts each)
    pod_subnet = "/24"

    # Zone subnet: /22 gives 1022 hosts
    zone_subnet = "/22"

    # Find smallest supernet prefix
    # Need to fit total_hosts_with_growth IPs
    for prefix in range(8, 24):
        capacity = 2 ** (32 - prefix) - 2
        if capacity >= total_hosts_with_growth:
            recommended_prefix = prefix
            supernet_capacity = capacity
            break
    else:
        recommended_prefix = 8
        supernet_capacity = 16777214

    # Supernet assignment
    supernet = f"10.0.0.0/{recommended_prefix}"

    output = {
        "input": {
            "rack_count": rack_count,
            "hosts_per_rack": hosts_per_rack,
            "vlans_required": vlans_required,
        },
        "total_hosts_needed": total_hosts_with_growth,
        "recommended_supernet": supernet,
        "recommended_supernet_prefix": recommended_prefix,
        "supernet_capacity": supernet_capacity,
        "subnet_per_rack": f"10.x.x.0{subnet_per_rack} (126 hosts each)",
        "pod_subnet": f"10.x.x.0{pod_subnet} (254 hosts)",
        "zone_subnet": f"10.x.x.0{zone_subnet} (1022 hosts)",
        "address_space": {
            "servers": "10.0.0.0/8",
            "management": "172.16.0.0/12",
            "oob": "192.168.0.0/16",
        },
        "management_network": "172.16.0.0/24 (254 hosts)",
        "oob_network": "192.168.0.0/24 (254 hosts)",
        "vlan_scheme": {
            "data": "100-199",
            "management": "200-299",
            "storage": "300-399",
            "oob": "400-499",
            "vlans_needed": vlans_required,
        },
        "total_ip_space_size": supernet_capacity,
        "notes": [
            f"Total hosts including 20% growth buffer: {total_hosts_with_growth}.",
            f"Recommended supernet 10.0.0.0/{recommended_prefix} provides {supernet_capacity:,} usable addresses.",
            "Use /25 per rack, /24 per pod, /22 per zone for hierarchical aggregation.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
