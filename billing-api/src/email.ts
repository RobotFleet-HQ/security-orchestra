// ─── Email transport ──────────────────────────────────────────────────────────
// Primary:  SendGrid API (@sendgrid/mail) — used when SENDGRID_API_KEY is set.
//           When the key is present, SendGrid is used exclusively (no Gmail
//           fallback). Gmail App Passwords get revoked by Google unpredictably,
//           making SendGrid the more reliable primary transport.
// Fallback: Gmail SMTP via nodemailer (App Password auth) — used only when
//           SENDGRID_API_KEY is absent. Google DKIM + SPF alignment is better
//           for a gmail.com FROM address, but token revocation makes it
//           unsuitable as primary.
//
// To enable SendGrid (recommended):
//   Set SENDGRID_API_KEY in your environment. Optionally set SENDGRID_FROM_EMAIL.
//
// To use Gmail SMTP as fallback (when SENDGRID_API_KEY is not set):
//   1. Enable 2-Step Verification on the sending Gmail account.
//   2. Generate an App Password: myaccount.google.com/apppasswords
//   3. Set GMAIL_APP_PASSWORD in your environment (and GMAIL_USER if different
//      from the default below).

import nodemailer from "nodemailer";
import type { Transporter, SendMailOptions } from "nodemailer";
import sgMail from "@sendgrid/mail";
import { logFailedDelivery } from "./database.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const GMAIL_USER = process.env.GMAIL_USER ?? "contact.securityorchestra@gmail.com";
const FROM_EMAIL  = process.env.SENDGRID_FROM_EMAIL ?? GMAIL_USER;
const REPLY_TO    = GMAIL_USER;

// ─── Transport factory ────────────────────────────────────────────────────────

function getGmailTransport(): Transporter {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error("GMAIL_APP_PASSWORD not set");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass },
  });
}

// ─── SendGrid helper ──────────────────────────────────────────────────────────

async function sendViaSendGrid(message: SendMailOptions): Promise<void> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY not set");
  sgMail.setApiKey(key);
  const { headers, ...rest } = message;
  const sgHeaders = headers
    ? Object.fromEntries(
        Object.entries(headers as Record<string, string>).map(([k, v]) => [k, String(v)])
      )
    : undefined;
  await sgMail.send({ ...rest, headers: sgHeaders } as Parameters<typeof sgMail.send>[0]);
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────
// Strategy:
//   - If SENDGRID_API_KEY is set, use SendGrid exclusively (primary transport).
//     Retries are for transient errors (5xx, network resets) only.
//   - If SENDGRID_API_KEY is absent, fall back to Gmail SMTP.
//   - On Gmail auth failure (535), no point retrying — log and exhaust.
//   - On final failure, persist to failed_deliveries — no email is silently lost.

function isAuthError(err: Error): boolean {
  return err.message.includes("535") || err.message.includes("BadCredentials") ||
         err.message.includes("Username and Password not accepted") ||
         err.message.includes("Invalid login");
}

async function sendWithRetry(
  message: SendMailOptions,
  emailType: string,
  to: string
): Promise<void> {
  const retryDelaysMs = [1000, 2000];
  let lastError: Error = new Error("unknown");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (process.env.SENDGRID_API_KEY) {
        // Primary: SendGrid API — reliable, no token revocation issues
        await sendViaSendGrid(message);
      } else {
        // Fallback: Gmail SMTP (when SENDGRID_API_KEY is not configured)
        const transport = getGmailTransport();
        await transport.sendMail(message);
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Gmail auth errors won't recover on retry — stop immediately
      if (!process.env.SENDGRID_API_KEY && isAuthError(lastError)) {
        console.warn(`[email] Gmail auth failed (no recovery): ${lastError.message.split("\n")[0]}`);
        break;
      }
      console.warn(`[email] ${emailType} to ${to} failed (attempt ${attempt + 1}/3): ${lastError.message.split("\n")[0]}`);
      if (attempt < retryDelaysMs.length) {
        await new Promise<void>(r => setTimeout(r, retryDelaysMs[attempt]));
      }
    }
  }

  try {
    await logFailedDelivery(to, emailType, lastError.message);
    console.error(`[email] ${emailType} to ${to} — all retries exhausted, logged to failed_deliveries`);
  } catch (dbErr) {
    console.error(`[email] failed_deliveries insert also failed: ${(dbErr as Error).message}`);
  }

  throw lastError;
}

