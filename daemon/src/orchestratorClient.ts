// ─── Orchestrator HTTP MCP client ────────────────────────────────────────────
// Calls orchestrator /mcp endpoint using the JSON-RPC wire protocol.
// Matches the streaming HTTP transport: POST with Accept: application/json, text/event-stream
// and X-API-Key header. Parses the SSE-style "data: {...}" response line.

import https from "https";
import http from "http";
import { ORCHESTRATOR_URL, ORCHESTRATOR_API_KEY } from "./config.js";

interface McpResponse {
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: { code: number; message: string };
}

interface ChainResult {
  chain:             string;
  steps_completed:   number;
  summary:           string;
  results:           Array<{ step: string; result: unknown; error?: string }>;
}

export interface OrchestratorCallResult {
  ok:             boolean;
  steps_completed?: number;
  summary?:       string;
  results?:       Array<{ step: string; result: unknown; error?: string }>;
  raw?:           unknown;
  error?:         string;
}

function post(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   "POST",
        headers:  { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseSseResponse(raw: string): McpResponse {
  // Response is SSE: "event: message\ndata: {...}\n\n"
  // Extract the last "data:" line which contains the JSON-RPC response.
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("data:")) {
      return JSON.parse(line.slice(5).trim()) as McpResponse;
    }
  }
  throw new Error(`No SSE data line found in response: ${raw.substring(0, 200)}`);
}

export async function callChain(
  chainId: string,
  args: Record<string, string>
): Promise<OrchestratorCallResult> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id:      1,
    method:  "tools/call",
    params: {
      name:      `chain_${chainId}`,
      arguments: args,
    },
  });

  try {
    const raw = await post(
      `${ORCHESTRATOR_URL}/mcp`,
      body,
      {
        "Content-Type":  "application/json",
        "Accept":        "application/json, text/event-stream",
        "X-API-Key":     ORCHESTRATOR_API_KEY,
      }
    );

    const mcp = parseSseResponse(raw);
    if (mcp.error) {
      return { ok: false, error: mcp.error.message };
    }

    const text = mcp.result?.content?.[0]?.text ?? "{}";
    const canonical = JSON.parse(text) as { result?: ChainResult };
    const r = canonical.result;
    return {
      ok:              true,
      steps_completed: r?.steps_completed,
      summary:         r?.summary,
      results:         r?.results,
      raw:             canonical,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function callWorkflow(
  workflowName: string,
  args: Record<string, string>
): Promise<OrchestratorCallResult> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id:      1,
    method:  "tools/call",
    params:  { name: workflowName, arguments: args },
  });

  try {
    const raw = await post(
      `${ORCHESTRATOR_URL}/mcp`,
      body,
      {
        "Content-Type": "application/json",
        "Accept":       "application/json, text/event-stream",
        "X-API-Key":    ORCHESTRATOR_API_KEY,
      }
    );

    const mcp = parseSseResponse(raw);
    if (mcp.error) {
      return { ok: false, error: mcp.error.message };
    }

    const text = mcp.result?.content?.[0]?.text ?? "{}";
    const canonical = JSON.parse(text) as { result?: unknown };
    return { ok: true, raw: canonical };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
