"""
Carbon Footprint Calculator (GHG Protocol Scope 2)
Usage: carbon_footprint.py <it_load_kw> <pue> <grid_region> [renewable_pct=0]

grid_region: WECC | SERC | RFC | MRO | NPCC | TRE | HICC | ASCC
"""

import sys
import json


# Grid emissions factors (lbs CO2/kWh) — EPA eGRID 2022
EMISSIONS_FACTORS = {
    "WECC": 0.687,
    "SERC": 0.734,
    "RFC":  0.815,
    "MRO":  0.936,
    "NPCC": 0.327,
    "TRE":  0.819,
    "HICC": 1.425,
    "ASCC": 1.123,
}

LBS_PER_METRIC_TON = 2204.6

# Industry benchmarks (tCO2/MW/yr)
BENCHMARKS = {
    "hyperscale": 500,
    "enterprise": 800,
}


def main() -> None:
    if len(sys.argv) < 4 or len(sys.argv) > 5:
        print(json.dumps({"error": "Usage: carbon_footprint.py <it_load_kw> <pue> <grid_region> [renewable_pct=0]"}), file=sys.stderr)
        sys.exit(1)

    try:
        it_load_kw = float(sys.argv[1])
        pue = float(sys.argv[2])
        grid_region = sys.argv[3].upper()
        renewable_pct = float(sys.argv[4]) if len(sys.argv) == 5 else 0.0
    except ValueError as e:
        print(json.dumps({"error": f"Invalid argument: {e}"}), file=sys.stderr)
        sys.exit(1)

    if it_load_kw < 1 or it_load_kw > 500000:
        print(json.dumps({"error": "it_load_kw must be 1-500000"}), file=sys.stderr)
        sys.exit(1)
    if pue < 1.0 or pue > 3.0:
        print(json.dumps({"error": "pue must be 1.0-3.0"}), file=sys.stderr)
        sys.exit(1)
    if grid_region not in EMISSIONS_FACTORS:
        print(json.dumps({"error": f"grid_region must be one of: {', '.join(EMISSIONS_FACTORS.keys())}"}), file=sys.stderr)
        sys.exit(1)
    if renewable_pct < 0 or renewable_pct > 100:
        print(json.dumps({"error": "renewable_pct must be 0-100"}), file=sys.stderr)
        sys.exit(1)

    ef = EMISSIONS_FACTORS[grid_region]

    # Total facility load
    total_kw = it_load_kw * pue
    annual_kwh = total_kw * 8760

    # Location-based emissions (always uses grid factor)
    location_emissions_lbs = annual_kwh * ef
    location_emissions_mt = location_emissions_lbs / LBS_PER_METRIC_TON

    # Market-based emissions (accounts for RECs)
    market_emissions_mt = location_emissions_mt * (1 - renewable_pct / 100.0)

    # Scope 3 estimate (~20% of Scope 2)
    scope3_mt = market_emissions_mt * 0.20

    # Carbon intensity
    it_mw = it_load_kw / 1000.0
    carbon_intensity = location_emissions_mt / it_mw if it_mw > 0 else 0

    # RECs needed for full offset
    rec_mwh = annual_kwh / 1000.0  # MWh = total facility

    # Net zero gap
    net_zero_gap_mt = market_emissions_mt + scope3_mt

    # Benchmark comparison
    benchmark_comparison = {}
    for name, benchmark_value in BENCHMARKS.items():
        benchmark_comparison[name] = {
            "benchmark_t_co2_per_mw_yr": benchmark_value,
            "vs_benchmark": "below" if carbon_intensity <= benchmark_value else "above",
            "delta_pct": round((carbon_intensity - benchmark_value) / benchmark_value * 100, 1),
        }

    output = {
        "input": {
            "it_load_kw": it_load_kw,
            "pue": pue,
            "grid_region": grid_region,
            "renewable_pct": renewable_pct,
        },
        "total_facility_kw": round(total_kw, 1),
        "annual_kwh": round(annual_kwh, 0),
        "emissions_factor_lbs_co2_per_kwh": ef,
        "location_based_emissions_metric_tons": round(location_emissions_mt, 1),
        "market_based_emissions_metric_tons": round(market_emissions_mt, 1),
        "scope3_estimate_metric_tons": round(scope3_mt, 1),
        "carbon_intensity_tons_per_mw_yr": round(carbon_intensity, 1),
        "rec_mwh_for_offset": round(rec_mwh, 0),
        "benchmark_comparison": benchmark_comparison,
        "net_zero_gap_metric_tons": round(net_zero_gap_mt, 1),
        "notes": [
            f"{grid_region} grid: {ef} lbs CO2/kWh. Total facility: {total_kw:,.0f} kW at PUE {pue}.",
            f"Location-based: {location_emissions_mt:,.0f} tCO2/yr; Market-based (with {renewable_pct}% RE): {market_emissions_mt:,.0f} tCO2/yr.",
            f"Carbon intensity {carbon_intensity:.0f} tCO2/MW/yr vs hyperscale benchmark 500 tCO2/MW/yr.",
        ],
    }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