// ─── Headers helpers ──────────────────────────────────────────────────────────

function unsubscribeHeaders(to: string, baseUrl: string): Record<string, string> {
  const mailtoUrl = `mailto:${REPLY_TO}?subject=unsubscribe&body=${encodeURIComponent(to)}`;
  const httpUrl   = `${baseUrl}/unsubscribe?email=${encodeURIComponent(to)}`;
  return {
    "List-Unsubscribe":      `<${mailtoUrl}>, <${httpUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Precedence":            "bulk",
  };
}

function htmlFooter(to: string, baseUrl: string): string {
  const unsubUrl = `${baseUrl}/unsubscribe?email=${encodeURIComponent(to)}`;
  return `
    <div style="border-top:1px solid #e0e0e0;margin-top:32px;padding-top:16px;font-size:11px;color:#999;line-height:1.6">
      <p>
        Security Orchestra &nbsp;&bull;&nbsp; P.O. Box [Placeholder]<br>
        <a href="mailto:${REPLY_TO}" style="color:#999">${REPLY_TO}</a>
      </p>
      <p style="margin-top:8px">
        You received this email because you signed up for Security Orchestra.<br>
        <a href="${unsubUrl}" style="color:#999">Unsubscribe</a> &nbsp;&bull;&nbsp;
        <a href="${baseUrl}/privacy.html" style="color:#999">Privacy Policy</a> &nbsp;&bull;&nbsp;
        <a href="${baseUrl}/terms.html" style="color:#999">Terms of Service</a>
      </p>
    </div>
  `;
}

function textFooter(to: string, baseUrl: string): string {
  return [
    "",
    "---",
    "Security Orchestra",
    `Support: ${REPLY_TO}`,
    `Unsubscribe: ${baseUrl}/unsubscribe?email=${encodeURIComponent(to)}`,
    `Privacy: ${baseUrl}/privacy.html`,
  ].join("\n");
}

export function logEmailTransport(): void {
  if (process.env.SENDGRID_API_KEY) {
    console.log(`[email] Transport: SendGrid (primary), from: ${FROM_EMAIL}`);
  } else {
    console.log(`[email] Transport: Gmail SMTP (fallback), from: ${FROM_EMAIL}`);
  }
}

export async function verifySmtpOnBoot(): Promise<void> {
  // Only verify Gmail SMTP when it is actually the active transport
  if (process.env.SENDGRID_API_KEY || !process.env.GMAIL_APP_PASSWORD) return;
  try {
    const transport = getGmailTransport();
    await transport.verify();
    console.log("[email] SMTP credentials verified OK");
  } catch {
    console.error(
      "[email] WARNING: SMTP credentials invalid — new signup emails will not deliver. " +
      "Set SENDGRID_API_KEY (preferred) or update GMAIL_APP_PASSWORD in Render env vars."
    );
  }
}

// ─── Email functions ──────────────────────────────────────────────────────────

export async function sendApiKeyEmail(
  to: string,
  apiKey: string,
  tier: string
): Promise<void> {
  console.log(`[email] sendApiKeyEmail → to="${to}" tier="${tier}" keyPrefix="${apiKey.slice(0, 16)}"`);
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";

  const text = [
    "Welcome to Security Orchestra!",
    "",
    `Your API key for the ${tier} plan:`,
    apiKey,
    "",
    "Keep this key safe — it will not be shown again.",
    "",
    "Quick Setup (Claude Desktop)",
    "Add to your claude_desktop_config.json:",
    "",
    JSON.stringify({
      mcpServers: {
        "security-orchestra": {
          url: "https://security-orchestra-orchestrator.onrender.com/sse",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    }, null, 2),
    "",
    "You have access to 50+ data center design tools.",
    "",
    "Credit policy: Credits reset on the 1st of each month.",
    "Unused credits do not roll over. No refunds on unused credits.",
    `Full terms: ${baseUrl}/terms.html`,
    "",
    `Questions? Email ${REPLY_TO}`,
    textFooter(to, baseUrl),
  ].join("\n");

  await sendWithRetry({
    from:    `Security Orchestra <${FROM_EMAIL}>`,
    to,
    replyTo: REPLY_TO,
    subject: "Your Security Orchestra API Key",
    text,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">Welcome to Security Orchestra!</h2>
        <p>Your API key for the <strong>${tier}</strong> plan is ready:</p>
        <pre style="background:#f6f8fa;padding:16px;border-radius:6px;font-family:monospace;word-break:break-all;border:1px solid #d0d7de">${apiKey}</pre>
        <p><strong>Keep this key safe — it will not be shown again.</strong></p>

        <h3>Quick Setup (Claude Desktop)</h3>
        <p>Add to your <code>claude_desktop_config.json</code>:</p>
        <pre style="background:#f6f8fa;padding:16px;border-radius:6px;font-family:monospace;font-size:13px;border:1px solid #d0d7de">{
  "mcpServers": {
    "security-orchestra": {
      "url": "https://security-orchestra-orchestrator.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer ${apiKey}"
      }
    }
  }
}</pre>

        <h3>Available Tools</h3>
        <p>You have access to 50+ data center design tools including generator sizing,
        network topology, HVAC design, site scoring, compliance checking, and more.</p>

        <p style="background:#fff8e1;border:1px solid #f0c040;border-radius:6px;padding:12px 16px;font-size:13px;color:#555">
          <strong>Credit policy:</strong> Credits reset on the 1st of each month.
          Unused credits do not roll over. No refunds on unused credits.
          See our <a href="${baseUrl}/terms.html">Terms of Service</a> for full details.
        </p>
        <p>Questions? Email <a href="mailto:${REPLY_TO}">${REPLY_TO}</a></p>
        ${htmlFooter(to, baseUrl)}
      </div>
    `,
    headers: unsubscribeHeaders(to, baseUrl),
  }, "api_key", to);
  console.log(`[email] sendApiKeyEmail → sent OK`);
}

