// ─── Canonical Contract Layer ─────────────────────────────────────────────────
// Every agent response is wrapped in CanonicalResponse before leaving
// dispatchWorkflow. This guarantees parseable, unambiguous output for
// Google A2A, OpenAI Agents SDK, AG-UI, ACP/BeeAI, AGNTCY/OASF, and
// any future A2A protocol.

export interface CanonicalResponse {
  // Identity
  agent_id:         string;    // e.g. "generator_sizing"
  agent_version:    string;    // semver
  protocol_version: "1.0";

  // Result
  status: "success" | "error" | "partial";
  result: unknown;             // workflow-specific payload

  // Failure path (always present when status === "error")
  error?: {
    code:              string;
    message:           string;
    recoverable:       boolean;
    suggested_action?: string;
  };

  // Knowledge freshness
  data_freshness: {
    last_validated: string;                        // ISO date
    standards_refs: string[];
    stale_risk:     "low" | "medium" | "high";
    pricing_note?:  string;                        // only if stale_risk === "high"
  };

  // A2A routing metadata
  a2a: {
    task_id:          string;
    input_tokens_used: number;
    credits_consumed: number;
    callable_by:      string[];  // ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"]
  };
}

export function toCanonical(
  agentId: string,
  result: unknown,
  meta: {
    version:        string;
    last_validated: string;
    standards_refs: string[];
    stale_risk:     "low" | "medium" | "high";
    credits:        number;
    taskId:         string;
  },
  error?: { code: string; message: string; recoverable: boolean; suggested_action?: string }
): CanonicalResponse {
  const resp: CanonicalResponse = {
    agent_id:         agentId,
    agent_version:    meta.version,
    protocol_version: "1.0",
    status:           error ? "error" : "success",
    result:           error ? null : result,
    data_freshness: {
      last_validated: meta.last_validated,
      standards_refs: meta.standards_refs,
      stale_risk:     meta.stale_risk,
      ...(meta.stale_risk === "high" && {
        pricing_note: "Cost estimates based on 2026 Q1 market data. Verify current pricing before procurement.",
      }),
    },
    a2a: {
      task_id:           meta.taskId,
      input_tokens_used: 0,
      credits_consumed:  meta.credits,
      callable_by:       ["google-a2a", "openai-agents", "ag-ui", "acp", "agntcy"],
    },
  };
  if (error) resp.error = error;
  return resp;
}
