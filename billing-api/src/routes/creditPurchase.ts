import { Request, Response, Router } from "express";
import Stripe from "stripe";
import { dbGet } from "../database.js";

export const CREDIT_PACKS: Record<
  string,
  { credits: number; price_cents: number; label: string; envKey: string }
> = {
  "100": { credits: 100, price_cents: 1000, label: "100 Credits", envKey: "CREDIT_PACK_100_PRICE_ID" },
  "250": { credits: 250, price_cents: 2000, label: "250 Credits", envKey: "CREDIT_PACK_250_PRICE_ID" },
  "500": { credits: 500, price_cents: 3500, label: "500 Credits", envKey: "CREDIT_PACK_500_PRICE_ID" },
};

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// Exported directly so index.ts can register as app.post("/credits/purchase", handleCreditPurchase)
// Avoids Express sub-router mounting path-stripping ambiguity.
export async function handleCreditPurchase(req: Request, res: Response): Promise<void> {
  console.log("[credits/purchase] handler invoked, body:", JSON.stringify(req.body));
  const { email, pack } = req.body ?? {};

  if (!email || !pack) {
    res.status(400).json({ error: "email and pack (100/250/500) are required" });
    return;
  }

  const packConfig = CREDIT_PACKS[String(pack)];
  if (!packConfig) {
    res.status(400).json({ error: `Invalid pack. Options: ${Object.keys(CREDIT_PACKS).join(", ")}` });
    return;
  }

  const user = await dbGet<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    [email.toLowerCase()]
  );
  if (!user) {
    res.status(404).json({ error: "No account found for that email. Please sign up first." });
    return;
  }

  const priceId = process.env[packConfig.envKey];
  console.log(`[credits/purchase] user=${user.id} pack=${pack} priceId=${priceId ?? "inline"}`);

  try {
    const stripe = getStripe();
    const baseUrl = process.env.BASE_URL ?? "https://security-orchestra-billing.onrender.com";

    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = priceId
      ? { price: priceId, quantity: 1 }
      : {
          price_data: {
            currency: "usd",
            unit_amount: packConfig.price_cents,
            product_data: {
              name: `Security Orchestra — ${packConfig.label}`,
              description: `${packConfig.credits} API credits for data center analysis tools`,
            },
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [lineItem],
      customer_email: email.toLowerCase(),
      metadata: {
        user_id: user.id,
        purchase_type: "credit_pack",
        credits: String(packConfig.credits),
      },
      success_url: `${baseUrl}/credits-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/credits.html?pack=${pack}`,
    });

    console.log(`[credits/purchase] session created: ${session.id}`);
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("[credits/purchase] Stripe error:", (err as Error).message);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
}

// GET /credits/packs — list available credit packs
const router = Router();
router.get("/packs", (_req: Request, res: Response) => {
  const packs = Object.entries(CREDIT_PACKS).map(([id, cfg]) => ({
    id,
    credits: cfg.credits,
    price_cents: cfg.price_cents,
    price_usd: `$${(cfg.price_cents / 100).toFixed(2)}`,
    label: cfg.label,
  }));
  res.json({ packs });
});

export default router;
