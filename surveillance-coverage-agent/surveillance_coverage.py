"""
Video Surveillance Coverage Agent
Usage: surveillance_coverage.py <facility_sqft> <camera_resolution> <retention_days>

camera_resolution: 2mp | 4mp | 8mp | 12mp
"""

import sys
import json
import math


CAMERA_SPECS = {
    "2mp":  {"range_ft": 30,  "bitrate_mbps": 4,  "cost_per_camera": 300},
    "4mp":  {"range_ft": 50,  "bitrate_mbps": 8,  "cost_per_camera": 500},
    "8mp":  {"range_ft": 80,  "bitrate_mbps": 16, "cost_per_camera": 900},
    "12mp": {"range_ft": 100, "bitrate_mbps": 25, "cost_per_camera": 1400},
}

RECOMMENDED_ZONES = [
    "Server floor (hot/cold aisles)",
    "Cage and colocation areas",
    "Loading dock and shipping/receiving",
    "Perimeter and exterior access points",
    "Network operations center (NOC)",
    "MER/EF (mechanical and electrical rooms)",
    "Roof access points",
    "Parking areas",
]


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: surveillance_coverage.py <facility_sqft> <camera_resolution> <retention_days>"}), file=sys.stderr)
        sys.exit(1)

    try:
        facility_sqft = float(sys.argv[1])
        camera_resolution = sys.argv[2].lower()
        retention_days = int(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if facility_sqft < 1000 or facility_sqft > 5000000:
        print(json.dumps({"error": "facility_sqft must be 1000-5000000"}), file=sys.stderr)
        sys.exit(1)
    if camera_resolution not in CAMERA_SPECS:
        print(json.dumps({"error": "camera_resolution must be: 2mp, 4mp, 8mp, or 12mp"}), file=sys.stderr)
        sys.exit(1)
    if retention_days < 1 or retention_days > 365:
        print(json.dumps({"error": "retention_days must be 1-365"}), file=sys.stderr)
        sys.exit(1)

    specs = CAMERA_SPECS[camera_resolution]
    range_ft = specs["range_ft"]
    bitrate_mbps = specs["bitrate_mbps"]

    # Coverage per camera with 60% efficiency due to placement constraints
    coverage_per_camera_sqft = math.pi * (range_ft ** 2) * 0.60

    # Camera count with 20% overlap buffer
    cameras_needed = math.ceil((facility_sqft / coverage_per_camera_sqft) * 1.2)

    # Total bandwidth
    total_bandwidth_mbps = cameras_needed * bitrate_mbps

    # Storage calculation: bitrate_bps * retention_days * 86400 / 8 / GB_to_TB
    storage_tb = (total_bandwidth_mbps * 1_000_000 * retention_days * 86400) / (8 * 1024 ** 4)

    # NVR count (64 cameras per NVR)
    nvr_count = math.ceil(cameras_needed / 64)

    # Cost estimate
    camera_cost = cameras_needed * specs["cost_per_camera"]
    nvr_cost = nvr_count * 8000  # $8K per NVR
    storage_cost = math.ceil(storage_tb) * 200  # $200/TB
    installation_cost = (cameras_needed * 300) + (nvr_count * 500)  # labor
    estimated_system_cost = camera_cost + nvr_cost + storage_cost + installation_cost

    output = {
        "input": {
            "facility_sqft": facility_sqft,
            "camera_resolution": camera_resolution,
            "retention_days": retention_days,
        },
        "camera_count": cameras_needed,
        "storage_required_tb": round(storage_tb, 2),
        "total_bandwidth_mbps": round(total_bandwidth_mbps, 1),
        "nvr_count": nvr_count,
        "recommended_zones": RECOMMENDED_ZONES,
        "estimated_system_cost": round(estimated_system_cost, 0),
        "retention_period_days": retention_days,
        "camera_specs": {
            "resolution": camera_resolution,
            "range_ft": range_ft,
            "bitrate_mbps": bitrate_mbps,
            "coverage_per_camera_sqft": round(coverage_per_camera_sqft, 0),
        },
        "notes": [
            f"{cameras_needed} cameras at {camera_resolution} resolution for {facility_sqft:,.0f} sqft.",
            f"Storage: {storage_tb:.1f} TB for {retention_days}-day retention at {bitrate_mbps} Mbps per camera.",
            f"{nvr_count} NVR(s) supporting up to 64 cameras each.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
