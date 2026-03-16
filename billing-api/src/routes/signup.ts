import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import Stripe from "stripe";
import { dbGet, dbRun, TIERS } from "../database.js";
import { sendVerificationEmail } from "../email.js";

const router = Router();

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "tempmail.com", "guerrillamail.com", "10minutemail.com",
  "throwaway.email", "temp-mail.org", "yopmail.com", "sharklasers.com",
  "guerrillamailblock.com", "spam4.me", "trashmail.com", "dispostable.com",
  "mailnull.com", "spamgourmet.com", "trashmail.me", "discard.email",
  "fakeinbox.com", "mailnesia.com", "maildrop.cc", "spamgourmet.org",
  "mailexpire.com", "spamfree24.org", "trashmail.at", "trashmail.io",
  "tempinbox.com", "getnada.com", "zzrgg.com", "tmail.com", "mailtemp.info",
]);

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// POST /signup
router.post("/", async (req: Request, res: Response) => {
  const { email, tier = "free" } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  const emailLower = email.toLowerCase().trim();

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // Block disposable email domains
  const domain = emailLower.split("@")[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.status(400).json({
      error: "Disposable email addresses are not allowed. Please use a real email.",
    });
  }

  if (!TIERS[tier]) {
    return res.status(400).json({
      error: `Invalid tier. Options: ${Object.keys(TIERS).join(", ")}`,
    });
  }

  // Check for existing account
  const existing = await dbGet<{ id: string; verification_status: string }>(
    "SELECT id, verification_status FROM users WHERE email = ?",
    [emailLower]
  );
  if (existing) {
    if (existing.verification_status === "pending") {
      return res.status(409).json({
        error: "Account exists but not verified. Check your email for the verification link.",
      });
    }
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  // Capture client IP
  const clientIp =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      .trim() ??
    req.ip ??
    "unknown";

  // Free tier: check IP abuse (1 free account per IP per 30 days)
  if (tier === "free") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ipCheck = await dbGet<{ id: string }>(
      "SELECT id FROM users WHERE ip_address = ? AND created_at > ?",
      [clientIp, cutoff]
    );
    if (ipCheck) {
      return res.status(429).json({
        error:
          "Free tier limit reached from this location. Please upgrade to a paid plan or wait 30 days.",
      });
    }
  }

  const userId = uuidv4();
  const now = new Date().toISOString();
  const verificationToken = crypto.randomBytes(32).toString("hex");

  if (tier === "free") {
    // Create pending user
    await dbRun(
      `INSERT INTO users (id, email, tier, created_at, ip_address, verification_token, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [userId, emailLower, tier, now, clientIp, verificationToken]
    );
    await dbRun(
      "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, ?, ?, 0, ?)",
      [userId, TIERS[tier].credits, TIERS[tier].credits, now]
    );

    // Send verification email
    try {
      await sendVerificationEmail(emailLower, verificationToken);
    } catch (err) {
      console.error("[signup] Email send failed:", (err as Error).message);
      // Don't block signup if email fails — user can request resend
    }

    return res.status(201).json({
      message: "Check your email to verify your account and get your API key!",
      email: emailLower,
      tier,
    });
  }

  // Paid tier — create user record + Stripe checkout session
  const tierConfig = TIERS[tier];

  await dbRun(
    `INSERT INTO users (id, email, tier, created_at, ip_address, verification_token, verification_status)
     VALUES (?, ?, 'free', ?, ?, ?, 'pending')`,
    [userId, emailLower, now, clientIp, verificationToken]
  );
  await dbRun(
    "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, 0, 0, 0, ?)",
    [userId, now]
  );

  try {
    const stripe = getStripe();
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: tierConfig.price_cents,
            product_data: {
              name: `Security Orchestra — ${tierConfig.label} Plan`,
              description: `${tierConfig.credits.toLocaleString()} analysis credits`,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: emailLower,
      metadata: { user_id: userId, tier },
      success_url: `${baseUrl}/signup-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/signup`,
    });

    return res.json({
      message: "Complete payment to activate your account",
      checkoutUrl: session.url,
      tier,
      credits: tierConfig.credits,
    });
  } catch (err) {
    console.error("[signup] Stripe error:", (err as Error).message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

export default router;
