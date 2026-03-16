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

    // ── Phase 1 — previously unregistered agents ──────────────────────────────

    case "demand_response": {
      const drGenKw = parseFloat(sanitizeInput(params.generator_capacity_kw ?? ""));
      if (isNaN(drGenKw) || drGenKw < 1 || drGenKw > 50_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_capacity_kw: "${params.generator_capacity_kw}". Must be 1–50000`);
      clean.generator_capacity_kw = String(drGenKw);

      const drCritKw = parseFloat(sanitizeInput(params.critical_load_kw ?? ""));
      if (isNaN(drCritKw) || drCritKw < 0 || drCritKw > 49_999)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid critical_load_kw: "${params.critical_load_kw}". Must be 0–49999`);
      clean.critical_load_kw = String(drCritKw);

      const drUtil = sanitizeInput(params.utility_provider ?? "");
      if (!drUtil || drUtil.length > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid utility_provider: must be a non-empty string up to 100 chars`);
      clean.utility_provider = drUtil;

      if (params.annual_events_expected !== undefined) {
        const drEvt = parseInt(sanitizeInput(params.annual_events_expected));
        if (isNaN(drEvt) || drEvt < 1 || drEvt > 365)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid annual_events_expected: "${params.annual_events_expected}". Must be 1–365`);
        clean.annual_events_expected = String(drEvt);
      }
      break;
    }

    case "environmental_impact": {
      const eiGenCnt = parseInt(sanitizeInput(params.generator_count ?? ""));
      if (isNaN(eiGenCnt) || eiGenCnt < 1 || eiGenCnt > 500)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_count: "${params.generator_count}". Must be 1–500`);
      clean.generator_count = String(eiGenCnt);

      const eiGenKw = parseFloat(sanitizeInput(params.generator_kw ?? ""));
      if (isNaN(eiGenKw) || eiGenKw < 1 || eiGenKw > 50_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_kw: "${params.generator_kw}". Must be 1–50000`);
      clean.generator_kw = String(eiGenKw);

      const eiAcres = parseFloat(sanitizeInput(params.site_acres ?? ""));
      if (isNaN(eiAcres) || eiAcres < 0.1 || eiAcres > 10_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid site_acres: "${params.site_acres}". Must be 0.1–10000`);
      clean.site_acres = String(eiAcres);

      if (params.proximity_to_wetlands_ft !== undefined) {
        const eiWet = parseFloat(sanitizeInput(params.proximity_to_wetlands_ft));
        if (isNaN(eiWet) || eiWet < 0 || eiWet > 100_000)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid proximity_to_wetlands_ft: "${params.proximity_to_wetlands_ft}". Must be 0–100000`);
        clean.proximity_to_wetlands_ft = String(eiWet);
      }

      if (params.state !== undefined) {
        const eiSt = sanitizeInput(params.state).toUpperCase();
        if (!/^[A-Z]{2}$/.test(eiSt))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid state: "${params.state}". Must be a 2-letter US state code`);
        clean.state = eiSt;
      }
      break;
    }

    case "fire_suppression": {
      const fsLen = parseFloat(sanitizeInput(params.room_length_ft ?? ""));
      if (isNaN(fsLen) || fsLen < 1 || fsLen > 5_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid room_length_ft: "${params.room_length_ft}". Must be 1–5000`);
      clean.room_length_ft = String(fsLen);

      const fsWid = parseFloat(sanitizeInput(params.room_width_ft ?? ""));
      if (isNaN(fsWid) || fsWid < 1 || fsWid > 5_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid room_width_ft: "${params.room_width_ft}". Must be 1–5000`);
      clean.room_width_ft = String(fsWid);

      const fsCeil = parseFloat(sanitizeInput(params.ceiling_height_ft ?? ""));
      if (isNaN(fsCeil) || fsCeil < 7 || fsCeil > 60)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ceiling_height_ft: "${params.ceiling_height_ft}". Must be 7–60`);
      clean.ceiling_height_ft = String(fsCeil);

      if (params.agent_type !== undefined) {
        const fsAgent = sanitizeInput(params.agent_type);
        if (!["FM200", "Novec1230", "Inergen", "CO2"].includes(fsAgent))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid agent_type: "${fsAgent}". Must be FM200, Novec1230, Inergen, or CO2`);
        clean.agent_type = fsAgent;
      }

      if (params.enclosure_type !== undefined) {
        const fsEnc = sanitizeInput(params.enclosure_type);
        if (!["server_room", "ups_room", "battery_room", "cable_vault", "mechanical"].includes(fsEnc))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid enclosure_type: "${fsEnc}". Must be server_room, ups_room, battery_room, cable_vault, or mechanical`);
        clean.enclosure_type = fsEnc;
      }
      break;
    }

    case "incentive_finder": {
      const ifState = sanitizeInput(params.state ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(ifState))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid state: "${params.state}". Must be a 2-letter US state code`);
      clean.state = ifState;

      const ifCapex = parseFloat(sanitizeInput(params.capex ?? ""));
      if (isNaN(ifCapex) || ifCapex < 0)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid capex: "${params.capex}". Must be >= 0`);
      clean.capex = String(ifCapex);

      const ifMw = parseFloat(sanitizeInput(params.it_load_mw ?? ""));
      if (isNaN(ifMw) || ifMw <= 0 || ifMw > 500)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_mw: "${params.it_load_mw}". Must be > 0 and <= 500`);
      clean.it_load_mw = String(ifMw);

      if (params.renewable_percentage !== undefined) {
        const ifRenew = parseFloat(sanitizeInput(params.renewable_percentage));
        if (isNaN(ifRenew) || ifRenew < 0 || ifRenew > 100)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid renewable_percentage: "${params.renewable_percentage}". Must be 0–100`);
        clean.renewable_percentage = String(ifRenew);
      }

      if (params.new_jobs_created !== undefined) {
        const ifJobs = parseInt(sanitizeInput(params.new_jobs_created));
        if (isNaN(ifJobs) || ifJobs < 0)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid new_jobs_created: "${params.new_jobs_created}". Must be >= 0`);
        clean.new_jobs_created = String(ifJobs);
      }
      break;
    }

    case "noise_compliance": {
      const ncDb = parseFloat(sanitizeInput(params.generator_db_at_23ft ?? ""));
      if (isNaN(ncDb) || ncDb < 50 || ncDb > 120)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_db_at_23ft: "${params.generator_db_at_23ft}". Must be 50–120`);
      clean.generator_db_at_23ft = String(ncDb);

      const ncDist = parseFloat(sanitizeInput(params.distance_to_property_line_ft ?? ""));
      if (isNaN(ncDist) || ncDist < 1 || ncDist > 10_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid distance_to_property_line_ft: "${params.distance_to_property_line_ft}". Must be 1–10000`);
      clean.distance_to_property_line_ft = String(ncDist);

      const ncLimit = parseFloat(sanitizeInput(params.local_limit_db ?? ""));
      if (isNaN(ncLimit) || ncLimit < 30 || ncLimit > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid local_limit_db: "${params.local_limit_db}". Must be 30–100`);
      clean.local_limit_db = String(ncLimit);

      if (params.zoning !== undefined) {
        const ncZone = sanitizeInput(params.zoning);
        if (!["residential", "commercial", "industrial"].includes(ncZone))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid zoning: "${ncZone}". Must be residential, commercial, or industrial`);
        clean.zoning = ncZone;
      }
      break;
    }

    case "permit_timeline": {
      const ptJuris = sanitizeInput(params.jurisdiction ?? "");
      if (!ptJuris || ptJuris.length > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid jurisdiction: must be a non-empty string up to 100 chars`);
      clean.jurisdiction = ptJuris;

      const ptSqft = parseFloat(sanitizeInput(params.project_sqft ?? ""));
      if (isNaN(ptSqft) || ptSqft < 100 || ptSqft > 5_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid project_sqft: "${params.project_sqft}". Must be 100–5000000`);
      clean.project_sqft = String(ptSqft);

      const ptGenCnt = parseInt(sanitizeInput(params.generator_count ?? ""));
      if (isNaN(ptGenCnt) || ptGenCnt < 0 || ptGenCnt > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_count: "${params.generator_count}". Must be 0–100`);
      clean.generator_count = String(ptGenCnt);

      if (params.project_type !== undefined) {
        const ptType = sanitizeInput(params.project_type);
        if (!["new", "renovation"].includes(ptType))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid project_type: "${ptType}". Must be new or renovation`);
        clean.project_type = ptType;
      }
      break;
    }

    case "roi_calculator": {
      const roiCapex = parseFloat(sanitizeInput(params.capex ?? ""));
      if (isNaN(roiCapex) || roiCapex < 0)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid capex: "${params.capex}". Must be >= 0`);
      clean.capex = String(roiCapex);

      const roiOpex = parseFloat(sanitizeInput(params.annual_opex ?? ""));
      if (isNaN(roiOpex) || roiOpex < 0)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid annual_opex: "${params.annual_opex}". Must be >= 0`);
      clean.annual_opex = String(roiOpex);

      const roiRev = parseFloat(sanitizeInput(params.revenue_per_year ?? ""));
      if (isNaN(roiRev) || roiRev < 0)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid revenue_per_year: "${params.revenue_per_year}". Must be >= 0`);
      clean.revenue_per_year = String(roiRev);

      const roiLife = parseFloat(sanitizeInput(params.project_lifetime_years ?? ""));
      if (isNaN(roiLife) || roiLife < 1 || roiLife > 50)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid project_lifetime_years: "${params.project_lifetime_years}". Must be 1–50`);
      clean.project_lifetime_years = String(roiLife);

      if (params.discount_rate !== undefined) {
        const roiRate = parseFloat(sanitizeInput(params.discount_rate));
        if (isNaN(roiRate) || roiRate < 0 || roiRate > 1)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid discount_rate: "${params.discount_rate}". Must be 0–1`);
        clean.discount_rate = String(roiRate);
      }
      break;
    }

    case "tco_analyzer": {
      const tcoItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(tcoItKw) || tcoItKw < 1 || tcoItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(tcoItKw);

      const tcoPower = parseFloat(sanitizeInput(params.power_rate_kwh ?? ""));
      if (isNaN(tcoPower) || tcoPower < 0.01 || tcoPower > 2.0)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid power_rate_kwh: "${params.power_rate_kwh}". Must be 0.01–2.0`);
      clean.power_rate_kwh = String(tcoPower);

      const tcoYrs = parseFloat(sanitizeInput(params.years ?? ""));
      if (isNaN(tcoYrs) || tcoYrs < 1 || tcoYrs > 30)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid years: "${params.years}". Must be 1–30`);
      clean.years = String(tcoYrs);

      const tcoPue = parseFloat(sanitizeInput(params.pue ?? ""));
      if (isNaN(tcoPue) || tcoPue < 1 || tcoPue > 3)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid pue: "${params.pue}". Must be 1–3`);
      clean.pue = String(tcoPue);

      if (params.labor_cost_annual !== undefined) {
        const tcoLabor = parseFloat(sanitizeInput(params.labor_cost_annual));
        if (isNaN(tcoLabor) || tcoLabor < 0)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid labor_cost_annual: "${params.labor_cost_annual}". Must be >= 0`);
        clean.labor_cost_annual = String(tcoLabor);
      }

      if (params.refresh_cycle_years !== undefined) {
        const tcoRefresh = parseFloat(sanitizeInput(params.refresh_cycle_years));
        if (isNaN(tcoRefresh) || tcoRefresh < 1 || tcoRefresh > 10)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid refresh_cycle_years: "${params.refresh_cycle_years}". Must be 1–10`);
        clean.refresh_cycle_years = String(tcoRefresh);
      }
      break;
    }

    case "fiber_connectivity": {
      const fcLoc = sanitizeInput(params.location ?? "");
      if (!fcLoc || fcLoc.length > 200)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid location: must be a non-empty string up to 200 chars`);
      clean.location = fcLoc;

      const fcMarkets = sanitizeInput(params.target_markets ?? "");
      if (!fcMarkets || fcMarkets.length > 500)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_markets: must be a non-empty string up to 500 chars`);
      clean.target_markets = fcMarkets;

      if (params.redundancy_required !== undefined) {
        const fcRed = sanitizeInput(params.redundancy_required).toLowerCase();
        if (!["yes", "no", "true", "false"].includes(fcRed))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid redundancy_required: "${params.redundancy_required}". Must be yes, no, true, or false`);
        clean.redundancy_required = fcRed;
      }
      break;
    }

    case "harmonic_analysis": {
      const haLoad = parseFloat(sanitizeInput(params.total_load_kva ?? ""));
      if (isNaN(haLoad) || haLoad < 1 || haLoad > 10_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid total_load_kva: "${params.total_load_kva}". Must be 1–10000000`);
      clean.total_load_kva = String(haLoad);

      const haUps = parseFloat(sanitizeInput(params.ups_percentage ?? ""));
      if (isNaN(haUps) || haUps < 0 || haUps > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ups_percentage: "${params.ups_percentage}". Must be 0–100`);
      clean.ups_percentage = String(haUps);

      const haVfd = parseFloat(sanitizeInput(params.vfd_percentage ?? ""));
      if (isNaN(haVfd) || haVfd < 0 || haVfd > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid vfd_percentage: "${params.vfd_percentage}". Must be 0–100`);
      clean.vfd_percentage = String(haVfd);

      const haXfmr = parseFloat(sanitizeInput(params.transformer_kva ?? ""));
      if (isNaN(haXfmr) || haXfmr < 1 || haXfmr > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid transformer_kva: "${params.transformer_kva}". Must be 1–100000`);
      clean.transformer_kva = String(haXfmr);
      break;
    }

    case "site_scoring": {
      const ssSites = sanitizeInput(params.sites_json ?? "");
      if (!ssSites)
        throw new McpError(ErrorCode.InvalidParams, `400: sites_json is required`);
      try { JSON.parse(ssSites); } catch {
        throw new McpError(ErrorCode.InvalidParams, `400: sites_json must be valid JSON`);
      }
      clean.sites_json = ssSites;
      break;
    }

    case "voltage_drop": {
      const vdAmps = parseFloat(sanitizeInput(params.load_amps ?? ""));
      if (isNaN(vdAmps) || vdAmps < 0.1 || vdAmps > 10_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid load_amps: "${params.load_amps}". Must be 0.1–10000`);
      clean.load_amps = String(vdAmps);

      const vdDist = parseFloat(sanitizeInput(params.distance_feet ?? ""));
      if (isNaN(vdDist) || vdDist < 1 || vdDist > 50_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid distance_feet: "${params.distance_feet}". Must be 1–50000`);
      clean.distance_feet = String(vdDist);

      const vdVolt = parseFloat(sanitizeInput(params.voltage ?? ""));
      if (isNaN(vdVolt) || vdVolt < 1 || vdVolt > 50_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid voltage: "${params.voltage}". Must be 1–50000`);
      clean.voltage = String(vdVolt);

      const vdCircuit = sanitizeInput(params.circuit_type ?? "");
      if (!["feeder", "branch"].includes(vdCircuit))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid circuit_type: "${vdCircuit}". Must be feeder or branch`);
      clean.circuit_type = vdCircuit;

      if (params.conductor_material !== undefined) {
        const vdMat = sanitizeInput(params.conductor_material);
        if (!["copper", "aluminum"].includes(vdMat))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid conductor_material: "${vdMat}". Must be copper or aluminum`);
        clean.conductor_material = vdMat;
      }
      break;
    }

    case "water_availability": {
      const waCool = parseFloat(sanitizeInput(params.cooling_tons ?? ""));
      if (isNaN(waCool) || waCool < 1 || waCool > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid cooling_tons: "${params.cooling_tons}". Must be 1–500000`);
      clean.cooling_tons = String(waCool);

      const waLoc = sanitizeInput(params.location ?? "");
      if (!waLoc || waLoc.length > 200)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid location: must be a non-empty string up to 200 chars`);
      clean.location = waLoc;

      if (params.cooling_type !== undefined) {
        const waCt = sanitizeInput(params.cooling_type);
        if (!["tower", "air", "hybrid"].includes(waCt))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid cooling_type: "${waCt}". Must be tower, air, or hybrid`);
        clean.cooling_type = waCt;
      }
      break;
    }

    // ── Phase 2 — new agents ──────────────────────────────────────────────────

    case "network_topology": {
      const ntRacks = parseInt(sanitizeInput(params.rack_count ?? ""));
      if (isNaN(ntRacks) || ntRacks < 1 || ntRacks > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid rack_count: "${params.rack_count}". Must be 1–100000`);
      clean.rack_count = String(ntRacks);

      const ntBw = parseFloat(sanitizeInput(params.target_bandwidth_gbps ?? ""));
      if (isNaN(ntBw) || ntBw < 0.1 || ntBw > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_bandwidth_gbps: "${params.target_bandwidth_gbps}". Must be 0.1–100000`);
      clean.target_bandwidth_gbps = String(ntBw);

      const ntRed = sanitizeInput(params.redundancy_type ?? "");
      if (!["N+1", "2N", "mesh"].includes(ntRed))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid redundancy_type: "${ntRed}". Must be N+1, 2N, or mesh`);
      clean.redundancy_type = ntRed;
      break;
    }

    case "bandwidth_sizing": {
      const bsRacks = parseInt(sanitizeInput(params.rack_count ?? ""));
      if (isNaN(bsRacks) || bsRacks < 1 || bsRacks > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid rack_count: "${params.rack_count}". Must be 1–100000`);
      clean.rack_count = String(bsRacks);

      const bsSrvs = parseInt(sanitizeInput(params.servers_per_rack ?? ""));
      if (isNaN(bsSrvs) || bsSrvs < 1 || bsSrvs > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid servers_per_rack: "${params.servers_per_rack}". Must be 1–100`);
      clean.servers_per_rack = String(bsSrvs);

      const bsBwSrv = parseFloat(sanitizeInput(params.bandwidth_per_server_gbps ?? ""));
      if (isNaN(bsBwSrv) || bsBwSrv < 0.001 || bsBwSrv > 800)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid bandwidth_per_server_gbps: "${params.bandwidth_per_server_gbps}". Must be 0.001–800`);
      clean.bandwidth_per_server_gbps = String(bsBwSrv);
      break;
    }

    case "latency_calculator": {
      const lcDist = parseFloat(sanitizeInput(params.distance_km ?? ""));
      if (isNaN(lcDist) || lcDist < 0.001 || lcDist > 40_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid distance_km: "${params.distance_km}". Must be 0.001–40000`);
      clean.distance_km = String(lcDist);

      const lcMed = sanitizeInput(params.medium ?? "");
      if (!["fiber", "copper", "wireless"].includes(lcMed))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid medium: "${lcMed}". Must be fiber, copper, or wireless`);
      clean.medium = lcMed;

      if (params.hops !== undefined) {
        const lcHops = parseInt(sanitizeInput(params.hops));
        if (isNaN(lcHops) || lcHops < 1 || lcHops > 100)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid hops: "${params.hops}". Must be 1–100`);
        clean.hops = String(lcHops);
      }
      break;
    }

    case "ip_addressing": {
      const ipRacks = parseInt(sanitizeInput(params.rack_count ?? ""));
      if (isNaN(ipRacks) || ipRacks < 1 || ipRacks > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid rack_count: "${params.rack_count}". Must be 1–100000`);
      clean.rack_count = String(ipRacks);

      const ipHosts = parseInt(sanitizeInput(params.hosts_per_rack ?? ""));
      if (isNaN(ipHosts) || ipHosts < 1 || ipHosts > 256)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid hosts_per_rack: "${params.hosts_per_rack}". Must be 1–256`);
      clean.hosts_per_rack = String(ipHosts);

      if (params.vlans_required !== undefined) {
        const ipVlans = parseInt(sanitizeInput(params.vlans_required));
        if (isNaN(ipVlans) || ipVlans < 1 || ipVlans > 4094)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid vlans_required: "${params.vlans_required}". Must be 1–4094`);
        clean.vlans_required = String(ipVlans);
      }
      break;
    }

    case "dns_architecture": {
      const dnsRacks = parseInt(sanitizeInput(params.rack_count ?? ""));
      if (isNaN(dnsRacks) || dnsRacks < 1 || dnsRacks > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid rack_count: "${params.rack_count}". Must be 1–100000`);
      clean.rack_count = String(dnsRacks);

      if (params.zones_count !== undefined) {
        const dnsZones = parseInt(sanitizeInput(params.zones_count));
        if (isNaN(dnsZones) || dnsZones < 1 || dnsZones > 1000)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid zones_count: "${params.zones_count}". Must be 1–1000`);
        clean.zones_count = String(dnsZones);
      }

      if (params.dnssec_required !== undefined) {
        const dnsSec = sanitizeInput(params.dnssec_required).toLowerCase();
        if (!["true", "false"].includes(dnsSec))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid dnssec_required: "${params.dnssec_required}". Must be true or false`);
        clean.dnssec_required = dnsSec;
      }
      break;
    }

    case "bgp_peering": {
      const bgpAsn = parseInt(sanitizeInput(params.asn ?? ""));
      if (isNaN(bgpAsn) || bgpAsn < 1 || bgpAsn > 4_294_967_295)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid asn: "${params.asn}". Must be 1–4294967295`);
      clean.asn = String(bgpAsn);

      const bgpPeers = parseInt(sanitizeInput(params.peer_count ?? ""));
      if (isNaN(bgpPeers) || bgpPeers < 1 || bgpPeers > 500)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid peer_count: "${params.peer_count}". Must be 1–500`);
      clean.peer_count = String(bgpPeers);

      const bgpTransit = parseInt(sanitizeInput(params.transit_providers ?? ""));
      if (isNaN(bgpTransit) || bgpTransit < 1 || bgpTransit > 20)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid transit_providers: "${params.transit_providers}". Must be 1–20`);
      clean.transit_providers = String(bgpTransit);
      break;
    }

    case "physical_security": {
      const psSqft = parseFloat(sanitizeInput(params.facility_sqft ?? ""));
      if (isNaN(psSqft) || psSqft < 100 || psSqft > 5_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid facility_sqft: "${params.facility_sqft}". Must be 100–5000000`);
      clean.facility_sqft = String(psSqft);

      const psTier = parseInt(sanitizeInput(params.tier ?? ""));
      if (isNaN(psTier) || psTier < 1 || psTier > 4)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid tier: "${params.tier}". Must be 1–4`);
      clean.tier = String(psTier);

      if (params.perimeter_ft !== undefined) {
        const psPerim = parseFloat(sanitizeInput(params.perimeter_ft));
        if (isNaN(psPerim) || psPerim < 0 || psPerim > 100_000)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid perimeter_ft: "${params.perimeter_ft}". Must be 0–100000`);
        clean.perimeter_ft = String(psPerim);
      }
      break;
    }

    case "biometric_design": {
      const biStaff = parseInt(sanitizeInput(params.staff_count ?? ""));
      if (isNaN(biStaff) || biStaff < 1 || biStaff > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid staff_count: "${params.staff_count}". Must be 1–100000`);
      clean.staff_count = String(biStaff);

      const biZones = parseInt(sanitizeInput(params.security_zones ?? ""));
      if (isNaN(biZones) || biZones < 1 || biZones > 20)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid security_zones: "${params.security_zones}". Must be 1–20`);
      clean.security_zones = String(biZones);

      const biBioType = sanitizeInput(params.biometric_type ?? "");
      if (!["fingerprint", "iris", "face", "palm", "multifactor"].includes(biBioType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid biometric_type: "${biBioType}". Must be fingerprint, iris, face, palm, or multifactor`);
      clean.biometric_type = biBioType;
      break;
    }

    case "surveillance_coverage": {
      const scSqft = parseFloat(sanitizeInput(params.facility_sqft ?? ""));
      if (isNaN(scSqft) || scSqft < 100 || scSqft > 5_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid facility_sqft: "${params.facility_sqft}". Must be 100–5000000`);
      clean.facility_sqft = String(scSqft);

      const scRes = sanitizeInput(params.camera_resolution ?? "");
      if (!["2mp", "4mp", "8mp", "12mp"].includes(scRes))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid camera_resolution: "${scRes}". Must be 2mp, 4mp, 8mp, or 12mp`);
      clean.camera_resolution = scRes;

      const scRet = parseInt(sanitizeInput(params.retention_days ?? ""));
      if (isNaN(scRet) || scRet < 1 || scRet > 365)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid retention_days: "${params.retention_days}". Must be 1–365`);
      clean.retention_days = String(scRet);
      break;
    }

    case "cybersecurity_controls": {
      const ccFacType = sanitizeInput(params.facility_type ?? "");
      if (!["colo", "hyperscale", "enterprise", "edge"].includes(ccFacType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid facility_type: "${ccFacType}". Must be colo, hyperscale, enterprise, or edge`);
      clean.facility_type = ccFacType;

      const ccFramework = sanitizeInput(params.compliance_framework ?? "");
      if (!["soc2", "pci_dss", "hipaa", "fedramp", "iso27001"].includes(ccFramework))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid compliance_framework: "${ccFramework}". Must be soc2, pci_dss, hipaa, fedramp, or iso27001`);
      clean.compliance_framework = ccFramework;

      const ccZones = parseInt(sanitizeInput(params.network_zones ?? ""));
      if (isNaN(ccZones) || ccZones < 1 || ccZones > 50)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid network_zones: "${params.network_zones}". Must be 1–50`);
      clean.network_zones = String(ccZones);
      break;
    }

    case "compliance_checker": {
      const compFrameworks = sanitizeInput(params.frameworks ?? "");
      if (!compFrameworks || compFrameworks.length > 500)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid frameworks: must be a non-empty comma-separated string`);
      clean.frameworks = compFrameworks;

      const compFacType = sanitizeInput(params.facility_type ?? "");
      if (!["colo", "hyperscale", "enterprise", "edge"].includes(compFacType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid facility_type: "${compFacType}". Must be colo, hyperscale, enterprise, or edge`);
      clean.facility_type = compFacType;

      const compTier = parseInt(sanitizeInput(params.current_tier ?? ""));
      if (isNaN(compTier) || compTier < 1 || compTier > 4)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid current_tier: "${params.current_tier}". Must be 1–4`);
      clean.current_tier = String(compTier);
      break;
    }

    case "chiller_sizing": {
      const csItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(csItKw) || csItKw < 1 || csItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(csItKw);

      const csPue = parseFloat(sanitizeInput(params.pue ?? ""));
      if (isNaN(csPue) || csPue < 1 || csPue > 3)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid pue: "${params.pue}". Must be 1–3`);
      clean.pue = String(csPue);

      const csCoolType = sanitizeInput(params.cooling_type ?? "");
      if (!["air_cooled", "water_cooled", "free_cooling"].includes(csCoolType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid cooling_type: "${csCoolType}". Must be air_cooled, water_cooled, or free_cooling`);
      clean.cooling_type = csCoolType;

      const csRedType = sanitizeInput(params.redundancy ?? "");
      if (!["N+1", "2N"].includes(csRedType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid redundancy: "${csRedType}". Must be N+1 or 2N`);
      clean.redundancy = csRedType;
      break;
    }

    case "crac_vs_crah": {
      const cvcItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(cvcItKw) || cvcItKw < 1 || cvcItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(cvcItKw);

      const cvcSqft = parseFloat(sanitizeInput(params.room_sqft ?? ""));
      if (isNaN(cvcSqft) || cvcSqft < 100 || cvcSqft > 5_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid room_sqft: "${params.room_sqft}". Must be 100–5000000`);
      clean.room_sqft = String(cvcSqft);

      const cvcWater = sanitizeInput(params.water_available ?? "").toLowerCase();
      if (!["yes", "no"].includes(cvcWater))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid water_available: "${params.water_available}". Must be yes or no`);
      clean.water_available = cvcWater;

      if (params.climate_zone !== undefined) {
        const cvcClimate = sanitizeInput(params.climate_zone);
        if (!["hot_dry", "hot_humid", "mild", "cold"].includes(cvcClimate))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid climate_zone: "${cvcClimate}". Must be hot_dry, hot_humid, mild, or cold`);
        clean.climate_zone = cvcClimate;
      }
      break;
    }

    case "airflow_modeling": {
      const afRacks = parseInt(sanitizeInput(params.rack_count ?? ""));
      if (isNaN(afRacks) || afRacks < 1 || afRacks > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid rack_count: "${params.rack_count}". Must be 1–100000`);
      clean.rack_count = String(afRacks);

      const afKwPerRack = parseFloat(sanitizeInput(params.avg_kw_per_rack ?? ""));
      if (isNaN(afKwPerRack) || afKwPerRack < 0.1 || afKwPerRack > 300)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid avg_kw_per_rack: "${params.avg_kw_per_rack}". Must be 0.1–300`);
      clean.avg_kw_per_rack = String(afKwPerRack);

      const afSqft = parseFloat(sanitizeInput(params.room_sqft ?? ""));
      if (isNaN(afSqft) || afSqft < 100 || afSqft > 5_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid room_sqft: "${params.room_sqft}". Must be 100–5000000`);
      clean.room_sqft = String(afSqft);

      const afContain = sanitizeInput(params.containment_type ?? "");
      if (!["none", "hot_aisle", "cold_aisle", "full_chimney"].includes(afContain))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid containment_type: "${afContain}". Must be none, hot_aisle, cold_aisle, or full_chimney`);
      clean.containment_type = afContain;
      break;
    }

    case "humidification": {
      const humSqft = parseFloat(sanitizeInput(params.room_sqft ?? ""));
      if (isNaN(humSqft) || humSqft < 100 || humSqft > 5_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid room_sqft: "${params.room_sqft}". Must be 100–5000000`);
      clean.room_sqft = String(humSqft);

      const humItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(humItKw) || humItKw < 1 || humItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(humItKw);

      const humClimate = sanitizeInput(params.climate_zone ?? "");
      if (!["arid", "temperate", "humid"].includes(humClimate))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid climate_zone: "${humClimate}". Must be arid, temperate, or humid`);
      clean.climate_zone = humClimate;

      if (params.target_rh_pct !== undefined) {
        const humRh = parseFloat(sanitizeInput(params.target_rh_pct));
        if (isNaN(humRh) || humRh < 20 || humRh > 80)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_rh_pct: "${params.target_rh_pct}". Must be 20–80`);
        clean.target_rh_pct = String(humRh);
      }
      break;
    }

    case "economizer_analysis": {
      const ecoLoc = sanitizeInput(params.location ?? "");
      if (!ecoLoc || ecoLoc.length > 200)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid location: must be a non-empty string up to 200 chars`);
      clean.location = ecoLoc;

      const ecoItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(ecoItKw) || ecoItKw < 1 || ecoItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(ecoItKw);

      const ecoPueMech = parseFloat(sanitizeInput(params.pue_mechanical ?? ""));
      if (isNaN(ecoPueMech) || ecoPueMech < 1 || ecoPueMech > 3)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid pue_mechanical: "${params.pue_mechanical}". Must be 1–3`);
      clean.pue_mechanical = String(ecoPueMech);

      const ecoType = sanitizeInput(params.economizer_type ?? "");
      if (!["air_side", "water_side", "hybrid"].includes(ecoType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid economizer_type: "${ecoType}". Must be air_side, water_side, or hybrid`);
      clean.economizer_type = ecoType;
      break;
    }

    case "construction_timeline": {
      const ctCapMw = parseFloat(sanitizeInput(params.capacity_mw ?? ""));
      if (isNaN(ctCapMw) || ctCapMw < 0.1 || ctCapMw > 1_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid capacity_mw: "${params.capacity_mw}". Must be 0.1–1000`);
      clean.capacity_mw = String(ctCapMw);

      const ctBldgType = sanitizeInput(params.building_type ?? "");
      if (!["new_build", "shell_core", "retrofit"].includes(ctBldgType))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid building_type: "${ctBldgType}". Must be new_build, shell_core, or retrofit`);
      clean.building_type = ctBldgType;

      const ctState = sanitizeInput(params.state ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(ctState))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid state: "${params.state}". Must be a 2-letter US state code`);
      clean.state = ctState;
      break;
    }

    case "commissioning_plan": {
      const cpCapMw = parseFloat(sanitizeInput(params.capacity_mw ?? ""));
      if (isNaN(cpCapMw) || cpCapMw < 0.1 || cpCapMw > 1_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid capacity_mw: "${params.capacity_mw}". Must be 0.1–1000`);
      clean.capacity_mw = String(cpCapMw);

      const cpTier = parseInt(sanitizeInput(params.tier ?? ""));
      if (isNaN(cpTier) || cpTier < 1 || cpTier > 4)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid tier: "${params.tier}". Must be 1–4`);
      clean.tier = String(cpTier);

      if (params.systems_count !== undefined) {
        const cpSystems = parseInt(sanitizeInput(params.systems_count));
        if (isNaN(cpSystems) || cpSystems < 0 || cpSystems > 1_000)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid systems_count: "${params.systems_count}". Must be 0–1000`);
        clean.systems_count = String(cpSystems);
      }
      break;
    }

    case "maintenance_schedule": {
      const msGenCnt = parseInt(sanitizeInput(params.generator_count ?? ""));
      if (isNaN(msGenCnt) || msGenCnt < 0 || msGenCnt > 500)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid generator_count: "${params.generator_count}". Must be 0–500`);
      clean.generator_count = String(msGenCnt);

      const msUpsCnt = parseInt(sanitizeInput(params.ups_count ?? ""));
      if (isNaN(msUpsCnt) || msUpsCnt < 0 || msUpsCnt > 1_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid ups_count: "${params.ups_count}". Must be 0–1000`);
      clean.ups_count = String(msUpsCnt);

      const msCoolCnt = parseInt(sanitizeInput(params.cooling_units ?? ""));
      if (isNaN(msCoolCnt) || msCoolCnt < 0 || msCoolCnt > 2_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid cooling_units: "${params.cooling_units}". Must be 0–2000`);
      clean.cooling_units = String(msCoolCnt);

      const msTier = parseInt(sanitizeInput(params.tier ?? ""));
      if (isNaN(msTier) || msTier < 1 || msTier > 4)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid tier: "${params.tier}". Must be 1–4`);
      clean.tier = String(msTier);
      break;
    }

    case "capacity_planning": {
      const capCurrLoad = parseFloat(sanitizeInput(params.current_load_kw ?? ""));
      if (isNaN(capCurrLoad) || capCurrLoad < 0 || capCurrLoad > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid current_load_kw: "${params.current_load_kw}". Must be 0–500000`);
      clean.current_load_kw = String(capCurrLoad);

      const capCapacity = parseFloat(sanitizeInput(params.current_capacity_kw ?? ""));
      if (isNaN(capCapacity) || capCapacity < 1 || capCapacity > 1_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid current_capacity_kw: "${params.current_capacity_kw}". Must be 1–1000000`);
      clean.current_capacity_kw = String(capCapacity);

      const capGrowth = parseFloat(sanitizeInput(params.growth_rate_pct_per_year ?? ""));
      if (isNaN(capGrowth) || capGrowth < 0 || capGrowth > 200)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid growth_rate_pct_per_year: "${params.growth_rate_pct_per_year}". Must be 0–200`);
      clean.growth_rate_pct_per_year = String(capGrowth);

      if (params.design_life_years !== undefined) {
        const capLife = parseFloat(sanitizeInput(params.design_life_years));
        if (isNaN(capLife) || capLife < 1 || capLife > 50)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid design_life_years: "${params.design_life_years}". Must be 1–50`);
        clean.design_life_years = String(capLife);
      }
      break;
    }

    case "sla_calculator": {
      const slaTier = parseInt(sanitizeInput(params.tier ?? ""));
      if (isNaN(slaTier) || slaTier < 1 || slaTier > 4)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid tier: "${params.tier}". Must be 1–4`);
      clean.tier = String(slaTier);

      const slaAvail = parseFloat(sanitizeInput(params.target_availability_pct ?? ""));
      if (isNaN(slaAvail) || slaAvail < 90 || slaAvail > 100)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_availability_pct: "${params.target_availability_pct}". Must be 90–100`);
      clean.target_availability_pct = String(slaAvail);

      if (params.maintenance_windows_per_year !== undefined) {
        const slaMaint = parseInt(sanitizeInput(params.maintenance_windows_per_year));
        if (isNaN(slaMaint) || slaMaint < 0 || slaMaint > 365)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid maintenance_windows_per_year: "${params.maintenance_windows_per_year}". Must be 0–365`);
        clean.maintenance_windows_per_year = String(slaMaint);
      }
      break;
    }

    case "change_management": {
      const cmTier = parseInt(sanitizeInput(params.tier ?? ""));
      if (isNaN(cmTier) || cmTier < 1 || cmTier > 4)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid tier: "${params.tier}". Must be 1–4`);
      clean.tier = String(cmTier);

      const cmVol = parseInt(sanitizeInput(params.change_volume_per_month ?? ""));
      if (isNaN(cmVol) || cmVol < 1 || cmVol > 10_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid change_volume_per_month: "${params.change_volume_per_month}". Must be 1–10000`);
      clean.change_volume_per_month = String(cmVol);

      const cmStaff = parseInt(sanitizeInput(params.staff_count ?? ""));
      if (isNaN(cmStaff) || cmStaff < 1 || cmStaff > 100_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid staff_count: "${params.staff_count}". Must be 1–100000`);
      clean.staff_count = String(cmStaff);
      break;
    }

    case "carbon_footprint": {
      const cfItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(cfItKw) || cfItKw < 1 || cfItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(cfItKw);

      const cfPue = parseFloat(sanitizeInput(params.pue ?? ""));
      if (isNaN(cfPue) || cfPue < 1 || cfPue > 3)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid pue: "${params.pue}". Must be 1–3`);
      clean.pue = String(cfPue);

      const cfRegion = sanitizeInput(params.grid_region ?? "");
      if (!["WECC", "SERC", "RFC", "MRO", "NPCC", "TRE", "HICC", "ASCC"].includes(cfRegion))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid grid_region: "${cfRegion}". Must be WECC, SERC, RFC, MRO, NPCC, TRE, HICC, or ASCC`);
      clean.grid_region = cfRegion;

      if (params.renewable_pct !== undefined) {
        const cfRenew = parseFloat(sanitizeInput(params.renewable_pct));
        if (isNaN(cfRenew) || cfRenew < 0 || cfRenew > 100)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid renewable_pct: "${params.renewable_pct}". Must be 0–100`);
        clean.renewable_pct = String(cfRenew);
      }
      break;
    }

    case "solar_feasibility": {
      const sfSqft = parseFloat(sanitizeInput(params.facility_sqft ?? ""));
      if (isNaN(sfSqft) || sfSqft < 1_000 || sfSqft > 10_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid facility_sqft: "${params.facility_sqft}". Must be 1000–10000000`);
      clean.facility_sqft = String(sfSqft);

      const sfItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(sfItKw) || sfItKw < 1 || sfItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(sfItKw);

      const sfState = sanitizeInput(params.state ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(sfState))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid state: "${params.state}". Must be a 2-letter US state code`);
      clean.state = sfState;

      if (params.roof_available_sqft !== undefined) {
        const sfRoof = parseFloat(sanitizeInput(params.roof_available_sqft));
        if (isNaN(sfRoof) || sfRoof < 0 || sfRoof > 10_000_000)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid roof_available_sqft: "${params.roof_available_sqft}". Must be 0–10000000`);
        clean.roof_available_sqft = String(sfRoof);
      }
      break;
    }

    case "battery_storage": {
      const bsItKw = parseFloat(sanitizeInput(params.it_load_kw ?? ""));
      if (isNaN(bsItKw) || bsItKw < 1 || bsItKw > 500_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid it_load_kw: "${params.it_load_kw}". Must be 1–500000`);
      clean.it_load_kw = String(bsItKw);

      const bsRuntime = parseFloat(sanitizeInput(params.target_runtime_minutes ?? ""));
      if (isNaN(bsRuntime) || bsRuntime < 1 || bsRuntime > 1_440)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid target_runtime_minutes: "${params.target_runtime_minutes}". Must be 1–1440`);
      clean.target_runtime_minutes = String(bsRuntime);

      const bsChem = sanitizeInput(params.chemistry ?? "");
      if (!["lithium_ion", "lfp", "vrla", "flow"].includes(bsChem))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid chemistry: "${bsChem}". Must be lithium_ion, lfp, vrla, or flow`);
      clean.chemistry = bsChem;

      if (params.use_case !== undefined) {
        const bsUse = sanitizeInput(params.use_case);
        if (!["ups_backup", "peak_shaving", "demand_response", "islanding"].includes(bsUse))
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid use_case: "${bsUse}". Must be ups_backup, peak_shaving, demand_response, or islanding`);
        clean.use_case = bsUse;
      }
      break;
    }

    case "energy_procurement": {
      const epConsume = parseFloat(sanitizeInput(params.annual_consumption_mwh ?? ""));
      if (isNaN(epConsume) || epConsume < 1 || epConsume > 100_000_000)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid annual_consumption_mwh: "${params.annual_consumption_mwh}". Must be 1–100000000`);
      clean.annual_consumption_mwh = String(epConsume);

      const epState = sanitizeInput(params.state ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(epState))
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid state: "${params.state}". Must be a 2-letter US state code`);
      clean.state = epState;

      const epTerm = parseInt(sanitizeInput(params.contract_term_years ?? ""));
      if (isNaN(epTerm) || epTerm < 1 || epTerm > 25)
        throw new McpError(ErrorCode.InvalidParams, `400: Invalid contract_term_years: "${params.contract_term_years}". Must be 1–25`);
      clean.contract_term_years = String(epTerm);

      if (params.renewable_target_pct !== undefined) {
        const epRenew = parseFloat(sanitizeInput(params.renewable_target_pct));
        if (isNaN(epRenew) || epRenew < 0 || epRenew > 100)
          throw new McpError(ErrorCode.InvalidParams, `400: Invalid renewable_target_pct: "${params.renewable_target_pct}". Must be 0–100`);
        clean.renewable_target_pct = String(epRenew);
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
