#!/usr/bin/env python3
"""
Generator Sizing Agent
======================
Sizes diesel generator sets for data center loads per NFPA 110, IEEE 446,
and EGSA standards.

Usage:
    python generator_sizing.py <load_kw> <tier> <altitude_ft> <temp_f>

    load_kw      : Critical load in kilowatts (1 – 50000)
    tier         : Redundancy tier: N, N+1, 2N, 2N+1
    altitude_ft  : Site altitude in feet (default 0)
    temp_f       : Ambient temperature in °F (default 77)

Output: JSON to stdout, errors to stderr, exit 0 on success.
"""

import sys
import json
import math


# ─── Derating tables ──────────────────────────────────────────────────────────
# Per ISO 3046-1 and typical OEM published curves.

def altitude_derate(altitude_ft: float) -> float:
    """Return power derating factor for altitude (1.0 at sea level)."""
    # ~3 % per 1 000 ft above 300 ft for turbocharged diesels
    if altitude_ft <= 300:
        return 1.0
    excess = altitude_ft - 300
    derate = 1.0 - 0.03 * (excess / 1000.0)
    return max(derate, 0.50)   # floor at 50 %


def temperature_derate(temp_f: float) -> float:
    """Return power derating factor for high ambient temperature."""
    # Baseline 77 °F (25 °C); ~1 % per 10 °F above 104 °F
    if temp_f <= 104:
        return 1.0
    excess = temp_f - 104
    derate = 1.0 - 0.01 * (excess / 10.0)
    return max(derate, 0.70)


# ─── Generator catalogue ──────────────────────────────────────────────────────
# (model, standby_kw, fuel_gph_full_load, fuel_gph_50pct, weight_lbs, msrp_usd)
# Sources: Generac Industrial, Cummins Power, Kohler, Caterpillar published specs.

CATALOGUE = [
    # Generac Industrial / Cummins / Caterpillar tier list
    # kW    fuel@100%  fuel@50%  weight    price
    (  100,   7.0,      4.0,    3200,     28_000),
    (  150,   9.8,      5.5,    3800,     38_000),
    (  200,  12.8,      7.2,    4500,     48_000),
    (  250,  15.6,      8.8,    5200,     58_000),
    (  300,  18.4,     10.4,    6100,     70_000),
    (  400,  24.0,     13.5,    7500,     90_000),
    (  500,  29.5,     16.5,    9000,    112_000),
    (  600,  35.0,     19.5,   10500,    135_000),
    (  750,  43.0,     24.0,   12000,    165_000),
    (  800,  45.5,     25.5,   13000,    175_000),
    ( 1000,  56.0,     31.0,   15000,    210_000),
    ( 1250,  68.5,     38.0,   18000,    260_000),
    ( 1500,  81.0,     45.0,   21000,    310_000),
    ( 1750,  93.5,     52.0,   24000,    360_000),
    ( 2000, 106.0,     59.0,   27000,    415_000),
    ( 2500, 130.0,     72.0,   32000,    510_000),
    ( 3000, 154.0,     86.0,   38000,    610_000),
    ( 4000, 202.0,    112.0,   48000,    800_000),
    ( 5000, 250.0,    138.0,   58000,    990_000),
    ( 6000, 298.0,    165.0,   68000,  1_180_000),
]


def nearest_unit(required_kw: float) -> dict:
    """Return the smallest catalogue unit that meets or exceeds required_kw."""
    for (kw, f100, f50, wt, price) in CATALOGUE:
        if kw >= required_kw:
            return {"kw": kw, "fuel_gph_100": f100, "fuel_gph_50": f50,
                    "weight_lbs": wt, "unit_price_usd": price}
    # Above catalogue top — extrapolate from the largest unit
    kw, f100, f50, wt, price = CATALOGUE[-1]
    scale = math.ceil(required_kw / kw)
    return {"kw": kw * scale, "fuel_gph_100": f100 * scale, "fuel_gph_50": f50 * scale,
            "weight_lbs": wt * scale, "unit_price_usd": price * scale,
            "note": f"Parallel {scale}× {kw} kW units (exceeds single-unit catalogue)"}


