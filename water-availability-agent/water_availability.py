"""
Water Availability Analysis Agent
Usage: water_availability.py <cooling_tons> <location> [cooling_type=tower]

cooling_tons  : float — design cooling load in tons of refrigeration
location      : string — city name or state
cooling_type  : "tower" | "air" | "hybrid"  (default: tower)
"""

import sys
import json


# ---------------------------------------------------------------------------
# Water rate ranges by region ($/gallon, midpoint used for estimates)
# ---------------------------------------------------------------------------

WATER_RATES: dict[str, float] = {
    "northeast":    0.010,   # $0.008–0.012
    "southeast":    0.007,   # $0.005–0.009
    "midwest":      0.0055,  # $0.004–0.007
    "southwest":    0.009,   # $0.006–0.012
    "mountain":     0.011,   # $0.007–0.015
    "pacific_nw":   0.0045,  # $0.003–0.006
    "california":   0.015,   # $0.010–0.020
}

# Sewer/discharge is typically 70–80% of water rate; use 75%
SEWER_RATE_FACTOR = 0.75

# ---------------------------------------------------------------------------
# Drought risk scores by region (1–10)
# ---------------------------------------------------------------------------

DROUGHT_RISK: dict[str, float] = {
    "california": 9.0,
    "nevada":     9.0,
    "arizona":    8.5,
    "new mexico": 8.0,
    "colorado":   8.0,
    "utah":       8.5,
    "texas":      7.0,
    "oklahoma":   6.5,
    "oregon":     3.5,
    "washington": 3.0,
    "idaho":      5.0,
    "montana":    5.5,
    "wyoming":    6.0,
    "florida":    4.5,
    "georgia":    5.0,
    "south carolina": 4.5,
    "north carolina": 4.0,
    "tennessee":  3.5,
    "midwest":    4.0,
    "northeast":  3.0,
    "southeast":  4.5,
    "pacific_nw": 3.0,
}

# Prior appropriation states (western water law)
PRIOR_APPROPRIATION_STATES = {
    "colorado", "utah", "nevada", "arizona", "new mexico",
    "wyoming", "montana", "idaho", "california", "oregon",
    "washington", "north dakota", "south dakota", "kansas", "nebraska",
}

# ---------------------------------------------------------------------------
# Region and state detection helpers
# ---------------------------------------------------------------------------

def _detect_state(loc_lower: str) -> str | None:
    """Return lowercase state name if detected in location string."""
    states = [
        "california", "nevada", "arizona", "new mexico", "colorado", "utah",
        "wyoming", "montana", "idaho", "oregon", "washington", "texas",
        "oklahoma", "florida", "georgia", "south carolina", "north carolina",
        "tennessee", "kentucky", "virginia", "maryland", "pennsylvania",
        "new york", "new jersey", "connecticut", "massachusetts", "maine",
        "vermont", "new hampshire", "rhode island", "ohio", "indiana",
        "michigan", "illinois", "wisconsin", "minnesota", "iowa", "missouri",
        "kansas", "nebraska", "north dakota", "south dakota", "alaska", "hawaii",
        "west virginia", "delaware", "alabama", "mississippi", "louisiana",
        "arkansas",
    ]
    for state in states:
        if state in loc_lower:
            return state
    return None


