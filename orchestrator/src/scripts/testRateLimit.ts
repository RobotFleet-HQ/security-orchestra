import {
  checkRateLimit,
  enforceRateLimit,
  TIER_LIMITS,
  _resetStore,
  _setTimestamps,
} from "../rateLimit.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗  ${label}\n     → ${msg}`);
    failed++;
  }
}

function expect429(label: string, userId: string, tier: string) {
  test(label, () => {
    try {
      enforceRateLimit(userId, tier);
      throw new Error("Expected 429 but request was allowed");
    } catch (err) {
      if (err instanceof McpError && err.message.includes("429")) {
        console.log(`       429: ${err.message}`);
        return;
      }
      throw err;
    }
  });
}

// ─── Helper: simulate N requests, returns the results ────────────────────────

function sendN(n: number, userId: string, tier: string) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(checkRateLimit(userId, tier));
  }
  return results;
}

// ─── Tier limits sanity check ─────────────────────────────────────────────────

console.log("\n── Tier limits ────────────────────────────────────────────────");
test("free tier: 10/min, 100/hour, 500/day", () => {
  const l = TIER_LIMITS.free;
  if (l.perMinute !== 10 || l.perHour !== 100 || l.perDay !== 500)
    throw new Error(JSON.stringify(l));
});
test("starter tier: 60/min", () => {
  if (TIER_LIMITS.starter.perMinute !== 60) throw new Error(String(TIER_LIMITS.starter.perMinute));
});
test("pro tier: 300/min", () => {
  if (TIER_LIMITS.pro.perMinute !== 300) throw new Error(String(TIER_LIMITS.pro.perMinute));
});
test("enterprise tier: 1000/min", () => {
  if (TIER_LIMITS.enterprise.perMinute !== 1000) throw new Error(String(TIER_LIMITS.enterprise.perMinute));
});

// ─── Per-minute window: free tier = 10/min ───────────────────────────────────

console.log("\n── Free tier: 11 requests in 1 minute (10th allowed, 11th blocked) ──");

_resetStore();
const USER = "user-free-01";

// Requests 1–10: all should be allowed
for (let i = 1; i <= 10; i++) {
  const result = checkRateLimit(USER, "free");
  test(`request ${i}/10 — allowed, remaining=${result.remaining}`, () => {
    if (!result.allowed) throw new Error("was denied");
  });
}

// Request 11: must be blocked
expect429("request 11/10 — 429 Too Many Requests (per-minute exceeded)", USER, "free");

// ─── Remaining counter ───────────────────────────────────────────────────────

console.log("\n── Remaining counter decrements correctly ─────────────────────");

_resetStore();
const USER2 = "user-remaining-01";

test("first request: remaining = perMinute - 1 = 9", () => {
  const r = checkRateLimit(USER2, "free");
  if (!r.allowed) throw new Error("denied");
  if (r.remaining !== 9) throw new Error(`remaining=${r.remaining}`);
});
test("second request: remaining = 8", () => {
  const r = checkRateLimit(USER2, "free");
  if (r.remaining !== 8) throw new Error(`remaining=${r.remaining}`);
});

// ─── Rate-limit headers ──────────────────────────────────────────────────────

console.log("\n── Rate-limit headers ─────────────────────────────────────────");

_resetStore();
const USER3 = "user-headers-01";

// Send 10 requests to fill the minute window
sendN(10, USER3, "free");

test("X-RateLimit-Limit = 10 on 429", () => {
  try {
    enforceRateLimit(USER3, "free");
    throw new Error("expected 429");
  } catch (err) {
    if (!(err instanceof McpError)) throw err;
    // Headers are embedded in the message — check via checkRateLimit instead
    const r = checkRateLimit(USER3, "free"); // does not record since limit hit
    if (r.headers["X-RateLimit-Limit"] !== "10") throw new Error(r.headers["X-RateLimit-Limit"]);
  }
});

test("X-RateLimit-Remaining = 0 when limit hit", () => {
  const r = checkRateLimit(USER3, "free");
  if (r.headers["X-RateLimit-Remaining"] !== "0") throw new Error(r.headers["X-RateLimit-Remaining"]);
});

