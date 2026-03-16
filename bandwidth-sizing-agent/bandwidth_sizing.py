"""
Bandwidth Sizing Agent
Usage: bandwidth_sizing.py <rack_count> <servers_per_rack> <bandwidth_per_server_gbps>
"""

import sys
import json
import math


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: bandwidth_sizing.py <rack_count> <servers_per_rack> <bandwidth_per_server_gbps>"}), file=sys.stderr)
        sys.exit(1)

    try:
        rack_count = int(sys.argv[1])
        servers_per_rack = int(sys.argv[2])
        bandwidth_per_server_gbps = float(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if rack_count < 1 or rack_count > 10000:
        print(json.dumps({"error": "rack_count must be 1-10000"}), file=sys.stderr)
        sys.exit(1)
    if servers_per_rack < 1 or servers_per_rack > 80:
        print(json.dumps({"error": "servers_per_rack must be 1-80"}), file=sys.stderr)
        sys.exit(1)
    if bandwidth_per_server_gbps < 0.1 or bandwidth_per_server_gbps > 400:
        print(json.dumps({"error": "bandwidth_per_server_gbps must be 0.1-400"}), file=sys.stderr)
        sys.exit(1)

    total_server_bandwidth_gbps = rack_count * servers_per_rack * bandwidth_per_server_gbps
    total_bandwidth_tbps = total_server_bandwidth_gbps / 1000.0

    east_west_tbps = total_bandwidth_tbps * 0.8
    north_south_tbps = total_bandwidth_tbps * 0.2

    # Fabric speed recommendation
    if total_server_bandwidth_gbps < 100:
        recommended_fabric_speed_gbps = 10
    elif total_server_bandwidth_gbps < 1000:
        recommended_fabric_speed_gbps = 100
    else:
        recommended_fabric_speed_gbps = 400

    # Spine uplinks at 3:1 oversubscription
    spine_uplink_count = math.ceil(total_server_bandwidth_gbps / 3 / recommended_fabric_speed_gbps)

    # Internet egress: 10% of north-south
    internet_egress_gbps = round(north_south_tbps * 1000 / 10, 1)

    # WAN circuits
    wan_circuit_capacity = 100  # Gbps per WAN circuit
    wan_circuit_count = math.ceil(internet_egress_gbps / wan_circuit_capacity)

    output = {
        "input": {
            "rack_count": rack_count,
            "servers_per_rack": servers_per_rack,
            "bandwidth_per_server_gbps": bandwidth_per_server_gbps,
        },
        "total_bandwidth_tbps": round(total_bandwidth_tbps, 3),
        "east_west_tbps": round(east_west_tbps, 3),
        "north_south_tbps": round(north_south_tbps, 3),
        "recommended_fabric_speed_gbps": recommended_fabric_speed_gbps,
        "spine_uplink_count": max(spine_uplink_count, 2),
        "internet_egress_gbps": internet_egress_gbps,
        "wan_circuit_count": max(wan_circuit_count, 2),
        "oversubscription": {
            "3_to_1": round(total_server_bandwidth_gbps / 3, 1),
            "1_to_1": round(total_server_bandwidth_gbps, 1),
        },
        "notes": [
            f"Total server bandwidth: {total_server_bandwidth_gbps:.1f} Gbps across {rack_count * servers_per_rack} servers.",
            "East-west traffic (80%) dominates; spine fabric must handle 3:1 oversubscription minimum.",
            f"Recommended {recommended_fabric_speed_gbps}G fabric with {max(wan_circuit_count, 2)} redundant WAN circuits.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
