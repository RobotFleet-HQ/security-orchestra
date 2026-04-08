// ─── Daemon SQLite database ───────────────────────────────────────────────────
// Mirrors the callback-style wrapper pattern from billing-api/src/database.ts.

import sqlite3 from "sqlite3";
import { DAEMON_DB_PATH } from "./config.js";

export const db = new sqlite3.Database(DAEMON_DB_PATH, (err) => {
  if (err) {
    console.error("[db] Failed to open daemon.db:", err.message);
    process.exit(1);
  }
  console.log(`[db] Connected to ${DAEMON_DB_PATH}`);
});

export function initDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("PRAGMA journal_mode=WAL");

      db.run(`
        CREATE TABLE IF NOT EXISTS sites (
          id                   TEXT PRIMARY KEY,
          name                 TEXT NOT NULL,
          components           TEXT NOT NULL,
          claimed_tier         TEXT NOT NULL,
          as_built_description TEXT NOT NULL,
          scan_interval_hours  INTEGER NOT NULL DEFAULT 24,
          contact_email        TEXT NOT NULL,
          updated_at           TEXT NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS scan_results (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id  TEXT NOT NULL,
          ran_at   TEXT NOT NULL,
          status   TEXT NOT NULL,
          findings TEXT,
          error    TEXT,
          FOREIGN KEY (site_id) REFERENCES sites(id)
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_scan_site_ran ON scan_results(site_id, ran_at)");

      db.run(`
        CREATE TABLE IF NOT EXISTS cve_records (
          cve_id       TEXT PRIMARY KEY,
          source       TEXT NOT NULL,
          published_at TEXT NOT NULL,
          description  TEXT NOT NULL,
          cvss_score   REAL,
          is_ics_scada INTEGER NOT NULL DEFAULT 0,
          fired_at     TEXT,
          raw_json     TEXT NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS thresholds (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id          TEXT NOT NULL,
          metric           TEXT NOT NULL,
          operator         TEXT NOT NULL,
          value            REAL NOT NULL,
          agent_name       TEXT NOT NULL,
          cooldown_minutes INTEGER NOT NULL DEFAULT 60,
          last_fired_at    TEXT,
          UNIQUE(site_id, metric),
          FOREIGN KEY (site_id) REFERENCES sites(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS threshold_events (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id        TEXT NOT NULL,
          metric         TEXT NOT NULL,
          value          REAL NOT NULL,
          threshold      REAL NOT NULL,
          agent_name     TEXT NOT NULL,
          fired_at       TEXT NOT NULL,
          agent_response TEXT
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_tevents_site_fired ON threshold_events(site_id, fired_at)");

      db.run(`
        CREATE TABLE IF NOT EXISTS digest_log (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          date     TEXT NOT NULL UNIQUE,
          sent_at  TEXT NOT NULL,
          site_ids TEXT NOT NULL
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// ─── Query helpers ────────────────────────────────────────────────────────────

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
