"""
Fiber Connectivity Analysis Agent
Usage: fiber_connectivity.py <location> <target_markets> [redundancy_required=yes]

location         : city name or "lat,lon"
target_markets   : comma-separated list, e.g. "NYC,Chicago,Dallas,LA"
redundancy_required : "yes" or "no"  (default: yes)
"""

import sys
import json
import math


# ---------------------------------------------------------------------------
# Known DC hub cities with straight-line miles to common target markets
# ---------------------------------------------------------------------------

HUB_DISTANCES: dict[str, dict[str, float]] = {
    "ashburn": {
        "NYC": 230.0, "Chicago": 680.0, "Dallas": 1380.0, "LA": 2350.0,
        "Miami": 1060.0, "Seattle": 2680.0, "Atlanta": 640.0,
        "Phoenix": 2200.0, "Charlotte": 390.0,
    },
    "dallas": {
        "NYC": 1380.0, "Chicago": 920.0, "LA": 1430.0, "Miami": 1310.0,
        "Seattle": 2080.0, "Atlanta": 780.0, "Phoenix": 1050.0,
        "Charlotte": 1150.0, "Ashburn": 1380.0,
    },
    "chicago": {
        "NYC": 790.0, "Dallas": 920.0, "LA": 2020.0, "Miami": 1380.0,
        "Atlanta": 720.0, "Seattle": 2060.0, "Phoenix": 1760.0,
        "Charlotte": 830.0, "Ashburn": 680.0,
    },
    "phoenix": {
        "LA": 370.0, "Dallas": 1050.0, "Chicago": 1760.0, "NYC": 2400.0,
        "Seattle": 1400.0, "Miami": 2350.0, "Atlanta": 1800.0,
        "Charlotte": 2000.0, "Ashburn": 2200.0,
    },
    "atlanta": {
        "NYC": 870.0, "Chicago": 720.0, "Dallas": 780.0, "Miami": 660.0,
        "LA": 2180.0, "Seattle": 2620.0, "Phoenix": 1800.0,
        "Charlotte": 240.0, "Ashburn": 640.0,
    },
    "charlotte": {
        "NYC": 630.0, "Atlanta": 240.0, "Chicago": 830.0, "Dallas": 1150.0,
        "LA": 2380.0, "Miami": 1030.0, "Seattle": 2720.0,
        "Phoenix": 2000.0, "Ashburn": 390.0,
    },
    "portland": {
        "Seattle": 170.0, "LA": 960.0, "Chicago": 2170.0, "NYC": 2880.0,
        "Dallas": 2050.0, "Phoenix": 1270.0, "Atlanta": 2620.0,
        "Charlotte": 2720.0, "Ashburn": 2750.0,
    },
    "seattle": {
        "Portland": 170.0, "LA": 1140.0, "Chicago": 2060.0, "NYC": 2860.0,
        "Dallas": 2080.0, "Phoenix": 1400.0, "Atlanta": 2620.0,
        "Charlotte": 2720.0, "Ashburn": 2680.0,
    },
    "los angeles": {
        "NYC": 2790.0, "Chicago": 2020.0, "Dallas": 1430.0, "Miami": 2750.0,
        "Seattle": 1140.0, "Atlanta": 2180.0, "Phoenix": 370.0,
        "Charlotte": 2380.0, "Ashburn": 2350.0,
    },
    "new york": {
        "NYC": 0.0, "Chicago": 790.0, "Dallas": 1380.0, "LA": 2790.0,
        "Miami": 1280.0, "Seattle": 2860.0, "Atlanta": 870.0,
        "Phoenix": 2400.0, "Charlotte": 630.0, "Ashburn": 230.0,
    },
    "miami": {
        "NYC": 1280.0, "Chicago": 1380.0, "Dallas": 1310.0, "LA": 2750.0,
        "Seattle": 3300.0, "Atlanta": 660.0, "Phoenix": 2350.0,
        "Charlotte": 1030.0, "Ashburn": 1060.0,
    },
}