def model_name(kw: int) -> str:
    """Return a plausible model string for a given kW rating."""
    brands = {
        100: "Generac SD100",    150: "Generac SD150",
        200: "Cummins C200D6",   250: "Cummins C250D6",
        300: "Cummins C300D6",   400: "Kohler 400REOZT",
        500: "Caterpillar XQP500",600: "Caterpillar XQP600",
        750: "Cummins C750D5",   800: "Cummins C800D5",
       1000: "Caterpillar 1000EKOZD", 1250: "Caterpillar 1250EKOZD",
       1500: "Cummins C1500D7",  1750: "Cummins C1750D7",
       2000: "Caterpillar 2000EKOZD", 2500: "Cummins QSK60G5",
       3000: "Caterpillar 3412",  4000: "Caterpillar 3516B",
       5000: "Caterpillar 3516C", 6000: "Caterpillar 3516C (par.)",
    }
    return brands.get(kw, f"Industrial {kw}kW Genset")


# ─── Redundancy configurations ────────────────────────────────────────────────

REDUNDANCY = {
    "N":    {"units": 1, "description": "No redundancy — single unit carries full load",
             "nfpa110_class": "Class 10, Type 10 minimum"},
    "N+1":  {"units": 2, "description": "One standby unit; any single unit failure is tolerated",
             "nfpa110_class": "Class 10, Type 10 — Tier II / III typical"},
    "2N":   {"units": 2, "description": "Full duplicate system; either side carries 100 % load",
             "nfpa110_class": "Class 10, Type 10 — Tier III / IV"},
    "2N+1": {"units": 3, "description": "Dual system plus one additional standby per side",
             "nfpa110_class": "Class 10, Type 10 — Tier IV"},
}


def unit_count(tier: str, n_units_needed: int) -> int:
    """Total physical units required for a given tier."""
    multipliers = {"N": 1, "N+1": n_units_needed + 1,
                   "2N": n_units_needed * 2, "2N+1": n_units_needed * 2 + 1}
    return multipliers.get(tier, 1)


# ─── Fuel tank sizing ─────────────────────────────────────────────────────────
# NFPA 110 §8.3.1: minimum 8-hour fuel supply at full load.
# Typical data centre design standard: 24–96 hours.

RUNTIME_TARGETS = {"N": 24, "N+1": 48, "2N": 72, "2N+1": 96}  # hours


def tank_size_gallons(fuel_gph: float, runtime_h: float) -> float:
    """Round up to nearest standard tank size (500-gal increments above 1 000 gal)."""
    raw = fuel_gph * runtime_h * 1.10   # 10 % reserve per NFPA 110
    if raw <= 1000:
        return round(math.ceil(raw / 100) * 100)
    return round(math.ceil(raw / 500) * 500)


# ─── KVA conversion ───────────────────────────────────────────────────────────
POWER_FACTOR = 0.8   # typical data centre PF


def kw_to_kva(kw: float) -> float:
    return kw / POWER_FACTOR


# ─── Main sizing logic ────────────────────────────────────────────────────────

