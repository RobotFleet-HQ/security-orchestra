import sqlite3 from "sqlite3";
import * as bcrypt from "bcryptjs";
import path from "path";

const DB_PATH = process.env.KEYS_DB_PATH ?? path.join(__dirname, "..", "keys.db");

export const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to open database:", err.message);
    process.exit(1);
  }
});

// Initialize table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_hash TEXT PRIMARY KEY,
      key_prefix TEXT,
      user_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      created_at TEXT,
      last_used TEXT,
      revoked INTEGER DEFAULT 0,
      expires_at TEXT
    )
  `);
});

const SALT_ROUNDS = 10;

export async function storeApiKey(
  rawKey: string,
  userId: string,
  tier: string,
  expiresAt?: string
): Promise<void> {
  const keyHash = await bcrypt.hash(rawKey, SALT_ROUNDS);
  const keyPrefix = rawKey.substring(0, 16); // sk_live_xxxxxxxx
  const createdAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO api_keys (key_hash, key_prefix, user_id, tier, created_at, last_used, revoked, expires_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`,
      [keyHash, keyPrefix, userId, tier, createdAt, expiresAt ?? null],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export interface ApiKeyRecord {
  key_hash: string;
  key_prefix: string;
  user_id: string;
  tier: string;
  created_at: string;
  last_used: string | null;
  revoked: number;
  expires_at: string | null;
}

export async function findAllKeys(): Promise<ApiKeyRecord[]> {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM api_keys WHERE revoked = 0", [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows as ApiKeyRecord[]);
    });
  });
}

export async function updateLastUsed(keyHash: string): Promise<void> {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE api_keys SET last_used = ? WHERE key_hash = ?",
      [now, keyHash],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}