# Aliases that map common input names to canonical hub keys
HUB_ALIASES: dict[str, str] = {
    "ashburn": "ashburn", "ashburn va": "ashburn", "dulles": "ashburn",
    "northern virginia": "ashburn", "nova": "ashburn",
    "dallas": "dallas", "dallas tx": "dallas", "dfw": "dallas",
    "chicago": "chicago", "chicago il": "chicago", "chi": "chicago",
    "phoenix": "phoenix", "phoenix az": "phoenix", "phx": "phoenix",
    "atlanta": "atlanta", "atlanta ga": "atlanta", "atl": "atlanta",
    "charlotte": "charlotte", "charlotte nc": "charlotte", "clt": "charlotte",
    "portland": "portland", "portland or": "portland", "pdx": "portland",
    "seattle": "seattle", "seattle wa": "seattle", "sea": "seattle",
    "los angeles": "los angeles", "la": "los angeles", "lax": "los angeles",
    "silicon valley": "los angeles", "san jose": "los angeles",
    "san francisco": "los angeles", "bay area": "los angeles",
    "new york": "new york", "nyc": "new york", "new york city": "new york",
    "new jersey": "new york", "nj": "new york",
    "miami": "miami", "miami fl": "miami", "mia": "miami",
}

# Regional fallback distances to common markets (miles) when city is unknown
REGIONAL_FALLBACK: dict[str, dict[str, float]] = {
    "northeast": {
        "NYC": 150.0, "Chicago": 900.0, "Dallas": 1450.0, "LA": 2900.0,
        "Miami": 1400.0, "Seattle": 3000.0, "Atlanta": 1000.0,
    },
    "southeast": {
        "NYC": 1000.0, "Chicago": 900.0, "Dallas": 900.0, "LA": 2300.0,
        "Miami": 500.0, "Seattle": 2800.0, "Atlanta": 400.0,
    },
    "midwest": {
        "NYC": 900.0, "Chicago": 200.0, "Dallas": 950.0, "LA": 2100.0,
        "Miami": 1400.0, "Seattle": 2100.0, "Atlanta": 750.0,
    },
    "southwest": {
        "NYC": 2000.0, "Chicago": 1400.0, "Dallas": 600.0, "LA": 1200.0,
        "Miami": 2000.0, "Seattle": 1800.0, "Atlanta": 1500.0,
    },
    "mountain": {
        "NYC": 2200.0, "Chicago": 1500.0, "Dallas": 1200.0, "LA": 900.0,
        "Miami": 2400.0, "Seattle": 1200.0, "Atlanta": 1900.0,
    },
    "pacific": {
        "NYC": 2900.0, "Chicago": 2100.0, "Dallas": 1900.0, "LA": 400.0,
        "Miami": 2900.0, "Seattle": 400.0, "Atlanta": 2500.0,
    },
}

# ---------------------------------------------------------------------------
# Carrier availability by region
# ---------------------------------------------------------------------------

CARRIERS_BY_REGION: dict[str, list[dict]] = {
    "tier1_northeast": [
        {"carrier": "Zayo", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4500.0},
        {"carrier": "Lumen", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4200.0},
        {"carrier": "Cogent", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 3800.0},
        {"carrier": "Crown Castle", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 5000.0},
        {"carrier": "Lightpath", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 4800.0},
        {"carrier": "GTT", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 3900.0},
        {"carrier": "Windstream", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 4100.0},
    ],
    "southeast": [
        {"carrier": "Zayo", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4000.0},
        {"carrier": "Lumen", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 3800.0},
        {"carrier": "AT&T", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 5200.0},
        {"carrier": "Crown Castle", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 4600.0},
        {"carrier": "Windstream", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 3700.0},
        {"carrier": "ITC DeltaCom", "services": ["10G lit"], "estimated_monthly_10g": 4300.0},
    ],
    "midwest": [
        {"carrier": "Zayo", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 3800.0},
        {"carrier": "Lumen", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 3600.0},
        {"carrier": "Cogent", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 3200.0},
        {"carrier": "WilTel", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 3900.0},
        {"carrier": "Windstream", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 3500.0},
        {"carrier": "TDS", "services": ["10G lit"], "estimated_monthly_10g": 4000.0},
    ],
    "southwest": [
        {"carrier": "Zayo", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4200.0},
        {"carrier": "Lumen", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4000.0},
        {"carrier": "AT&T", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 5000.0},
        {"carrier": "Cogent", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 3600.0},
        {"carrier": "tw telecom", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 4400.0},
    ],
    "mountain": [
        {"carrier": "Zayo", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4800.0},
        {"carrier": "Lumen", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 4600.0},
        {"carrier": "360networks", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 5200.0},
        {"carrier": "Electric Lightwave", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 5000.0},
    ],
    "california": [
        {"carrier": "Zayo", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 5500.0},
        {"carrier": "Lumen", "services": ["10G lit", "100G lit", "dark fiber"], "estimated_monthly_10g": 5200.0},
        {"carrier": "Cogent", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 4800.0},
        {"carrier": "Crown Castle", "services": ["10G lit", "dark fiber"], "estimated_monthly_10g": 6000.0},
        {"carrier": "XO Communications", "services": ["10G lit", "100G lit"], "estimated_monthly_10g": 5800.0},
    ],
}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _normalize_location(loc: str) -> str:
    return loc.strip().lower()


