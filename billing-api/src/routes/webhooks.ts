import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Stripe from "stripe";
import { dbGet, dbRun, TIERS } from "../database.js";
import {
  sendApiKeyEmail,
  sendCreditPurchaseConfirmation,
  sendSignupNotification,
  sendUpgradeConfirmation,
} from "../email.js";
import { provisionApiKey } from "../provisionKey.js";

const router = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

interface User {
  id: string;
  email: string;
  tier: string;
  verification_status: string;
}

// POST /webhooks/stripe — handle Stripe events
router.post("/stripe", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  if (!Buffer.isBuffer(req.body)) {
    console.error("[webhook] req.body is not a Buffer — raw body was consumed by middleware");
    return res.status(500).json({ error: "Server misconfiguration: raw body not available" });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhook] constructEvent failed:", msg);
    return res.status(400).json({ error: `Webhook verification failed: ${msg}` });
  }

  console.log(`[webhook] ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      default:
        console.log(`[webhook] Unhandled: ${event.type}`);
    }
  } catch (err) {
    console.error("[webhook] Handler error:", (err as Error).message);
    // Still return 200 to prevent Stripe from retrying non-retryable errors
  }

  return res.json({ received: true });
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metaUserId = session.metadata?.user_id;
  const tier = session.metadata?.tier;
  const purchaseType = session.metadata?.purchase_type;
  const creditsStr = session.metadata?.credits;

  const now = new Date().toISOString();

  // ── Credit pack purchase ────────────────────────────────────────────────────
  if (purchaseType === "credit_pack" && creditsStr && metaUserId) {
    const user = await dbGet<User>("SELECT * FROM users WHERE id = ?", [metaUserId]);
    if (!user) {
      console.error(`[webhook] credit_pack: user not found: ${metaUserId}`);
      return;
    }
    const credits = parseInt(creditsStr, 10);
    const current = await dbGet<{ balance: number; total_purchased: number }>(
      "SELECT balance, total_purchased FROM credits WHERE user_id = ?", [metaUserId]
    );
    const newBalance = (current?.balance ?? 0) + credits;
    const newPurchased = (current?.total_purchased ?? 0) + credits;
    await dbRun(
      "UPDATE credits SET balance = ?, total_purchased = ?, updated_at = ? WHERE user_id = ?",
      [newBalance, newPurchased, now, metaUserId]
    );
    console.log(`[webhook] Credit pack: user ${metaUserId} +${credits} (balance: ${newBalance})`);
    try {
      await sendCreditPurchaseConfirmation(user.email, credits, newBalance);
    } catch (err) {
      console.error("[webhook] Email error:", (err as Error).message);
    }
    return;
  }

  // ── Tier purchase / new signup ──────────────────────────────────────────────
  if (!tier) {
    console.error("[webhook] checkout.session.completed: missing tier in metadata", session.id);
    return;
  }
  const tierConfig = TIERS[tier];
  if (!tierConfig) {
    console.error(`[webhook] Unknown tier: ${tier}`);
    return;
  }

  // Resolve user — prefer metadata user_id, fall back to email lookup, then create fresh
  let user = metaUserId
    ? await dbGet<User>("SELECT * FROM users WHERE id = ?", [metaUserId])
    : null;

  const email: string =
    session.customer_details?.email ??
    session.customer_email ??
    (user?.email ?? "");

  if (!user && email) {
    // Try lookup by email (handles case where DB was reset but user signed up before)
    user = await dbGet<User>("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  }

  if (!user) {
    // User genuinely doesn't exist (DB reset, direct Stripe payment, etc.) — create them now
    if (!email) {
      console.error(`[webhook] Cannot create user — no email in session ${session.id}`);
      return;
    }
    const newId = metaUserId ?? uuidv4();
    console.log(`[webhook] User ${newId} not found — creating from Stripe session`);
    await dbRun(
      `INSERT INTO users (id, email, tier, created_at, verification_status)
       VALUES (?, ?, ?, ?, 'verified')`,
      [newId, email.toLowerCase(), tier, now]
    );
    await dbRun(
      "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, 0, 0, 0, ?)",
      [newId, now]
    );
    user = await dbGet<User>("SELECT * FROM users WHERE id = ?", [newId]);
    if (!user) {
      console.error(`[webhook] Failed to create user ${newId}`);
      return;
    }
  }

  const userId = user.id;

  // Upgrade tier + mark verified
  await dbRun(
    "UPDATE users SET tier = ?, verification_status = 'verified' WHERE id = ?",
    [tier, userId]
  );

  // Add credits
  const existing = await dbGet<{ balance: number; total_purchased: number }>(
    "SELECT balance, total_purchased FROM credits WHERE user_id = ?", [userId]
  );
  const newBalance = (existing?.balance ?? 0) + tierConfig.credits;
  const newPurchased = (existing?.total_purchased ?? 0) + tierConfig.credits;
  if (existing) {
    await dbRun(
      "UPDATE credits SET balance = ?, total_purchased = ?, updated_at = ? WHERE user_id = ?",
      [newBalance, newPurchased, now, userId]
    );
  } else {
    await dbRun(
      "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, ?, ?, 0, ?)",
      [userId, newBalance, newPurchased, now]
    );
  }

  // Record subscription
  await dbRun(
    `INSERT OR REPLACE INTO subscriptions
     (id, user_id, stripe_customer_id, stripe_subscription_id, tier, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [session.id, userId, session.customer as string, (session.subscription as string) ?? null, tier, now]
  );

  console.log(`[webhook] User ${userId} → ${tier}, +${tierConfig.credits} credits`);

  // Provision API key (with retry for 429/503)
  console.log(`[webhook-email] Step 1: calling provisionApiKey for user ${userId}`);
  const apiKey = await provisionApiKey(userId, tier);
  console.log(`[webhook-email] Step 2: provisionApiKey returned: ${apiKey ? "KEY_OBTAINED" : "NULL"}`);

  // Email customer
  console.log(`[webhook-email] Step 3: preparing to send email to user ${userId} — SENDGRID_API_KEY set: ${!!process.env.SENDGRID_API_KEY}`);
  if (!user.email) {
    console.error(`[webhook-email] ABORT: user ${userId} has no email — cannot send`);
    return;
  }

  try {
    if (apiKey) {
      console.log(`[webhook-email] Step 4a: sending API key email to user ${userId} (${tierConfig.label})`);
      await sendApiKeyEmail(user.email, apiKey, tierConfig.label);
      console.log(`[webhook-email] Step 5a: API key email sent OK for user ${userId}`);
    } else {
      console.error(`[webhook-email] Step 4b: provision-key returned null for user ${userId} — sending upgrade confirmation instead`);
      await sendUpgradeConfirmation(user.email, tierConfig.label, tierConfig.credits);
      console.log(`[webhook-email] Step 5b: upgrade confirmation sent for user ${userId}`);
    }
  } catch (err) {
    const sgErr = err as { message?: string; response?: { body?: unknown; status?: number } };
    console.error(`[webhook-email] FAILED for user ${userId} — message:`, sgErr.message);
    console.error(`[webhook-email] FAILED for user ${userId} — status:`, sgErr.response?.status);
    console.error(`[webhook-email] FAILED for user ${userId} — body:`, JSON.stringify(sgErr.response?.body));
  }

  // Notify internal team of new signup
  try {
    await sendSignupNotification(user.email, tierConfig.label, tierConfig.credits, now);
  } catch (err) {
    console.error(`[webhook-email] Signup notification failed for user ${userId}:`, (err as Error).message);
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const customerId = sub.customer as string;
  const subRecord = await dbGet<{ user_id: string; tier: string }>(
    "SELECT user_id, tier FROM subscriptions WHERE stripe_customer_id = ?",
    [customerId]
  );
  if (!subRecord) return;

  const status = sub.status === "active" ? "active" : "inactive";
  await dbRun(
    "UPDATE subscriptions SET status = ? WHERE stripe_customer_id = ?",
    [status, customerId]
  );

  // On re-activation, sync tier credits
  if (status === "active") {
    const tierConfig = TIERS[subRecord.tier];
    if (tierConfig) {
      const now = new Date().toISOString();
      await dbRun(
        "UPDATE credits SET balance = ?, updated_at = ? WHERE user_id = ?",
        [tierConfig.credits, now, subRecord.user_id]
      );
    }
  }

  console.log(`[webhook] Subscription ${status} for customer ${customerId}`);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = sub.customer as string;
  await dbRun(
    "UPDATE subscriptions SET status = 'cancelled' WHERE stripe_customer_id = ?",
    [customerId]
  );
  const subRecord = await dbGet<{ user_id: string }>(
    "SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?",
    [customerId]
  );
  if (subRecord) {
    await dbRun("UPDATE users SET tier = 'free' WHERE id = ?", [subRecord.user_id]);
    console.log(`[webhook] Subscription cancelled for user ${subRecord.user_id}`);
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const subRecord = await dbGet<{ user_id: string; tier: string }>(
    "SELECT user_id, tier FROM subscriptions WHERE stripe_customer_id = ? AND status = 'active'",
    [customerId]
  );
  if (!subRecord) return;

  const tierConfig = TIERS[subRecord.tier];
  if (!tierConfig) return;

  const now = new Date().toISOString();
  const credits = await dbGet<{ balance: number; total_purchased: number }>(
    "SELECT balance, total_purchased FROM credits WHERE user_id = ?",
    [subRecord.user_id]
  );
  const newBalance = (credits?.balance ?? 0) + tierConfig.credits;
  const newPurchased = (credits?.total_purchased ?? 0) + tierConfig.credits;

  await dbRun(
    "UPDATE credits SET balance = ?, total_purchased = ?, updated_at = ? WHERE user_id = ?",
    [newBalance, newPurchased, now, subRecord.user_id]
  );
  console.log(
    `[webhook] Invoice paid for user ${subRecord.user_id}: +${tierConfig.credits} credits (balance: ${newBalance})`
  );
}

export default router;
