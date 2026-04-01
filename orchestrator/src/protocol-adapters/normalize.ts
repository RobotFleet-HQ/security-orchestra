// ─── Protocol Normalization Layer ─────────────────────────────────────────────
// Single source of truth for translating CanonicalResponse into each protocol's
// wire format. Every adapter imports and calls normalize() — no ad-hoc shaping.
//
// Supported protocols:
//   a2a     — Google A2A JSON-RPC 2.0
//   agui    — AG-UI (returns event payload; callers write to SSE stream)
//   acp     — ACP / BeeAI run envelope
//   openai  — OpenAI Agents SDK tool-call response
//   mcp     — Model Context Protocol content array
//   agntcy  — AGNTCY/OASF per-agent run response

import { CanonicalResponse } from "../canonical.js";

// ─── Protocol type ────────────────────────────────────────────────────────────

export type Protocol = "a2a" | "agui" | "acp" | "openai" | "mcp" | "agntcy";

// ─── Per-protocol option bags ─────────────────────────────────────────────────

export interface NormalizeOpts {
  /** JSON-RPC call id (a2a only) */
  rpcId?:     string | number | null;
  /** ACP/AGNTCY run_id; defaults to canonical.a2a.task_id */
  runId?:     string;
  /** ACP agent_name */
  agentName?: string;
  /** AGNTCY agent_id */
  agentId?:   string;
}

// ─── Wire-format types ────────────────────────────────────────────────────────

export interface A2AWire {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: {
    id: string;
    status: { state: "completed" | "failed" };
    artifacts: { name: string; parts: { kind: string; text: string }[] }[];
  };
  error?: { code: number; message: string; data?: unknown };
}

export interface ACPWire {
  run_id:       string;
  agent_name?:  string;
  status:       "completed" | "failed";
  output?:      { role: string; content: { type: string; text: string }[] }[];
  error?:       string;
}

export interface OpenAIWire {
  role:    "tool";
  content: string;
}

export interface MCPWire {
  content: { type: "text"; text: string }[];
}

export interface AGNTCYWire {
  run_id:        string;
  agent_id?:     string;
  status:        "completed" | "failed";
  completed_at?: string;
  output?:       { role: string; content: { type: string; text: string }[] }[];
  error?:        string;
}

export interface AGUIEventPayload {
  type: string;
  [key: string]: unknown;
}

// ─── normalize ────────────────────────────────────────────────────────────────

export function normalize(
  protocol: "a2a",
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): A2AWire;
export function normalize(
  protocol: "acp",
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): ACPWire;
export function normalize(
  protocol: "openai",
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): OpenAIWire;
export function normalize(
  protocol: "mcp",
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): MCPWire;
export function normalize(
  protocol: "agntcy",
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): AGNTCYWire;
export function normalize(
  protocol: "agui",
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): AGUIEventPayload;
export function normalize(
  protocol: Protocol,
  canonical: CanonicalResponse,
  opts?: NormalizeOpts
): A2AWire | ACPWire | OpenAIWire | MCPWire | AGNTCYWire | AGUIEventPayload;
export function normalize(
  protocol: Protocol,
  canonical: CanonicalResponse,
  opts: NormalizeOpts = {}
): A2AWire | ACPWire | OpenAIWire | MCPWire | AGNTCYWire | AGUIEventPayload {
  const text      = JSON.stringify(canonical, null, 2);
  const isError   = canonical.status === "error";
  const taskId    = canonical.a2a.task_id;
  const runId     = opts.runId ?? taskId;
  const errorMsg  = canonical.error_message ?? "Internal error";

  switch (protocol) {

    // ── A2A (Google Agent-to-Agent JSON-RPC 2.0) ────────────────────────────
    case "a2a": {
      if (isError) {
        return {
          jsonrpc: "2.0",
          id: opts.rpcId ?? null,
          error: {
            code:    -32603,
            message: errorMsg,
            data:    canonical,       // full CanonicalResponse in data — always parseable
          },
        } satisfies A2AWire;
      }
      return {
        jsonrpc: "2.0",
        id: opts.rpcId ?? null,
        result: {
          id:        taskId,
          status:    { state: "completed" },
          artifacts: [{ name: "response", parts: [{ kind: "text", text }] }],
        },
      } satisfies A2AWire;
    }

    // ── ACP (IBM/BeeAI Agent Communication Protocol) ────────────────────────
    case "acp": {
      if (isError) {
        return {
          run_id:     runId,
          agent_name: opts.agentName,
          status:     "failed",
          error:      errorMsg,
        } satisfies ACPWire;
      }
      return {
        run_id:     runId,
        agent_name: opts.agentName,
        status:     "completed",
        output: [{ role: "agent", content: [{ type: "text", text }] }],
      } satisfies ACPWire;
    }

    // ── OpenAI Agents SDK ────────────────────────────────────────────────────
    case "openai": {
      return {
        role:    "tool",
        content: isError ? `Error: ${errorMsg}` : text,
      } satisfies OpenAIWire;
    }

    // ── MCP (Model Context Protocol) ─────────────────────────────────────────
    case "mcp": {
      return {
        content: [{ type: "text", text }],
      } satisfies MCPWire;
    }

    // ── AGNTCY / OASF per-agent run ──────────────────────────────────────────
    case "agntcy": {
      if (isError) {
        return {
          run_id:   runId,
          agent_id: opts.agentId,
          status:   "failed",
          error:    errorMsg,
        } satisfies AGNTCYWire;
      }
      return {
        run_id:        runId,
        agent_id:      opts.agentId,
        status:        "completed",
        completed_at:  new Date().toISOString(),
        output: [{ role: "agent", content: [{ type: "text", text }] }],
      } satisfies AGNTCYWire;
    }

    // ── AG-UI (streaming SSE) ────────────────────────────────────────────────
    // Returns a single event payload; callers write via writeAGUIEvent().
    case "agui": {
      if (isError) {
        return { type: "RUN_ERROR", message: errorMsg, canonical } satisfies AGUIEventPayload;
      }
      return { type: "CANONICAL_RESULT", canonical } satisfies AGUIEventPayload;
    }
  }
}