def _resolve_hub(loc_lower: str) -> str | None:
    """Return canonical hub key if location matches a known hub or alias."""
    if loc_lower in HUB_ALIASES:
        return HUB_ALIASES[loc_lower]
    for alias, hub in HUB_ALIASES.items():
        if alias in loc_lower or loc_lower in alias:
            return hub
    return None


def _infer_region(loc_lower: str) -> str:
    """Infer geographic region from location string for fallback handling."""
    northeast_kw = ["boston", "providence", "hartford", "albany", "philadelphia",
                    "baltimore", "washington", "dc ", " dc", "virginia", "maryland",
                    "pennsylvania", "new york", "new jersey", "connecticut",
                    "massachusetts", "rhode island", "maine", "vermont", "new hampshire"]
    southeast_kw = ["florida", "georgia", "alabama", "mississippi", "south carolina",
                    "north carolina", "tennessee", "kentucky", "west virginia",
                    "louisiana", "arkansas", "nashville", "memphis", "birmingham",
                    "jackson", "raleigh", "richmond", "norfolk", "savannah"]
    midwest_kw = ["ohio", "indiana", "michigan", "minnesota", "wisconsin", "iowa",
                  "missouri", "kansas", "nebraska", "south dakota", "north dakota",
                  "columbus", "cleveland", "detroit", "minneapolis", "st. louis",
                  "kansas city", "omaha", "milwaukee", "cincinnati"]
    southwest_kw = ["texas", "oklahoma", "new mexico", "houston", "san antonio",
                    "austin", "fort worth", "tulsa", "oklahoma city", "el paso",
                    "albuquerque", "las vegas", "nevada"]
    mountain_kw = ["colorado", "utah", "wyoming", "montana", "idaho",
                   "denver", "salt lake", "boise", "billings", "casper", "tucson",
                   "arizona"]
    pacific_kw = ["california", "oregon", "washington", "alaska", "hawaii",
                  "sacramento", "fresno", "san diego", "portland", "seattle",
                  "tacoma", "spokane"]

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
    for kw in pacific_kw:
        if kw in loc_lower:
            return "pacific"

    return "midwest"  # default fallback


def _get_distances(loc_lower: str, target_markets: list[str]) -> dict[str, float]:
    """Return a dict of {market: straight_line_miles} for the given location."""
    hub = _resolve_hub(loc_lower)
    if hub and hub in HUB_DISTANCES:
        hub_dist = HUB_DISTANCES[hub]
        result: dict[str, float] = {}
        for mkt in target_markets:
            mkt_key = mkt.strip()
            # Try exact match, then case-insensitive
            if mkt_key in hub_dist:
                result[mkt_key] = hub_dist[mkt_key]
            else:
                found = False
                for k, v in hub_dist.items():
                    if k.lower() == mkt_key.lower():
                        result[mkt_key] = v
                        found = True
                        break
                if not found:
                    # Use regional fallback for unknown target market
                    region = _infer_region(mkt_key.lower())
                    fallback = REGIONAL_FALLBACK.get(region, REGIONAL_FALLBACK["midwest"])
                    # Best guess: distance from this hub to unknown market
                    result[mkt_key] = fallback.get("NYC", 1500.0)
        return result

    # Unknown hub: use regional fallback
    region = _infer_region(loc_lower)
    fallback = REGIONAL_FALLBACK.get(region, REGIONAL_FALLBACK["midwest"])
    result = {}
    for mkt in target_markets:
        mkt_key = mkt.strip()
        # Find best match key in fallback
        best = None
        for fk in fallback:
            if fk.lower() == mkt_key.lower() or mkt_key.lower() in fk.lower():
                best = fk
                break
        result[mkt_key] = fallback[best] if best else 1200.0
    return result


