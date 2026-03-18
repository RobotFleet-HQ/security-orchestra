#!/usr/bin/env python3
"""
NC Utility Interconnect Agent
==============================
Models the generator/solar interconnect application process for the three
major North Carolina utilities: Duke Energy Progress (DEP), Duke Energy
Carolinas (DEC), and Dominion Energy North Carolina (DENC).

Based on publicly filed NCUC tariff schedules and standard interconnect
procedures as of 2024–2025.

Usage:
    python nc_utility_interconnect.py <utility> <capacity_kw> <county>
                                      <interconnect_type> <voltage_level>
                                      <project_type>

Output: JSON to stdout, errors to stderr, exit 0 on success.
"""

import sys
import json

# ─── Utility territory data ───────────────────────────────────────────────────
# County lists based on NC Utilities Commission service territory maps.

UTILITY_TERRITORY = {
    "Duke Energy Progress": {
        "abbreviation": "DEP",
        "ncuc_docket_prefix": "E-2",
        "application_portal": "https://www.duke-energy.com/business/products/interconnections",
        "engineering_contact": "interconnections@duke-energy.com",
        "tariff_schedule": "Rider DG1 (Distributed Generation Interconnection)",
        "counties": [
            "Wake", "Durham", "Johnston", "Wayne", "Nash", "Edgecombe", "Wilson",
            "Pitt", "Beaufort", "Craven", "Lenoir", "Jones", "Onslow", "Duplin",
            "Sampson", "Cumberland", "Harnett", "Lee", "Chatham", "Moore",
            "Montgomery", "Richmond", "Hoke", "Scotland", "Robeson",
            "Columbus", "Bladen", "Brunswick", "New Hanover", "Pender",
            "Carteret", "Pamlico", "Hyde", "Tyrrell", "Washington",
            "Martin", "Bertie", "Hertford", "Gates", "Chowan", "Perquimans",
            "Pasquotank", "Camden", "Currituck", "Dare",
        ],
    },
    "Duke Energy Carolinas": {
        "abbreviation": "DEC",
        "ncuc_docket_prefix": "E-7",
        "application_portal": "https://www.duke-energy.com/business/products/interconnections",
        "engineering_contact": "interconnections@duke-energy.com",
        "tariff_schedule": "Rider DG1 (Distributed Generation Interconnection)",
        "counties": [
            "Mecklenburg", "Cabarrus", "Union", "Anson", "Stanly",
            "Rowan", "Iredell", "Lincoln", "Gaston", "Cleveland", "Rutherford",
            "Polk", "Henderson", "Transylvania", "Buncombe", "Madison",
            "Yancey", "Mitchell", "Avery", "Watauga", "Caldwell", "Burke",
            "McDowell", "Catawba", "Alexander", "Wilkes", "Surry", "Yadkin",
            "Davie", "Davidson", "Forsyth", "Stokes", "Rockingham", "Guilford",
            "Alamance", "Orange", "Caswell", "Person", "Granville", "Vance",
            "Warren",
        ],
    },
    "Dominion Energy NC": {
        "abbreviation": "DENC",
        "ncuc_docket_prefix": "E-22",
        "application_portal": "https://www.dominionenergy.com/north-carolina/generate-power/interconnection",
        "engineering_contact": "ncinterconnect@dominionenergy.com",
        "tariff_schedule": "Schedule 19 (Cogeneration and Small Power Production)",
        "counties": [
            "Northampton", "Halifax", "Warren", "Vance", "Franklin", "Nash",
        ],
    },
}

