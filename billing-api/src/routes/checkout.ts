import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { dbGet, TIERS } from "../database.js";

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

// POST /checkout — create a Stripe checkout session for a tier upgrade
router.post("/", async (req: Request, res: Response) => {
  const { user_id, tier, success_url, cancel_url } = req.body;

  if (!user_id || !tier) {
    return res.status(400).json({ error: "user_id and tier are required" });
  }
  if (tier === "free") {
    return res.status(400).json({ error: "Cannot purchase free tier" });
  }
  const tierConfig = TIERS[tier];
  if (!tierConfig) {
    return res.status(400).json({ error: `Invalid tier. Paid tiers: starter, pro, enterprise` });
  }

  const user = await dbGet<User>("SELECT * FROM users WHERE id = ?", [user_id]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: tierConfig.price_cents,
          product_data: {
            name: `${tierConfig.label} Plan`,
            description: `${tierConfig.credits.toLocaleString()} credits`,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: user.email,
    metadata: {
      user_id,
      tier,
    },
    success_url: success_url ?? `${process.env.BASE_URL ?? "http://localhost:3001"}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancel_url ?? `${process.env.BASE_URL ?? "http://localhost:3001"}/cancel`,
  });

  return res.json({
    checkout_url: session.url,
    session_id: session.id,
    tier,
    credits: tierConfig.credits,
    price_cents: tierConfig.price_cents,
  });
});

// GET /checkout/tiers — list available pricing tiers
router.get("/tiers", (_req: Request, res: Response) => {
  const tiers = Object.entries(TIERS).map(([id, config]) => ({
    id,
    label: config.label,
    price_cents: config.price_cents,
    price_usd: (config.price_cents / 100).toFixed(2),
    credits: config.credits,
  }));
  return res.json({ tiers });
});

export default router;