def size_generator(load_kw: float, tier: str,
                   altitude_ft: float = 0.0,
                   temp_f: float = 77.0) -> dict:

    # 1. Validate inputs
    if not (1 <= load_kw <= 50_000):
        raise ValueError(f"load_kw must be 1–50000, got {load_kw}")
    if tier not in REDUNDANCY:
        raise ValueError(f"tier must be N, N+1, 2N, or 2N+1, got '{tier}'")

    # 2. Derating
    alt_factor  = altitude_derate(altitude_ft)
    temp_factor = temperature_derate(temp_f)
    combined    = alt_factor * temp_factor

    # 3. Derated load: we need MORE nameplate kW to deliver load_kw after derating
    derated_required_kw = load_kw / combined

    # 4. Select unit from catalogue
    unit = nearest_unit(derated_required_kw)

    # 5. How many N-units at this size cover the load?
    n_units = math.ceil(load_kw / unit["kw"])

    # 6. Total units including redundancy
    total_units = unit_count(tier, n_units)

    # 7. KVA
    genset_kva = round(kw_to_kva(unit["kw"]) * n_units, 1)

    # 8. Fuel consumption (full-load running scenario — worst case)
    fuel_gph_per_unit = unit["fuel_gph_100"]
    fuel_gph_total    = round(fuel_gph_per_unit * n_units, 1)

    # 9. Tank size
    runtime_h   = RUNTIME_TARGETS[tier]
    tank_gallons = tank_size_gallons(fuel_gph_total, runtime_h)
    runtime_at_tank = round(tank_gallons / fuel_gph_total, 1)

    # 10. ATS sizing (NEC 700.12 — 110 % of load)
    ats_amps = round((load_kw * 1000 / 480) * 1.10 / math.sqrt(3), 0)  # 480V 3Ø

    # 11. Emissions estimate (EPA Tier 4 Final: ~0.55 lb NOx/MWh)
    nox_lb_per_hr = round(unit["kw"] * 0.55 / 1000, 3)

    # 12. Approximate installed cost
    equipment_cost  = unit["unit_price_usd"] * total_units
    install_factor  = 1.35   # typical 35 % for civil, electrical, ATS, pad
    total_installed = round(equipment_cost * install_factor)

    redundancy_info = REDUNDANCY[tier].copy()
    redundancy_info["total_units"]    = total_units
    redundancy_info["active_units"]   = n_units
    redundancy_info["standby_units"]  = total_units - n_units

    return {
        "input": {
            "load_kw":      load_kw,
            "tier":         tier,
            "altitude_ft":  altitude_ft,
            "temp_f":       temp_f,
        },
        "derating": {
            "altitude_factor":    round(alt_factor,  4),
            "temperature_factor": round(temp_factor, 4),
            "combined_factor":    round(combined,    4),
            "derated_required_kw": round(derated_required_kw, 1),
        },
        "genset_kva":    genset_kva,
        "genset_kw":     unit["kw"] * n_units,
        "unit_model":    model_name(unit["kw"]),
        "unit_kw":       unit["kw"],
        "fuel_gph":      fuel_gph_total,
        "tank_size_gal": tank_gallons,
        "runtime_hours": runtime_at_tank,
        "runtime_target_hours": runtime_h,
        "ats_amps_480v": int(ats_amps),
        "nox_lb_per_hr": nox_lb_per_hr,
        "redundancy_config": redundancy_info,
        "cost_estimate": {
            "equipment_usd":      equipment_cost,
            "installed_usd":      total_installed,
            "per_kw_installed":   round(total_installed / load_kw, 0),
        },
        "compliance": {
            "nfpa_110_class":     redundancy_info["nfpa110_class"],
            "nfpa_110_fuel_req":  "8-hour minimum at full load (§8.3.1)",
            "epa_emission_tier":  "Tier 4 Final (>600 kW) / Tier 4i (<600 kW)",
            "ieee_446":           "IEEE 446 — 10-second start, full load transfer",
        },
        "notes": [unit["note"]] if "note" in unit else [],
    }


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: generator_sizing.py <load_kw> <tier> [altitude_ft] [temp_f]",
              file=sys.stderr)
        sys.exit(1)

    try:
        load_kw     = float(sys.argv[1])
        tier        = sys.argv[2]
        altitude_ft = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
        temp_f      = float(sys.argv[4]) if len(sys.argv) > 4 else 77.0

        result = size_generator(load_kw, tier, altitude_ft, temp_f)
        print(json.dumps(result, indent=2))
        sys.exit(0)

    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}), file=sys.stderr)
        sys.exit(2)