# ─── Interconnect type definitions ────────────────────────────────────────────
INTERCONNECT_TYPES = {
    "emergency standby": {
        "ncuc_filing": False,
        "export_allowed": False,
        "description": "Emergency standby generator — no export, NCUC filing typically not required",
        "study_required": False,
        "base_timeline_weeks": (4, 8),
    },
    "parallel operation": {
        "ncuc_filing": True,
        "export_allowed": False,
        "description": "Operates in parallel with utility grid, no net export",
        "study_required": True,
        "base_timeline_weeks": (12, 24),
    },
    "export": {
        "ncuc_filing": True,
        "export_allowed": True,
        "description": "Generates and exports power to grid — full interconnect application required",
        "study_required": True,
        "base_timeline_weeks": (20, 52),
    },
    "net metering": {
        "ncuc_filing": False,
        "export_allowed": True,
        "description": "Net metering up to 1000 kW — governed by NC Session Law 2017-192",
        "study_required": False,
        "base_timeline_weeks": (8, 16),
    },
}

# ─── Voltage level study requirements ────────────────────────────────────────
VOLTAGE_STUDY_REQUIREMENTS = {
    "120/240V":  {"studies": ["basic screening"],               "protection": "Standard"},
    "208Y/120V": {"studies": ["basic screening"],               "protection": "Standard"},
    "480V":      {"studies": ["load flow", "protection study"], "protection": "Relay coordination"},
    "4160V":     {"studies": ["load flow", "short circuit", "protection study"], "protection": "Full protection study"},
    "12.47kV":   {"studies": ["load flow", "short circuit", "protection study", "stability"], "protection": "Transmission interconnection"},
    "115kV":     {"studies": ["load flow", "short circuit", "protection study", "stability", "power quality"], "protection": "Transmission interconnection — FERC jurisdiction possible"},
}


def get_application_fees(utility, capacity_kw, interconnect_type, voltage):
    if capacity_kw <= 100:
        app_fee = 100;  study_deposit = 0
    elif capacity_kw <= 1000:
        app_fee = 500;  study_deposit = 1_000 if interconnect_type in ["parallel operation", "export"] else 0
    elif capacity_kw <= 10_000:
        app_fee = 1_500; study_deposit = 10_000 if interconnect_type in ["parallel operation", "export"] else 0
    elif capacity_kw <= 20_000:
        app_fee = 3_000; study_deposit = 25_000 if interconnect_type in ["parallel operation", "export"] else 0
    else:
        app_fee = 5_000; study_deposit = 50_000 if interconnect_type in ["parallel operation", "export"] else 0

    protection_relay_cost = 0
    if voltage in ["4160V", "12.47kV", "115kV"]:
        if "Duke" in utility:
            protection_relay_cost = 15_000 if capacity_kw <= 5000 else 40_000
        else:
            protection_relay_cost = 12_000 if capacity_kw <= 5000 else 35_000

    return {
        "application_fee_usd":                 app_fee,
        "feasibility_study_deposit_usd":        study_deposit,
        "protection_relay_engineering_usd":     protection_relay_cost,
        "total_estimated_fees_usd":             app_fee + study_deposit + protection_relay_cost,
        "note": "Fees based on publicly filed NC tariff schedules. Actual fees confirmed at application.",
    }


