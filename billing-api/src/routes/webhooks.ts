import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { dbGet, dbRun, TIERS } from "../database.js";
import {
  sendApiKeyEmail,
  sendCreditPurchaseConfirmation,
  sendUpgradeConfirmation,
} from "../email.js";

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

  // req.body must be a Buffer — if it's already a parsed object, raw body was lost
  if (!Buffer.isBuffer(req.body)) {
    console.error(
      "[webhook] req.body is not a Buffer — raw body was not captured. " +
      `Got type: ${typeof req.body}. Check that /webhooks uses express.raw() before express.json().`
    );
    return res.status(500).json({ error: "Server misconfiguration: raw body not available" });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhook] Signature verification failed:", msg);
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
  const userId = session.metadata?.user_id;
  const tier = session.metadata?.tier;
  const purchaseType = session.metadata?.purchase_type;
  const creditsStr = session.metadata?.credits;

  if (!userId) {
    console.error("[webhook] checkout.session.completed: missing user_id in metadata", session.id);
    return;
  }

  const user = await dbGet<User>("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) {
    console.error(`[webhook] User not found: ${userId}`);
    return;
  }

  const now = new Date().toISOString();

  // Credit pack purchase
  if (purchaseType === "credit_pack" && creditsStr) {
    const credits = parseInt(creditsStr, 10);
    const currentCredits = await dbGet<{ balance: number; total_purchased: number }>(
      "SELECT balance, total_purchased FROM credits WHERE user_id = ?",
      [userId]
    );
    const newBalance = (currentCredits?.balance ?? 0) + credits;
    const newPurchased = (currentCredits?.total_purchased ?? 0) + credits;

    await dbRun(
      "UPDATE credits SET balance = ?, total_purchased = ?, updated_at = ? WHERE user_id = ?",
      [newBalance, newPurchased, now, userId]
    );

    console.log(`[webhook] Credit pack: user ${userId} +${credits} credits (balance: ${newBalance})`);

    try {
      await sendCreditPurchaseConfirmation(user.email, credits, newBalance);
    } catch (err) {
      console.error("[webhook] Email error:", (err as Error).message);
    }
    return;
  }

  // Tier upgrade / new paid signup
  if (!tier) {
    console.error("[webhook] checkout.session.completed: missing tier in metadata", session.id);
    return;
  }

  const tierConfig = TIERS[tier];
  if (!tierConfig) {
    console.error(`[webhook] Unknown tier: ${tier}`);
    return;
  }

  // Upgrade user tier
  await dbRun("UPDATE users SET tier = ?, verification_status = 'verified' WHERE id = ?", [tier, userId]);

  // Add credits
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
    `INSERT OR REPLACE INTO subscriptions
     (id, user_id, stripe_customer_id, stripe_subscription_id, tier, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [session.id, userId, session.customer as string, session.subscription as string ?? null, tier, now]
  );

  console.log(`[webhook] User ${userId} upgraded to ${tier}, +${tierConfig.credits} credits`);

  // Provision API key
  let apiKey: string | null = null;
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  const adminKey = process.env.ORCHESTRATOR_ADMIN_KEY;

  if (orchestratorUrl && adminKey) {
    try {
      const provRes = await fetch(`${orchestratorUrl}/admin/provision-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ userId, tier }),
      });
      if (provRes.ok) {
        const data = (await provRes.json()) as { apiKey: string };
        apiKey = data.apiKey;
      } else {
        console.error("[webhook] provision-key failed:", provRes.status, await provRes.text());
      }
    } catch (err) {
      console.error("[webhook] provision-key error:", (err as Error).message);
    }
  }

  // Email customer
  try {
    if (apiKey) {
      await sendApiKeyEmail(user.email, apiKey, tierConfig.label);
    } else {
      await sendUpgradeConfirmation(user.email, tierConfig.label, tierConfig.credits);
    }
  } catch (err) {
    console.error("[webhook] Email error:", (err as Error).message);
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
