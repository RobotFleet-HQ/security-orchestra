// ─── Daily digest ─────────────────────────────────────────────────────────────
// Runs at DIGEST_CRON (default 06:00 UTC).
// Aggregates overnight scan findings, CVE alerts, and threshold events,
// then emails each site contact and the admin address.
// Idempotent: digest_log table prevents double-sends if the process restarts.

import cron from "node-cron";
import { dbGet, dbAll, dbRun } from "./database.js";
import { sendEmail } from "./email.js";
import { DIGEST_CRON, GMAIL_USER } from "./config.js";
import { SiteConfig, ScanResultRow, CveRow, ThresholdEventRow } from "./types.js";

const SINCE_HOURS = 25; // look back slightly more than 24 h to cover gaps

function sinceIso(): string {
  return new Date(Date.now() - SINCE_HOURS * 60 * 60 * 1000).toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Digest assembly ──────────────────────────────────────────────────────────

async function buildSiteSection(
  site: SiteConfig,
  since: string
): Promise<{ text: string; html: string; hasContent: boolean }> {
  const scans = await dbAll<ScanResultRow>(
    "SELECT * FROM scan_results WHERE site_id = ? AND ran_at >= ? ORDER BY ran_at DESC",
    [site.id, since]
  );

  const events = await dbAll<ThresholdEventRow>(
    "SELECT * FROM threshold_events WHERE site_id = ? AND fired_at >= ? ORDER BY fired_at DESC",
    [site.id, since]
  );

  const hasContent = scans.length > 0 || events.length > 0;
  if (!hasContent) {
    return {
      hasContent: false,
      text:  `\n## ${site.name}\nNo activity in the last 24 hours.\n`,
      html:  `<h3>${site.name}</h3><p style="color:#888">No activity in the last 24 hours.</p>`,
    };
  }

  const textLines: string[] = [`\n## ${site.name}`, ""];
  const htmlParts: string[] = [`<h3 style="color:#1a1a1a;border-bottom:1px solid #ddd;padding-bottom:4px">${site.name}</h3>`];

  if (scans.length > 0) {
    const ok    = scans.filter((s) => s.status === "success").length;
    const fail  = scans.filter((s) => s.status === "error").length;
    textLines.push(`Scans: ${ok} succeeded, ${fail} failed`);
    htmlParts.push(
      `<p><strong>Scans:</strong> ${ok} succeeded` +
      (fail > 0 ? `, <span style="color:#d73a49">${fail} failed</span>` : "") +
      `</p>`
    );

    // Summarise failures
    for (const s of scans.filter((s) => s.status === "error")) {
      textLines.push(`  FAILED at ${s.ran_at}: ${s.error ?? "unknown error"}`);
      htmlParts.push(`<p style="color:#d73a49;font-size:13px">✗ Failed at ${s.ran_at}: ${s.error ?? "unknown error"}</p>`);
    }
  }

  if (events.length > 0) {
    textLines.push(`\nThreshold alerts: ${events.length}`);
    htmlParts.push(`<p><strong>Threshold alerts:</strong> ${events.length}</p><ul>`);
    for (const e of events) {
      const line = `  ${e.metric} = ${e.value} (threshold: ${e.threshold}) → fired ${e.agent_name} at ${e.fired_at}`;
      textLines.push(line);
      htmlParts.push(
        `<li style="font-size:13px">${e.metric} = <strong>${e.value}</strong> ` +
        `(threshold: ${e.threshold}) → <em>${e.agent_name}</em> at ${e.fired_at}</li>`
      );
    }
    htmlParts.push("</ul>");
  }

  return {
    hasContent: true,
    text:       textLines.join("\n"),
    html:       htmlParts.join("\n"),
  };
}

async function sendDigest(sites: SiteConfig[]): Promise<void> {
  const date  = todayDate();
  const since = sinceIso();

  // Idempotency guard
  const already = await dbGet<{ date: string }>(
    "SELECT date FROM digest_log WHERE date = ?", [date]
  );
  if (already) {
    console.log(`[digest] Already sent for ${date} — skipping`);
    return;
  }

  // Global CVE summary
  const newCves = await dbAll<CveRow>(
    "SELECT * FROM cve_records WHERE is_ics_scada = 1 AND published_at >= ? ORDER BY cvss_score DESC NULLS LAST LIMIT 10",
    [since]
  );

  // Build per-site sections
  const siteSections = await Promise.all(sites.map((s) => buildSiteSection(s, since)));

  // Compose email
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const subject   = `Security Orchestra — Daily Digest ${date}`;

  const textParts: string[] = [
    `Security Orchestra Daily Digest — ${dateLabel}`,
    "=".repeat(60),
  ];
  const htmlParts: string[] = [
    `<div style="font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;color:#333">`,
    `<h2 style="color:#238636">Security Orchestra — Daily Digest</h2>`,
    `<p style="color:#888;font-size:13px">${dateLabel}</p>`,
  ];

  // CVE section
  if (newCves.length > 0) {
    textParts.push(`\nNEW ICS/SCADA CVEs (last 25 h): ${newCves.length}`);
    htmlParts.push(`<h3>New ICS/SCADA CVEs (${newCves.length})</h3><ul>`);
    for (const c of newCves) {
      const score = c.cvss_score != null ? ` CVSS ${c.cvss_score}` : "";
      textParts.push(`  ${c.cve_id}${score} — ${c.description.slice(0, 120)}`);
      htmlParts.push(
        `<li><strong>${c.cve_id}</strong>${score} ` +
        `<span style="color:#555;font-size:13px">${c.description.slice(0, 120)}</span></li>`
      );
    }
    htmlParts.push("</ul>");
  } else {
    textParts.push("\nNo new ICS/SCADA CVEs in the last 25 hours.");
    htmlParts.push(`<p style="color:#888">No new ICS/SCADA CVEs in the last 25 hours.</p>`);
  }

  // Site sections
  htmlParts.push("<hr style='margin:24px 0'><h2>Site Reports</h2>");
  textParts.push("\n" + "─".repeat(60) + "\nSITE REPORTS");
  for (const section of siteSections) {
    textParts.push(section.text);
    htmlParts.push(section.html);
  }

  htmlParts.push(`<p style="color:#aaa;font-size:11px;margin-top:32px">Sent by Security Orchestra Daemon</p></div>`);

  const text = textParts.join("\n");
  const html = htmlParts.join("\n");

  // Collect unique recipient emails
  const recipients = new Set<string>([GMAIL_USER]);
  for (const site of sites) {
    if (site.contact_email) recipients.add(site.contact_email);
  }

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, text, html });
      sent++;
    } catch (err) {
      console.error(`[digest] Failed to send to ${to}:`, (err as Error).message);
    }
  }

  // Log successful send
  await dbRun(
    "INSERT OR IGNORE INTO digest_log (date, sent_at, site_ids) VALUES (?, ?, ?)",
    [date, new Date().toISOString(), JSON.stringify(sites.map((s) => s.id))]
  );

  console.log(`[digest] Sent ${date} digest to ${sent}/${recipients.size} recipient(s)`);
}

export function startDailyDigest(sites: SiteConfig[]): void {
  cron.schedule(DIGEST_CRON, () => {
    sendDigest(sites).catch((err) =>
      console.error("[digest] Unhandled error:", (err as Error).message)
    );
  });
  console.log(`[digest] Scheduled — cron: "${DIGEST_CRON}"`);
}