def get_process_steps(utility, capacity_kw, interconnect_type, voltage, project_type):
    intercon    = INTERCONNECT_TYPES[interconnect_type]
    udata       = UTILITY_TERRITORY[utility]
    voltage_req = VOLTAGE_STUDY_REQUIREMENTS.get(voltage, VOLTAGE_STUDY_REQUIREMENTS["480V"])
    study_needed = intercon["study_required"] or voltage in ["4160V", "12.47kV", "115kV"]

    steps = []
    week  = 0

    steps.append({
        "step":        "1. Pre-Application Meeting",
        "description": f"Schedule pre-application meeting with {utility} interconnection team.",
        "timeline":    "Weeks 1–2",
        "action":      f"Submit request via {udata['application_portal']}",
        "week_start":  week, "week_end": week + 2,
    })
    week += 2

    steps.append({
        "step":        "2. Formal Application Submission",
        "description": "Submit completed application with one-line diagram, site plan, equipment specs, and fee.",
        "timeline":    f"Week {week + 1}",
        "action":      "Submit via online portal with payment",
        "week_start":  week, "week_end": week + 1,
    })
    week += 1

    steps.append({
        "step":        "3. Application Completeness Review",
        "description": f"{utility} reviews for completeness. Incomplete applications returned within 5 business days.",
        "timeline":    f"Weeks {week + 1}–{week + 3}",
        "action":      "Respond to any requests for additional information",
        "week_start":  week, "week_end": week + 3,
    })
    week += 3

    if study_needed:
        study_list = ", ".join(voltage_req["studies"])
        duration   = 8 if capacity_kw <= 1000 else (12 if capacity_kw <= 10_000 else 20)
        steps.append({
            "step":        "4. Engineering Studies",
            "description": f"Required studies: {study_list}. Protection: {voltage_req['protection']}.",
            "timeline":    f"Weeks {week + 1}–{week + duration}",
            "action":      "Pay study deposit; review mitigation requirements with utility engineers",
            "week_start":  week, "week_end": week + duration,
        })
        week += duration

    if intercon["ncuc_filing"]:
        steps.append({
            "step":        f"{len(steps) + 1}. NCUC Docket Filing",
            "description": f"File interconnection agreement with NC Utilities Commission under docket {udata['ncuc_docket_prefix']}. Public notice period applies.",
            "timeline":    f"Weeks {week + 1}–{week + 8}",
            "action":      "File at ncuc.commerce.state.nc.us; coordinate with utility legal team",
            "week_start":  week, "week_end": week + 8,
        })
        week += 8

    steps.append({
        "step":        f"{len(steps) + 1}. Interconnection Agreement Execution",
        "description": "Execute signed Interconnection Agreement. Utility countersigns within 5 business days.",
        "timeline":    f"Weeks {week + 1}–{week + 2}",
        "action":      "Review with legal counsel; execute and return",
        "week_start":  week, "week_end": week + 2,
    })
    week += 2

    steps.append({
        "step":        f"{len(steps) + 1}. Construction and Utility Inspection",
        "description": f"Install protective relaying, metering, and disconnect equipment per {utility} specs.",
        "timeline":    f"Weeks {week + 1}–{week + 4}",
        "action":      "Schedule utility inspection with 5-business-day advance notice",
        "week_start":  week, "week_end": week + 4,
    })
    week += 4

    steps.append({
        "step":        f"{len(steps) + 1}. Permission to Operate (PTO)",
        "description": "Utility issues Permission to Operate after successful inspection and meter installation.",
        "timeline":    f"Week {week + 1}",
        "action":      "Obtain signed PTO before energizing in parallel with grid",
        "week_start":  week, "week_end": week + 1,
    })
    week += 1

    return steps, week


def data_center_considerations(capacity_kw, interconnect_type):
    notes = [
        "Emergency standby generators operated only during utility outages typically use a simplified interconnect process — confirm classification with utility.",
        "UPS systems that can back-feed during outages may trigger parallel operation requirements; notify utility proactively.",
        "Data center critical loads qualify for expedited scheduling in some utility programs — ask about Critical Facilities programs.",
    ]
    if capacity_kw >= 1_000:
        notes.append("Facilities >= 1 MW must notify utility 30 days before commissioning under NC Session Law 2021-165.")
    if capacity_kw >= 5_000:
        notes.append("Facilities >= 5 MW must file notice with NCUC and may require transmission-level interconnect studies.")
    if interconnect_type == "export":
        notes.append("Export projects may be subject to FERC jurisdiction if interconnecting at transmission level (>= 69 kV).")
    return notes


