import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { dbGet, dbRun, TIERS } from "../database.js";

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
}

// POST /webhooks/stripe — handle Stripe events
// Stripe sends raw body, so this route must receive it unparsed.
router.post("/stripe", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Webhook signature verification failed:", msg);
    return res.status(400).json({ error: `Webhook verification failed: ${msg}` });
  }

  console.log(`[webhook] Received event: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub);
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaid(invoice);
      break;
    }
    default:
      console.log(`[webhook] Unhandled event type: ${event.type}`);
  }

  return res.json({ received: true });
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  const tier = session.metadata?.tier;

  if (!userId || !tier) {
    console.error("[webhook] checkout.session.completed missing metadata", session.id);
    return;
  }

  const user = await dbGet<User>("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) {
    console.error(`[webhook] User not found: ${userId}`);
    return;
  }

  const tierConfig = TIERS[tier];
  if (!tierConfig) {
    console.error(`[webhook] Unknown tier in metadata: ${tier}`);
    return;
  }

  const now = new Date().toISOString();

  // Upgrade user tier
  await dbRun("UPDATE users SET tier = ? WHERE id = ?", [tier, userId]);

  // Add credits to balance
  const credits = await dbGet<{ balance: number; total_purchased: number }>(
    "SELECT balance, total_purchased FROM credits WHERE user_id = ?",
    [userId]
  );
  const newBalance = (credits?.balance ?? 0) + tierConfig.credits;
  const newPurchased = (credits?.total_purchased ?? 0) + tierConfig.credits;

  await dbRun(
    "UPDATE credits SET balance = ?, total_purchased = ?, updated_at = ? WHERE user_id = ?",
    [newBalance, newPurchased, now, userId]
  );

  // Record subscription
  await dbRun(
    `INSERT OR REPLACE INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, tier, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [session.id, userId, session.customer as string, session.subscription as string, tier, now]
  );

  console.log(`[webhook] User ${userId} upgraded to ${tier}, credited ${tierConfig.credits} credits`);
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
  console.log(`[webhook] Subscription updated for customer ${customerId}: status=${status}`);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = sub.customer as string;
  await dbRun(
    "UPDATE subscriptions SET status = 'cancelled' WHERE stripe_customer_id = ?",
    [customerId]
  );
  // Downgrade user to free tier
  const subRecord = await dbGet<{ user_id: string }>(
    "SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?",
    [customerId]
  );
  if (subRecord) {
    await dbRun("UPDATE users SET tier = 'free' WHERE id = ?", [subRecord.user_id]);
    console.log(`[webhook] Subscription cancelled for user ${subRecord.user_id}, downgraded to free`);
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // For recurring billing: top up credits on each successful invoice
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
  console.log(`[webhook] Invoice paid for user ${subRecord.user_id}: +${tierConfig.credits} credits (new balance: ${newBalance})`);
}

export default router;