def _detect_region(loc_lower: str) -> str:
    """Infer geographic region for water rate and drought lookups."""
    northeast_kw = ["boston", "new york", "nyc", "philadelphia", "baltimore",
                    "washington", "dc", "virginia", "maryland", "pennsylvania",
                    "connecticut", "massachusetts", "rhode island", "maine",
                    "vermont", "new hampshire", "new jersey", "ashburn", "charlotte",
                    "north carolina", "south carolina", "delaware", "west virginia"]
    southeast_kw = ["florida", "georgia", "alabama", "mississippi", "louisiana",
                    "arkansas", "tennessee", "kentucky", "miami", "atlanta",
                    "nashville", "memphis", "birmingham", "jackson"]
    midwest_kw   = ["chicago", "ohio", "indiana", "michigan", "minnesota",
                    "wisconsin", "iowa", "missouri", "illinois", "detroit",
                    "cleveland", "columbus", "minneapolis", "st. louis",
                    "kansas city", "omaha", "milwaukee", "cincinnati"]
    southwest_kw = ["texas", "oklahoma", "dallas", "houston", "san antonio",
                    "austin", "fort worth", "el paso", "tulsa", "albuquerque",
                    "new mexico", "las vegas", "nevada"]
    mountain_kw  = ["colorado", "utah", "wyoming", "montana", "idaho",
                    "denver", "salt lake", "boise", "billings", "tucson",
                    "arizona", "phoenix"]
    pacific_nw_kw = ["oregon", "washington", "portland", "seattle", "tacoma",
                     "spokane", "eugene"]
    california_kw = ["california", "los angeles", "san francisco", "san jose",
                     "san diego", "sacramento", "fresno", "bay area",
                     "silicon valley", "la ", " ca "]

    for kw in california_kw:
        if kw in loc_lower:
            return "california"
    for kw in pacific_nw_kw:
        if kw in loc_lower:
            return "pacific_nw"
    for kw in northeast_kw:
        if kw in loc_lower:
            return "northeast"
    for kw in southeast_kw:
        if kw in loc_lower:
            return "southeast"
    for kw in midwest_kw:
        if kw in loc_lower:
            return "midwest"
    for kw in southwest_kw:
        if kw in loc_lower:
            return "southwest"
    for kw in mountain_kw:
        if kw in loc_lower:
            return "mountain"

    return "midwest"  # default


def _drought_risk_for_location(loc_lower: str) -> float:
    state = _detect_state(loc_lower)
    if state and state in DROUGHT_RISK:
        return DROUGHT_RISK[state]
    region = _detect_region(loc_lower)
    region_defaults = {
        "california": 9.0, "mountain": 7.5, "southwest": 6.5,
        "pacific_nw": 3.0, "southeast": 4.5, "midwest": 4.0, "northeast": 3.0,
    }
    return region_defaults.get(region, 5.0)


def _risk_level(score: float) -> str:
    if score <= 3.0:
        return "low"
    if score <= 5.5:
        return "moderate"
    if score <= 7.5:
        return "high"
    return "critical"


def _water_rights_system(loc_lower: str) -> str:
    state = _detect_state(loc_lower)
    if state and state in PRIOR_APPROPRIATION_STATES:
        return "prior_appropriation"
    region = _detect_region(loc_lower)
    if region in ("california", "mountain", "pacific_nw", "southwest"):
        return "prior_appropriation"
    return "riparian"


def _drought_notes(loc_lower: str, risk_score: float, water_rights: str) -> str:
    notes: list[str] = []
    if water_rights == "prior_appropriation":
        notes.append(
            "Western water law (prior appropriation) applies — secure water rights early; "
            "senior rights holders have priority during drought."
        )
    if risk_score >= 8.0:
        notes.append(
            "Critical drought risk region. Evaluate recycled water sources, "
            "on-site storage, or water-free cooling alternatives."
        )
    elif risk_score >= 6.0:
        notes.append(
            "Elevated drought risk. Consider hybrid cooling with air-side economization "
            "to reduce dependence on municipal water supply."
        )
    elif risk_score <= 3.0:
        notes.append("Low drought risk region with generally reliable municipal water supply.")

    region = _detect_region(loc_lower)
    if region == "california":
        notes.append(
            "California imposes tiered water pricing and drought surcharges; "
            "actual costs may exceed estimates during declared emergencies."
        )
    return " ".join(notes) if notes else "Moderate water risk; monitor local utility advisories."


# ---------------------------------------------------------------------------
# Cooling type alternatives
# ---------------------------------------------------------------------------

