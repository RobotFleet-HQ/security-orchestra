// ─── API Gateway Integration ──────────────────────────────────────────────────
// Express middleware + universal /gateway route.
//
// gatewayMiddleware: lightweight global middleware — attaches request ID and
//   handles idempotency short-circuit for all routes.
//
// mountGateway(app, deps): mounts POST /gateway universal endpoint that runs
//   the full 7-layer pipeline and auto-dispatches to the right protocol adapter.

import crypto    from "crypto";
import express   from "express";
import { db }    from "./database.js";
import { checkCredits, deductCredits } from "./billing.js";
import { toCanonical, validateCanonical, CanonicalResponse } from "./canonical.js";
import { normalize, Protocol } from "./protocol-adapters/normalize.js";
import {
  detectProtocol,
  gwCheckRateLimit,
  idemGet,
  idemSet,
  gwAuditLog,
  gwNormalizeError,
  GatewayAuditEntry,
} from "./api-gateway-agent.js";

// ─── Dep injection (same pattern as agntcy.ts) ────────────────────────────────

export interface GatewayDeps {
  dispatchWorkflow: (
    name:   string,
    params: Record<string, string>,
    taskId?: string
  ) => Promise<CanonicalResponse>;
  runChain: (
    chainId: string,
    params:  Record<string, string>,
    userId:  string,
    tier:    string,
    taskId?: string
  ) => Promise<CanonicalResponse>;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function resolveKey(
  req: express.Request
): Promise<{ user_id: string; tier: string; revoked: number; key_prefix: string } | undefined> {
  const supplied = (
    (req.headers["x-api-key"] as string | undefined) ??
    (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "")
  );
  if (!supplied) return undefined;
  return new Promise((resolve, reject) =>
    db.get(
      "SELECT user_id, tier, revoked, key_prefix FROM api_keys WHERE key_prefix = ?",
      [supplied.slice(0, 16)],
      (err, row) => err ? reject(err) : resolve(row as { user_id: string; tier: string; revoked: number; key_prefix: string } | undefined)
    )
  );
}

// ─── gatewayMiddleware ────────────────────────────────────────────────────────
// Global middleware — attaches request_id and checks idempotency cache.
// Non-blocking for existing routes (they handle their own auth).

export function gatewayMiddleware(
  req:  express.Request,
  res:  express.Response,
  next: express.NextFunction
): void {
  // Attach a unique request ID for tracing
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);

  // Idempotency short-circuit: if caller supplies X-Task-ID and we have a
  // cached response, return it immediately — no auth, no billing, no execution.
  const taskId = req.headers["x-task-id"] as string | undefined;
  if (taskId && req.method === "POST") {
    const cached = idemGet(taskId);
    if (cached) {
      // Re-detect protocol from this request to return correct wire format
      const body = req.body ?? {};
      const detection = detectProtocol(body, req.headers as Record<string, string | undefined>);
      const protocol  = detection.protocol;

      gwAuditLog({
        timestamp:    new Date().toISOString(),
        key_id:       "cached",
        protocol:     String(protocol),
        tool:         detection.toolName,
        task_id:      taskId,
        status:       "cached",
        credits_used: 0,
        latency_ms:   0,
      });

      if (protocol === "unknown") {
        res.json(cached.response);
      } else {
        res.json(normalize(protocol as Protocol, cached.response, {
          rpcId:     detection.rpcId,
          runId:     detection.runId,
          agentId:   detection.agentId ?? undefined,
          agentName: detection.agentName ?? undefined,
        }));
      }
      return;
    }
  }

  next();
}

// ─── mountGateway ─────────────────────────────────────────────────────────────

