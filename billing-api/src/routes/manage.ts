import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { dbGet } from "../database.js";
import { provisionApiKey } from "../provisionKey.js";
import { sendApiKeyEmail } from "../email.js";

const router = Router();

interface User {
  id: string;
  email: string;
  tier: string;
}

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// GET /manage/account?email=... — look up account info by email
router.get("/account", async (req: Request, res: Response) => {
  const secret = process.env.BILLING_ADMIN_SECRET;
  if (secret) {
    const auth  = (req.headers["authorization"] as string | undefined) ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const email = (req.query.email as string | undefined)?.trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const user = await dbGet<User>("SELECT id, email, tier FROM users WHERE email = ?", [email]);
  if (!user) {
    return res.status(404).json({ error: "No account found for that email address." });
  }

  const credits = await dbGet<{ balance: number; total_used: number }>(
    "SELECT balance, total_used FROM credits WHERE user_id = ?",
    [user.id]
  );

  const sub = await dbGet<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [user.id]
  );

  return res.json({
    tier: user.tier,
    balance: credits?.balance ?? 0,
    total_used: credits?.total_used ?? 0,
    has_stripe_customer: !!(sub?.stripe_customer_id),
  });
});

// POST /manage/portal — create a Stripe billing portal session
router.post("/portal", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) {
    return res.status(400).json({ error: "email is required" });
  }

  const user = await dbGet<User>("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()]);
  if (!user) {
    return res.status(404).json({ error: "No account found for that email address." });
  }

  const sub = await dbGet<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [user.id]
  );

  if (!sub?.stripe_customer_id) {
    return res.status(400).json({
      error: "No Stripe billing account found. Free tier accounts do not have a billing portal.",
    });
  }

  const stripe = getStripe();
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${baseUrl}/manage.html`,
  });

  return res.json({ url: session.url });
});

// POST /manage/resend-key — provision a new API key and email it to the user
router.post("/resend-key", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) {
    return res.status(400).json({ error: "email is required" });
  }

  const user = await dbGet<User>(
    "SELECT id, email, tier FROM users WHERE email = ?",
    [email.trim().toLowerCase()]
  );
  if (!user) {
    return res.status(404).json({ error: "No account found for that email address." });
  }

  const apiKey = await provisionApiKey(user.id, user.tier);
  if (!apiKey) {
    return res.status(503).json({
      error: "Could not provision key — orchestrator unavailable. Please try again in 30 seconds.",
    });
  }

  try {
    await sendApiKeyEmail(user.email, apiKey, user.tier);
  } catch (err) {
    console.error("[manage/resend-key] Email send error:", (err as Error).message);
    return res.status(500).json({ error: "Key provisioned but email failed to send. Contact support." });
  }

  return res.json({ sent: true });
});

export default router;
