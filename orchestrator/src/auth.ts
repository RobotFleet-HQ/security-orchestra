import crypto from "crypto";
import * as bcrypt from "bcryptjs";
import { findAllKeys, updateLastUsed } from "./database.js";

/**
 * Generate a new API key.
 * Format: sk_live_[32-hex-random]_[6-char-checksum]
 */
export function generateApiKey(userId: string, tier: string): string {
  const random = crypto.randomBytes(16).toString("hex"); // 32 hex chars
  const checksum = crypto
    .createHash("sha256")
    .update(`${userId}:${tier}:${random}`)
    .digest("hex")
    .substring(0, 6);
  return `sk_live_${random}_${checksum}`;
}

const API_KEY_REGEX = /^sk_live_[0-9a-f]{32}_[0-9a-f]{6}$/;

export interface ValidationResult {
  valid: boolean;
  userId?: string;
  tier?: string;
  error?: string;
}

/**
 * Validate an API key against stored hashes.
 * Uses bcrypt.compare against every active key (suitable for low-volume use).
 */
export async function validateApiKey(apiKey: string): Promise<ValidationResult> {
  // 1. Format check
  if (!API_KEY_REGEX.test(apiKey)) {
    return { valid: false, error: "Invalid API key format" };
  }

  // 2. Look up all active (non-revoked) keys and bcrypt-compare
  let records;
  try {
    records = await findAllKeys();
  } catch (err) {
    return { valid: false, error: "Database error" };
  }

  for (const record of records) {
    const match = await bcrypt.compare(apiKey, record.key_hash);
    if (!match) continue;

    // 3. Check revoked (already filtered by findAllKeys, but double-check)
    if (record.revoked) {
      return { valid: false, error: "API key has been revoked" };
    }

    // 4. Check expiry
    if (record.expires_at) {
      const expiry = new Date(record.expires_at);
      if (expiry < new Date()) {
        return { valid: false, error: "API key has expired" };
      }
    }

    // 5. Update last_used (fire-and-forget)
    updateLastUsed(record.key_hash).catch(() => {});

    return {
      valid: true,
      userId: record.user_id,
      tier: record.tier,
    };
  }

  return { valid: false, error: "API key not found" };
}
