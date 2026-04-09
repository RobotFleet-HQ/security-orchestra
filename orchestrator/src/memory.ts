/**
 * memory.ts — In-process session context store.
 *
 * Keyed by `userId::sessionId`. Each session holds up to MAX_ENTRIES_PER_SESSION
 * entries (FIFO — oldest dropped when the cap is exceeded). Sessions idle for
 * longer than SESSION_TTL_MS are evicted by pruneExpiredSessions().
 *
 * Deliberate design choices:
 *   • In-process Map only — no DB writes. Sub-millisecond read/write latency.
 *   • Ephemeral — sessions do not survive process restarts (expected for
 *     compound chains that complete within a single user session).
 *   • Render single-instance deployment makes distributed state unnecessary.
 */

export interface MemoryEntry {
  agent_id:  string;   // workflow name, e.g. "generator_sizing"
  task_id:   string;   // a2a.task_id from the CanonicalResponse
  timestamp: string;   // ISO 8601
  result:    unknown;  // CanonicalResponse.result payload (not the full envelope)
}

export interface SessionMemory {
  session_id:       string;
  user_id:          string;
  created_at:       string;   // ISO 8601 — when first entry was appended
  last_accessed_at: string;   // ISO 8601 — updated on every read or write
  entries:          MemoryEntry[];
}

export const MAX_ENTRIES_PER_SESSION = 50;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour idle → evict

const _store = new Map<string, SessionMemory>();

function storeKey(userId: string, sessionId: string): string {
  return `${userId}::${sessionId}`;
}

/**
 * Return the session for this (userId, sessionId) pair, updating
 * last_accessed_at. Returns null if the session does not exist.
 */
export function getSession(userId: string, sessionId: string): SessionMemory | null {
  const s = _store.get(storeKey(userId, sessionId));
  if (!s) return null;
  s.last_accessed_at = new Date().toISOString();
  return s;
}

/**
 * Append an entry to the session, creating it on first use.
 * Enforces MAX_ENTRIES_PER_SESSION by dropping the oldest entry (FIFO).
 * Returns the updated session.
 */
export function appendEntry(
  userId:    string,
  sessionId: string,
  entry:     MemoryEntry,
): SessionMemory {
  const k   = storeKey(userId, sessionId);
  const now = new Date().toISOString();
  let s = _store.get(k);
  if (!s) {
    s = {
      session_id:       sessionId,
      user_id:          userId,
      created_at:       now,
      last_accessed_at: now,
      entries:          [],
    };
    _store.set(k, s);
  }
  s.last_accessed_at = now;
  s.entries.push(entry);
  if (s.entries.length > MAX_ENTRIES_PER_SESSION) {
    s.entries.shift(); // drop oldest (FIFO)
  }
  return s;
}

/**
 * Delete a session. Returns true if the session existed and was removed.
 */
export function clearSession(userId: string, sessionId: string): boolean {
  return _store.delete(storeKey(userId, sessionId));
}

/**
 * Evict sessions that have been idle longer than SESSION_TTL_MS.
 * Returns the number of sessions pruned.
 */
export function pruneExpiredSessions(): number {
  const cutoff = Date.now() - SESSION_TTL_MS;
  let pruned = 0;
  for (const [k, s] of _store) {
    if (new Date(s.last_accessed_at).getTime() < cutoff) {
      _store.delete(k);
      pruned++;
    }
  }
  return pruned;
}

/** Aggregate stats for the health / admin endpoint. */
export function getSessionStats(): { total_sessions: number; total_entries: number } {
  let total_entries = 0;
  for (const s of _store.values()) total_entries += s.entries.length;
  return { total_sessions: _store.size, total_entries };
}