def _alternatives(cooling_type: str, cooling_tons: float, risk_score: float) -> list[dict]:
    """Return alternative cooling options with water reduction and energy penalty."""
    alts: list[dict] = []

    if cooling_type != "air":
        alts.append({
            "type": "air",
            "water_reduction_pct": 100.0,
            "energy_penalty_pct":  17.5,  # midpoint of 15–20%
            "description": (
                "Air-cooled chillers eliminate water consumption entirely. "
                "Expect PUE increase from ~1.10 to ~1.20, adding 17–20% to cooling energy cost. "
                "Best suited for moderate climates; performance degrades above 95°F ambient."
            ),
        })

    if cooling_type != "hybrid":
        alts.append({
            "type": "hybrid",
            "water_reduction_pct": 30.0,
            "energy_penalty_pct":  5.0,
            "description": (
                "Adiabatic / hybrid cooling uses evaporative pre-cooling only during peak heat. "
                "Reduces makeup water ~30% with a modest 3–7% energy premium. "
                "Good balance of water conservation and energy efficiency."
            ),
        })

    if cooling_type != "tower":
        alts.append({
            "type": "tower",
            "water_reduction_pct": 0.0,
            "energy_penalty_pct":  0.0,
            "description": (
                "Evaporative cooling tower — lowest energy consumption of all wet cooling options. "
                f"Requires ~{round(cooling_tons * 3.0 / 100.0, 1)} gpm of makeup water at design load."
            ),
        })

    # Dry cooler option — geography-limited
    region = None  # determined contextually; always include with note
    alts.append({
        "type": "dry_cooler",
        "water_reduction_pct": 100.0,
        "energy_penalty_pct":  25.0,
        "description": (
            "Closed-circuit dry cooler uses zero water when ambient < 65°F. "
            "Effective in Pacific NW or high-altitude sites; impractical in hot climates. "
            "Energy penalty ~20–30% versus wet tower; may require supplemental cooling in summer."
        ),
    })

    return alts


# ---------------------------------------------------------------------------
# Core calculations
# ---------------------------------------------------------------------------

def _water_requirements(cooling_tons: float, cooling_type: str) -> dict:
    if cooling_type == "air":
        # No water consumption for air-cooled
        return {
            "cooling_tons":    cooling_tons,
            "makeup_water_gpm": 0.0,
            "blowdown_gpm":    0.0,
            "total_water_gpm": 0.0,
            "annual_gallons":  0.0,
            "annual_acre_feet": 0.0,
        }

    if cooling_type == "hybrid":
        # Adiabatic / hybrid: ~30% less water than tower
        factor = 0.70
    else:
        factor = 1.00  # standard tower

    # Makeup water: 3.0 gpm per 100 tons (evaporation + drift + blowdown)
    makeup_gpm    = round(cooling_tons * 3.0 / 100.0 * factor, 2)
    blowdown_gpm  = round(makeup_gpm * 0.25, 2)          # ~25% of makeup
    total_gpm     = round(makeup_gpm, 2)                  # blowdown is a subset
    annual_gal    = round(makeup_gpm * 60.0 * 8760.0, 0)  # gal/yr
    annual_af     = round(annual_gal / 325_851.0, 2)      # 1 acre-foot = 325,851 gal

    return {
        "cooling_tons":    cooling_tons,
        "makeup_water_gpm": makeup_gpm,
        "blowdown_gpm":    blowdown_gpm,
        "total_water_gpm": total_gpm,
        "annual_gallons":  annual_gal,
        "annual_acre_feet": annual_af,
    }


def _water_costs(annual_gallons: float, blowdown_gpm: float, region: str) -> dict:
    rate = WATER_RATES.get(region, 0.008)
    annual_water_cost   = round(annual_gallons * rate, 2)
    blowdown_annual_gal = round(blowdown_gpm * 60.0 * 8760.0, 0)
    sewer_cost          = round(blowdown_annual_gal * rate * SEWER_RATE_FACTOR, 2)
    total               = round(annual_water_cost + sewer_cost, 2)

    return {
        "estimated_rate_per_gallon": rate,
        "annual_water_cost":         annual_water_cost,
        "sewer_discharge_cost":      sewer_cost,
        "total_annual_water_cost":   total,
    }


