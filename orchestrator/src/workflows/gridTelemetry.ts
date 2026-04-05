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

interface EiaResponse {
  response?: {
    data?: Array<{
      period:       string;
      respondent:   string;
      "type-name":  string;
      value:        number;
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

  const url =
    `https://api.eia.gov/v2/electricity/rto/region-data/data/` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=hourly` +
    `&data[0]=value` +
    `&facets[respondent][]=${encodeURIComponent(region_code)}` +
    `&sort[0][column]=period` +
    `&sort[0][direction]=desc` +
    `&length=5`;

  let raw: string;
  try {
    raw = await httpsGet(url);
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

  let parsed: EiaResponse;
  try {
    parsed = JSON.parse(raw) as EiaResponse;
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
        note: `Invalid JSON from EIA API: ${raw.slice(0, 200)}`,
      },
    };
  }

  const records = parsed?.response?.data ?? [];
  if (records.length === 0) {
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

  const rawRecords: GridRecord[] = records.map(r => ({
    period:    r.period,
    type_name: r["type-name"],
    value:     r.value,
    units:     r["value-units"],
  }));

  // Find latest demand (D) and net generation (NG) — exclude forecasts
  const demandRecord = rawRecords.find(r =>
    r.type_name.toLowerCase().includes("demand") &&
    !r.type_name.toLowerCase().includes("forecast")
  ) ?? null;

  const ngRecord = rawRecords.find(r =>
    r.type_name.toLowerCase().includes("net generation")
  ) ?? null;

  const demandMw       = demandRecord ? demandRecord.value : null;
  const netGenMw       = ngRecord     ? ngRecord.value     : null;
  const reserveMargin  = (demandMw !== null && netGenMw !== null && demandMw > 0)
    ? parseFloat((((netGenMw - demandMw) / demandMw) * 100).toFixed(1))
    : null;

  const dataPeriod = rawRecords[0]?.period ?? "";

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
