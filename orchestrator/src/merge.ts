/**
 * merge.ts — Parallel result merge and conflict detection.
 *
 * When two or more agents run concurrently and return numeric estimates for
 * the same field, this module compares their values and classifies any
 * divergence as none / advisory / blocking.
 *
 * Severity thresholds (absolute % divergence from the mean):
 *   ≤ 5%   → "none"     — average the values, no warning
 *   5–20%  → "advisory" — average the values, log a warning
 *   > 20%  → "blocking" — leave unresolved, caller should not use the field
 *
 * Non-numeric fields use first-wins with no conflict flagged.
 *
 * Design: pure module — no Express, no MCP, no SQLite imports.
 * Callers are responsible for persisting MergeAuditRecord via logAudit().
 */

import type { CanonicalResponse } from "./canonical.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export type ConflictSeverity = "none" | "advisory" | "blocking";

export interface FieldConflict {
  field:          string;
  values:         { agent_id: string; value: unknown }[];
  severity:       ConflictSeverity;
  resolution:     "highest" | "lowest" | "average" | "first_wins" | "unresolved";
  resolved_value?: unknown;
}

export interface MergeResult<T = unknown> {
  merged:                T;
  conflicts:             FieldConflict[];
  conflict_count:        number;
  has_blocking_conflicts: boolean;
  merge_timestamp:       string;
}

/** Written to the audit log for every merge with advisory or blocking conflicts. */
export interface MergeAuditRecord {
  chain_id:       string;
  task_id:        string;
  customer_id:    string;
  timestamp:      string;
  conflict_count: number;
  has_blocking:   boolean;
  conflicts:      FieldConflict[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Operational/timing fields that should never be conflict-checked — they will
 * naturally differ between agents and carry no semantic meaning for the caller.
 */
const EXCLUDED_FIELDS = new Set([
  "duration_ms",
  "input_tokens_used",
  "credits_consumed",
  "scan_cost_usd",   // purely a billing datum; summed, not compared
  "timestamp",
]);

/**
 * Walk one level of nesting and collect all numeric leaf values.
 * Returns a Map from dotted key path → numeric value.
 *
 * Examples:
 *   { demand_mw: 5000, nested: { pue: 1.4 } }
 *   → Map { "demand_mw" → 5000, "nested.pue" → 1.4 }
 */
function extractNumericFields(
  result:  unknown,
  prefix = "",
): Map<string, number> {
  const out = new Map<string, number>();
  if (!result || typeof result !== "object" || Array.isArray(result)) return out;

  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    const dotKey = prefix ? `${prefix}.${key}` : key;
    if (EXCLUDED_FIELDS.has(key)) continue;

    if (typeof value === "number" && isFinite(value)) {
      out.set(dotKey, value);
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !prefix // only one level of nesting
    ) {
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        const subDotKey = `${dotKey}.${subKey}`;
        if (!EXCLUDED_FIELDS.has(subKey) && typeof subVal === "number" && isFinite(subVal)) {
          out.set(subDotKey, subVal);
        }
      }
    }
  }
  return out;
}

/**
 * Compute the percent divergence between the max and min of a set of values,
 * relative to their mean. Returns a value in [0, ∞).
 */
function pctDivergence(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return values.some((v) => v !== 0) ? Infinity : 0;
  const max  = Math.max(...values);
  const min  = Math.min(...values);
  return ((max - min) / Math.abs(mean)) * 100;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Merge an array of parallel agent results into a single object.
 *
 * - Numeric fields present in 2+ results are conflict-checked.
 * - Non-numeric fields: first agent's value wins.
 * - Returns a MergeResult whose `merged` is a plain object combining all fields.
 */
export function mergeResults(results: CanonicalResponse[]): MergeResult {
  if (results.length === 0) {
    return {
      merged:                {},
      conflicts:             [],
      conflict_count:        0,
      has_blocking_conflicts: false,
      merge_timestamp:       new Date().toISOString(),
    };
  }

  // ── 1. Collect numeric fields per agent ──────────────────────────────────
  const numericByAgent: Array<{ agent_id: string; fields: Map<string, number> }> = results.map((r) => ({
    agent_id: r.agent_id,
    fields:   extractNumericFields(r.result),
  }));

  // ── 2. Find fields present in 2+ agents ──────────────────────────────────
  const fieldAgentValues = new Map<string, Array<{ agent_id: string; value: number }>>();
  for (const { agent_id, fields } of numericByAgent) {
    for (const [field, value] of fields) {
      if (!fieldAgentValues.has(field)) fieldAgentValues.set(field, []);
      fieldAgentValues.get(field)!.push({ agent_id, value });
    }
  }

  const conflicts: FieldConflict[] = [];

  // ── 3. Classify each multi-agent field ───────────────────────────────────
  for (const [field, agentValues] of fieldAgentValues) {
    if (agentValues.length < 2) continue; // only one agent — no conflict possible

    const nums   = agentValues.map((av) => av.value);
    const pct    = pctDivergence(nums);
    const avg    = nums.reduce((s, v) => s + v, 0) / nums.length;

    let severity:       ConflictSeverity;
    let resolution:     FieldConflict["resolution"];
    let resolved_value: unknown;

    if (pct <= 5) {
      severity       = "none";
      resolution     = "average";
      resolved_value = avg;
    } else if (pct <= 20) {
      severity       = "advisory";
      resolution     = "average";
      resolved_value = avg;
      console.warn(
        `[merge] advisory conflict on "${field}": ` +
        `${agentValues.map((av) => `${av.agent_id}=${av.value}`).join(", ")} ` +
        `(divergence=${pct.toFixed(1)}%, resolved=average ${avg.toFixed(4)})`
      );
    } else {
      severity       = "blocking";
      resolution     = "unresolved";
      resolved_value = undefined;
    }

    conflicts.push({
      field,
      values:    agentValues.map((av) => ({ agent_id: av.agent_id, value: av.value })),
      severity,
      resolution,
      ...(resolved_value !== undefined && { resolved_value }),
    });
  }

  // ── 4. Build merged object ────────────────────────────────────────────────
  // Start with a deep merge of all result objects (first-wins for non-numeric
  // fields and numeric fields without a conflict entry).
  const merged: Record<string, unknown> = {};

  for (const r of results) {
    if (r.result && typeof r.result === "object" && !Array.isArray(r.result)) {
      for (const [key, value] of Object.entries(r.result as Record<string, unknown>)) {
        if (!(key in merged)) merged[key] = value; // first-wins
      }
    }
  }

  // Apply resolved values for non-blocking conflicts
  for (const conflict of conflicts) {
    if (conflict.resolution === "average" && conflict.resolved_value !== undefined) {
      // The field may be nested (dotted key) — handle one level only
      const parts = conflict.field.split(".");
      if (parts.length === 1) {
        merged[parts[0]] = conflict.resolved_value;
      } else if (parts.length === 2) {
        const parent = merged[parts[0]];
        if (parent && typeof parent === "object" && !Array.isArray(parent)) {
          (parent as Record<string, unknown>)[parts[1]] = conflict.resolved_value;
        }
      }
    }
  }

  const has_blocking_conflicts = conflicts.some((c) => c.severity === "blocking");

  return {
    merged,
    conflicts,
    conflict_count:        conflicts.length,
    has_blocking_conflicts,
    merge_timestamp:       new Date().toISOString(),
  };
}
