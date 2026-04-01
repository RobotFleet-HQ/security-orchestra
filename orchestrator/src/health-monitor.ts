// ─── Agent Health Monitor ─────────────────────────────────────────────────────
// In-memory per-agent metrics: call counts, error rates, latencies.
// recordCall() is wired into dispatchWorkflow and runChain in index.ts.
// getHealthReport() is served by GET /admin/health.

import { STALENESS } from "./staleness.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AgentHealthEntry {
  agent_id:       string;
  call_count:     number;
  error_count:    number;
  error_rate:     number;          // 0–1 fraction
  last_called:    string | null;   // ISO timestamp or null if never called
  avg_latency_ms: number;
  last_error:     string | null;
  stale_risk:     "low" | "medium" | "high" | null;  // from STALENESS registry
  validated_at:   string | null;                      // from STALENESS registry
}

export interface HealthReport {
  agents:       AgentHealthEntry[];
  generated_at: string;
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface InternalMetrics {
  call_count:       number;
  error_count:      number;
  last_called_ms:   number | null;
  total_latency_ms: number;
  last_error:       string | null;
}

const metrics = new Map<string, InternalMetrics>();

// ─── recordCall ───────────────────────────────────────────────────────────────
// Called after every dispatchWorkflow() and runChain() execution.
// latency_ms: wall-clock time of the call.
// error:      pass the thrown error for failed calls.

export function recordCall(agentId: string, latency_ms: number, error?: Error): void {
  const m: InternalMetrics = metrics.get(agentId) ?? {
    call_count:       0,
    error_count:      0,
    last_called_ms:   null,
    total_latency_ms: 0,
    last_error:       null,
  };
  m.call_count++;
  m.last_called_ms    = Date.now();
  m.total_latency_ms += latency_ms;
  if (error) {
    m.error_count++;
    m.last_error = error.message;
  }
  metrics.set(agentId, m);
}

// ─── getHealthReport ──────────────────────────────────────────────────────────
// Returns all tracked agents sorted by error_rate descending.

export function getHealthReport(): HealthReport {
  const agents: AgentHealthEntry[] = [];

  for (const [agent_id, m] of metrics) {
    const error_rate = m.call_count > 0 ? m.error_count / m.call_count : 0;
    const staleness  = STALENESS[agent_id];
    agents.push({
      agent_id,
      call_count:     m.call_count,
      error_count:    m.error_count,
      error_rate,
      last_called:    m.last_called_ms ? new Date(m.last_called_ms).toISOString() : null,
      avg_latency_ms: m.call_count > 0 ? Math.round(m.total_latency_ms / m.call_count) : 0,
      last_error:     m.last_error,
      stale_risk:     staleness?.stale_risk  ?? null,
      validated_at:   staleness?.validated_at ?? null,
    });
  }

  agents.sort((a, b) => b.error_rate - a.error_rate);
  return { agents, generated_at: new Date().toISOString() };
}