def _compute_latency(straight_miles: float) -> float:
    """Latency in ms using route factor 1.4 and ~60 miles per ms."""
    return round((straight_miles * 1.4) / 60.0, 2)


def _get_carriers(loc_lower: str) -> list[dict]:
    """Return carrier list based on location region."""
    hub = _resolve_hub(loc_lower)

    # Special-case known tier-1 hubs
    if hub in ("new york", "ashburn"):
        return CARRIERS_BY_REGION["tier1_northeast"]
    if hub in ("chicago",):
        return CARRIERS_BY_REGION["midwest"]
    if hub in ("dallas",):
        return CARRIERS_BY_REGION["southwest"]
    if hub in ("los angeles",):
        return CARRIERS_BY_REGION["california"]
    if hub in ("atlanta", "charlotte", "miami"):
        return CARRIERS_BY_REGION["southeast"]
    if hub in ("phoenix",):
        return CARRIERS_BY_REGION["mountain"]
    if hub in ("portland", "seattle"):
        return CARRIERS_BY_REGION["pacific"] if "pacific" in CARRIERS_BY_REGION else CARRIERS_BY_REGION["mountain"]

    region = _infer_region(loc_lower)
    mapping = {
        "northeast": "tier1_northeast",
        "southeast": "southeast",
        "midwest": "midwest",
        "southwest": "southwest",
        "mountain": "mountain",
        "pacific": "california",
    }
    return CARRIERS_BY_REGION.get(mapping.get(region, "midwest"), CARRIERS_BY_REGION["midwest"])


def _market_tier(loc_lower: str) -> str:
    """Classify the market tier."""
    tier1_hubs = {"ashburn", "new york", "chicago", "dallas", "los angeles"}
    tier2_hubs = {"atlanta", "phoenix", "seattle", "charlotte", "miami", "portland"}
    hub = _resolve_hub(loc_lower)
    if hub in tier1_hubs:
        return "tier1"
    if hub in tier2_hubs:
        return "tier2"
    region = _infer_region(loc_lower)
    if region in ("northeast", "midwest"):
        return "tier3"
    return "edge"


def _fiber_score(tier: str, carrier_count: int, latencies: dict[str, float], redundancy_required: bool) -> float:
    """Compute a 1–10 fiber quality score."""
    base = {"tier1": 9.5, "tier2": 7.5, "tier3": 5.5, "edge": 2.5}[tier]

    # Adjust for carrier count
    if carrier_count >= 6:
        base = min(10.0, base + 0.5)
    elif carrier_count <= 2:
        base = max(1.0, base - 1.0)

    # Penalise if average latency to requested markets is high
    if latencies:
        avg_lat = sum(latencies.values()) / len(latencies)
        if avg_lat > 40:
            base = max(1.0, base - 1.0)
        elif avg_lat < 10:
            base = min(10.0, base + 0.3)

    if redundancy_required and tier == "edge":
        base = max(1.0, base - 0.5)

    return round(base, 1)


def _lit_building(tier: str) -> bool:
    return tier in ("tier1", "tier2")


