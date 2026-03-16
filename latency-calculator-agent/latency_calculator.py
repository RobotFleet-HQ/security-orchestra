"""
Latency Calculator Agent
Usage: latency_calculator.py <distance_km> <medium> [hops=1]

medium: fiber | copper | wireless
"""

import sys
import json
import math


SPEEDS_KM_PER_S = {
    "fiber":    200000.0,
    "copper":   200000.0,
    "wireless": 300000.0,
}

PER_HOP_PROCESSING_MS = 0.5


def main() -> None:
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(json.dumps({"error": "Usage: latency_calculator.py <distance_km> <medium> [hops=1]"}), file=sys.stderr)
        sys.exit(1)

    try:
        distance_km = float(sys.argv[1])
        medium = sys.argv[2].lower()
        hops = int(sys.argv[3]) if len(sys.argv) == 4 else 1
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if distance_km < 0.1 or distance_km > 40000:
        print(json.dumps({"error": "distance_km must be 0.1-40000"}), file=sys.stderr)
        sys.exit(1)
    if medium not in SPEEDS_KM_PER_S:
        print(json.dumps({"error": "medium must be fiber, copper, or wireless"}), file=sys.stderr)
        sys.exit(1)
    if hops < 1 or hops > 100:
        print(json.dumps({"error": "hops must be 1-100"}), file=sys.stderr)
        sys.exit(1)

    speed = SPEEDS_KM_PER_S[medium]
    propagation_delay_ms = (distance_km / speed) * 1000.0
    processing_ms = hops * PER_HOP_PROCESSING_MS
    one_way_latency_ms = propagation_delay_ms + processing_ms
    rtt_ms = one_way_latency_ms * 2.0

    # Classification
    if rtt_ms < 1.0:
        classification = "excellent"
    elif rtt_ms < 5.0:
        classification = "good"
    elif rtt_ms < 20.0:
        classification = "acceptable"
    else:
        classification = "poor"

    # Max distance for 1ms RTT (0.5ms one-way propagation budget)
    max_distance_for_1ms_km = (0.5 / 1000.0) * speed

    output = {
        "input": {
            "distance_km": distance_km,
            "medium": medium,
            "hops": hops,
        },
        "propagation_delay_ms": round(propagation_delay_ms, 4),
        "per_hop_processing_ms": PER_HOP_PROCESSING_MS,
        "total_processing_ms": round(processing_ms, 2),
        "one_way_latency_ms": round(one_way_latency_ms, 4),
        "rtt_ms": round(rtt_ms, 4),
        "classification": classification,
        "max_distance_for_1ms_rtt_km": round(max_distance_for_1ms_km, 1),
        "notes": [
            f"Speed of light in {medium}: {speed:,.0f} km/s.",
            f"Propagation delay at {distance_km} km: {propagation_delay_ms:.4f} ms one-way.",
            f"RTT {rtt_ms:.4f} ms classified as {classification}.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
