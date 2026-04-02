import sgMail from "@sendgrid/mail";
import { logFailedDelivery } from "./database.js";

const FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL ?? "noreply@security-orchestra.com";

function initSg(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY not set");
  sgMail.setApiKey(key);
  console.log(`[email] SendGrid initialised — key prefix: ${key.slice(0, 8)}... from: ${process.env.SENDGRID_FROM_EMAIL ?? "(default)"}`);
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────
// Attempts to send up to 3 times with exponential backoff (1s, 2s).
// On final failure, logs to failed_deliveries table before rethrowing.

async function sendWithRetry(
  message: Parameters<typeof sgMail.send>[0],
  emailType: string,
  to: string
): Promise<void> {
  const retryDelaysMs = [1000, 2000];
  let lastError: Error = new Error("unknown");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sgMail.send(message);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[email] ${emailType} to ${to} failed (attempt ${attempt + 1}/3): ${lastError.message}`);
      if (attempt < retryDelaysMs.length) {
        await new Promise<void>(r => setTimeout(r, retryDelaysMs[attempt]));
      }
    }
  }

  // All 3 attempts exhausted — persist to failed_deliveries for manual retry
  try {
    await logFailedDelivery(to, emailType, lastError.message);
    console.error(`[email] ${emailType} to ${to} — all retries exhausted, logged to failed_deliveries`);
  } catch (dbErr) {
    console.error(`[email] failed_deliveries insert also failed: ${(dbErr as Error).message}`);
  }

  throw lastError;
}

function canSpamFooter(to: string, baseUrl: string): string {
  const unsubscribeUrl = `mailto:contact.securityorchestra@gmail.com?subject=Unsubscribe&body=Please unsubscribe ${encodeURIComponent(to)} from Security Orchestra emails.`;
  return `
    <div style="border-top:1px solid #e0e0e0;margin-top:32px;padding-top:16px;font-size:11px;color:#999;line-height:1.6">
      <p>
        Security Orchestra &nbsp;&bull;&nbsp; P.O. Box [Placeholder]<br>
        <a href="mailto:contact.securityorchestra@gmail.com" style="color:#999">contact.securityorchestra@gmail.com</a>
      </p>
      <p style="margin-top:8px">
        You received this email because you signed up for Security Orchestra.<br>
        <a href="${unsubscribeUrl}" style="color:#999">Unsubscribe</a> &nbsp;&bull;&nbsp;
        <a href="${baseUrl}/privacy.html" style="color:#999">Privacy Policy</a> &nbsp;&bull;&nbsp;
        <a href="${baseUrl}/terms.html" style="color:#999">Terms of Service</a>
      </p>
    </div>
  `;
}

export async function sendApiKeyEmail(
  to: string,
  apiKey: string,
  tier: string
): Promise<void> {
  initSg();
  console.log(`[email] sendApiKeyEmail → to="${to}" tier="${tier}" keyPrefix="${apiKey.slice(0, 16)}"`);
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  await sendWithRetry({
    to,
    from: FROM_EMAIL,
    subject: "Your Security Orchestra API Key",
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">Welcome to Security Orchestra!</h2>
        <p>Your API key for the <strong>${tier}</strong> plan is ready:</p>
        <pre style="background:#f6f8fa;padding:16px;border-radius:6px;font-family:monospace;word-break:break-all;border:1px solid #d0d7de">${apiKey}</pre>
        <p><strong>Keep this key safe — it won't be shown again.</strong></p>

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
          <strong>Credit policy:</strong> Credits reset on the 1st of each month. Unused credits do not roll over. No refunds on unused credits.
          See our <a href="${baseUrl}/terms.html">Terms of Service</a> for full details.
        </p>
        <p>Questions? Email <a href="mailto:contact.securityorchestra@gmail.com">contact.securityorchestra@gmail.com</a></p>
        ${canSpamFooter(to, baseUrl)}
      </div>
    `,
  }, "api_key", to);
  console.log(`[email] sendApiKeyEmail → sent OK`);
}

