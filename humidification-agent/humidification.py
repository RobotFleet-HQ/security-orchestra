"""
Humidification/Dehumidification Sizing Agent
Usage: humidification.py <room_sqft> <it_load_kw> <climate_zone> [target_rh_pct=45]

climate_zone: arid | temperate | humid
"""

import sys
import json


WATER_COST_PER_GALLON = 0.008  # $/gallon typical industrial rate
STEAM_COST_PER_LB_HR = 800     # $/lb-hr installed cost
EVAP_COST_PER_LB_HR = 400      # $/lb-hr installed cost

# Infiltration moisture loads by climate (lbs/hr per 1000 sqft)
INFILTRATION = {
    "arid":       -5.0,   # moisture loss (negative = need to add moisture)
    "temperate":   0.0,   # neutral
    "humid":       3.0,   # moisture gain (need to remove)
}


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: humidification.py <room_sqft> <it_load_kw> <climate_zone> [target_rh_pct=45]"}), file=sys.stderr)
        sys.exit(1)

    try:
        room_sqft = float(sys.argv[1])
        it_load_kw = float(sys.argv[2])
        climate_zone = sys.argv[3].lower()
        target_rh_pct = float(sys.argv[4]) if len(sys.argv) == 5 else 45.0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if room_sqft < 100 or room_sqft > 500000:
        print(json.dumps({"error": "room_sqft must be 100-500000"}), file=sys.stderr)
        sys.exit(1)
    if it_load_kw < 1 or it_load_kw > 500000:
        print(json.dumps({"error": "it_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if climate_zone not in INFILTRATION:
        print(json.dumps({"error": "climate_zone must be: arid, temperate, or humid"}), file=sys.stderr)
        sys.exit(1)
    if target_rh_pct < 20 or target_rh_pct > 70:
        print(json.dumps({"error": "target_rh_pct must be 20-70"}), file=sys.stderr)
        sys.exit(1)

    # ASHRAE compliance check
    ashrae_compliant = 20 <= target_rh_pct <= 80

    # Infiltration load
    infiltration_per_1000sqft = INFILTRATION[climate_zone]
    infiltration_lbs_hr = infiltration_per_1000sqft * (room_sqft / 1000.0)

    # IT latent heat (5% of IT load converted to moisture)
    it_latent_lbs_hr = it_load_kw * 0.05

    # Total moisture demand
    total_moisture_change = infiltration_lbs_hr + it_latent_lbs_hr

    if climate_zone == "arid":
        # Need to add moisture (humidify)
        humidifier_capacity = abs(infiltration_lbs_hr) + 5.0  # +5 buffer
        dehumidifier_capacity = 0.0
        recommended_system = "steam_humidifier"
        system_cost = humidifier_capacity * STEAM_COST_PER_LB_HR
    elif climate_zone == "humid":
        # Need to remove moisture (dehumidify)
        humidifier_capacity = 0.0
        dehumidifier_capacity = infiltration_lbs_hr + it_latent_lbs_hr
        recommended_system = "mechanical_dehumidifier"
        system_cost = dehumidifier_capacity * EVAP_COST_PER_LB_HR
    else:
        # Temperate: minimal need, use evaporative for occasional humidification
        humidifier_capacity = max(it_latent_lbs_hr, 2.0)
        dehumidifier_capacity = 0.0
        recommended_system = "evaporative_humidifier"
        system_cost = humidifier_capacity * EVAP_COST_PER_LB_HR

    # Water consumption
    water_gal_per_hr = humidifier_capacity * 0.12 if humidifier_capacity > 0 else 0
    water_gal_per_day = water_gal_per_hr * 24
    annual_water_cost = water_gal_per_day * 365 * WATER_COST_PER_GALLON

    output = {
        "input": {
            "room_sqft": room_sqft,
            "it_load_kw": it_load_kw,
            "climate_zone": climate_zone,
            "target_rh_pct": target_rh_pct,
        },
        "ashrae_a1_range_pct": "20-80%",
        "ashrae_compliant": ashrae_compliant,
        "climate_assessment": climate_zone,
        "infiltration_load_lbs_per_hr": round(infiltration_lbs_hr, 2),
        "humidifier_capacity_lbs_per_hr": round(humidifier_capacity, 2),
        "dehumidifier_capacity_lbs_per_hr": round(dehumidifier_capacity, 2),
        "water_consumption_gallons_per_day": round(water_gal_per_day, 1),
        "recommended_system_type": recommended_system,
        "estimated_system_cost": round(system_cost, 0),
        "annual_water_cost": round(annual_water_cost, 0),
        "notes": [
            f"ASHRAE A1 humidity envelope: 20-80% RH, dew point 5.5-15°C.",
            f"Target RH {target_rh_pct}%: {'within' if ashrae_compliant else 'OUTSIDE'} ASHRAE A1 range.",
            f"Climate zone '{climate_zone}': {'+' if infiltration_lbs_hr > 0 else ''}{infiltration_lbs_hr:.1f} lbs/hr infiltration load.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
