// ─── API Gateway Agent ────────────────────────────────────────────────────────
// 7-layer security pipeline for all inbound A2A-compatible requests:
//   1. API key auth       — validates x-api-key against billing DB
//   2. Rate limiting      — per-key sliding window, 100 req/min (in-memory)
//   3. Protocol detection — auto-detects A2A / MCP / ACP / AG-UI / OpenAI / AGNTCY
//   4. Credit check       — rejects 402 if balance < 1
//   5. Idempotency        — caches CanonicalResponse by task_id for 24 h
//   6. Audit log          — structured JSON per request
//   7. Error normalization— all unhandled errors → toCanonical() + normalize()

import crypto from "crypto";
import { CanonicalResponse, toCanonical, validateCanonical } from "./canonical.js";
import { normalize, Protocol } from "./protocol-adapters/normalize.js";

// ─── Layer 2: Gateway rate limiter (100 req/min per key, sliding window) ──────
// Intentionally separate from the tier-based rateLimit.ts so the gateway can
// apply a uniform baseline before tier-aware dispatch.

const GATEWAY_WINDOW_MS   = 60_000;
const GATEWAY_LIMIT       = 100;
const GATEWAY_CLEANUP_MS  = 300_000; // prune every 5 min

const gwRateStore = new Map<string, number[]>();

function gwRatePrune(ts: number[], now: number): number[] {
  const cutoff = now - GATEWAY_WINDOW_MS;
  let i = 0;
  while (i < ts.length && ts[i] <= cutoff) i++;
  return i === 0 ? ts : ts.slice(i);
}

const gwCleanup = setInterval(() => {
  const cutoff = Date.now() - GATEWAY_WINDOW_MS;
  for (const [k, ts] of gwRateStore) {
    if (ts.length === 0 || ts[ts.length - 1] <= cutoff) gwRateStore.delete(k);
  }
}, GATEWAY_CLEANUP_MS);
if (gwCleanup.unref) gwCleanup.unref();

export interface GatewayRateLimitResult {
  allowed:          boolean;
  remaining:        number;
  retryAfterSecs:   number;
}

