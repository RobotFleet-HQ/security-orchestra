"""
Network Topology Design Agent
Usage: network_topology.py <rack_count> <target_bandwidth_gbps> <redundancy_type>

redundancy_type: N+1 | 2N | mesh
"""

import sys
import json
import math


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: network_topology.py <rack_count> <target_bandwidth_gbps> <redundancy_type>"}), file=sys.stderr)
        sys.exit(1)

    try:
        rack_count = int(sys.argv[1])
        target_bandwidth_gbps = float(sys.argv[2])
        redundancy_type = sys.argv[3]
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if rack_count < 1 or rack_count > 10000:
        print(json.dumps({"error": "rack_count must be 1-10000"}), file=sys.stderr)
        sys.exit(1)
    if target_bandwidth_gbps < 1 or target_bandwidth_gbps > 100000:
        print(json.dumps({"error": "target_bandwidth_gbps must be 1-100000"}), file=sys.stderr)
        sys.exit(1)
    if redundancy_type not in ("N+1", "2N", "mesh"):
        print(json.dumps({"error": "redundancy_type must be N+1, 2N, or mesh"}), file=sys.stderr)
        sys.exit(1)

    # Port speed recommendation
    if target_bandwidth_gbps < 10:
        port_speed_gbps = 10
    elif target_bandwidth_gbps < 100:
        port_speed_gbps = 40
    else:
        port_speed_gbps = 100

    # Spine-leaf topology calculations
    ports_per_leaf = 48
    leaf_count = math.ceil(rack_count / ports_per_leaf)
    spine_count = math.ceil(leaf_count / 2) * 2

    if redundancy_type == "2N":
        leaf_count = leaf_count * 2
        spine_count = spine_count * 2
    elif redundancy_type == "mesh":
        spine_count = max(spine_count, 4)

    total_switch_count = leaf_count + spine_count

    # Oversubscription ratios
    oversubscription_ratio = 3.0
    if target_bandwidth_gbps > 1000:
        oversubscription_ratio = 1.0
    elif target_bandwidth_gbps > 100:
        oversubscription_ratio = 2.0

    # Port calculations
    downlink_ports = rack_count * 2  # dual-homed racks
    uplink_ports = leaf_count * spine_count  # full mesh
    total_ports = downlink_ports + uplink_ports + spine_count * leaf_count

    # Bandwidth capacity
    bandwidth_capacity_gbps = leaf_count * ports_per_leaf * port_speed_gbps / oversubscription_ratio

    # Latency (leaf-spine)
    estimated_latency_us = 3.0 if port_speed_gbps >= 100 else 5.0

    # Redundancy paths
    if redundancy_type == "N+1":
        redundancy_paths = 2
    elif redundancy_type == "2N":
        redundancy_paths = 4
    else:
        redundancy_paths = spine_count

    output = {
        "input": {
            "rack_count": rack_count,
            "target_bandwidth_gbps": target_bandwidth_gbps,
            "redundancy_type": redundancy_type,
        },
        "recommended_topology": "spine_leaf",
        "switch_counts": {
            "leaf_switches": leaf_count,
            "spine_switches": spine_count,
            "total_switches": total_switch_count,
        },
        "port_speeds": {
            "recommended_speed_gbps": port_speed_gbps,
            "downlink_ports_per_leaf": ports_per_leaf,
        },
        "oversubscription_ratio": f"{oversubscription_ratio:.0f}:1",
        "estimated_latency_us": estimated_latency_us,
        "total_ports": total_ports,
        "bandwidth_capacity_gbps": round(bandwidth_capacity_gbps, 1),
        "redundancy_paths": redundancy_paths,
        "vlan_planning": {
            "data_vlans": "100-199",
            "mgmt_vlans": "200-299",
            "storage_vlans": "300-399",
            "oob_vlans": "400-499",
        },
        "notes": [
            f"Spine-leaf topology recommended for {rack_count} racks with {target_bandwidth_gbps} Gbps target.",
            f"Estimated leaf-to-spine latency: {estimated_latency_us} microseconds.",
            f"MLAG/vPC recommended on leaf switches for dual-homed server connectivity.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
