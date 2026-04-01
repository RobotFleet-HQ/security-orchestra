// ─── Canonical Contract Layer ─────────────────────────────────────────────────
// Every agent response is wrapped in CanonicalResponse before leaving
// dispatchWorkflow. This guarantees parseable, unambiguous output for
// Google A2A, OpenAI Agents SDK, AG-UI, ACP/BeeAI, AGNTCY/OASF, and
// any future A2A protocol.

import crypto from "crypto";
import { z } from "zod";
import { STALENESS } from "./staleness.js";

// ─── DataFreshness ────────────────────────────────────────────────────────────

export interface DataFreshness {
  validated_at:  string;                      // ISO date when agent logic was last verified
  standards_ref: string[];                    // e.g. ["NFPA 110:2022", "IEEE 485:2010"]
  stale_risk:    "low" | "medium" | "high";  // based on data volatility
  pricing_note?: string;                      // present whenever result contains pricing/rates
}

// ─── CanonicalResponse ────────────────────────────────────────────────────────

// How the result was produced — lets callers set latency expectations and
// decide whether to show a spinner, stream, or batch.
export type ExecutionContext =
  | "deterministic_calc"   // pure TypeScript math; no LLM, no I/O — sub-100 ms
  | "single_agent"         // one agent with external I/O (DB, API) — typically 200–800 ms
  | "multi_agent_chain"    // N agents run sequentially — scales with step count; 8-step chains ~5–30 s
  | "cached";              // result served from cache — sub-10 ms

export interface CanonicalResponse {
  agent_id:          string;           // e.g. "generator_sizing" or "chain:full_power_analysis"
  agent_version:     string;           // semver
  protocol_version:  "1.0";           // fixed — breaking changes use a new version
  execution_context: ExecutionContext; // how the result was produced

  status: "success" | "error";
  result: unknown;            // workflow-specific payload; null on error

  // Flat error fields — easier to match without nested destructure
  error_code?:    string;     // e.g. "WORKFLOW_FAILED", "INVALID_PARAMS"
  error_message?: string;     // human-readable description

  data_freshness: DataFreshness;  // required on every response

  a2a: {
    task_id:           string;
    input_tokens_used: number;
    credits_consumed:  number;
    callable_by:       string[];  // ["google-a2a","openai-agents","ag-ui","acp","agntcy"]
    idempotent:        boolean;   // true = safe to retry; false = state-mutating
  };
}

// ─── Zod schema (outbound boundary guard) ────────────────────────────────────

export const CanonicalResponseSchema = z.object({
  agent_id:          z.string(),
  agent_version:     z.string(),
  protocol_version:  z.literal("1.0"),
  execution_context: z.enum(["deterministic_calc", "single_agent", "multi_agent_chain", "cached"]),
  status:            z.enum(["success", "error"]),
  result:            z.unknown(),
  error_code:        z.string().optional(),
  error_message:     z.string().optional(),
  data_freshness:    z.object({
    validated_at:  z.string(),
    standards_ref: z.array(z.string()),
    stale_risk:    z.enum(["low", "medium", "high"]),
    pricing_note:  z.string().optional(),
  }),
  a2a: z.object({
    task_id:           z.string(),
    input_tokens_used: z.number(),
    credits_consumed:  z.number(),
    callable_by:       z.array(z.string()),
    idempotent:        z.boolean(),
  }),
});

export function validateCanonical(response: CanonicalResponse): CanonicalResponse {
  const check = CanonicalResponseSchema.safeParse(response);
  if (!check.success) {
    const issues = check.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const r = response as unknown as Record<string, unknown>;
    const a2aBlock = r["a2a"] as { task_id?: string } | undefined;
    const fallbackTaskId = a2aBlock?.task_id ?? crypto.randomUUID();
    return toCanonical(
      response.agent_id ?? "schema_validator",
      null,
      { version: "1.0", credits: 0, taskId: fallbackTaskId, idempotent: true },
      { code: "SCHEMA_VIOLATION", message: `CanonicalResponse failed validation: ${issues}` }
    );
  }
  return response;
}

// ─── toCanonical ─────────────────────────────────────────────────────────────

const PRICING_NOTE =
  "Cost estimates based on 2026 Q1 market data. Verify current pricing before procurement.";

export function toCanonical(
  agentId: string,
  result:  unknown,
  meta: {
    version:           string;
    credits:           number;
    taskId:            string;
    executionContext?: ExecutionContext;
    idempotent?:       boolean;
  },
  error?: { code: string; message: string }
): CanonicalResponse {
  const reg = STALENESS[agentId];

  const data_freshness: DataFreshness = reg
    ? {
        validated_at:  reg.validated_at,
        standards_ref: reg.standards_ref,
        stale_risk:    reg.stale_risk,
        ...(reg.has_pricing && { pricing_note: PRICING_NOTE }),
      }
    : {
        validated_at:  new Date().toISOString().slice(0, 10),
        standards_ref: [],
        stale_risk:    "low" as const,
      };

  // Default: chains are multi_agent_chain; everything else is deterministic_calc
  // (all 56 individual agents are pure TypeScript calculations — no LLM calls).
  const executionContext: ExecutionContext =
    meta.executionContext ??
    (agentId.startsWith("chain:") ? "multi_agent_chain" : "deterministic_calc");

  const resp: CanonicalResponse = {
    agent_id:          agentId,
    agent_version:     meta.version,
    protocol_version:  "1.0",
    execution_context: executionContext,
    status:            error ? "error" : "success",
    result:            error ? null : result,
    data_freshness,
    a2a: {
      task_id:           meta.taskId,
      input_tokens_used: 0,
      credits_consumed:  meta.credits,
      callable_by:       ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"],
      idempotent:        meta.idempotent ?? true,
    },
  };

  if (error) {
    resp.error_code    = error.code;
    resp.error_message = error.message;
  }

  return resp;
}
