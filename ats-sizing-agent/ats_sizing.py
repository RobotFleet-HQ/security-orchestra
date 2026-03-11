"""
Automatic Transfer Switch Sizing per NEC Articles 700, 701, 702
CLI: python ats_sizing.py <load_kw> <voltage> <phases> <application_type>
"""

import sys
import json
import math


POWER_FACTOR = 0.85
NEC_125_PCT = 1.25

VALID_VOLTAGES = {120, 208, 240, 277, 480, 600}
VALID_PHASES = {1, 3}
VALID_APPLICATION_TYPES = {"emergency", "legally_required", "optional", "critical"}

STANDARD_ATS_RATINGS = [100, 150, 200, 225, 260, 400, 600, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000]

NEC_ARTICLE_MAP = {
    "emergency": "700",
    "legally_required": "701",
    "optional": "702",
    "critical": "700",
}

TRANSFER_TIME_LIMITS = {
    "emergency": 10,
    "legally_required": 60,
    "optional": None,
    "critical": 10,
}

# Interrupt ratings by ATS ampere rating
def get_interrupt_rating(rated_amps):
    if rated_amps <= 600:
        return 22
    elif rated_amps <= 1200:
        return 42
    elif rated_amps <= 2000:
        return 65
    else:
        return 100

# Conductor sizing per NEC 310 (simplified ampacity table)
CONDUCTOR_TABLE = {
    100: "1 AWG",
    150: "2/0 AWG",
    200: "3/0 AWG",
    225: "4/0 AWG",
    260: "350 kcmil",
    400: "600 kcmil",
    600: "2x 350 kcmil",
    800: "2x 500 kcmil",
}


def parse_args(argv):
    if len(argv) < 4:
        raise ValueError(
            "Usage: ats_sizing.py <load_kw> <voltage> <phases> [application_type]"
        )

    load_kw = float(argv[1])
    if not (0.1 <= load_kw <= 10000):
        raise ValueError(f"load_kw must be between 0.1 and 10000, got {load_kw}")

    voltage = int(argv[2])
    if voltage not in VALID_VOLTAGES:
        raise ValueError(f"voltage must be one of {sorted(VALID_VOLTAGES)}, got {voltage}")

    phases = int(argv[3])
    if phases not in VALID_PHASES:
        raise ValueError(f"phases must be 1 or 3, got {phases}")

    application_type = argv[4].lower() if len(argv) > 4 else "emergency"
    if application_type not in VALID_APPLICATION_TYPES:
        raise ValueError(
            f"application_type must be one of {sorted(VALID_APPLICATION_TYPES)}, got {application_type}"
        )

    return load_kw, voltage, phases, application_type


def compute_load_amps(load_kw, voltage, phases):
    if phases == 3:
        amps = (load_kw * 1000.0) / (math.sqrt(3) * voltage * POWER_FACTOR)
    else:
        amps = (load_kw * 1000.0) / (voltage * POWER_FACTOR)
    return amps


def select_ats_rating(design_amps):
    for rating in STANDARD_ATS_RATINGS:
        if rating >= design_amps:
            return rating
    return STANDARD_ATS_RATINGS[-1]  # largest available


def get_conductor_size(rated_amps):
    if rated_amps in CONDUCTOR_TABLE:
        return CONDUCTOR_TABLE[rated_amps]
    elif rated_amps >= 1000:
        return "Paralleled sets required — consult NEC 310.10(H) for paralleled conductor sizing"
    else:
        # Find next largest in table
        for key in sorted(CONDUCTOR_TABLE.keys()):
            if key >= rated_amps:
                return CONDUCTOR_TABLE[key]
        return "Paralleled sets required — consult NEC 310.10(H)"


def get_poles(phases):
    # 3-phase: 3 poles + neutral = 4 poles; 1-phase: 2 poles (line + neutral)
    if phases == 3:
        return 4
    else:
        return 2


def build_enclosure_options():
    return [
        {
            "nema_type": "NEMA 1",
            "description": "General-purpose indoor enclosure, no gaskets, suitable for dry locations",
            "recommended_for": "Indoor electrical rooms, dry commercial/industrial environments",
        },
        {
            "nema_type": "NEMA 3R",
            "description": "Outdoor enclosure, rainproof and sleet-resistant, ventilated",
            "recommended_for": "Outdoor pad-mount installations, rooftop locations",
        },
        {
            "nema_type": "NEMA 4",
            "description": "Watertight, dust-tight enclosure for indoor or outdoor use",
            "recommended_for": "Wash-down areas, outdoor locations with water exposure, coastal environments",
        },
        {
            "nema_type": "NEMA 12",
            "description": "Industrial-duty enclosure, dust-tight and drip-proof, no gasket for hose-down",
            "recommended_for": "Industrial plants, manufacturing facilities with dust or oil drip exposure",
        },
    ]


