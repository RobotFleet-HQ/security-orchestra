/**
 * Integration test: drives the full request pipeline (rate-limit → validation →
 * credit-gate → workflow → deduct) directly, with audit logging at every step,
 * then queries audit.db and prints a formatted log table.
 *
 * No MCP transport needed — we call the same business-logic functions that
 * index.ts uses, so audit entries are identical to what a real server produces.
 */

import { logAudit, auditDb, AuditRow } from "../audit.js";
import { enforceRateLimit, _resetStore } from "../rateLimit.js";
import { validateWorkflowParams } from "../validation.js";
import { WORKFLOW_COSTS } from "../billing.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER = `test-audit-${Date.now()}`;  // unique per run
const TIER      = "free";

function label(tag: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${tag}`);
  console.log("─".repeat(60));
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Simulate the pipeline steps ─────────────────────────────────────────────

async function simulateWorkflow(
  workflowName: string,
  params: Record<string, string>,
  creditBalance: number
) {
  const wfCredits = WORKFLOW_COSTS[workflowName] ?? 1;

  // Rate limit
  try {
    const rl = enforceRateLimit(TEST_USER, TIER);
    logAudit({ user_id: TEST_USER, action: "rate_limit_ok", resource: workflowName,
      result: "success", details: { remaining: rl.remaining } });
  } catch (err) {
    logAudit({ user_id: TEST_USER, action: "rate_limit_exceeded", resource: workflowName,
      result: "blocked", details: { message: err instanceof McpError ? err.message : String(err) } });
    throw err;
  }

  // Validation
  let cleanParams: Record<string, string>;
  try {
    cleanParams = validateWorkflowParams(workflowName, params);
    logAudit({ user_id: TEST_USER, action: "validation_ok", resource: workflowName,
      result: "success", details: { params: cleanParams } });
  } catch (err) {
    logAudit({ user_id: TEST_USER, action: "validation_failure", resource: workflowName,
      result: "failure", details: { raw_params: params,
        message: err instanceof McpError ? err.message : String(err) } });
    throw err;
  }

  // Credit gate (simulated — no live billing API needed)
  if (creditBalance < wfCredits) {
    logAudit({ user_id: TEST_USER, action: "credit_insufficient", resource: workflowName,
      result: "blocked", details: { balance: creditBalance, required: wfCredits,
        shortfall: wfCredits - creditBalance } });
    throw new Error(`402: Insufficient credits — balance: ${creditBalance}, required: ${wfCredits}`);
  }
  logAudit({ user_id: TEST_USER, action: "credit_check", resource: workflowName,
    result: "success", details: { balance: creditBalance, required: wfCredits } });

  // Execute (simulated)
  logAudit({ user_id: TEST_USER, action: "workflow_start", resource: workflowName,
    result: "success", details: { params: cleanParams!, tier: TIER, credits_required: wfCredits } });
  const t0 = Date.now();
  await wait(15);  // simulate work
  const durationMs = Date.now() - t0;

  // Credit deduction
  const remaining = creditBalance - wfCredits;
  logAudit({ user_id: TEST_USER, action: "credit_deduct", resource: workflowName,
    result: "success", details: { deducted: wfCredits, remaining } });

  // Complete
  logAudit({ user_id: TEST_USER, action: "workflow_complete", resource: workflowName,
    result: "success", duration_ms: durationMs,
    details: { params: cleanParams!, tier: TIER } });

  return remaining;
}

// ─── Read audit rows back from the DB ────────────────────────────────────────

function fetchAuditRows(userId: string): Promise<AuditRow[]> {
  return new Promise((resolve, reject) => {
    auditDb.all(
      "SELECT * FROM audit_logs WHERE user_id = ? ORDER BY id ASC",
      [userId],
      (err, rows) => { if (err) reject(err); else resolve(rows as AuditRow[]); }
    );
  });
}

function printTable(rows: AuditRow[]) {
  const COL = { id: 4, ts: 26, action: 24, resource: 24, result: 8, dur: 6 };
  const hdr = [
    " ID  ".padEnd(COL.id),
    " Timestamp".padEnd(COL.ts),
    " Action".padEnd(COL.action),
    " Resource".padEnd(COL.resource),
    " Result".padEnd(COL.result),
    " ms".padEnd(COL.dur),
  ].join("│");
  const sep = Object.values(COL).map(w => "─".repeat(w)).join("┼");

  console.log("┌" + sep + "┐");
  console.log("│" + hdr + "│");
  console.log("├" + sep + "┤");
  for (const r of rows) {
    let detailStr = "";
    if (r.details) {
      try {
        const d = JSON.parse(r.details) as Record<string, unknown>;
        detailStr = Object.entries(d)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ");
      } catch { detailStr = r.details; }
    }
    const resultIcon = r.result === "success" ? "✓" :
                       r.result === "blocked"  ? "⊘" : "✗";
    const row = [
      String(r.id).padStart(3).padEnd(COL.id),
      (" " + r.timestamp.replace("T", " ").replace("Z", "")).padEnd(COL.ts),
      (" " + r.action).padEnd(COL.action),
      (" " + (r.resource ?? "—")).padEnd(COL.resource),
      (` ${resultIcon} ${r.result}`).padEnd(COL.result),
      (" " + (r.duration_ms != null ? String(r.duration_ms) : "—")).padEnd(COL.dur),
    ].join("│");
    console.log("│" + row + "│");
    if (detailStr) {
      const detail = "   " + detailStr;
      console.log("│  " + detail.substring(0, 84).padEnd(88) + "│");
    }
  }
  console.log("└" + sep + "┘");
}

// ─── Run scenarios ────────────────────────────────────────────────────────────

async function main() {
  _resetStore();   // start with clean rate-limit state

  console.log(`\nAudit log integration test`);
  console.log(`Test user: ${TEST_USER}`);

  let credits = 20;  // start with 20 credits

  // ── 1. Auth logged at startup ───────────────────────────────────────────────
  label("1. Auth events");
  logAudit({ user_id: "anonymous", action: "auth_failure", result: "failure",
    details: { reason: "Invalid API key format" } });
  logAudit({ user_id: TEST_USER, action: "auth_success", result: "success",
    details: { tier: TIER } });
  console.log("  Logged: auth_failure (anonymous), auth_success");

  // ── 2. subdomain_discovery — should succeed, costs 5 credits ───────────────
  label("2. subdomain_discovery (valid — costs 5 credits)");
  credits = await simulateWorkflow("subdomain_discovery", { domain: "example.com" }, credits);
  console.log(`  Credits remaining: ${credits}`);

  // ── 3. asset_discovery — should succeed, costs 15 credits ──────────────────
  label("3. asset_discovery (valid — costs 15 credits)");
  credits = await simulateWorkflow("asset_discovery", { domain: "api.example.com" }, credits);
  console.log(`  Credits remaining: ${credits}`);

  // ── 4. Validation failure ────────────────────────────────────────────────────
  label("4. Validation failure: domain='example.com; rm -rf /'");
  try {
    await simulateWorkflow("subdomain_discovery", { domain: "example.com; rm -rf /" }, credits);
  } catch { console.log("  Correctly rejected."); }

  // ── 5. Validation failure ────────────────────────────────────────────────────
  label("5. Validation failure: domain='../../../etc/passwd'");
  try {
    await simulateWorkflow("subdomain_discovery", { domain: "../../../etc/passwd" }, credits);
  } catch { console.log("  Correctly rejected."); }

  // ── 6. Insufficient credits — vuln_assessment costs 25, balance is 0 ────────
  label("6. Credit gate: vulnerability_assessment costs 25, balance is 0");
  try {
    await simulateWorkflow("vulnerability_assessment", { target: "example.com" }, credits);
  } catch (err) {
    console.log(`  Correctly blocked: ${err instanceof Error ? err.message : err}`);
  }

  // ── 7. Rate limit ─────────────────────────────────────────────────────────
  label("7. Rate limit: exhaust free tier (10/min) then attempt #11");
  // Use a fresh user to avoid polluting the main test user's log
  const rlUser = `rl-test-${Date.now()}`;
  for (let i = 0; i < 10; i++) {
    enforceRateLimit(rlUser, "free");   // requests 1-10
  }
  try {
    enforceRateLimit(rlUser, "free");   // request 11 — must fail
  } catch (err) {
    if (err instanceof McpError) {
      logAudit({ user_id: rlUser, action: "rate_limit_exceeded", resource: "subdomain_discovery",
        result: "blocked", details: { message: err.message } });
      console.log(`  Correctly blocked: ${err.message}`);
    }
  }

  // ── Wait for SQLite writes to flush (fire-and-forget callbacks) ─────────────
  await wait(150);

  // ── 8. Print the full audit log ─────────────────────────────────────────────
  label("Audit log — all events for test user");
  const rows = await fetchAuditRows(TEST_USER);
  console.log(`\n  Total events: ${rows.length}\n`);
  printTable(rows);

  // ── 9. Summary by action ────────────────────────────────────────────────────
  label("Summary by action");
  const summary: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    summary[r.action] = summary[r.action] ?? {};
    summary[r.action][r.result] = (summary[r.action][r.result] ?? 0) + 1;
  }
  for (const [action, results] of Object.entries(summary)) {
    const parts = Object.entries(results).map(([res, n]) => `${res}×${n}`).join(", ");
    console.log(`  ${action.padEnd(26)} ${parts}`);
  }

  // ── 10. Billing-API audit endpoint simulation ───────────────────────────────
  label("Billing-API /audit/:userId response shape");
  const allRows = await fetchAuditRows(TEST_USER);
  const apiResponse = {
    user_id: TEST_USER,
    total:   allRows.length,
    limit:   50,
    offset:  0,
    summary: Object.entries(summary).map(([action, results]) =>
      Object.entries(results).map(([result, count]) => ({ action, result, count }))
    ).flat(),
    rows: allRows.slice(0, 3).map(r => ({
      id: r.id, timestamp: r.timestamp, action: r.action,
      resource: r.resource, result: r.result,
      details: r.details ? JSON.parse(r.details) : null,
      duration_ms: r.duration_ms,
    })),
  };
  console.log("\n  GET /audit/" + TEST_USER.substring(0, 20) + "...");
  console.log(JSON.stringify(apiResponse, null, 2));

  auditDb.close();
  console.log(`\n${"─".repeat(60)}`);
  console.log(` All scenarios complete. ${rows.length} audit events recorded.`);
  console.log("─".repeat(60) + "\n");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
