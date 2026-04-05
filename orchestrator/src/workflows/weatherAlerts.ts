import https from "https";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeatherAlertsParams {
  state_code: string;  // Two-letter US state abbreviation, e.g. "TX", "PA"
}

export interface WeatherAlertsResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    state_code:    string;
    alert_count:   number;
    all_clear:     boolean;
    alerts:        ParsedAlert[];
    threat_flags:  ThreatFlags;
    data_source:   string;
    duration_ms:   number;
    note?:         string;
  };
}

export interface ParsedAlert {
  event:    string;
  severity: string;   // Minor | Moderate | Severe | Extreme | Unknown
  urgency:  string;   // Future | Expected | Immediate | Unknown
  headline: string;
  onset?:   string;
  expires?: string;
}

export interface ThreatFlags {
  has_severe_or_extreme:   boolean;  // severity = Severe or Extreme
  has_thunderstorm:        boolean;  // event contains "Thunderstorm Warning"
  has_tornado:             boolean;  // event contains "Tornado"
  has_hurricane:           boolean;  // event contains "Hurricane" or "Tropical"
  has_winter_storm:        boolean;  // event contains "Winter Storm", "Ice Storm", "Blizzard"
  has_extreme_heat:        boolean;  // event contains "Heat" + severity Extreme
}

interface NwsFeature {
  properties?: {
    event?:    string;
    severity?: string;
    urgency?:  string;
    headline?: string;
    onset?:    string;
    expires?:  string;
  };
}

interface NwsResponse {
  features?: NwsFeature[];
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runWeatherAlerts(params: WeatherAlertsParams): Promise<WeatherAlertsResult> {
  const start = Date.now();
  const stateCode = params.state_code.toUpperCase();

  const url = `https://api.weather.gov/alerts/active?area=${encodeURIComponent(stateCode)}`;

  let raw: string;
  try {
    raw = await httpsGet(url, {
      "User-Agent": "SecurityOrchestraAgent/1.0 (contact@security-orchestra.io)",
      "Accept":     "application/geo+json",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      workflow: "get_active_weather_alerts",
      target: stateCode,
      timestamp: new Date().toISOString(),
      results: {
        state_code: stateCode, alert_count: 0, all_clear: false,
        alerts: [], threat_flags: emptyFlags(),
        data_source: "NWS API — api.weather.gov",
        duration_ms: Date.now() - start,
        note: `Network error fetching NWS alerts: ${msg}`,
      },
    };
  }

  let parsed: NwsResponse;
  try {
    parsed = JSON.parse(raw) as NwsResponse;
  } catch {
    return {
      workflow: "get_active_weather_alerts",
      target: stateCode,
      timestamp: new Date().toISOString(),
      results: {
        state_code: stateCode, alert_count: 0, all_clear: false,
        alerts: [], threat_flags: emptyFlags(),
        data_source: "NWS API — api.weather.gov",
        duration_ms: Date.now() - start,
        note: `Invalid JSON from NWS API: ${raw.slice(0, 200)}`,
      },
    };
  }

  const features = parsed?.features ?? [];
  const alerts: ParsedAlert[] = features.map(f => ({
    event:    f.properties?.event    ?? "Unknown",
    severity: f.properties?.severity ?? "Unknown",
    urgency:  f.properties?.urgency  ?? "Unknown",
    headline: f.properties?.headline ?? "",
    onset:    f.properties?.onset    ?? undefined,
    expires:  f.properties?.expires  ?? undefined,
  }));

  const flags = computeThreatFlags(alerts);

  return {
    workflow:  "get_active_weather_alerts",
    target:    stateCode,
    timestamp: new Date().toISOString(),
    results: {
      state_code:   stateCode,
      alert_count:  alerts.length,
      all_clear:    alerts.length === 0,
      alerts,
      threat_flags: flags,
      data_source:  "NWS API — api.weather.gov (no API key required)",
      duration_ms:  Date.now() - start,
    },
  };
}

function emptyFlags(): ThreatFlags {
  return {
    has_severe_or_extreme:  false,
    has_thunderstorm:       false,
    has_tornado:            false,
    has_hurricane:          false,
    has_winter_storm:       false,
    has_extreme_heat:       false,
  };
}

function computeThreatFlags(alerts: ParsedAlert[]): ThreatFlags {
  const flags = emptyFlags();
  for (const a of alerts) {
    const ev  = a.event.toLowerCase();
    const sev = a.severity.toLowerCase();
    if (sev === "severe" || sev === "extreme")                                    flags.has_severe_or_extreme  = true;
    if (ev.includes("thunderstorm warning"))                                      flags.has_thunderstorm       = true;
    if (ev.includes("tornado"))                                                   flags.has_tornado            = true;
    if (ev.includes("hurricane") || ev.includes("tropical"))                     flags.has_hurricane          = true;
    if (ev.includes("winter storm") || ev.includes("ice storm") || ev.includes("blizzard")) flags.has_winter_storm = true;
    if (ev.includes("heat") && sev === "extreme")                                flags.has_extreme_heat       = true;
  }
  return flags;
}