export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<void> {
  const baseUrl   = process.env.BASE_URL ?? "http://localhost:3001";
  const verifyUrl = `${baseUrl}/verify?token=${token}`;

  const text = [
    "Verify your Security Orchestra account",
    "",
    "Click the link below to activate your account and receive your API key:",
    verifyUrl,
    "",
    "This link expires in 24 hours.",
    textFooter(to, baseUrl),
  ].join("\n");

  await sendWithRetry({
    from:    `Security Orchestra <${FROM_EMAIL}>`,
    to,
    replyTo: REPLY_TO,
    subject: "Verify your Security Orchestra account",
    text,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2>Verify your email</h2>
        <p>Click below to activate your account and receive your API key:</p>
        <p style="margin:24px 0">
          <a href="${verifyUrl}" style="background:#238636;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
            Verify Email and Get API Key
          </a>
        </p>
        <p style="color:#666;font-size:13px">Or copy this link:<br><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p style="color:#666;font-size:13px">This link expires in 24 hours.</p>
        ${htmlFooter(to, baseUrl)}
      </div>
    `,
    headers: unsubscribeHeaders(to, baseUrl),
  }, "verification", to);
}

export async function sendLowCreditWarning(
  to: string,
  balance: number
): Promise<void> {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";

  const text = [
    "Your Security Orchestra credit balance is running low",
    "",
    `Your account has ${balance} credits remaining.`,
    "",
    "Top up to keep running analyses:",
    `  100 credits — $10: ${baseUrl}/credits/buy?pack=100`,
    `  250 credits — $20: ${baseUrl}/credits/buy?pack=250`,
    `  500 credits — $35: ${baseUrl}/credits/buy?pack=500`,
    "",
    `Upgrade your plan: ${baseUrl}/upgrade`,
    textFooter(to, baseUrl),
  ].join("\n");

  await sendWithRetry({
    from:    `Security Orchestra <${FROM_EMAIL}>`,
    to,
    replyTo: REPLY_TO,
    subject: "Your Security Orchestra credit balance is running low",
    text,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#d29922">Credit balance running low</h2>
        <p>Your Security Orchestra account has only <strong>${balance} credits</strong> remaining.</p>
        <p>Top up to keep running analyses:</p>
        <ul>
          <li><a href="${baseUrl}/credits/buy?pack=100">100 credits — $10</a></li>
          <li><a href="${baseUrl}/credits/buy?pack=250">250 credits — $20</a></li>
          <li><a href="${baseUrl}/credits/buy?pack=500">500 credits — $35</a></li>
        </ul>
        <p>Or <a href="${baseUrl}/upgrade">upgrade your plan</a> for a monthly credit refill.</p>
        ${htmlFooter(to, baseUrl)}
      </div>
    `,
    headers: unsubscribeHeaders(to, baseUrl),
  }, "low_credit_warning", to);
}

