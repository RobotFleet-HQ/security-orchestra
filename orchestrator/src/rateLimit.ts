import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// ─── Tier limits ──────────────────────────────────────────────────────────────

export interface TierLimits {
  perMinute: number;
  perHour:   number;
  perDay:    number;
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free:       { perMinute: 10,   perHour: 100,    perDay: 500     },
  starter:    { perMinute: 60,   perHour: 1000,   perDay: 5000    },
  pro:        { perMinute: 300,  perHour: 5000,   perDay: 50000   },
  enterprise: { perMinute: 1000, perHour: 20000,  perDay: 200000  },
};

const MINUTE_MS = 60_000;
const HOUR_MS   = 3_600_000;
const DAY_MS    = 86_400_000;

// ─── Sliding-window store ─────────────────────────────────────────────────────
// Each entry holds a sorted array of timestamps (epoch ms) for a user.
// Old timestamps are pruned on every check so memory stays bounded.

const store = new Map<string, number[]>();

/** Remove timestamps older than `windowMs` from the front of the array. */
function prune(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) i++;
  return i === 0 ? timestamps : timestamps.slice(i);
}

// ─── Periodic cleanup ─────────────────────────────────────────────────────────
// Remove users whose last request was >24 h ago so the Map doesn't grow forever.

const CLEANUP_INTERVAL_MS = HOUR_MS;

function runCleanup() {
  const cutoff = Date.now() - DAY_MS;
  for (const [userId, timestamps] of store) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
      store.delete(userId);
    }
  }
}

// Use unref() so this timer doesn't keep the Node process alive in tests.
const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed:          boolean;
  window:           "minute" | "hour" | "day";
  limit:            number;
  remaining:        number;
  /** Seconds until the oldest request in the exceeded window expires. */
  retryAfterSecs:   number;
  /** Headers to attach to the MCP error response. */
  headers: {
    "X-RateLimit-Limit":     string;
    "X-RateLimit-Remaining": string;
    "Retry-After":           string;
  };
}

/**
 * Check and record a request for `userId` against their tier's limits.
 * If all windows are within limit, records the timestamp and returns allowed=true.
 * If any window is exceeded, returns allowed=false WITHOUT recording (caller may retry).
 */
export function checkRateLimit(userId: string, tier: string): RateLimitResult {
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
  const now = Date.now();

  // Initialise or fetch existing timestamps
  let timestamps = store.get(userId) ?? [];

  // Prune to the largest window we care about (day)
  timestamps = prune(timestamps, DAY_MS, now);

  // Count requests in each window (timestamps is sorted ascending)
  const countInWindow = (windowMs: number) => {
    const cutoff = now - windowMs;
    // Binary-search-style count from the right
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] > cutoff) count++;
      else break;
    }
    return count;
  };

  const perMinCount = countInWindow(MINUTE_MS);
  const perHourCount = countInWindow(HOUR_MS);
  const perDayCount = countInWindow(DAY_MS);

  // Check windows from tightest to broadest
  const checks: Array<{ count: number; limit: number; windowMs: number; label: "minute" | "hour" | "day" }> = [
    { count: perMinCount,  limit: limits.perMinute, windowMs: MINUTE_MS, label: "minute" },
    { count: perHourCount, limit: limits.perHour,   windowMs: HOUR_MS,   label: "hour"   },
    { count: perDayCount,  limit: limits.perDay,    windowMs: DAY_MS,    label: "day"    },
  ];

  for (const { count, limit, windowMs, label } of checks) {
    if (count >= limit) {
      // Find the oldest timestamp in this window — that's when a slot opens
      const cutoff = now - windowMs;
      const oldestInWindow = timestamps.find(t => t > cutoff) ?? now;
      const retryAfterMs = oldestInWindow + windowMs - now;
      const retryAfterSecs = Math.max(1, Math.ceil(retryAfterMs / 1000));

      return {
        allowed: false,
        window: label,
        limit,
        remaining: 0,
        retryAfterSecs,
        headers: {
          "X-RateLimit-Limit":     String(limit),
          "X-RateLimit-Remaining": "0",
          "Retry-After":           String(retryAfterSecs),
        },
      };
    }
  }

  // All windows OK — record this request
  timestamps.push(now);
  store.set(userId, timestamps);

  // Report the tightest window's remaining capacity
  const minRemaining = Math.min(
    limits.perMinute - perMinCount - 1,
    limits.perHour   - perHourCount - 1,
    limits.perDay    - perDayCount  - 1,
  );

  return {
    allowed: true,
    window: "minute",
    limit: limits.perMinute,
    remaining: minRemaining,
    retryAfterSecs: 0,
    headers: {
      "X-RateLimit-Limit":     String(limits.perMinute),
      "X-RateLimit-Remaining": String(minRemaining),
      "Retry-After":           "0",
    },
  };
}

/**
 * Enforce rate limit. Throws McpError(429) if exceeded.
 * Returns the result (including headers) so callers can log remaining capacity.
 */
export function enforceRateLimit(userId: string, tier: string): RateLimitResult {
  const result = checkRateLimit(userId, tier);
  if (!result.allowed) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `429: Rate limit exceeded (${result.window} window: ${result.limit} req/${result.window}). ` +
      `Retry after ${result.retryAfterSecs}s. ` +
      `Upgrade your tier for higher limits.`
    );
  }
  return result;
}

/** Exposed for tests — clears all stored timestamps. */
export function _resetStore() {
  store.clear();
}

/** Exposed for tests — directly inject timestamps for a user. */
export function _setTimestamps(userId: string, timestamps: number[]) {
  store.set(userId, [...timestamps]);
}