export function gwCheckRateLimit(keyId: string): GatewayRateLimitResult {
  const now  = Date.now();
  let ts = gwRatePrune(gwRateStore.get(keyId) ?? [], now);

  if (ts.length >= GATEWAY_LIMIT) {
    const oldest = ts[0];
    const retryAfterSecs = Math.max(1, Math.ceil((oldest + GATEWAY_WINDOW_MS - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSecs };
  }

  ts.push(now);
  gwRateStore.set(keyId, ts);
  return { allowed: true, remaining: GATEWAY_LIMIT - ts.length, retryAfterSecs: 0 };
}

// ─── Layer 3: Protocol detection ──────────────────────────────────────────────
// Infers protocol from request shape — no path dependency.

export type DetectedProtocol = Protocol | "unknown";

export interface ProtocolDetectionResult {
  protocol:   DetectedProtocol;
  taskId:     string;
  toolName:   string | null;
  params:     Record<string, string>;
  rpcId:      string | number | null;
  runId:      string;
  agentId:    string | null;
  agentName:  string | null;
}

export function detectProtocol(
  body: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>
): ProtocolDetectionResult {
  const accept = (headers["accept"] as string | undefined) ?? "";
  const runId  = crypto.randomUUID();
  const base: Omit<ProtocolDetectionResult, "protocol"> = {
    taskId:    crypto.randomUUID(),
    toolName:  null,
    params:    {},
    rpcId:     null,
    runId,
    agentId:   null,
    agentName: null,
  };

  // A2A — JSON-RPC 2.0 envelope
  if (body.jsonrpc === "2.0" && typeof body.method === "string") {
    const params = (body.params as Record<string, unknown> | undefined) ?? {};
    const msgParts = (params.message as { parts?: { text?: string }[] } | undefined)?.parts ?? [];
    const text = (msgParts[0]?.text as string | undefined) ?? "";
    return {
      ...base,
      protocol:  "a2a",
      taskId:    (params.id as string | undefined) ?? base.taskId,
      toolName:  body.method,
      params:    { message: text },
      rpcId:     (body.id as string | number | null | undefined) ?? null,
    };
  }

  // MCP — tools/call shape
  if (body.method === "tools/call" && typeof body.params === "object" && body.params !== null) {
    const p = body.params as Record<string, unknown>;
    return {
      ...base,
      protocol: "mcp",
      toolName: (p.name as string | undefined) ?? null,
      params:   (p.arguments as Record<string, string> | undefined) ?? {},
    };
  }

  // ACP — input array
  if (Array.isArray(body.input)) {
    const firstMsg = (body.input as { content?: { text?: string }[] }[])[0];
    const text = firstMsg?.content?.[0]?.text ?? "";
    return {
      ...base,
      protocol:  "acp",
      taskId:    (body.run_id as string | undefined) ?? base.taskId,
      toolName:  (body.agent_name as string | undefined) ?? null,
      params:    { message: text },
      runId:     (body.run_id as string | undefined) ?? runId,
      agentName: (body.agent_name as string | undefined) ?? null,
    };
  }

  // AGNTCY — agent_id + inputs
  if (typeof body.agent_id === "string" && typeof body.inputs === "object" && body.inputs !== null) {
    return {
      ...base,
      protocol:  "agntcy",
      taskId:    (body.run_id as string | undefined) ?? base.taskId,
      toolName:  body.agent_id,
      params:    body.inputs as Record<string, string>,
      runId:     (body.run_id as string | undefined) ?? runId,
      agentId:   body.agent_id,
    };
  }

  // OpenAI — tool_name + parameters
  if (typeof body.tool_name === "string") {
    return {
      ...base,
      protocol: "openai",
      toolName: body.tool_name,
      params:   (body.parameters as Record<string, string> | undefined) ?? {},
    };
  }

  // AG-UI — messages array + streaming Accept header
  if (Array.isArray(body.messages) && accept.includes("text/event-stream")) {
    return {
      ...base,
      protocol: "agui",
      params:   { messages: JSON.stringify(body.messages) },
    };
  }

  // Generic workflow call — { workflow, ...params }
  if (typeof body.workflow === "string") {
    const { workflow, task_id, ...rest } = body as Record<string, string>;
    return {
      ...base,
      protocol: "openai",
      taskId:   task_id ?? base.taskId,
      toolName: workflow,
      params:   rest,
    };
  }

  return { ...base, protocol: "unknown" };
}

// ─── Layer 5: Idempotency cache (24 h TTL, in-memory Map) ─────────────────────

const IDEMPOTENCY_TTL_MS = 86_400_000; // 24 h
const IDEMPOTENCY_MAX    = 10_000;      // LRU eviction ceiling

interface IdempotencyEntry {
  response:   CanonicalResponse;
  protocol:   DetectedProtocol;
  storedAt:   number;
}

const idempotencyCache = new Map<string, IdempotencyEntry>();

export function idemGet(taskId: string): IdempotencyEntry | undefined {
  const entry = idempotencyCache.get(taskId);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(taskId);
    return undefined;
  }
  return entry;
}

export function idemSet(taskId: string, response: CanonicalResponse, protocol: DetectedProtocol): void {
  // LRU: evict oldest entry when at capacity
  if (idempotencyCache.size >= IDEMPOTENCY_MAX) {
    const firstKey = idempotencyCache.keys().next().value;
    if (firstKey !== undefined) idempotencyCache.delete(firstKey);
  }
  idempotencyCache.set(taskId, { response, protocol, storedAt: Date.now() });
}

// ─── Layer 6: Audit log ────────────────────────────────────────────────────────

export interface GatewayAuditEntry {
  timestamp:    string;
  key_id:       string;
  protocol:     string;
  tool:         string | null;
  task_id:      string;
  status:       "success" | "error" | "cached";
  credits_used: number;
  latency_ms:   number;
  error_code?:  string;
}

export function gwAuditLog(entry: GatewayAuditEntry): void {
  // Write to stdout as structured JSON — same sink as the rest of the app
  process.stdout.write(JSON.stringify({ level: "audit", source: "gateway", ...entry }) + "\n");
}

// ─── Layer 7: Error normalization ─────────────────────────────────────────────

export function gwNormalizeError(
  err: unknown,
  protocol: DetectedProtocol,
  taskId: string,
  toolName: string | null,
  opts: { rpcId?: string | number | null; runId?: string; agentId?: string; agentName?: string } = {}
): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  const canonical = validateCanonical(
    toCanonical(
      toolName ?? "gateway",
      null,
      { version: "1.0", credits: 0, taskId, idempotent: false },
      { code: "GATEWAY_ERROR", message: msg }
    )
  );

  if (protocol === "unknown") return canonical;

  return normalize(protocol as Protocol, canonical, {
    rpcId:     opts.rpcId,
    runId:     opts.runId,
    agentId:   opts.agentId,
    agentName: opts.agentName,
  });
}