def build_coordination_notes(application_type, rated_amps, voltage, phases, load_kw):
    notes = []

    nec_article = NEC_ARTICLE_MAP[application_type]
    notes.append(
        f"ATS must be listed and labeled for use in {application_type} systems per NEC Article {nec_article}."
    )

    if application_type in ("emergency", "critical"):
        notes.append(
            "Emergency and critical systems require separation from all other wiring per NEC 700.10. "
            "Wiring must be kept entirely independent from normal branch circuits."
        )

    transfer_limit = TRANSFER_TIME_LIMITS[application_type]
    if transfer_limit is not None:
        notes.append(
            f"Maximum transfer time for {application_type} systems: {transfer_limit} seconds per NEC Article {nec_article}."
        )
    else:
        notes.append(
            "No mandatory transfer time limit for optional standby systems (NEC Article 702); "
            "coordinate with owner's operational requirements."
        )

    if rated_amps > 2000:
        notes.append(
            f"ATS rated above 2000A ({rated_amps}A selected): consider paralleled ATS units or "
            "a static transfer switch for faster response. Verify bus bracing and interrupting capacity."
        )

    if phases == 3 and voltage == 480:
        notes.append(
            "480V 3-phase system: verify ATS is rated for 480V with appropriate dielectric withstand. "
            "Neutral switching must be evaluated — switched neutral recommended for 4-wire systems."
        )

    notes.append(
        "Overcurrent protection (OCPD) must be coordinated upstream of ATS on both normal and "
        "emergency source feeders per applicable NEC article."
    )

    notes.append(
        "Verify ATS is listed for service-entrance use if installed at the service point (NEC 230.83)."
    )

    kva = (load_kw / POWER_FACTOR)
    if kva > 500:
        notes.append(
            f"High load ({kva:.0f} kVA): ensure generator source is sized with adequate short-circuit "
            "current capability to coordinate with ATS and downstream OCPD."
        )

    return notes


def build_installation_requirements(application_type, nec_article):
    transfer_limit = TRANSFER_TIME_LIMITS[application_type]
    return {
        "nec_article": nec_article,
        "transfer_time_max_seconds": transfer_limit,
        "service_entrance_rated": application_type in ("emergency", "critical"),
        "wiring_separation_required": application_type in ("emergency", "legally_required", "critical"),
        "listed_equipment_required": True,
        "maintenance_bypass_recommended": application_type in ("emergency", "critical"),
        "notes": (
            f"All installation must comply with NEC Article {nec_article} and applicable local amendments. "
            "Commissioning testing required prior to system acceptance."
        ),
    }


def main():
    try:
        load_kw, voltage, phases, application_type = parse_args(sys.argv)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected argument error: {e}"}), file=sys.stderr)
        sys.exit(2)

    try:
        load_amps = compute_load_amps(load_kw, voltage, phases)
        design_amps = load_amps * NEC_125_PCT
        full_load_kva = load_kw / POWER_FACTOR
        rated_amps = select_ats_rating(design_amps)
        poles = get_poles(phases)
        interrupt_rating = get_interrupt_rating(rated_amps)
        nec_article = NEC_ARTICLE_MAP[application_type]
        conductor_size = get_conductor_size(rated_amps)

        transfer_limit = TRANSFER_TIME_LIMITS[application_type]

        output = {
            "input": {
                "load_kw": load_kw,
                "voltage": voltage,
                "phases": phases,
                "application_type": application_type,
                "power_factor": POWER_FACTOR,
            },
            "load_analysis": {
                "load_amps": round(load_amps, 2),
                "design_amps_125pct": round(design_amps, 2),
                "full_load_kva": round(full_load_kva, 2),
            },
            "ats_specification": {
                "rated_amps": rated_amps,
                "voltage_rating": voltage,
                "phases": phases,
                "poles": poles,
                "interrupt_rating_kaic": interrupt_rating,
                "nec_article": nec_article,
                "application_type": application_type,
            },
            "enclosure_options": build_enclosure_options(),
            "coordination_notes": build_coordination_notes(
                application_type, rated_amps, voltage, phases, load_kw
            ),
            "installation_requirements": build_installation_requirements(application_type, nec_article),
            "cable_recommendations": {
                "min_conductor_size_awg": conductor_size,
                "voltage_drop_note": (
                    "For cable runs exceeding 100 ft, limit voltage drop to <2% per NEC best practice. "
                    "Upsize conductors as needed; recalculate VD using: VD = (2 × K × I × L) / CM "
                    "for single-phase or (1.732 × K × I × L) / CM for three-phase, "
                    "where K=12.9 (copper), I=load amps, L=one-way length (ft), CM=circular mils."
                ),
            },
        }

        print(json.dumps(output, indent=2))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"error": f"Internal error: {e}"}), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
