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
  free:       { price_cents: 0,     credits: 100,   label: "Free" },
  starter:    { price_cents: 2900,  credits: 500,   label: "Starter ($29)" },
  pro:        { price_cents: 9900,  credits: 2000,  label: "Pro ($99)" },
  enterprise: { price_cents: 49900, credits: 10000, label: "Enterprise ($499)" },
};

export function initDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          tier TEXT NOT NULL DEFAULT 'free',
          created_at TEXT NOT NULL,
          ip_address TEXT,
          verification_token TEXT,
          verification_status TEXT NOT NULL DEFAULT 'verified'
        )
      `);

      // Migration: add columns to existing databases (ignore "duplicate column" errors)
      for (const col of [
        "ip_address TEXT",
        "verification_token TEXT",
        "verification_status TEXT NOT NULL DEFAULT 'verified'",
      ]) {
        db.run(`ALTER TABLE users ADD COLUMN ${col}`, () => { /* ignore errors */ });
      }

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
          last_low_credit_warning_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Migration: add column to existing credits tables
      db.run("ALTER TABLE credits ADD COLUMN last_low_credit_warning_at TEXT", () => { /* ignore if already exists */ });

      db.run(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          issue_type TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unread',
          created_at TEXT NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS failed_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          email_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_attempt_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 1,
          last_error TEXT NOT NULL
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export function logFailedDelivery(email: string, emailType: string, error: string): Promise<void> {
  const now = new Date().toISOString();
  return dbRun(
    "INSERT INTO failed_deliveries (email, email_type, created_at, last_attempt_at, attempts, last_error) VALUES (?, ?, ?, ?, 1, ?)",
    [email, emailType, now, now, error]
  );
}

export function getFailedDeliveries(): Promise<Array<{
  id: number; email: string; email_type: string;
  created_at: string; last_attempt_at: string; attempts: number; last_error: string;
}>> {
  return dbAll<{
    id: number; email: string; email_type: string;
    created_at: string; last_attempt_at: string; attempts: number; last_error: string;
  }>("SELECT * FROM failed_deliveries ORDER BY created_at DESC LIMIT 200", []);
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

export function dbRunChanges(sql: string, params: unknown[]): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: { changes: number }, err: Error | null) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}