export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<void> {
  initSg();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  const verifyUrl = `${baseUrl}/verify?token=${token}`;
  await sendWithRetry({
    to,
    from: FROM_EMAIL,
    subject: "Verify your Security Orchestra account",
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2>Verify your email</h2>
        <p>Click below to activate your account and receive your API key:</p>
        <p style="margin:24px 0">
          <a href="${verifyUrl}" style="background:#238636;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
            Verify Email &amp; Get API Key
          </a>
        </p>
        <p style="color:#666;font-size:13px">Or copy this link:<br><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p style="color:#666;font-size:13px">This link expires in 24 hours.</p>
        ${canSpamFooter(to, baseUrl)}
      </div>
    `,
  }, "verification", to);
}

export async function sendLowCreditWarning(
  to: string,
  balance: number
): Promise<void> {
  initSg();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  await sendWithRetry({
    to,
    from: FROM_EMAIL,
    subject: "Low Credit Warning — Security Orchestra",
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#d29922">Low Credit Warning</h2>
        <p>Your Security Orchestra account has only <strong>${balance} credits</strong> remaining.</p>
        <p>Top up to keep running analyses:</p>
        <ul>
          <li><a href="${baseUrl}/credits/buy?pack=100">100 credits — $10</a></li>
          <li><a href="${baseUrl}/credits/buy?pack=250">250 credits — $20</a></li>
          <li><a href="${baseUrl}/credits/buy?pack=500">500 credits — $35</a></li>
        </ul>
        <p>Or <a href="${baseUrl}/upgrade">upgrade your plan</a> for a monthly credit refill.</p>
        ${canSpamFooter(to, baseUrl)}
      </div>
    `,
  }, "low_credit_warning", to);
}

export async function sendCreditPurchaseConfirmation(
  to: string,
  credits: number,
  newBalance: number
): Promise<void> {
  initSg();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  await sendWithRetry({
    to,
    from: FROM_EMAIL,
    subject: `${credits} credits added — Security Orchestra`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">${credits} Credits Added!</h2>
        <p>Your new credit balance is <strong>${newBalance} credits</strong>.</p>
        <p>Start running data center analysis tools right away.</p>
        ${canSpamFooter(to, baseUrl)}
      </div>
    `,
  }, "credit_purchase_confirmation", to);
}

export async function sendSignupNotification(
  customerEmail: string,
  tier: string,
  credits: number,
  timestamp: string
): Promise<void> {
  initSg();
  const notifyTo = "contact.securityorchestra@gmail.com";
  await sendWithRetry({
    to: notifyTo,
    from: FROM_EMAIL,
    subject: `New Signup - ${tier} - ${customerEmail}`,
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
  }, "signup_notification", notifyTo);
  console.log(`[email] sendSignupNotification → sent for ${customerEmail} (${tier})`);
}

export async function sendUpgradeConfirmation(
  to: string,
  tier: string,
  credits: number
): Promise<void> {
  initSg();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  await sendWithRetry({
    to,
    from: FROM_EMAIL,
    subject: `Plan upgraded to ${tier} — Security Orchestra`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">Plan Upgraded!</h2>
        <p>You're now on the <strong>${tier}</strong> plan.</p>
        <p><strong>${credits} credits</strong> have been added to your account.</p>
        <p>Enjoy expanded access to all data center intelligence tools.</p>
        <p style="background:#fff8e1;border:1px solid #f0c040;border-radius:6px;padding:12px 16px;font-size:13px;color:#555">
          Your credits will reset on the 1st of each month. Unused credits do not roll over.
          Review our <a href="${baseUrl}/terms.html">Terms of Service</a> for full details.
        </p>
        ${canSpamFooter(to, baseUrl)}
      </div>
    `,
  }, "upgrade_confirmation", to);
}
