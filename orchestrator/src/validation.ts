import validator from "validator";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// ─── Shell / injection pattern blocklist ─────────────────────────────────────
// These patterns flag command injection, path traversal, and SQL/template injection.

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /[;&|`$(){}[\]<>]/, label: "shell metacharacter" },
  { pattern: /\.\.[\\/]/, label: "path traversal sequence" },
  { pattern: /\r|\n|\0/, label: "control character" },
  { pattern: /\bOR\b|\bAND\b|\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b/i, label: "SQL keyword injection" },
  { pattern: /{{|}}|<%|%>/, label: "template injection sequence" },
  { pattern: /javascript:/i, label: "javascript: URI" },
  { pattern: /\s{2,}/, label: "excessive whitespace" },
];

/**
 * Sanitize a raw string: trim whitespace, strip non-printable characters.
 * Returns the cleaned string (does NOT throw — callers decide what to do with it).
 */
export function sanitizeInput(input: string): string {
  // Remove non-printable ASCII except normal space (0x20)
  // eslint-disable-next-line no-control-regex
  return input.trim().replace(/[^\x20-\x7E]/g, "");
}

/**
 * Check a sanitized string against the injection blocklist.
 * Returns the first matching label, or null if clean.
 */
function detectInjection(value: string): string | null {
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(value)) return label;
  }
  return null;
}

// ─── Domain validation ────────────────────────────────────────────────────────

const MAX_DOMAIN_LEN = 253;

/**
 * Returns true only if `domain` is a well-formed FQDN with no injection payloads.
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > MAX_DOMAIN_LEN) return false;
  if (detectInjection(domain) !== null) return false;

  return validator.isFQDN(domain, {
    require_tld: true,
    allow_underscores: false,
    allow_trailing_dot: false,
    allow_numeric_tld: false,
  });
}

// ─── IP validation ────────────────────────────────────────────────────────────

/**
 * Returns true only if `ip` is a valid IPv4 or IPv6 address with no injection.
 */
export function isValidIP(ip: string): boolean {
  if (!ip) return false;
  if (detectInjection(ip) !== null) return false;
  return validator.isIP(ip, 4) || validator.isIP(ip, 6);
}

// ─── Per-workflow parameter validation ───────────────────────────────────────

/**
 * Validates all parameters for a given workflow.
 * Throws McpError(InvalidParams / 400) with a descriptive message on failure.
 * Returns a record of sanitized parameter values on success.
 */
export function validateWorkflowParams(
  workflow: string,
  params: Record<string, string>
): Record<string, string> {
  const clean: Record<string, string> = {};

  switch (workflow) {
    case "subdomain_discovery":
    case "asset_discovery": {
      const raw = params.domain ?? "";
      const sanitized = sanitizeInput(raw);

      const injectionHit = detectInjection(sanitized);
      if (injectionHit) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid domain — detected ${injectionHit}`
        );
      }
      if (!isValidDomain(sanitized)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid domain format: "${sanitized}". Must be a valid FQDN (e.g. example.com)`
        );
      }
      clean.domain = sanitized;
      break;
    }

    case "vulnerability_assessment": {
      const raw = params.target ?? "";
      const sanitized = sanitizeInput(raw);

      const injectionHit = detectInjection(sanitized);
      if (injectionHit) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid target — detected ${injectionHit}`
        );
      }
      // Target may be a domain or an IP
      if (!isValidDomain(sanitized) && !isValidIP(sanitized)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid target format: "${sanitized}". Must be a valid domain or IP address`
        );
      }
      clean.target = sanitized;
      break;
    }

    case "generator_sizing": {
      // load_kw — required, numeric, 1–50000
      const rawKw = params.load_kw ?? "";
      const loadKw = parseFloat(sanitizeInput(rawKw));
      if (isNaN(loadKw) || loadKw < 1 || loadKw > 50_000) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid load_kw: "${rawKw}". Must be a number between 1 and 50000`
        );
      }
      clean.load_kw = String(loadKw);

      // tier — required, enum
      const VALID_TIERS = ["N", "N+1", "2N", "2N+1"];
      const tier = sanitizeInput(params.tier ?? "");
      if (!VALID_TIERS.includes(tier)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid tier: "${tier}". Must be one of: ${VALID_TIERS.join(", ")}`
        );
      }
      clean.tier = tier;

      // altitude_ft — optional, numeric, 0–15000 ft
      if (params.altitude_ft !== undefined) {
        const alt = parseFloat(sanitizeInput(params.altitude_ft));
        if (isNaN(alt) || alt < 0 || alt > 15_000) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid altitude_ft: "${params.altitude_ft}". Must be 0–15000`
          );
        }
        clean.altitude_ft = String(alt);
      }

      // temp_f — optional, numeric, -40–140 °F (operational range)
      if (params.temp_f !== undefined) {
        const temp = parseFloat(sanitizeInput(params.temp_f));
        if (isNaN(temp) || temp < -40 || temp > 140) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid temp_f: "${params.temp_f}". Must be -40–140 °F`
          );
        }
        clean.temp_f = String(temp);
      }
      break;
    }

    case "utility_interconnect": {
      // utility — required, enum
      const VALID_UTILITIES = [
        "dominion", "pge", "comed", "georgia_power",
        "aps", "oncor", "duke_energy", "sce", "xcel",
      ];
      const utility = sanitizeInput(params.utility ?? "");
      if (!VALID_UTILITIES.includes(utility)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid utility: "${utility}". Must be one of: ${VALID_UTILITIES.join(", ")}`
        );
      }
      clean.utility = utility;

      // load_mw — required, numeric, 1–500
      const rawMw  = params.load_mw ?? "";
      const loadMw = parseFloat(sanitizeInput(rawMw));
      if (isNaN(loadMw) || loadMw < 1 || loadMw > 500) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid load_mw: "${rawMw}". Must be a number between 1 and 500`
        );
      }
      clean.load_mw = String(loadMw);

      // voltage_kv — optional, numeric, 4–765 kV
      if (params.voltage_kv !== undefined) {
        const kv = parseFloat(sanitizeInput(params.voltage_kv));
        if (isNaN(kv) || kv < 4 || kv > 765) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid voltage_kv: "${params.voltage_kv}". Must be 4–765 kV`
          );
        }
        clean.voltage_kv = String(kv);
      }

      // load_type — optional, enum
      const VALID_LOAD_TYPES = ["data_center", "industrial", "commercial"];
      if (params.load_type !== undefined) {
        const lt = sanitizeInput(params.load_type);
        if (!VALID_LOAD_TYPES.includes(lt)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid load_type: "${lt}". Must be one of: ${VALID_LOAD_TYPES.join(", ")}`
          );
        }
        clean.load_type = lt;
      }

      // state — optional, 2-letter US state code
      if (params.state !== undefined) {
        const st = sanitizeInput(params.state).toUpperCase();
        if (!/^[A-Z]{2}$/.test(st)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid state: "${params.state}". Must be a 2-letter US state code (e.g. VA, TX, CA)`
          );
        }
        clean.state = st;
      }
      break;
    }

    case "construction_cost": {
      // capacity_mw — required, numeric, 0.1–1000
      const rawMw  = params.capacity_mw ?? "";
      const capMw  = parseFloat(sanitizeInput(rawMw));
      if (isNaN(capMw) || capMw < 0.1 || capMw > 1000) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid capacity_mw: "${rawMw}". Must be a number between 0.1 and 1000`
        );
      }
      clean.capacity_mw = String(capMw);

      // tier — optional, enum
      const VALID_TIERS_CC = ["tier1", "tier2", "tier3", "tier4"];
      if (params.tier !== undefined) {
        const t = sanitizeInput(params.tier);
        if (!VALID_TIERS_CC.includes(t)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid tier: "${t}". Must be one of: ${VALID_TIERS_CC.join(", ")}`
          );
        }
        clean.tier = t;
      }

      // region — optional, enum
      const VALID_REGIONS = [
        "northeast", "mid_atlantic", "southeast", "midwest",
        "southwest", "mountain", "pacific", "pacific_nw",
      ];
      if (params.region !== undefined) {
        const r = sanitizeInput(params.region);
        if (!VALID_REGIONS.includes(r)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid region: "${r}". Must be one of: ${VALID_REGIONS.join(", ")}`
          );
        }
        clean.region = r;
      }

      // building_type — optional, enum
      const VALID_BUILDING_TYPES = ["new_build", "shell_core", "retrofit"];
      if (params.building_type !== undefined) {
        const bt = sanitizeInput(params.building_type);
        if (!VALID_BUILDING_TYPES.includes(bt)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid building_type: "${bt}". Must be one of: ${VALID_BUILDING_TYPES.join(", ")}`
          );
        }
        clean.building_type = bt;
      }

      // electricity_rate_per_kwh — optional, numeric, 0.01–2.0
      if (params.electricity_rate_per_kwh !== undefined) {
        const rate = parseFloat(sanitizeInput(params.electricity_rate_per_kwh));
        if (isNaN(rate) || rate < 0.01 || rate > 2.0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid electricity_rate_per_kwh: "${params.electricity_rate_per_kwh}". Must be 0.01–2.0`
          );
        }
        clean.electricity_rate_per_kwh = String(rate);
      }
      break;
    }

    case "pue_calculator": {
      // it_load_kw — required, numeric, 1–500000
      const rawKw  = params.it_load_kw ?? "";
      const itLoad = parseFloat(sanitizeInput(rawKw));
      if (isNaN(itLoad) || itLoad < 1 || itLoad > 500_000) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid it_load_kw: "${rawKw}". Must be a number between 1 and 500000`
        );
      }
      clean.it_load_kw = String(itLoad);

      // cooling_load_kw — optional, numeric, 0–2000000
      if (params.cooling_load_kw !== undefined) {
        const cl = parseFloat(sanitizeInput(params.cooling_load_kw));
        if (isNaN(cl) || cl < 0 || cl > 2_000_000) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid cooling_load_kw: "${params.cooling_load_kw}". Must be 0–2000000`
          );
        }
        clean.cooling_load_kw = String(cl);
      }

      // ups_efficiency_pct — optional, numeric, 50–100
      if (params.ups_efficiency_pct !== undefined) {
        const eff = parseFloat(sanitizeInput(params.ups_efficiency_pct));
        if (isNaN(eff) || eff < 50 || eff > 100) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid ups_efficiency_pct: "${params.ups_efficiency_pct}". Must be 50–100`
          );
        }
        clean.ups_efficiency_pct = String(eff);
      }

      // pdu_loss_pct — optional, numeric, 0–20
      if (params.pdu_loss_pct !== undefined) {
        const pdu = parseFloat(sanitizeInput(params.pdu_loss_pct));
        if (isNaN(pdu) || pdu < 0 || pdu > 20) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid pdu_loss_pct: "${params.pdu_loss_pct}". Must be 0–20`
          );
        }
        clean.pdu_loss_pct = String(pdu);
      }

      // lighting_kw — optional, numeric, 0–10000
      if (params.lighting_kw !== undefined) {
        const lkw = parseFloat(sanitizeInput(params.lighting_kw));
        if (isNaN(lkw) || lkw < 0 || lkw > 10_000) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid lighting_kw: "${params.lighting_kw}". Must be 0–10000`
          );
        }
        clean.lighting_kw = String(lkw);
      }

      // cooling_type — optional, enum
      const VALID_COOLING = ["air_cooled", "water_cooled", "free_cooling", "hybrid", "liquid_immersion"];
      if (params.cooling_type !== undefined) {
        const ct = sanitizeInput(params.cooling_type);
        if (!VALID_COOLING.includes(ct)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid cooling_type: "${ct}". Must be one of: ${VALID_COOLING.join(", ")}`
          );
        }
        clean.cooling_type = ct;
      }

      // electricity_rate_per_kwh — optional, numeric, 0.01–2.0
      if (params.electricity_rate_per_kwh !== undefined) {
        const rate = parseFloat(sanitizeInput(params.electricity_rate_per_kwh));
        if (isNaN(rate) || rate < 0.01 || rate > 2.0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid electricity_rate_per_kwh: "${params.electricity_rate_per_kwh}". Must be 0.01–2.0`
          );
        }
        clean.electricity_rate_per_kwh = String(rate);
      }
      break;
    }

    case "nc_utility_interconnect": {
      // load_mw — required, numeric, 1–500
      const rawMw  = params.load_mw ?? "";
      const loadMw = parseFloat(sanitizeInput(rawMw));
      if (isNaN(loadMw) || loadMw < 1 || loadMw > 500) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `400: Invalid load_mw: "${rawMw}". Must be a number between 1 and 500`
        );
      }
      clean.load_mw = String(loadMw);

      // voltage_kv — optional, numeric, 4–765 kV
      if (params.voltage_kv !== undefined) {
        const kv = parseFloat(sanitizeInput(params.voltage_kv));
        if (isNaN(kv) || kv < 4 || kv > 765) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid voltage_kv: "${params.voltage_kv}". Must be 4–765 kV`
          );
        }
        clean.voltage_kv = String(kv);
      }

      // load_type — optional, enum
      const VALID_LOAD_TYPES_NC = ["data_center", "industrial", "commercial"];
      if (params.load_type !== undefined) {
        const lt = sanitizeInput(params.load_type);
        if (!VALID_LOAD_TYPES_NC.includes(lt)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid load_type: "${lt}". Must be one of: ${VALID_LOAD_TYPES_NC.join(", ")}`
          );
        }
        clean.load_type = lt;
      }

      // state — optional, 2-letter US state code
      if (params.state !== undefined) {
        const st = sanitizeInput(params.state).toUpperCase();
        if (!/^[A-Z]{2}$/.test(st)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `400: Invalid state: "${params.state}". Must be a 2-letter US state code (e.g. NC, SC)`
          );
        }
        clean.state = st;
      }
      break;
    }

    case "nfpa_110_checker": {
      // generator_kw — required, numeric, 1–10000
      const genKw = parseFloat(sanitizeInput(params.generator_kw ?? ""));
      if (isNaN(genKw) || genKw < 1 || genKw > 10_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_kw: "${params.generator_kw}". Must be 1–10000`);
      }
      clean.generator_kw = String(genKw);

      // fuel_capacity_gallons — required, numeric, 1–100000
      const fuelGal = parseFloat(sanitizeInput(params.fuel_capacity_gallons ?? ""));
      if (isNaN(fuelGal) || fuelGal < 1 || fuelGal > 100_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid fuel_capacity_gallons: "${params.fuel_capacity_gallons}". Must be 1–100000`);
      }
      clean.fuel_capacity_gallons = String(fuelGal);

      // runtime_hours — required, numeric, 0.1–720
      const rtHrs = parseFloat(sanitizeInput(params.runtime_hours ?? ""));
      if (isNaN(rtHrs) || rtHrs < 0.1 || rtHrs > 720) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid runtime_hours: "${params.runtime_hours}". Must be 0.1–720`);
      }
      clean.runtime_hours = String(rtHrs);

      // ats_transfer_time_seconds — required, numeric, 0–120
      const atsSec = parseFloat(sanitizeInput(params.ats_transfer_time_seconds ?? ""));
      if (isNaN(atsSec) || atsSec < 0 || atsSec > 120) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ats_transfer_time_seconds: "${params.ats_transfer_time_seconds}". Must be 0–120`);
      }
      clean.ats_transfer_time_seconds = String(atsSec);

      // level — required, 1 or 2
      const lvl = parseInt(sanitizeInput(params.level ?? ""));
      if (lvl !== 1 && lvl !== 2) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid level: "${params.level}". Must be 1 or 2`);
      }
      clean.level = String(lvl);

      // fuel_type — optional, enum
      if (params.fuel_type !== undefined) {
        const ft = sanitizeInput(params.fuel_type);
        if (!["diesel", "natural_gas", "propane"].includes(ft)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid fuel_type: "${ft}". Must be diesel, natural_gas, or propane`);
        }
        clean.fuel_type = ft;
      }
      break;
    }

    case "ats_sizing": {
      // load_kw — required, numeric, 1–10000
      const atsLoadKw = parseFloat(sanitizeInput(params.load_kw ?? ""));
      if (isNaN(atsLoadKw) || atsLoadKw < 1 || atsLoadKw > 10_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid load_kw: "${params.load_kw}". Must be 1–10000`);
      }
      clean.load_kw = String(atsLoadKw);

      // voltage — required, enum
      const VALID_VOLTAGES = [120, 208, 240, 277, 480, 600];
      const atsVolt = parseInt(sanitizeInput(params.voltage ?? ""));
      if (!VALID_VOLTAGES.includes(atsVolt)) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid voltage: "${params.voltage}". Must be one of: ${VALID_VOLTAGES.join(", ")}`);
      }
      clean.voltage = String(atsVolt);

      // phases — required, 1 or 3
      const atsPhases = parseInt(sanitizeInput(params.phases ?? ""));
      if (atsPhases !== 1 && atsPhases !== 3) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid phases: "${params.phases}". Must be 1 or 3`);
      }
      clean.phases = String(atsPhases);

      // application_type — optional, enum
      if (params.application_type !== undefined) {
        const at = sanitizeInput(params.application_type);
        if (!["emergency", "legally_required", "optional", "critical"].includes(at)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid application_type: "${at}". Must be emergency, legally_required, optional, or critical`);
        }
        clean.application_type = at;
      }
      break;
    }

    case "ups_sizing": {
      // load_kw — required, numeric, 1–100000
      const upsLoadKw = parseFloat(sanitizeInput(params.load_kw ?? ""));
      if (isNaN(upsLoadKw) || upsLoadKw < 1 || upsLoadKw > 100_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid load_kw: "${params.load_kw}". Must be 1–100000`);
      }
      clean.load_kw = String(upsLoadKw);

      // runtime_minutes — required, numeric, 1–480
      const rtMin = parseFloat(sanitizeInput(params.runtime_minutes ?? ""));
      if (isNaN(rtMin) || rtMin < 1 || rtMin > 480) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid runtime_minutes: "${params.runtime_minutes}". Must be 1–480`);
      }
      clean.runtime_minutes = String(rtMin);

      // redundancy — optional, enum
      if (params.redundancy !== undefined) {
        const red = sanitizeInput(params.redundancy);
        if (!["N", "N+1", "2N"].includes(red)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid redundancy: "${red}". Must be N, N+1, or 2N`);
        }
        clean.redundancy = red;
      }

      // voltage — optional, 208 or 480
      if (params.voltage !== undefined) {
        const upsVolt = parseInt(sanitizeInput(params.voltage));
        if (upsVolt !== 208 && upsVolt !== 480) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid voltage: "${params.voltage}". Must be 208 or 480`);
        }
        clean.voltage = String(upsVolt);
      }

      // battery_type — optional, enum
      if (params.battery_type !== undefined) {
        const bt = sanitizeInput(params.battery_type);
        if (!["VRLA", "Li-ion"].includes(bt)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid battery_type: "${bt}". Must be VRLA or Li-ion`);
        }
        clean.battery_type = bt;
      }
      break;
    }

    case "fuel_storage": {
      // generator_kw — required, numeric, 1–10000
      const fsGenKw = parseFloat(sanitizeInput(params.generator_kw ?? ""));
      if (isNaN(fsGenKw) || fsGenKw < 1 || fsGenKw > 10_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_kw: "${params.generator_kw}". Must be 1–10000`);
      }
      clean.generator_kw = String(fsGenKw);

      // target_runtime_hours — required, numeric, 1–720
      const fsRtHrs = parseFloat(sanitizeInput(params.target_runtime_hours ?? ""));
      if (isNaN(fsRtHrs) || fsRtHrs < 1 || fsRtHrs > 720) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_runtime_hours: "${params.target_runtime_hours}". Must be 1–720`);
      }
      clean.target_runtime_hours = String(fsRtHrs);

      // tank_type — optional, enum
      if (params.tank_type !== undefined) {
        const tt = sanitizeInput(params.tank_type);
        if (!["above_ground", "underground", "day_tank"].includes(tt)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid tank_type: "${tt}". Must be above_ground, underground, or day_tank`);
        }
        clean.tank_type = tt;
      }

      // jurisdiction — optional, enum
      if (params.jurisdiction !== undefined) {
        const jur = sanitizeInput(params.jurisdiction);
        if (!["epa", "california", "nfpa30"].includes(jur)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid jurisdiction: "${jur}". Must be epa, california, or nfpa30`);
        }
        clean.jurisdiction = jur;
      }
      break;
    }

    case "cooling_load": {
      // it_load_kw — required, numeric, 1–500000
      const clItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(clItKw) || clItKw < 1 || clItKw > 500_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      }
      clean.it_load_kw = String(clItKw);

      // ups_capacity_kw — required, numeric, 1–1000000
      const clUpsKw = parseFloat(sanitizeInput(params.ups_capacity_kw ?? ""));
      if (isNaN(clUpsKw) || clUpsKw < 1 || clUpsKw > 1_000_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ups_capacity_kw: "${params.ups_capacity_kw}". Must be 1–1000000`);
      }
      clean.ups_capacity_kw = String(clUpsKw);

      // room_sqft — required, numeric, 100–5000000
      const clSqft = parseFloat(sanitizeInput(params.room_sqft ?? ""));
      if (isNaN(clSqft) || clSqft < 100 || clSqft > 5_000_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid room_sqft: "${params.room_sqft}". Must be 100–5000000`);
      }
      clean.room_sqft = String(clSqft);

      // ceiling_height_ft — optional, numeric, 8–50
      if (params.ceiling_height_ft !== undefined) {
        const ch = parseFloat(sanitizeInput(params.ceiling_height_ft));
        if (isNaN(ch) || ch < 8 || ch > 50) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid ceiling_height_ft: "${params.ceiling_height_ft}". Must be 8–50`);
        }
        clean.ceiling_height_ft = String(ch);
      }

      // ambient_temp_f — optional, numeric, 50–130
      if (params.ambient_temp_f !== undefined) {
        const at = parseFloat(sanitizeInput(params.ambient_temp_f));
        if (isNaN(at) || at < 50 || at > 130) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid ambient_temp_f: "${params.ambient_temp_f}". Must be 50–130`);
        }
        clean.ambient_temp_f = String(at);
      }
      break;
    }

    case "power_density": {
      // total_it_load_kw — required, numeric, 1–500000
      const pdItKw = parseFloat(sanitizeInput(params.total_it_load_kw ?? ""));
      if (isNaN(pdItKw) || pdItKw < 1 || pdItKw > 500_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid total_it_load_kw: "${params.total_it_load_kw}". Must be 1–500000`);
      }
      clean.total_it_load_kw = String(pdItKw);

      // rack_count — required, integer, 1–100000
      const pdRacks = parseInt(sanitizeInput(params.rack_count ?? ""));
      if (isNaN(pdRacks) || pdRacks < 1 || pdRacks > 100_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid rack_count: "${params.rack_count}". Must be 1–100000`);
      }
      clean.rack_count = String(pdRacks);

      // cabinet_height_u — optional, integer, 7–52
      if (params.cabinet_height_u !== undefined) {
        const cu = parseInt(sanitizeInput(params.cabinet_height_u));
        if (isNaN(cu) || cu < 7 || cu > 52) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid cabinet_height_u: "${params.cabinet_height_u}". Must be 7–52`);
        }
        clean.cabinet_height_u = String(cu);
      }

      // cooling_type — optional, enum
      if (params.cooling_type !== undefined) {
        const ct = sanitizeInput(params.cooling_type);
        if (!["air", "liquid", "hybrid"].includes(ct)) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid cooling_type: "${ct}". Must be air, liquid, or hybrid`);
        }
        clean.cooling_type = ct;
      }

      // target_density_kw_per_rack — optional, numeric, 1–300
      if (params.target_density_kw_per_rack !== undefined) {
        const td = parseFloat(sanitizeInput(params.target_density_kw_per_rack));
        if (isNaN(td) || td < 1 || td > 300) {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_density_kw_per_rack: "${params.target_density_kw_per_rack}". Must be 1–300`);
        }
        clean.target_density_kw_per_rack = String(td);
      }
      break;
    }

    case "redundancy_validator": {
      // design_type — required, enum
      const VALID_DESIGN_TYPES = ["N", "N+1", "2N", "2N+1"];
      const dt = sanitizeInput(params.design_type ?? "");
      if (!VALID_DESIGN_TYPES.includes(dt)) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid design_type: "${dt}". Must be one of: ${VALID_DESIGN_TYPES.join(", ")}`);
      }
      clean.design_type = dt;

      // total_load_kw — required, numeric, 1–500000
      const rvLoad = parseFloat(sanitizeInput(params.total_load_kw ?? ""));
      if (isNaN(rvLoad) || rvLoad < 1 || rvLoad > 500_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid total_load_kw: "${params.total_load_kw}". Must be 1–500000`);
      }
      clean.total_load_kw = String(rvLoad);

      // generator_count — required, integer, 1–100
      const rvGenCnt = parseInt(sanitizeInput(params.generator_count ?? ""));
      if (isNaN(rvGenCnt) || rvGenCnt < 1 || rvGenCnt > 100) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_count: "${params.generator_count}". Must be 1–100`);
      }
      clean.generator_count = String(rvGenCnt);

      // generator_capacity_kw — required, numeric, 1–10000
      const rvGenKw = parseFloat(sanitizeInput(params.generator_capacity_kw ?? ""));
      if (isNaN(rvGenKw) || rvGenKw < 1 || rvGenKw > 10_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_capacity_kw: "${params.generator_capacity_kw}". Must be 1–10000`);
      }
      clean.generator_capacity_kw = String(rvGenKw);

      // ups_count — required, integer, 1–100
      const rvUpsCnt = parseInt(sanitizeInput(params.ups_count ?? ""));
      if (isNaN(rvUpsCnt) || rvUpsCnt < 1 || rvUpsCnt > 100) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ups_count: "${params.ups_count}". Must be 1–100`);
      }
      clean.ups_count = String(rvUpsCnt);

      // ups_capacity_kw — required, numeric, 1–100000
      const rvUpsKw = parseFloat(sanitizeInput(params.ups_capacity_kw ?? ""));
      if (isNaN(rvUpsKw) || rvUpsKw < 1 || rvUpsKw > 100_000) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ups_capacity_kw: "${params.ups_capacity_kw}". Must be 1–100000`);
      }
      clean.ups_capacity_kw = String(rvUpsKw);

      // cooling_units — required, integer, 1–200
      const rvCoolCnt = parseInt(sanitizeInput(params.cooling_units ?? ""));
      if (isNaN(rvCoolCnt) || rvCoolCnt < 1 || rvCoolCnt > 200) {
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid cooling_units: "${params.cooling_units}". Must be 1–200`);
      }
      clean.cooling_units = String(rvCoolCnt);

      // has_bypass — optional, boolean string
      if (params.has_bypass !== undefined) {
        const hb = sanitizeInput(params.has_bypass).toLowerCase();
        if (hb !== "true" && hb !== "false") {
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid has_bypass: "${params.has_bypass}". Must be true or false`);
        }
        clean.has_bypass = hb;
      }
      break;
    }

    default:
      throw new McpError(
        ErrorCode.InvalidParams,
        `400: Unknown workflow: "${workflow}"`
      );
  }

  return clean;
}
