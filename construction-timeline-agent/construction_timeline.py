"""
Construction Timeline Estimation Agent
Usage: construction_timeline.py <capacity_mw> <building_type> <state>

building_type: new_build | shell_core | retrofit
state: 2-letter US state code
"""

import sys
import json
import math


PHASE_DURATIONS = {
    "new_build": {
        "site_selection": 8,
        "design": 24,
        "permitting": 20,
        "procurement": 16,
        "civil": 20,
        "structural": 24,
        "MEP": 32,
        "IT_infra": 12,
        "commissioning": 12,
    },
    "shell_core": {
        "site_selection": 4,
        "design": 16,
        "permitting": 12,
        "procurement": 12,
        "civil": 8,
        "structural": 12,
        "MEP": 24,
        "IT_infra": 12,
        "commissioning": 10,
    },
    "retrofit": {
        "site_selection": 2,
        "design": 12,
        "permitting": 8,
        "procurement": 8,
        "civil": 0,
        "structural": 4,
        "MEP": 16,
        "IT_infra": 8,
        "commissioning": 6,
    },
}

# State permitting modifiers
HIGH_COMPLEXITY_STATES = {"CA", "NY", "MA", "WA", "OR", "NJ", "CT", "HI"}
LOW_COMPLEXITY_STATES  = {"TX", "FL", "AZ", "NV", "ID", "WY", "ND", "SD"}


def _permitting_modifier(state: str) -> float:
    s = state.upper()
    if s in HIGH_COMPLEXITY_STATES:
        return 1.50  # +50%
    if s in LOW_COMPLEXITY_STATES:
        return 0.80  # -20%
    return 1.00


def _scale_factor(capacity_mw: float) -> float:
    if capacity_mw < 1:
        return 1.0
    if capacity_mw <= 10:
        return 1.1
    if capacity_mw <= 100:
        return 1.3
    return 1.5


def _permitting_risk(state: str, capacity_mw: float) -> str:
    s = state.upper()
    if s in HIGH_COMPLEXITY_STATES or capacity_mw > 100:
        return "high"
    if s in LOW_COMPLEXITY_STATES and capacity_mw < 10:
        return "low"
    return "medium"


def main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: construction_timeline.py <capacity_mw> <building_type> <state>"}), file=sys.stderr)
        sys.exit(1)

    try:
        capacity_mw = float(sys.argv[1])
        building_type = sys.argv[2].lower()
        state = sys.argv[3].upper()
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if capacity_mw < 0.1 or capacity_mw > 500:
        print(json.dumps({"error": "capacity_mw must be 0.1-500"}), file=sys.stderr)
        sys.exit(1)
    if building_type not in PHASE_DURATIONS:
        print(json.dumps({"error": "building_type must be: new_build, shell_core, or retrofit"}), file=sys.stderr)
        sys.exit(1)
    if len(state) != 2 or not state.isalpha():
        print(json.dumps({"error": "state must be a 2-letter US state code"}), file=sys.stderr)
        sys.exit(1)

    phases = dict(PHASE_DURATIONS[building_type])

    # Apply permitting modifier
    perm_mod = _permitting_modifier(state)
    phases["permitting"] = round(phases["permitting"] * perm_mod)

    scale = _scale_factor(capacity_mw)

    # Critical path
    critical_path_weeks = (
        phases["site_selection"]
        + phases["design"]
        + max(phases["permitting"], phases["procurement"])
        + phases["civil"]
        + phases["structural"]
        + phases["MEP"]
        + phases["commissioning"]
    )
    total_weeks = round(critical_path_weeks * scale)
    total_months = round(total_weeks / 4.33, 1)

    # Key milestones (cumulative weeks from start)
    cum = 0
    milestones = {}
    for phase in ["site_selection", "design", "permitting", "civil", "structural", "MEP", "IT_infra", "commissioning"]:
        cum += phases[phase]
        milestones[phase + "_complete_week"] = round(cum * scale)

    output = {
        "input": {
            "capacity_mw": capacity_mw,
            "building_type": building_type,
            "state": state,
        },
        "phase_durations_weeks": phases,
        "state_regulatory_modifier": perm_mod,
        "scale_factor": scale,
        "critical_path_weeks": total_weeks,
        "expected_start_to_ops_months": total_months,
        "permitting_risk": _permitting_risk(state, capacity_mw),
        "key_milestones_weeks_from_start": milestones,
        "notes": [
            f"{building_type.replace('_', ' ').title()} at {capacity_mw} MW in {state}: {total_months} months.",
            f"Permitting modifier for {state}: {perm_mod}x ({'+50%' if perm_mod > 1 else '-20%' if perm_mod < 1 else 'baseline'}).",
            f"Scale factor for {capacity_mw} MW: {scale}x.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
