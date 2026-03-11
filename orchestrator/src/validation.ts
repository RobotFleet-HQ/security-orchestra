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

    default:
      throw new McpError(
        ErrorCode.InvalidParams,
        `400: Unknown workflow: "${workflow}"`
      );
  }

  return clean;
}
