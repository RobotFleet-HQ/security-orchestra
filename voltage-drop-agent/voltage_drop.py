"""
Voltage Drop Calculation Agent — NEC 2023
CLI: <load_amps> <distance_feet> <voltage> <circuit_type> [conductor_material=copper]

circuit_type: "feeder" or "branch"
conductor_material: "copper" or "aluminum"
"""

import sys
import json
import math


# ── NEC Chapter 9 Table 9 — resistance per 1000 ft at 75°C (copper, uncoated) ──
# (AWG/kcmil label, resistance Ω/kft, THWN insulation OD inches, ampacity_75C)
COPPER_TABLE = [
    ("14",    3.14,   0.171,  15),
    ("12",    1.98,   0.191,  20),
    ("10",    1.24,   0.216,  30),
    ("8",     0.778,  0.272,  50),
    ("6",     0.491,  0.323,  65),
    ("4",     0.308,  0.372,  85),
    ("3",     0.245,  0.401, 100),
    ("2",     0.194,  0.436, 115),
    ("1",     0.154,  0.481, 130),
    ("1/0",   0.122,  0.532, 150),
    ("2/0",   0.0967, 0.575, 175),
    ("3/0",   0.0766, 0.630, 200),
    ("4/0",   0.0608, 0.681, 230),
    ("250",   0.0515, 0.730, 255),
    ("350",   0.0367, 0.827, 310),
    ("500",   0.0258, 0.943, 380),
    ("750",   0.0171, 1.100, 475),
]

# Standard conduit sizes (trade size, inches) with interior diameter and area (sq-in)
# EMT/rigid approximate interior dimensions
CONDUIT_TABLE = [
    ("3/4",  0.824,  0.533),
    ("1",    1.049,  0.864),
    ("1-1/4", 1.380, 1.496),
    ("1-1/2", 1.610, 2.036),
    ("2",    2.067,  3.356),
    ("2-1/2", 2.469, 4.788),
    ("3",    3.068,  7.393),
    ("3-1/2", 3.548, 9.887),
    ("4",    4.026, 12.730),
]

AL_FACTOR = 1.61  # aluminum resistance = copper × 1.61


def get_conductors(material: str):
    """Return list of (awg, resistance_per_kft, od_inches, ampacity) tuples."""
    table = []
    for awg, r_cu, od, amp in COPPER_TABLE:
        if material == "aluminum":
            r = r_cu * AL_FACTOR
            # aluminum ampacity is roughly 80% of copper in same size
            a = int(amp * 0.78)
        else:
            r = r_cu
            a = amp
        table.append((awg, r, od, a))
    return table


def voltage_drop_percent(r_per_kft: float, distance_ft: float, load_amps: float,
                          voltage: float, phases: int) -> float:
    """
    Single-phase: VD = 2 × R × L × I / 1000
    Three-phase:  VD = √3 × R × L × I / 1000
    VD% = VD / V × 100
    """
    if phases == 1:
        vd = 2.0 * r_per_kft * distance_ft * load_amps / 1000.0
    else:
        vd = math.sqrt(3) * r_per_kft * distance_ft * load_amps / 1000.0
    return (vd / voltage) * 100.0


def conduit_size_for_conductors(conductors_per_conduit: int, od_inches: float):
    """
    NEC 310.15 fill rule: ≤40% of conduit interior area.
    conductor_area = conductors × π/4 × OD²
    """
    conductor_area = conductors_per_conduit * math.pi / 4.0 * od_inches**2
    required_conduit_area = conductor_area / 0.40  # 40% fill max

    for size_str, _id, area in CONDUIT_TABLE:
        if area >= required_conduit_area:
            actual_fill = conductor_area / area * 100.0
            return size_str, round(actual_fill, 1)

    # Larger than table — return largest
    size_str, _id, area = CONDUIT_TABLE[-1]
    actual_fill = conductor_area / area * 100.0
    return size_str, round(actual_fill, 1)


def determine_phases(voltage: float) -> int:
    """Single-phase: 120V, 240V, 277V. Three-phase: 208V, 480V, 600V."""
    if voltage in (120.0, 240.0, 277.0):
        return 1
    return 3


