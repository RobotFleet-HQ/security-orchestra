import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { dbGet, dbRun, TIERS } from "../database.js";
import { sendUpgradeConfirmation } from "../email.js";

const router = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// POST /subscription/upgrade — upgrade to a paid tier
router.post("/upgrade", async (req: Request, res: Response) => {
  const { email, newTier } = req.body;

  if (!email || !newTier) {
    return res.status(400).json({ error: "email and newTier are required" });
  }
  if (newTier === "free") {
    return res.status(400).json({ error: "Cannot upgrade to free tier" });
  }

  const tierConfig = TIERS[newTier];
  if (!tierConfig) {
    return res.status(400).json({
      error: `Invalid tier. Paid options: starter, pro, enterprise`,
    });
  }

  const user = await dbGet<{ id: string; email: string; tier: string }>(
    "SELECT id, email, tier FROM users WHERE email = ?",
    [email.toLowerCase()]
  );
  if (!user) {
    return res.status(404).json({ error: "Account not found" });
  }

  // Check for an active Stripe subscription to upgrade with proration
  const sub = await dbGet<{
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
  }>(
    "SELECT stripe_subscription_id, stripe_customer_id FROM subscriptions WHERE user_id = ? AND status = 'active'",
    [user.id]
  );

  const priceTierEnvKey = `STRIPE_PRICE_${newTier.toUpperCase()}`;
  const priceId = process.env[priceTierEnvKey];

  if (sub?.stripe_subscription_id && priceId) {
    try {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(
        sub.stripe_subscription_id
      );
      const itemId = subscription.items.data[0]?.id;

      if (itemId) {
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items: [{ id: itemId, price: priceId }],
          proration_behavior: "create_prorations",
        });

        const now = new Date().toISOString();
        await dbRun("UPDATE users SET tier = ? WHERE id = ?", [newTier, user.id]);
        await dbRun(
          `UPDATE credits
           SET balance = balance + ?, total_purchased = total_purchased + ?, updated_at = ?
           WHERE user_id = ?`,
          [tierConfig.credits, tierConfig.credits, now, user.id]
        );
        await dbRun(
          "UPDATE subscriptions SET tier = ? WHERE user_id = ? AND status = 'active'",
          [newTier, user.id]
        );

        try {
          await sendUpgradeConfirmation(user.email, tierConfig.label, tierConfig.credits);
        } catch (err) {
          console.error("[subscription/upgrade] Email error:", (err as Error).message);
        }

        return res.json({
          message: `Upgraded to ${tierConfig.label}`,
          tier: newTier,
          creditsAdded: tierConfig.credits,
        });
      }
    } catch (err) {
      console.error("[subscription/upgrade] Stripe subscription update failed:", (err as Error).message);
      // Fall through to checkout
    }
  }

  // No active subscription — create a new checkout session
  try {
    const stripe = getStripe();
    const baseUrl = process.env.BASE_URL ?? "https://security-orchestra-billing.onrender.com";
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
      customer_email: email.toLowerCase(),
      metadata: { user_id: user.id, tier: newTier },
      success_url: `${baseUrl}/signup-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/`,
    });

    return res.json({
      checkoutUrl: session.url,
      tier: newTier,
      message: "Complete payment to upgrade your plan",
    });
  } catch (err) {
    console.error("[subscription/upgrade] Stripe error:", (err as Error).message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// GET /subscription/tiers — list upgrade options
router.get("/tiers", (_req: Request, res: Response) => {
  const tiers = Object.entries(TIERS)
    .filter(([id]) => id !== "free")
    .map(([id, cfg]) => ({
      id,
      label: cfg.label,
      price_cents: cfg.price_cents,
      price_usd: `$${(cfg.price_cents / 100).toFixed(2)}`,
      credits: cfg.credits,
    }));
  return res.json({ tiers });
});

export default router;
