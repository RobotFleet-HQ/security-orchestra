import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { dbGet } from "../database.js";

const router = Router();

export const CREDIT_PACKS: Record<
  string,
  { credits: number; price_cents: number; label: string }
> = {
  "100": { credits: 100, price_cents: 1000, label: "100 Credits" },
  "250": { credits: 250, price_cents: 2000, label: "250 Credits" },
  "500": { credits: 500, price_cents: 3500, label: "500 Credits" },
};

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// POST /credits/purchase — one-time credit pack purchase
router.post("/purchase", async (req: Request, res: Response) => {
  const { email, pack } = req.body;

  if (!email || !pack) {
    return res.status(400).json({ error: "email and pack (100/250/500) are required" });
  }

  const packConfig = CREDIT_PACKS[String(pack)];
  if (!packConfig) {
    return res.status(400).json({
      error: `Invalid pack. Options: ${Object.keys(CREDIT_PACKS).join(", ")}`,
    });
  }

  const user = await dbGet<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    [email.toLowerCase()]
  );
  if (!user) {
    return res.status(404).json({
      error: "Account not found. Sign up first at /signup",
    });
  }

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
            unit_amount: packConfig.price_cents,
            product_data: {
              name: `Security Orchestra — ${packConfig.label}`,
              description: `${packConfig.credits} API credits for data center analysis tools`,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: email.toLowerCase(),
      metadata: {
        user_id: user.id,
        purchase_type: "credit_pack",
        credits: String(packConfig.credits),
      },
      success_url: `${baseUrl}/credits-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/`,
    });

    return res.json({
      checkoutUrl: session.url,
      credits: packConfig.credits,
      price_cents: packConfig.price_cents,
      price_usd: `$${(packConfig.price_cents / 100).toFixed(2)}`,
    });
  } catch (err) {
    console.error("[credits/purchase] Stripe error:", (err as Error).message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// GET /credits/packs — list available credit packs
router.get("/packs", (_req: Request, res: Response) => {
  const packs = Object.entries(CREDIT_PACKS).map(([id, cfg]) => ({
    id,
    credits: cfg.credits,
    price_cents: cfg.price_cents,
    price_usd: `$${(cfg.price_cents / 100).toFixed(2)}`,
    label: cfg.label,
  }));
  return res.json({ packs });
});

export default router;
