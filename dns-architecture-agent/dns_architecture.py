"""
DNS Architecture Design Agent
Usage: dns_architecture.py <rack_count> [zones_count=3] [dnssec_required=false]
"""

import sys
import json
import math


def main() -> None:
    if len(sys.argv) < 2 or len(sys.argv) > 4:
        print(json.dumps({"error": "Usage: dns_architecture.py <rack_count> [zones_count=3] [dnssec_required=false]"}), file=sys.stderr)
        sys.exit(1)

    try:
        rack_count = int(sys.argv[1])
        zones_count = int(sys.argv[2]) if len(sys.argv) >= 3 else 3
        dnssec_required_str = sys.argv[3].lower() if len(sys.argv) == 4 else "false"
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if rack_count < 1 or rack_count > 10000:
        print(json.dumps({"error": "rack_count must be 1-10000"}), file=sys.stderr)
        sys.exit(1)
    if zones_count < 1 or zones_count > 1000:
        print(json.dumps({"error": "zones_count must be 1-1000"}), file=sys.stderr)
        sys.exit(1)
    if dnssec_required_str not in ("true", "false"):
        print(json.dumps({"error": "dnssec_required must be true or false"}), file=sys.stderr)
        sys.exit(1)

    dnssec_required = dnssec_required_str == "true"

    # Primary DNS servers: 2 minimum, +1 per 500 racks
    primary_count = 2 + math.floor(rack_count / 500)

    # Recursive resolvers: 2 per zone
    recursive_count = zones_count * 2

    total_servers = (primary_count * 2) + recursive_count  # primary pair + resolvers

    anycast_required = zones_count > 3

    # QPS estimate: rack_count * assumed 20 hosts/rack * 0.1 DNS queries/sec/host
    estimated_qps = rack_count * 20 * 0.1

    # DNSSEC overhead
    dnssec_overhead_pct = 15 if dnssec_required else 0

    output = {
        "input": {
            "rack_count": rack_count,
            "zones_count": zones_count,
            "dnssec_required": dnssec_required,
        },
        "authoritative_server_count": primary_count * 2,
        "recursive_resolver_count": recursive_count,
        "total_dns_server_count": total_servers,
        "anycast_required": anycast_required,
        "split_horizon_zones": ["internal.dc", "mgmt.dc", "prod.dc"],
        "recommended_ttls": {
            "A_records_seconds": 300,
            "PTR_records_seconds": 3600,
            "SOA_seconds": 86400,
            "MX_records_seconds": 3600,
        },
        "estimated_qps": round(estimated_qps, 1),
        "cache_hit_rate_target_pct": 85,
        "dnssec_signing_overhead_pct": dnssec_overhead_pct,
        "notes": [
            f"{primary_count * 2} authoritative servers for zone redundancy across {zones_count} DNS zones.",
            "Anycast required" if anycast_required else "Unicast DNS adequate for this zone count.",
            "DNSSEC adds ~15% query processing overhead but strongly recommended for security." if dnssec_required else "Consider DNSSEC for production environments.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
