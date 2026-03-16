"""
Site Scoring Agent
Usage: site_scoring.py <sites_json>

sites_json : JSON array string, e.g.:
  '[{"name":"Site A","power_rate_kwh":0.065,"fiber_quality":8,
     "incentives_pct":0.15,"labor_cost_index":100,"risk_score":2,"water_access":true}]'
"""

import sys
import json


# ---------------------------------------------------------------------------
# Scoring weights (must sum to 1.0)
# ---------------------------------------------------------------------------

WEIGHTS = {
    "power_costs":        0.30,
    "fiber_connectivity": 0.25,
    "tax_incentives":     0.20,
    "labor_availability": 0.10,
    "disaster_risk":      0.10,
    "water_availability": 0.05,
}


# ---------------------------------------------------------------------------
# Individual scoring functions (each returns 1–10)
# ---------------------------------------------------------------------------

def _score_power(rate_kwh: float) -> float:
    if rate_kwh < 0.04:
        return 10.0
    if rate_kwh < 0.06:
        return 8.0
    if rate_kwh < 0.08:
        return 6.0
    if rate_kwh < 0.10:
        return 4.0
    return 2.0


def _score_fiber(fiber_quality: float) -> float:
    # Already on a 1–10 scale; clamp to valid range
    return max(1.0, min(10.0, float(fiber_quality)))


def _score_incentives(incentives_pct: float) -> float:
    # incentives_pct is a decimal fraction (e.g. 0.15 = 15%)
    pct = incentives_pct * 100.0
    if pct > 20.0:
        return 10.0
    if pct >= 15.0:
        return 8.0
    if pct >= 10.0:
        return 6.0
    if pct >= 5.0:
        return 4.0
    return 2.0


def _score_labor(labor_cost_index: float) -> float:
    if labor_cost_index < 80.0:
        return 10.0
    if labor_cost_index <= 100.0:
        return 7.0
    if labor_cost_index <= 120.0:
        return 5.0
    return 3.0


def _score_risk(risk_score: float) -> float:
    if risk_score <= 2.0:
        return 10.0
    if risk_score <= 4.0:
        return 7.0
    if risk_score <= 6.0:
        return 5.0
    if risk_score <= 8.0:
        return 3.0
    return 1.0


def _score_water(water_access: bool) -> float:
    return 10.0 if water_access else 4.0


# ---------------------------------------------------------------------------
# Weighted total (out of 100)
# ---------------------------------------------------------------------------

def _weighted_total(subscores: dict[str, float]) -> float:
    total = 0.0
    for key, weight in WEIGHTS.items():
        total += subscores[key] * weight * 10.0  # scale each 1–10 score by weight×10 → max 100
    return round(total, 2)


# ---------------------------------------------------------------------------
# Strength / weakness tagging
# ---------------------------------------------------------------------------

_THRESHOLD_STRONG = 7.0
_THRESHOLD_WEAK   = 4.0

_LABELS = {
    "power_costs":        ("Low power costs", "High power costs"),
    "fiber_connectivity": ("Strong fiber connectivity", "Poor fiber connectivity"),
    "tax_incentives":     ("Generous tax incentives", "Minimal tax incentives"),
    "labor_availability": ("Competitive labor market", "Expensive or tight labor market"),
    "disaster_risk":      ("Low disaster risk", "Elevated disaster risk"),
    "water_availability": ("Reliable water access", "Limited water availability"),
}


def _strengths_weaknesses(subscores: dict[str, float]) -> tuple[list[str], list[str]]:
    strengths: list[str] = []
    weaknesses: list[str] = []
    for key, (strong_label, weak_label) in _LABELS.items():
        score = subscores[key]
        if score >= _THRESHOLD_STRONG:
            strengths.append(strong_label)
        elif score <= _THRESHOLD_WEAK:
            weaknesses.append(weak_label)
    return strengths, weaknesses