def _recommendation_text(cooling_tons: float, cooling_type: str, risk_score: float,
                          risk_level: str, water_req: dict, water_costs: dict,
                          water_rights: str) -> str:
    parts: list[str] = []

    if cooling_type == "air":
        parts.append(
            f"Air-cooled configuration for {cooling_tons}T eliminates all water dependency — "
            "preferred choice in high water-stress regions despite the ~17% energy premium."
        )
    elif cooling_type == "hybrid":
        parts.append(
            f"Hybrid cooling for {cooling_tons}T reduces water use ~30% vs. a conventional tower, "
            f"requiring ~{water_req['makeup_water_gpm']} gpm at design load."
        )
    else:
        parts.append(
            f"Evaporative cooling tower for {cooling_tons}T requires "
            f"{water_req['makeup_water_gpm']} gpm makeup water "
            f"({water_req['annual_acre_feet']} acre-ft/yr)."
        )

    annual_cost = water_costs["total_annual_water_cost"]
    parts.append(f"Estimated total annual water cost: ${annual_cost:,.0f}.")

    if risk_level in ("high", "critical"):
        parts.append(
            f"Risk level is {risk_level} — strongly recommend evaluating air-cooled or hybrid alternatives "
            "and securing long-term water supply agreements."
        )
    elif risk_level == "moderate":
        parts.append("Moderate drought risk; implement water-efficient tower operation (higher cycles of concentration).")
    else:
        parts.append("Low drought risk; standard cooling tower operation is appropriate.")

    if water_rights == "prior_appropriation":
        parts.append("Engage water rights attorney before site commitment.")

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: water_availability.py <cooling_tons> <location> [cooling_type=tower]"}),
              file=sys.stderr)
        sys.exit(1)

    try:
        cooling_tons = float(sys.argv[1])
    except ValueError:
        print(json.dumps({"error": f"Invalid cooling_tons value: {sys.argv[1]}"}), file=sys.stderr)
        sys.exit(1)

    if cooling_tons <= 0:
        print(json.dumps({"error": "cooling_tons must be > 0"}), file=sys.stderr)
        sys.exit(1)

    location     = sys.argv[2]
    cooling_type = sys.argv[3] if len(sys.argv) > 3 else "tower"

    if cooling_type not in ("tower", "air", "hybrid"):
        print(json.dumps({"error": "cooling_type must be 'tower', 'air', or 'hybrid'"}), file=sys.stderr)
        sys.exit(1)

    loc_lower = location.strip().lower()
    region    = _detect_region(loc_lower)

    water_req    = _water_requirements(cooling_tons, cooling_type)
    costs        = _water_costs(water_req["annual_gallons"], water_req["blowdown_gpm"], region)
    risk_score   = _drought_risk_for_location(loc_lower)
    risk_lvl     = _risk_level(risk_score)
    water_rights = _water_rights_system(loc_lower)
    notes        = _drought_notes(loc_lower, risk_score, water_rights)
    alts         = _alternatives(cooling_type, cooling_tons, risk_score)
    rec          = _recommendation_text(cooling_tons, cooling_type, risk_score,
                                        risk_lvl, water_req, costs, water_rights)

    output = {
        "input": {
            "cooling_tons":  cooling_tons,
            "location":      location,
            "cooling_type":  cooling_type,
        },
        "water_requirements": water_req,
        "water_costs":        costs,
        "drought_risk": {
            "drought_risk_score":  risk_score,
            "risk_level":         risk_lvl,
            "water_rights_system": water_rights,
            "notes":              notes,
        },
        "alternatives":   alts,
        "recommendation": rec,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
