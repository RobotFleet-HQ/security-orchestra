import sqlite3 from "sqlite3";
import path from "path";

const DB_PATH = process.env.BILLING_DB_PATH ?? path.join(__dirname, "..", "billing.db");

export const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to open billing database:", err.message);
    process.exit(1);
  }
  console.log("Connected to billing.db");
});

export const TIERS: Record<string, { price_cents: number; credits: number; label: string }> = {
  free:       { price_cents: 0,     credits: 100,    label: "Free" },
  starter:    { price_cents: 2900,  credits: 500,    label: "Starter ($29)" },
  pro:        { price_cents: 9900,  credits: 2000,   label: "Pro ($99)" },
  enterprise: { price_cents: 49900, credits: 10000,  label: "Enterprise ($499)" },
};

export function initDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          tier TEXT NOT NULL DEFAULT 'free',
          created_at TEXT NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          tier TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS credits (
          user_id TEXT PRIMARY KEY,
          balance INTEGER NOT NULL DEFAULT 0,
          total_purchased INTEGER NOT NULL DEFAULT 0,
          total_used INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function dbGet<T>(sql: string, params: unknown[]): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

export function dbAll<T>(sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export function dbRun(sql: string, params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