def main():
    if len(sys.argv) < 5 or len(sys.argv) > 6:
        err = {"error": (
            "Usage: voltage_drop.py <load_amps> <distance_feet> "
            "<voltage> <circuit_type> [conductor_material=copper]"
        )}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    try:
        load_amps = float(sys.argv[1])
        distance_feet = float(sys.argv[2])
        voltage = float(sys.argv[3])
        circuit_type = sys.argv[4].lower()
        conductor_material = sys.argv[5].lower() if len(sys.argv) == 6 else "copper"
    except ValueError as e:
        err = {"error": f"Invalid argument: {e}"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    if load_amps <= 0:
        err = {"error": "load_amps must be positive"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if distance_feet <= 0:
        err = {"error": "distance_feet must be positive"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if voltage <= 0:
        err = {"error": "voltage must be positive"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if circuit_type not in ("feeder", "branch"):
        err = {"error": "circuit_type must be 'feeder' or 'branch'"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)
    if conductor_material not in ("copper", "aluminum"):
        err = {"error": "conductor_material must be 'copper' or 'aluminum'"}
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    # NEC limits: feeder 3%, branch 3%, total 5%
    nec_limit_percent = 3.0  # both feeder and branch
    phases = determine_phases(voltage)
    conductors = get_conductors(conductor_material)

    # ── Find minimum AWG meeting VD% < limit ────────────────────────────────
    min_awg = None
    min_r = None
    min_vd_pct = None

    for awg, r_per_kft, od, ampacity in conductors:
        vd_pct = voltage_drop_percent(r_per_kft, distance_feet, load_amps, voltage, phases)
        if vd_pct < nec_limit_percent:
            min_awg = awg
            min_r = r_per_kft
            min_vd_pct = vd_pct
            break

    if min_awg is None:
        # Even 750 kcmil exceeds limit — recommend parallel conductors
        awg, r_per_kft, od, ampacity = conductors[-1]
        min_awg = awg
        min_r = r_per_kft
        min_vd_pct = voltage_drop_percent(r_per_kft, distance_feet, load_amps, voltage, phases)

    min_idx = next(i for i, (a, _, __, ___) in enumerate(conductors) if a == min_awg)
    compliant = min_vd_pct < nec_limit_percent

    # ── Calculate actual VD for minimum size ────────────────────────────────
    _, min_r_kft, min_od, min_ampacity = conductors[min_idx]
    actual_vd_volts_min = (
        (2.0 if phases == 1 else math.sqrt(3)) * min_r_kft * distance_feet * load_amps / 1000.0
    )

    # ── Recommended conductor: one size up from minimum ──────────────────────
    if min_idx > 0:
        rec_idx = min_idx - 1  # lower index = larger conductor
    else:
        rec_idx = 0
    rec_awg, rec_r, rec_od, rec_ampacity = conductors[rec_idx]
    rec_vd_pct = voltage_drop_percent(rec_r, distance_feet, load_amps, voltage, phases)
    one_size_up = rec_idx < min_idx

    # ── Conduit sizing (3 current-carrying + 1 ground = 4 conductors) ───────
    conductors_per_conduit = 3 if phases == 3 else 2
    # Use recommended conductor OD
    conduit_size_str, fill_pct = conduit_size_for_conductors(conductors_per_conduit, rec_od)

    # ── Parallel conductors recommendation ──────────────────────────────────
    # Recommend parallel if load_amps > largest conductor ampacity or if > 500 kcmil needed
    largest_awg, largest_r, largest_od, largest_amp = conductors[-1]
    parallel_recommended = (load_amps > largest_amp) or (rec_awg in ("500", "750"))
    parallel_sets = 1
    parallel_awg = rec_awg
    parallel_note = "Single conductor set is adequate for this load."

    if parallel_recommended:
        # Find smallest conductor where 2 sets meet ampacity and VD
        parallel_sets = 2
        for awg, r_p, od_p, amp_p in conductors:
            vd_parallel = voltage_drop_percent(r_p / parallel_sets, distance_feet, load_amps, voltage, phases)
            if vd_parallel < nec_limit_percent and (amp_p * parallel_sets) >= load_amps:
                parallel_awg = awg
                break
        parallel_note = (
            f"Load ({load_amps}A) exceeds single conductor capacity or requires large conductor. "
            f"Use {parallel_sets} sets of {parallel_awg} AWG {conductor_material} per phase."
        )

    # ── Notes ────────────────────────────────────────────────────────────────
    notes = []
    phase_str = "single-phase" if phases == 1 else "three-phase"
    notes.append(f"Calculation basis: {phase_str} system at {voltage}V.")
    notes.append(
        f"NEC VD limit: {nec_limit_percent}% for {circuit_type} circuit. "
        "Combined feeder + branch total should not exceed 5%."
    )
    if not compliant:
        notes.append(
            f"WARNING: Even the largest conductor ({min_awg} AWG) yields {min_vd_pct:.2f}% VD. "
            "Parallel conductors required to meet NEC voltage drop recommendation."
        )
    if conductor_material == "aluminum":
        notes.append(
            "Aluminum conductors require compression connectors and anti-oxidant compound "
            "per NEC 110.14. Minimum size for aluminum feeders is #4 AWG."
        )
    notes.append(
        "Ampacity must also be verified per NEC Table 310.16 for installed conditions "
        "(conduit fill, ambient temperature, continuous load factor)."
    )

    result = {
        "input": {
            "load_amps": load_amps,
            "distance_feet": distance_feet,
            "voltage": voltage,
            "circuit_type": circuit_type,
            "conductor_material": conductor_material
        },
        "voltage_drop_analysis": {
            "min_wire_awg": min_awg,
            "min_wire_resistance_per_kft": round(min_r_kft, 5),
            "voltage_drop_volts": round(actual_vd_volts_min, 3),
            "voltage_drop_percent": round(min_vd_pct, 3),
            "nec_limit_percent": nec_limit_percent,
            "compliant": compliant
        },
        "recommended_conductor": {
            "awg": rec_awg,
            "resistance_per_kft": round(rec_r, 5),
            "voltage_drop_percent": round(rec_vd_pct, 3),
            "ampacity_75c": float(rec_ampacity),
            "one_size_up_from_minimum": one_size_up
        },
        "conduit_sizing": {
            "conductors_per_conduit": conductors_per_conduit,
            "recommended_conduit_size_inch": conduit_size_str,
            "fill_percent": fill_pct
        },
        "parallel_conductors": {
            "recommended": parallel_recommended,
            "sets": parallel_sets,
            "per_set_awg": parallel_awg,
            "notes": parallel_note
        },
        "notes": notes
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
