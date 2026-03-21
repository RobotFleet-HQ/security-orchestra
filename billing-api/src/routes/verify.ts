import { Router, Request, Response } from "express";
import { dbGet, dbRun, TIERS } from "../database.js";
import { sendApiKeyEmail, sendSignupNotification, sendVerificationEmail } from "../email.js";
import { provisionApiKey } from "../provisionKey.js";

const router = Router();

interface UserRow {
  id: string;
  email: string;
  tier: string;
  verification_status: string;
  verification_token: string | null;
}

// GET /verify?token=<token> — activate account, provision API key, email customer
router.get("/", async (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).send(page("Invalid verification link.", false));
  }

  const user = await dbGet<UserRow>(
    "SELECT id, email, tier, verification_status FROM users WHERE verification_token = ?",
    [token]
  );

  if (!user) {
    return res
      .status(404)
      .send(page("Verification link not found or already used.", false));
  }

  if (user.verification_status === "verified") {
    return res.send(
      page("Account already verified. Check your email for your API key.", true)
    );
  }

  // Mark verified
  await dbRun(
    "UPDATE users SET verification_status = 'verified', verification_token = NULL WHERE id = ?",
    [user.id]
  );

  // Provision API key from orchestrator (with retry for 429/503)
  const apiKey = await provisionApiKey(user.id, user.tier);

  // Email the API key
  if (apiKey) {
    try {
      await sendApiKeyEmail(user.email, apiKey, user.tier);
    } catch (err) {
      console.error("[verify] Email send failed:", (err as Error).message);
    }
    // Notify internal team of new free signup
    try {
      const tierConfig = TIERS[user.tier];
      await sendSignupNotification(
        user.email,
        tierConfig?.label ?? user.tier,
        tierConfig?.credits ?? 0,
        new Date().toISOString()
      );
    } catch (err) {
      console.error("[verify] Signup notification failed:", (err as Error).message);
    }
  } else {
    console.error(`[verify] Could not provision key for user ${user.id} — they will need manual key delivery`);
  }

  return res.send(
    page(
      apiKey
        ? "Email verified! Your API key has been sent to your inbox."
        : "Email verified! Your API key will be emailed shortly — if you don't receive it within 5 minutes, contact support.",
      true
    )
  );
});

// GET /verify/resend?email=<email> — resend verification email
router.get("/resend", async (req: Request, res: Response) => {
  const { email } = req.query;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  const user = await dbGet<UserRow>(
    "SELECT id, email, tier, verification_token, verification_status FROM users WHERE email = ?",
    [email.toLowerCase()]
  );

  if (!user) {
    // Don't reveal whether account exists
    return res.json({ message: "If an account exists, a verification email has been sent." });
  }

  if (user.verification_status === "verified") {
    return res.json({ message: "Account is already verified." });
  }

  try {
    if (user.verification_token) {
      await sendVerificationEmail(user.email, user.verification_token);
    }
  } catch (err) {
    console.error("[verify/resend] Email error:", (err as Error).message);
  }

  return res.json({ message: "If an account exists, a verification email has been sent." });
});

function page(message: string, success: boolean): string {
  const icon = success ? "✓" : "✗";
  const color = success ? "#238636" : "#da3633";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Orchestra — Verification</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 48px;
      max-width: 440px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 52px; color: ${color}; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 16px; }
    p { color: #8b949e; line-height: 1.6; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .home { margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>Security Orchestra</h1>
    <p>${message}</p>
    <p class="home"><a href="/">Return home</a></p>
  </div>
</body>
</html>`;
}

export default router;