def _cost_estimate(carriers: list[dict], redundancy_required: bool) -> dict[str, float]:
    if not carriers:
        return {"single_10g_circuit": 5000.0, "redundant_10g_circuits": 9000.0, "dark_fiber_option": 8000.0}
    avg_10g = sum(c["estimated_monthly_10g"] for c in carriers) / len(carriers)
    single = round(avg_10g, 2)
    redundant = round(avg_10g * 1.8, 2)
    dark_fiber = round(avg_10g * 1.6, 2)  # proxy for dark fiber cost
    return {
        "single_10g_circuit": single,
        "redundant_10g_circuits": redundant,
        "dark_fiber_option": dark_fiber,
    }


def _redundancy_assessment(carrier_count: int, tier: str) -> dict:
    diverse = carrier_count >= 2
    single_conduit_risk = tier == "edge" or carrier_count <= 1
    return {
        "diverse_path_available": diverse,
        "carrier_diversity": carrier_count,
        "single_conduit_risk": single_conduit_risk,
    }


def _recommendation(tier: str, fiber_score: float, carrier_count: int,
                     latencies: dict[str, float], redundancy_required: bool) -> str:
    parts: list[str] = []
    if tier == "tier1":
        parts.append(
            f"Tier-1 market with excellent carrier diversity ({carrier_count} carriers). "
            "High-density meet-me rooms available; cross-connects are straightforward."
        )
    elif tier == "tier2":
        parts.append(
            f"Strong secondary market ({carrier_count} carriers). "
            "Good redundancy options; verify building entrance diversity before committing."
        )
    elif tier == "tier3":
        parts.append(
            f"Tertiary market with moderate connectivity ({carrier_count} carriers). "
            "Pre-qualify carrier hand-off points and confirm building-diverse paths."
        )
    else:
        parts.append(
            f"Edge/rural location with limited carrier options ({carrier_count} carriers). "
            "Consider microwave or satellite backup; fiber build-out may be required."
        )

    if latencies:
        high_lat = {m: v for m, v in latencies.items() if v > 30}
        if high_lat:
            mkt_str = ", ".join(f"{m} ({v}ms)" for m, v in high_lat.items())
            parts.append(f"Elevated latency to: {mkt_str}; consider edge caching or CDN offload.")

    if redundancy_required and not (carrier_count >= 2):
        parts.append("Redundancy requested but carrier diversity is insufficient — negotiate diverse-entrance contracts.")

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 3:
        error = {"error": "Usage: fiber_connectivity.py <location> <target_markets> [redundancy_required=yes]"}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    location = sys.argv[1]
    target_markets_raw = sys.argv[2]
    redundancy_str = sys.argv[3] if len(sys.argv) > 3 else "yes"

    if redundancy_str not in ("yes", "no"):
        print(json.dumps({"error": "redundancy_required must be 'yes' or 'no'"}), file=sys.stderr)
        sys.exit(1)

    redundancy_required = redundancy_str == "yes"
    target_markets = [m.strip() for m in target_markets_raw.split(",") if m.strip()]

    if not target_markets:
        print(json.dumps({"error": "target_markets must be a non-empty comma-separated list"}), file=sys.stderr)
        sys.exit(1)

    loc_lower = _normalize_location(location)

    # Distances and latencies
    distances = _get_distances(loc_lower, target_markets)
    latency_matrix: dict[str, float] = {mkt: _compute_latency(dist) for mkt, dist in distances.items()}

    # Carriers
    carriers = _get_carriers(loc_lower)

    # Market tier
    tier = _market_tier(loc_lower)

    # Fiber score
    score = _fiber_score(tier, len(carriers), latency_matrix, redundancy_required)

    # Costs
    costs = _cost_estimate(carriers, redundancy_required)

    # Redundancy
    redundancy = _redundancy_assessment(len(carriers), tier)

    output = {
        "input": {
            "location": location,
            "target_markets": target_markets,
            "redundancy_required": redundancy_str,
        },
        "location_analysis": {
            "location": location,
            "market_tier": tier,
            "estimated_carriers_available": len(carriers),
            "lit_building": _lit_building(tier),
        },
        "available_carriers": carriers,
        "latency_matrix_ms": latency_matrix,
        "fiber_score": score,
        "redundancy_assessment": redundancy,
        "monthly_cost_estimate": costs,
        "recommendation": _recommendation(tier, score, len(carriers), latency_matrix, redundancy_required),
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
