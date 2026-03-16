"""
Generator Noise Compliance Agent
CLI: python noise_compliance.py <generator_db_at_23ft> <distance_to_property_line_ft> <local_limit_db> [zoning=commercial]

zoning: "residential", "commercial", "industrial"
"""

import sys
import json
import math


ZONING_LIMITS = {
    "residential": {"daytime": 55, "nighttime": 45},
    "commercial":  {"daytime": 65, "nighttime": 55},
    "industrial":  {"daytime": 75, "nighttime": 75},
}

VALID_ZONINGS = {"residential", "commercial", "industrial"}


def spl_at_distance(reference_db: float, reference_distance_ft: float, target_distance_ft: float) -> float:
    """
    Sound pressure level at target distance using inverse square law.
    SPL = reference_db - 20 * log10(target_distance / reference_distance)
    """
    if target_distance_ft <= 0:
        raise ValueError("Distance must be positive")
    return reference_db - 20.0 * math.log10(target_distance_ft / reference_distance_ft)


def required_attenuation(calculated_db: float, limit_db: float) -> float:
    return max(0.0, calculated_db - limit_db)


def enclosure_type(req_db: float):
    if req_db <= 5:
        return "standard", "Standard generator housing (factory-installed)", 0.0
    elif req_db <= 15:
        return "critical", "Critical grade enclosure — heavy-gauge steel with acoustic lining", 5500.0
    elif req_db <= 25:
        return "hospital", "Hospital grade enclosure — multi-layer acoustic barrier with vibration isolation", 14000.0
    else:
        return "acoustic_vault", "Acoustic room/vault — concrete or masonry enclosure with ventilation silencers", 40000.0


def barrier_wall_cost(distance_ft: float) -> float:
    """
    Estimate cost for 8-inch CMU barrier wall.
    Wall length assumed = 2× the setback distance (wraps around).
    Height = 2× distance for good shielding (simplified: use practical max ~20 ft).
    Cost: ~$40-60/sqft installed for 8" CMU.
    """
    wall_length_ft = distance_ft * 2.0
    wall_height_ft = min(distance_ft * 2.0, 20.0)  # practical max 20 ft
    wall_area_sqft = wall_length_ft * wall_height_ft
    cost_per_sqft = 50.0  # midpoint of $40-60/sqft
    return wall_area_sqft * cost_per_sqft


def main():
    if len(sys.argv) < 4:
        err = {"error": "Usage: noise_compliance.py <generator_db_at_23ft> <distance_to_property_line_ft> <local_limit_db> [zoning=commercial]"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        gen_db = float(sys.argv[1])
        distance_ft = float(sys.argv[2])
        local_limit = float(sys.argv[3])
    except ValueError as e:
        print(json.dumps({"error": f"Invalid numeric argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    zoning = sys.argv[4] if len(sys.argv) > 4 else "commercial"
    if zoning not in VALID_ZONINGS:
        print(json.dumps({"error": f"zoning must be one of: {', '.join(sorted(VALID_ZONINGS))}"}), file=sys.stderr)
        sys.exit(1)

    if gen_db <= 0:
        print(json.dumps({"error": "generator_db_at_23ft must be positive"}), file=sys.stderr)
        sys.exit(1)
    if distance_ft <= 0:
        print(json.dumps({"error": "distance_to_property_line_ft must be positive"}), file=sys.stderr)
        sys.exit(1)

    # --- Sound propagation ---
    calculated_db = spl_at_distance(gen_db, 23.0, distance_ft)
    excess = calculated_db - local_limit
    compliant = excess <= 0.0
    req_db = max(0.0, excess)

    # --- Enclosure ---
    enc_type, enc_desc, enc_cost = enclosure_type(req_db)

    # --- Barrier wall ---
    barrier_needed = req_db > 15.0  # recommend wall for high attenuation needs
    barrier_attenuation = 12.5  # midpoint of 10-15 dB
    wall_cost = barrier_wall_cost(distance_ft) if barrier_needed else 0.0
    wall_spec = "8-inch CMU masonry wall, height = min(2× setback, 20 ft)" if barrier_needed else "Not required"

    # --- Compliance path ---
    zoning_info = ZONING_LIMITS[zoning]
    if compliant:
        compliance_path = (
            f"Generator is compliant at {calculated_db:.1f} dB — below the {local_limit} dB limit. "
            f"No additional attenuation required."
        )
    elif req_db <= 5:
        compliance_path = (
            f"Minor exceedance of {excess:.1f} dB. Standard housing sufficient. "
            f"Verify manufacturer spec sheet confirms attenuation."
        )
    elif req_db <= 15:
        compliance_path = (
            f"Moderate exceedance of {excess:.1f} dB. Install critical grade enclosure "
            f"on each generator unit to achieve compliance."
        )
    elif req_db <= 25:
        compliance_path = (
            f"Significant exceedance of {excess:.1f} dB. Hospital grade enclosure required. "
            f"Consider relocating generator pad or adding barrier wall."
        )
    else:
        compliance_path = (
            f"Severe exceedance of {excess:.1f} dB. Acoustic vault or dedicated generator room required. "
            f"Consult acoustic engineer. Generator relocation may be more cost-effective."
        )

    # --- Notes ---
    notes = [
        f"Reference level: {gen_db} dB at 23 ft (manufacturer spec point).",
        f"Propagation model: inverse square law — 6 dB reduction per doubling of distance.",
        f"Calculated level at {distance_ft} ft property line: {calculated_db:.1f} dB.",
        f"Typical {zoning} zoning limits: {zoning_info['daytime']} dB daytime, {zoning_info['nighttime']} dB nighttime.",
        f"Local limit used for analysis: {local_limit} dB.",
    ]
    if not compliant:
        notes.append(f"Required attenuation: {req_db:.1f} dB to achieve compliance.")
    if barrier_needed:
        notes.append(
            "Barrier wall provides 10–15 dB additional attenuation at target. "
            "Wall must extend beyond noise source sightlines to be effective."
        )
    notes.append("For multiple generators, add 3 dB per doubling of generator count to the reference level.")
    notes.append("Nighttime limits are more restrictive — evaluate against both daytime and nighttime thresholds.")

    output = {
        "input": {
            "generator_db_at_23ft": gen_db,
            "distance_to_property_line_ft": distance_ft,
            "local_limit_db": local_limit,
            "zoning": zoning,
        },
        "sound_analysis": {
            "generator_db_at_23ft": gen_db,
            "distance_to_property_line_ft": distance_ft,
            "calculated_db_at_boundary": round(calculated_db, 2),
            "local_limit_db": local_limit,
            "excess_db": round(excess, 2),
            "compliant": compliant,
        },
        "attenuation_required": {
            "required_db": round(req_db, 2),
            "enclosure_type": enc_type,
            "enclosure_description": enc_desc,
            "enclosure_cost_per_generator": enc_cost,
        },
        "barrier_wall": {
            "recommended": barrier_needed,
            "additional_attenuation_db": barrier_attenuation if barrier_needed else 0.0,
            "wall_spec": wall_spec,
            "estimated_cost": round(wall_cost, 2),
        },
        "compliance_path": compliance_path,
        "notes": notes,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