export function mountGateway(app: express.Application, deps: GatewayDeps): void {

  app.post("/gateway", express.json(), gatewayMiddleware, async (req, res) => {
    const startTime = Date.now();
    const body = req.body ?? {};

    // ── Layer 3: Protocol detection ──────────────────────────────────────────
    const detection = detectProtocol(body, req.headers as Record<string, string | undefined>);
    const { protocol, taskId, toolName, params, rpcId, runId, agentId, agentName } = detection;

    // Resolve caller's task_id from header (overrides body-detected one)
    const effectiveTaskId = (req.headers["x-task-id"] as string | undefined) ?? taskId;

    // ── Layer 1: API key auth ────────────────────────────────────────────────
    let keyRow: Awaited<ReturnType<typeof resolveKey>>;
    try {
      keyRow = await resolveKey(req);
    } catch (err) {
      res.status(500).json(gwNormalizeError(err, protocol, effectiveTaskId, toolName, { rpcId, runId, agentId: agentId ?? undefined, agentName: agentName ?? undefined }));
      return;
    }

    if (!keyRow || keyRow.revoked) {
      const errCanonical = validateCanonical(toCanonical(
        toolName ?? "gateway", null,
        { version: "1.0", credits: 0, taskId: effectiveTaskId, idempotent: false },
        { code: "UNAUTHORIZED", message: "Missing or invalid API key" }
      ));
      res.status(401).json(
        protocol === "unknown" ? errCanonical : normalize(protocol as Protocol, errCanonical, { rpcId, runId, agentId: agentId ?? undefined, agentName: agentName ?? undefined })
      );
      return;
    }

    // ── Layer 2: Rate limit ──────────────────────────────────────────────────
    const rl = gwCheckRateLimit(keyRow.key_prefix);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSecs));
      res.setHeader("X-RateLimit-Limit", "100");
      res.setHeader("X-RateLimit-Remaining", "0");
      const errCanonical = validateCanonical(toCanonical(
        toolName ?? "gateway", null,
        { version: "1.0", credits: 0, taskId: effectiveTaskId, idempotent: false },
        { code: "RATE_LIMITED", message: `Gateway rate limit exceeded. Retry after ${rl.retryAfterSecs}s.` }
      ));
      res.status(429).json(
        protocol === "unknown" ? errCanonical : normalize(protocol as Protocol, errCanonical, { rpcId, runId })
      );
      return;
    }
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));

    if (!toolName) {
      const errCanonical = validateCanonical(toCanonical(
        "gateway", null,
        { version: "1.0", credits: 0, taskId: effectiveTaskId, idempotent: false },
        { code: "BAD_REQUEST", message: `Could not detect tool/workflow name from ${protocol} request body` }
      ));
      res.status(400).json(
        protocol === "unknown" ? errCanonical : normalize(protocol as Protocol, errCanonical, { rpcId, runId })
      );
      return;
    }

    // ── Layer 4: Credit check (minimum balance = 1) ──────────────────────────
    if (process.env.BILLING_API_URL) {
      try {
        const balance = await checkCredits(keyRow.user_id);
        if (balance < 1) {
          const errCanonical = validateCanonical(toCanonical(
            toolName, null,
            { version: "1.0", credits: 0, taskId: effectiveTaskId, idempotent: false },
            { code: "INSUFFICIENT_CREDITS", message: `Insufficient credits — balance: ${balance}, minimum: 1` }
          ));
          res.status(402).json(
            protocol === "unknown" ? errCanonical : normalize(protocol as Protocol, errCanonical, { rpcId, runId })
          );
          return;
        }
      } catch (err) {
        res.status(500).json(gwNormalizeError(err, protocol, effectiveTaskId, toolName, { rpcId, runId, agentId: agentId ?? undefined, agentName: agentName ?? undefined }));
        return;
      }
    }

    // ── Layer 5: Idempotency — deduplicate by task_id ────────────────────────
    const cached = idemGet(effectiveTaskId);
    if (cached) {
      const wire = protocol === "unknown"
        ? cached.response
        : normalize(protocol as Protocol, cached.response, { rpcId, runId, agentId: agentId ?? undefined, agentName: agentName ?? undefined });
      gwAuditLog({
        timestamp: new Date().toISOString(), key_id: keyRow.key_prefix,
        protocol: String(protocol), tool: toolName, task_id: effectiveTaskId,
        status: "cached", credits_used: 0, latency_ms: 0,
      });
      res.json(wire);
      return;
    }

    // ── Execute + Layers 6 & 7 ───────────────────────────────────────────────
    const auditBase: Omit<GatewayAuditEntry, "status" | "credits_used" | "latency_ms" | "error_code"> = {
      timestamp: new Date().toISOString(),
      key_id:    keyRow.key_prefix,
      protocol:  String(protocol),
      tool:      toolName,
      task_id:   effectiveTaskId,
    };

    let result: CanonicalResponse;
    try {
      result = await deps.dispatchWorkflow(toolName, params, effectiveTaskId);
      result = validateCanonical(result);

      // Deduct minimum 1 credit for gateway-routed calls
      let creditsUsed = 0;
      if (process.env.BILLING_API_URL) {
        try {
          await deductCredits(keyRow.user_id, 1, `gateway:${toolName}`);
          creditsUsed = 1;
        } catch { /* non-fatal — already validated balance > 0 above */ }
      }

      // Store in idempotency cache
      idemSet(effectiveTaskId, result, protocol);

      gwAuditLog({ ...auditBase, status: "success", credits_used: creditsUsed, latency_ms: Date.now() - startTime });

      const wire = protocol === "unknown"
        ? result
        : normalize(protocol as Protocol, result, { rpcId, runId, agentId: agentId ?? undefined, agentName: agentName ?? undefined });
      res.json(wire);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      gwAuditLog({ ...auditBase, status: "error", credits_used: 0, latency_ms: Date.now() - startTime, error_code: "DISPATCH_ERROR" });
      res.status(500).json(gwNormalizeError(err, protocol, effectiveTaskId, toolName, { rpcId, runId, agentId: agentId ?? undefined, agentName: agentName ?? undefined }));
    }
  });
}