def main():
    if len(sys.argv) < 7:
        err = {
            "error": (
                "Usage: nc_utility_interconnect.py <utility> <capacity_kw> <county> "
                "<interconnect_type> <voltage_level> <project_type>"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    utility_raw       = sys.argv[1]
    capacity_kw       = float(sys.argv[2])
    county            = sys.argv[3].strip()
    interconnect_type = sys.argv[4].strip().lower()
    voltage_level     = sys.argv[5].strip()
    project_type      = sys.argv[6].strip().lower()

    utility = None
    for key in UTILITY_TERRITORY:
        if key.lower() in utility_raw.lower() or utility_raw.lower() in key.lower():
            utility = key
            break

    if not utility:
        err = {
            "error": (
                f"Unknown utility '{utility_raw}'. "
                "Must be one of: Duke Energy Progress, Duke Energy Carolinas, Dominion Energy NC"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    if interconnect_type not in INTERCONNECT_TYPES:
        err = {
            "error": (
                f"Unknown interconnect_type '{interconnect_type}'. "
                "Must be: emergency standby, parallel operation, export, net metering"
            )
        }
        print(json.dumps(err), file=sys.stderr)
        sys.exit(1)

    udata       = UTILITY_TERRITORY[utility]
    intercon    = INTERCONNECT_TYPES[interconnect_type]
    fees        = get_application_fees(utility, capacity_kw, interconnect_type, voltage_level)
    steps, _    = get_process_steps(utility, capacity_kw, interconnect_type, voltage_level, project_type)
    dc_notes    = data_center_considerations(capacity_kw, interconnect_type)
    voltage_req = VOLTAGE_STUDY_REQUIREMENTS.get(voltage_level, VOLTAGE_STUDY_REQUIREMENTS["480V"])

    territory_confirmed = county.title() in udata["counties"]

    timeline_low, timeline_high = intercon["base_timeline_weeks"]
    if capacity_kw > 10_000:
        timeline_low = max(timeline_low, 26);  timeline_high = max(timeline_high, 52)
    elif capacity_kw > 1_000:
        timeline_low = max(timeline_low, 16);  timeline_high = max(timeline_high, 36)

    result = {
        "utility":              utility,
        "utility_abbreviation": udata["abbreviation"],
        "ncuc_docket_prefix":   udata["ncuc_docket_prefix"],
        "county":               county,
        "territory_confirmed":  territory_confirmed,
        "territory_note": (
            f"{county} County is in {utility} service territory."
            if territory_confirmed
            else f"Could not confirm {county} County in {utility} territory — verify at ncuc.commerce.state.nc.us"
        ),
        "input": {
            "capacity_kw":       capacity_kw,
            "interconnect_type": interconnect_type,
            "voltage_level":     voltage_level,
            "project_type":      project_type,
        },
        "interconnect_type_details": {
            "type":                      interconnect_type,
            "description":               intercon["description"],
            "export_allowed":            intercon["export_allowed"],
            "ncuc_filing_required":      intercon["ncuc_filing"],
            "engineering_study_required": intercon["study_required"],
        },
        "voltage_requirements": {
            "voltage_level":    voltage_level,
            "required_studies": voltage_req["studies"],
            "protection_type":  voltage_req["protection"],
        },
        "application_process": {
            "portal":          udata["application_portal"],
            "contact_email":   udata["engineering_contact"],
            "tariff_schedule": udata["tariff_schedule"],
            "steps":           steps,
            "total_steps":     len(steps),
        },
        "timeline_estimate": {
            "total_weeks_low":   timeline_low,
            "total_weeks_high":  timeline_high,
            "total_months_low":  round(timeline_low / 4.3, 1),
            "total_months_high": round(timeline_high / 4.3, 1),
            "note": "Timeline estimates based on publicly filed NC tariff schedules. Contact utility for current queue position and processing times.",
        },
        "fees": fees,
        "ncuc_requirements": {
            "filing_required":    intercon["ncuc_filing"],
            "docket":             udata["ncuc_docket_prefix"] if intercon["ncuc_filing"] else "N/A",
            "public_notice_days": 30 if intercon["ncuc_filing"] else 0,
            "portal":             "https://ncuc.commerce.state.nc.us/ncucWeb/",
        },
        "data_center_considerations": dc_notes,
        "disclaimer": (
            "Timeline and fee estimates are based on publicly filed NC tariff schedules and NCUC docket filings. "
            "Actual timelines and fees may vary. Contact the utility interconnection department to confirm current "
            "queue position, processing times, and applicable tariff rates."
        ),
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