# ---------------------------------------------------------------------------
# Comparison matrix
# ---------------------------------------------------------------------------

def _comparison_matrix(scored: list[dict]) -> dict:
    if not scored:
        return {}
    top = scored[0]
    matrix: dict[str, dict[str, float]] = {}
    for site in scored[1:]:
        diff: dict[str, float] = {}
        for key in WEIGHTS:
            diff[key] = round(site["subscores"][key] - top["subscores"][key], 2)
        diff["total_score"] = round(site["total_score"] - top["total_score"], 2)
        matrix[site["name"]] = diff
    return {"vs_top_site": matrix}


# ---------------------------------------------------------------------------
# Recommendation text
# ---------------------------------------------------------------------------

def _recommendation(scored: list[dict]) -> dict:
    if not scored:
        return {"top_site": "N/A", "justification": "No sites provided.", "runner_up": "N/A",
                "key_differentiators": []}

    top = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None

    # Key differentiators: categories where top outperforms runner-up by >1 point
    key_diff: list[str] = []
    if runner_up:
        for key in WEIGHTS:
            delta = top["subscores"][key] - runner_up["subscores"][key]
            if delta >= 1.5:
                label = _LABELS[key][0]
                key_diff.append(f"{label} (+{delta:.1f}pts over runner-up)")

    justification = (
        f"{top['name']} scored {top['total_score']}/100, leading on: "
        + (", ".join(top["strengths"]) if top["strengths"] else "balanced metrics across all categories")
        + "."
    )
    if top["weaknesses"]:
        justification += f" Noted weaknesses: {', '.join(top['weaknesses'])}."

    return {
        "top_site":             top["name"],
        "justification":        justification,
        "runner_up":            runner_up["name"] if runner_up else "N/A",
        "key_differentiators":  key_diff,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: site_scoring.py <sites_json>"}), file=sys.stderr)
        sys.exit(1)

    raw_json = sys.argv[1]
    try:
        sites = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"Invalid JSON for sites_json: {exc}"}), file=sys.stderr)
        sys.exit(1)

    if not isinstance(sites, list) or len(sites) == 0:
        print(json.dumps({"error": "sites_json must be a non-empty JSON array"}), file=sys.stderr)
        sys.exit(1)

    required_fields = {"name", "power_rate_kwh", "fiber_quality", "incentives_pct",
                       "labor_cost_index", "risk_score", "water_access"}

    scored_sites: list[dict] = []

    for i, site in enumerate(sites):
        missing = required_fields - set(site.keys())
        if missing:
            print(json.dumps({"error": f"Site index {i} missing fields: {sorted(missing)}"}),
                  file=sys.stderr)
            sys.exit(1)

        subscores = {
            "power_costs":        _score_power(float(site["power_rate_kwh"])),
            "fiber_connectivity": _score_fiber(float(site["fiber_quality"])),
            "tax_incentives":     _score_incentives(float(site["incentives_pct"])),
            "labor_availability": _score_labor(float(site["labor_cost_index"])),
            "disaster_risk":      _score_risk(float(site["risk_score"])),
            "water_availability": _score_water(bool(site["water_access"])),
        }
        total = _weighted_total(subscores)
        strengths, weaknesses = _strengths_weaknesses(subscores)

        scored_sites.append({
            "rank":        0,  # filled below after sorting
            "name":        site["name"],
            "total_score": total,
            "subscores":   subscores,
            "strengths":   strengths,
            "weaknesses":  weaknesses,
        })

    # Sort descending by total score, assign ranks
    scored_sites.sort(key=lambda s: s["total_score"], reverse=True)
    for rank, s in enumerate(scored_sites, start=1):
        s["rank"] = rank

    comparison = _comparison_matrix(scored_sites)
    recommendation = _recommendation(scored_sites)

    output = {
        "input":             {"sites_evaluated": len(sites)},
        "scored_sites":      scored_sites,
        "comparison_matrix": comparison,
        "recommendation":    recommendation,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
