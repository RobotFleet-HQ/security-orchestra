import sgMail from "@sendgrid/mail";

const FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL ?? "noreply@security-orchestra.com";

function initSg(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY not set");
  sgMail.setApiKey(key);
  console.log(`[email] SendGrid initialised — key prefix: ${key.slice(0, 8)}... from: ${process.env.SENDGRID_FROM_EMAIL ?? "(default)"}`);
}

export async function sendApiKeyEmail(
  to: string,
  apiKey: string,
  tier: string
): Promise<void> {
  initSg();
  console.log(`[email] sendApiKeyEmail → to="${to}" tier="${tier}" keyPrefix="${apiKey.slice(0, 16)}"`);
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  const [response] = await sgMail.send({
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

        <p>Questions? Reply to this email or visit <a href="${baseUrl}">${baseUrl}</a></p>
      </div>
    `,
  });
  console.log(`[email] sendApiKeyEmail → sent OK, statusCode=${response.statusCode}`);
}

export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<void> {
  initSg();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  const verifyUrl = `${baseUrl}/verify?token=${token}`;
  await sgMail.send({
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
      </div>
    `,
  });
}

export async function sendLowCreditWarning(
  to: string,
  balance: number
): Promise<void> {
  initSg();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  await sgMail.send({
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
      </div>
    `,
  });
}

export async function sendCreditPurchaseConfirmation(
  to: string,
  credits: number,
  newBalance: number
): Promise<void> {
  initSg();
  await sgMail.send({
    to,
    from: FROM_EMAIL,
    subject: `${credits} credits added — Security Orchestra`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">${credits} Credits Added!</h2>
        <p>Your new credit balance is <strong>${newBalance} credits</strong>.</p>
        <p>Start running data center analysis tools right away.</p>
      </div>
    `,
  });
}

export async function sendUpgradeConfirmation(
  to: string,
  tier: string,
  credits: number
): Promise<void> {
  initSg();
  await sgMail.send({
    to,
    from: FROM_EMAIL,
    subject: `Plan upgraded to ${tier} — Security Orchestra`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="color:#238636">Plan Upgraded!</h2>
        <p>You're now on the <strong>${tier}</strong> plan.</p>
        <p><strong>${credits} credits</strong> have been added to your account.</p>
        <p>Enjoy expanded access to all data center intelligence tools.</p>
      </div>
    `,
  });
}
