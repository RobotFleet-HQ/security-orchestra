"""
BGP Peering Strategy Agent
Usage: bgp_peering.py <asn> <peer_count> <transit_providers>
"""

import sys
import json
import math


FULL_TABLE_ROUTES = 950000
BYTES_PER_ROUTE = 200


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: bgp_peering.py <asn> <peer_count> <transit_providers>"}), file=sys.stderr)
        sys.exit(1)

    try:
        asn = int(sys.argv[1])
        peer_count = int(sys.argv[2])
        transit_providers = int(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if asn < 1 or asn > 4294967295:
        print(json.dumps({"error": "asn must be 1-4294967295"}), file=sys.stderr)
        sys.exit(1)
    if peer_count < 1 or peer_count > 200:
        print(json.dumps({"error": "peer_count must be 1-200"}), file=sys.stderr)
        sys.exit(1)
    if transit_providers < 1 or transit_providers > 10:
        print(json.dumps({"error": "transit_providers must be 1-10"}), file=sys.stderr)
        sys.exit(1)

    # Full table memory per peer (MB)
    full_table_memory_mb = (FULL_TABLE_ROUTES * BYTES_PER_ROUTE) / (1024 * 1024)

    # Route reflectors
    rr_count = math.ceil(peer_count / 50)

    # eBGP sessions
    ebgp_count = transit_providers + peer_count

    # iBGP: full mesh vs route reflectors
    # With RR: each peer has 2 RR sessions (primary + backup)
    ibgp_count = peer_count * 2  # using route reflectors

    # Routing policy recommendation
    if transit_providers > 1:
        routing_policy = "full_table"
        routing_policy_reason = "Multiple transit providers enable traffic engineering with full BGP table."
    else:
        routing_policy = "default_route"
        routing_policy_reason = "Single transit provider; default route sufficient, saves memory."

    # BGP convergence estimate: 30s keepalive, 90s hold timer, ~3x hold = detection
    # Fast convergence with BFD: ~1 second
    convergence_time_s = 90  # without BFD; 1s with BFD

    output = {
        "input": {
            "asn": asn,
            "peer_count": peer_count,
            "transit_providers": transit_providers,
        },
        "full_table_memory_mb_per_peer": round(full_table_memory_mb, 1),
        "full_table_routes": FULL_TABLE_ROUTES,
        "route_reflector_count": rr_count,
        "ebgp_session_count": ebgp_count,
        "ibgp_session_count": ibgp_count,
        "recommended_routing_policy": routing_policy,
        "routing_policy_reason": routing_policy_reason,
        "bgp_timers": {
            "keepalive_seconds": 30,
            "hold_timer_seconds": 90,
        },
        "bgp_convergence_time_estimate_s": convergence_time_s,
        "prefix_filter_recommended": True,
        "community_scheme": {
            "transit": "local-pref 100",
            "peer": "local-pref 200",
            "customer": "local-pref 300",
        },
        "notes": [
            f"ASN {asn}: {rr_count} route reflectors recommended for {peer_count} iBGP peers.",
            f"Full BGP table ~{FULL_TABLE_ROUTES:,} routes requires {full_table_memory_mb:.0f} MB per peer session.",
            "Deploy BFD (Bidirectional Forwarding Detection) for sub-second failure detection.",
            "Implement RPKI ROA validation to prevent BGP hijacking.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