export async function sendCreditPurchaseConfirmation(
  to: string,
  credits: number,
  newBalance: number
): Promise<void> {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";

  const text = [
    `${credits} credits added to your Security Orchestra account`,
    "",
    `Your new credit balance: ${newBalance} credits`,
    "",
    "You can start running data center analysis tools right away.",
    textFooter(to, baseUrl),
  ].join("\n");

  await sendWithRetry({
    from:    `Security Orchestra <${FROM_EMAIL}>`,
    to,
    replyTo: REPLY_TO,
    subject: `${credits} credits added to your account`,
    text,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">${credits} Credits Added</h2>
        <p>Your new credit balance is <strong>${newBalance} credits</strong>.</p>
        <p>Start running data center analysis tools right away.</p>
        ${htmlFooter(to, baseUrl)}
      </div>
    `,
    headers: unsubscribeHeaders(to, baseUrl),
  }, "credit_purchase_confirmation", to);
}

export async function sendSignupNotification(
  customerEmail: string,
  tier: string,
  credits: number,
  timestamp: string
): Promise<void> {
  const text = [
    `New signup: ${customerEmail}`,
    `Tier:      ${tier}`,
    `Credits:   ${credits}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");

  await sendWithRetry({
    from:    `Security Orchestra <${FROM_EMAIL}>`,
    to:      REPLY_TO,
    replyTo: REPLY_TO,
    subject: `New signup: ${tier} — ${customerEmail}`,
    text,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2>New Signup</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;font-weight:600">Email</td><td style="padding:8px">${customerEmail}</td></tr>
          <tr><td style="padding:8px;font-weight:600">Tier</td><td style="padding:8px">${tier}</td></tr>
          <tr><td style="padding:8px;font-weight:600">Timestamp</td><td style="padding:8px">${timestamp}</td></tr>
          <tr><td style="padding:8px;font-weight:600">Credits Allocated</td><td style="padding:8px">${credits}</td></tr>
        </table>
      </div>
    `,
  }, "signup_notification", REPLY_TO);
  console.log(`[email] sendSignupNotification → sent for ${customerEmail} (${tier})`);
}

export async function sendUpgradeConfirmation(
  to: string,
  tier: string,
  credits: number
): Promise<void> {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";

  const text = [
    `Your Security Orchestra plan has been upgraded to ${tier}`,
    "",
    `${credits} credits have been added to your account.`,
    "",
    "You now have expanded access to all data center intelligence tools.",
    "",
    "Note: Your credits reset on the 1st of each month. Unused credits do not roll over.",
    `Full terms: ${baseUrl}/terms.html`,
    textFooter(to, baseUrl),
  ].join("\n");

  await sendWithRetry({
    from:    `Security Orchestra <${FROM_EMAIL}>`,
    to,
    replyTo: REPLY_TO,
    subject: `Your plan has been upgraded to ${tier}`,
    text,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">Plan Upgraded</h2>
        <p>You are now on the <strong>${tier}</strong> plan.</p>
        <p><strong>${credits} credits</strong> have been added to your account.</p>
        <p>Enjoy expanded access to all data center intelligence tools.</p>
        <p style="background:#fff8e1;border:1px solid #f0c040;border-radius:6px;padding:12px 16px;font-size:13px;color:#555">
          Your credits reset on the 1st of each month. Unused credits do not roll over.
          Review our <a href="${baseUrl}/terms.html">Terms of Service</a> for full details.
        </p>
        ${htmlFooter(to, baseUrl)}
      </div>
    `,
    headers: unsubscribeHeaders(to, baseUrl),
  }, "upgrade_confirmation", to);
}
