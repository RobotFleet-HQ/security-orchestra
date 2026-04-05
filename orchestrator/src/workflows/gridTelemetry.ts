import https from "https";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GridRegion = "ERCO" | "PJM";

export interface GridTelemetryParams {
  region_code: GridRegion;
  eia_api_key?: string;
}

export interface GridTelemetryResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    region_code:        string;
    region_name:        string;
    data_period:        string;
    demand_mw:          number | null;
    net_generation_mw:  number | null;
    reserve_margin_pct: number | null;
    raw_records:        GridRecord[];
    data_source:        string;
    duration_ms:        number;
    note?:              string;
  };
}

interface GridRecord {
  period:     string;
  type_name:  string;
  value:      number;
  units:      string;
}

interface EiaRegionResponse {
  response?: {
    data?: Array<{
      period:        string;
      respondent:    string;
      "type":        string;
      "type-name":   string;
      value:         number | string;
      "value-units": string;
    }>;
  };
}

interface EiaFuelTypeResponse {
  response?: {
    data?: Array<{
      period:        string;
      respondent:    string;
      fueltype:      string;
      "type-name":   string;
      value:         number | string;
      "value-units": string;
    }>;
  };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "SecurityOrchestraAgent/1.0" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runGridTelemetry(params: GridTelemetryParams): Promise<GridTelemetryResult> {
  const start = Date.now();
  const { region_code } = params;
  const apiKey = params.eia_api_key ?? process.env.EIA_API_KEY ?? "DEMO_KEY";

  const regionNames: Record<string, string> = {
    ERCO: "ERCOT (Texas)",
    PJM:  "PJM (Mid-Atlantic / Midwest)",
  };
  const regionName = regionNames[region_code] ?? region_code;

  // ── Fetch 1: region-data for Demand (D) ────────────────────────────────────
  // We request only type=D. NG is not available via DEMO_KEY on this endpoint;
  // we derive it from the fuel-type-data endpoint instead (see below).
  const demandUrl =
    `https://api.eia.gov/v2/electricity/rto/region-data/data/` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=hourly` +
    `&data[0]=value` +
    `&facets[respondent][]=${encodeURIComponent(region_code)}` +
    `&facets[type][]=D` +
    `&sort[0][column]=period` +
    `&sort[0][direction]=desc` +
    `&length=4`;

  // ── Fetch 2: fuel-type-data for Net Generation (sum of all fuel types) ─────
  // EIA exposes generation by fuel (BAT, COL, NG, NUC, OTH, SUN, WAT, WND).
  // Summing the latest hour gives total net generation — works with DEMO_KEY.
  const fuelUrl =
    `https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=hourly` +
    `&data[0]=value` +
    `&facets[respondent][]=${encodeURIComponent(region_code)}` +
    `&sort[0][column]=period` +
    `&sort[0][direction]=desc` +
    `&length=20`;

  let demandRaw: string;
  let fuelRaw: string;
  try {
    [demandRaw, fuelRaw] = await Promise.all([httpsGet(demandUrl), httpsGet(fuelUrl)]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      workflow: "get_grid_telemetry",
      target: region_code,
      timestamp: new Date().toISOString(),
      results: {
        region_code, region_name: regionName,
        data_period: "", demand_mw: null, net_generation_mw: null,
        reserve_margin_pct: null, raw_records: [],
        data_source: "EIA v2 API",
        duration_ms: Date.now() - start,
        note: `Network error fetching EIA data: ${msg}`,
      },
    };
  }

  let demandParsed: EiaRegionResponse;
  let fuelParsed: EiaFuelTypeResponse;
  try {
    demandParsed = JSON.parse(demandRaw) as EiaRegionResponse;
    fuelParsed   = JSON.parse(fuelRaw)   as EiaFuelTypeResponse;
  } catch {
    return {
      workflow: "get_grid_telemetry",
      target: region_code,
      timestamp: new Date().toISOString(),
      results: {
        region_code, region_name: regionName,
        data_period: "", demand_mw: null, net_generation_mw: null,
        reserve_margin_pct: null, raw_records: [],
        data_source: "EIA v2 API",
        duration_ms: Date.now() - start,
        note: "Invalid JSON from EIA API",
      },
    };
  }

  const demandRecords = demandParsed?.response?.data ?? [];
  if (demandRecords.length === 0) {
    return {
      workflow: "get_grid_telemetry",
      target: region_code,
      timestamp: new Date().toISOString(),
      results: {
        region_code, region_name: regionName,
        data_period: "", demand_mw: null, net_generation_mw: null,
        reserve_margin_pct: null, raw_records: [],
        data_source: "EIA v2 API",
        duration_ms: Date.now() - start,
        note: "No data returned from EIA API. Check region_code or API key.",
      },
    };
  }

  // Latest demand record
  const latestDemandRec = demandRecords[0];
  const demandMw = parseFloat(String(latestDemandRec.value));
  const dataPeriod = latestDemandRec.period;

  // Sum all fuel types at the most recent period to get total net generation
  const fuelRecords = fuelParsed?.response?.data ?? [];
  const latestFuelPeriod = fuelRecords[0]?.period ?? "";
  const latestFuelRecords = fuelRecords.filter(r => r.period === latestFuelPeriod);
  const netGenMw = latestFuelRecords.length > 0
    ? parseFloat(latestFuelRecords.reduce((sum, r) => sum + parseFloat(String(r.value) || "0"), 0).toFixed(0))
    : null;

  const reserveMargin = (netGenMw !== null && demandMw > 0)
    ? parseFloat((((netGenMw - demandMw) / demandMw) * 100).toFixed(1))
    : null;

  const rawRecords: GridRecord[] = [
    { period: dataPeriod, type_name: "Demand", value: demandMw, units: "megawatthours" },
    ...(netGenMw !== null ? [{ period: latestFuelPeriod, type_name: "Net generation (fuel-type sum)", value: netGenMw, units: "megawatthours" }] : []),
    ...latestFuelRecords.map(r => ({
      period:    r.period,
      type_name: r["type-name"],
      value:     parseFloat(String(r.value)),
      units:     r["value-units"],
    })),
  ];

  return {
    workflow:  "get_grid_telemetry",
    target:    region_code,
    timestamp: new Date().toISOString(),
    results: {
      region_code,
      region_name:        regionName,
      data_period:        dataPeriod,
      demand_mw:          demandMw,
      net_generation_mw:  netGenMw,
      reserve_margin_pct: reserveMargin,
      raw_records:        rawRecords,
      data_source:        "EIA v2 API — api.eia.gov",
      duration_ms:        Date.now() - start,
    },
  };
}