test("Retry-After > 0 when limit hit", () => {
  const r = checkRateLimit(USER3, "free");
  const retryAfter = Number(r.headers["Retry-After"]);
  if (retryAfter <= 0) throw new Error(`Retry-After=${retryAfter}`);
  console.log(`       Retry-After: ${retryAfter}s`);
});

// ─── Hour window ─────────────────────────────────────────────────────────────

console.log("\n── Hour window: 101 requests (100 allowed, 101st blocked) ─────");

_resetStore();
const USER4 = "user-hour-01";
const now = Date.now();

// Inject 100 timestamps spread across the last hour (all within window)
const hourTimestamps = Array.from({ length: 100 }, (_, i) =>
  now - (3_599_000 - i * 35)   // spread 35ms apart, all < 1h ago
);
_setTimestamps(USER4, hourTimestamps);

test("100 existing requests in hour window — 101st blocked", () => {
  const r = checkRateLimit(USER4, "free");
  if (r.allowed) throw new Error("Expected blocked but was allowed");
  if (r.window !== "hour") throw new Error(`window=${r.window}`);
  console.log(`       window=hour, Retry-After=${r.retryAfterSecs}s`);
});

// ─── Day window ──────────────────────────────────────────────────────────────

console.log("\n── Day window: 501 requests (500 allowed, 501st blocked) ──────");

_resetStore();
const USER5 = "user-day-01";
const now2 = Date.now();

// Inject 500 timestamps spread across the last 24h (within day window, outside hour/minute)
const dayTimestamps = Array.from({ length: 500 }, (_, i) =>
  now2 - (86_390_000 - i * 172)  // spread within day, > 1h ago
);
_setTimestamps(USER5, dayTimestamps);

test("500 existing requests in day window — 501st blocked", () => {
  const r = checkRateLimit(USER5, "free");
  if (r.allowed) throw new Error("Expected blocked but was allowed");
  if (r.window !== "day") throw new Error(`window=${r.window}`);
  console.log(`       window=day, Retry-After=${r.retryAfterSecs}s`);
});

// ─── Old timestamps don't count ──────────────────────────────────────────────

console.log("\n── Expired timestamps do not count ────────────────────────────");

_resetStore();
const USER6 = "user-expiry-01";
const old = Date.now() - 65_000; // 65 seconds ago — outside 1-min window

// Inject 10 timestamps that are >60s old (expired for per-minute)
_setTimestamps(USER6, Array(10).fill(old));

test("10 expired per-minute timestamps → new request allowed", () => {
  const r = checkRateLimit(USER6, "free");
  if (!r.allowed) throw new Error("was denied — old timestamps incorrectly counted");
  console.log(`       remaining=${r.remaining}`);
});

// ─── Users are isolated ──────────────────────────────────────────────────────

console.log("\n── Users are isolated ─────────────────────────────────────────");

_resetStore();
sendN(10, "user-a", "free"); // exhaust user-a

test("user-a blocked after 10 requests", () => {
  const r = checkRateLimit("user-a", "free");
  if (r.allowed) throw new Error("Expected blocked");
});
test("user-b unaffected by user-a's usage", () => {
  const r = checkRateLimit("user-b", "free");
  if (!r.allowed) throw new Error("user-b was incorrectly rate limited");
});

// ─── Unknown tier falls back to free ─────────────────────────────────────────

console.log("\n── Unknown tier falls back to free limits ──────────────────────");

_resetStore();
const USER7 = "user-unknown-tier";
sendN(10, USER7, "unknown_tier");

test("unknown tier: 11th request blocked (inherits free 10/min limit)", () => {
  const r = checkRateLimit(USER7, "unknown_tier");
  if (r.allowed) throw new Error("Expected blocked");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n── Results ────────────────────────────────────────────────────`);
console.log(`   Passed: ${passed}  |  Failed: ${failed}  |  Total: ${passed + failed}`);
if (failed > 0) process.exit(1);
