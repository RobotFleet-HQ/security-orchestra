import { Router, Request, Response } from "express";
import { dbGet, dbRun, dbRunChanges } from "../database.js";
import { sendLowCreditWarning } from "../email.js";

const router = Router();

interface Credits {
  user_id: string;
  balance: number;
  total_purchased: number;
  total_used: number;
  updated_at: string;
}

interface User {
  id: string;
  tier: string;
}

// GET /credits/:userId — check credit balance
router.get("/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;

  const user = await dbGet<User>("SELECT id, tier FROM users WHERE id = ?", [userId]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const credits = await dbGet<Credits>("SELECT * FROM credits WHERE user_id = ?", [userId]);
  if (!credits) {
    return res.status(404).json({ error: "Credits record not found" });
  }

  return res.json({
    user_id: userId,
    tier: user.tier,
    balance: credits.balance,
    total_purchased: credits.total_purchased,
    total_used: credits.total_used,
    updated_at: credits.updated_at,
  });
});

// POST /credits/:userId/deduct — deduct credits for a workflow execution
router.post("/:userId/deduct", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { amount = 1, reason } = req.body;

  if (typeof amount !== "number" || amount < 1) {
    return res.status(400).json({ error: "amount must be a positive integer" });
  }

  const user = await dbGet<User>("SELECT id FROM users WHERE id = ?", [userId]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const now = new Date().toISOString();
  const changed = await dbRunChanges(
    `UPDATE credits
        SET balance    = balance - ?,
            total_used = total_used + ?,
            updated_at = ?
      WHERE user_id = ?
        AND balance >= ?`,
    [amount, amount, now, userId, amount]
  );

  if (changed === 0) {
    // Either user has no credits row or balance was insufficient —
    // distinguish the two so the caller gets the right status code.
    const credits = await dbGet<Credits>("SELECT balance FROM credits WHERE user_id = ?", [userId]);
    if (!credits) {
      return res.status(404).json({ error: "Credits record not found" });
    }
    return res.status(402).json({
      error: "Insufficient credits",
      balance: credits.balance,
      required: amount,
    });
  }

  const updated = await dbGet<Credits>("SELECT balance, total_used FROM credits WHERE user_id = ?", [userId]);
  return res.json({
    user_id: userId,
    deducted: amount,
    reason: reason ?? null,
    balance: updated?.balance ?? 0,
    updated_at: now,
  });
});

// POST /credits/:userId/add — manually add credits (admin use)
router.post("/:userId/add", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { amount } = req.body;

  if (typeof amount !== "number" || amount < 1) {
    return res.status(400).json({ error: "amount must be a positive integer" });
  }

  const user = await dbGet<User>("SELECT id FROM users WHERE id = ?", [userId]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const credits = await dbGet<Credits>("SELECT * FROM credits WHERE user_id = ?", [userId]);
  if (!credits) {
    return res.status(404).json({ error: "Credits record not found" });
  }

  const now = new Date().toISOString();
  const newBalance = credits.balance + amount;
  const newTotalPurchased = credits.total_purchased + amount;

  await dbRun(
    "UPDATE credits SET balance = ?, total_purchased = ?, updated_at = ? WHERE user_id = ?",
    [newBalance, newTotalPurchased, now, userId]
  );

  return res.json({
    user_id: userId,
    added: amount,
    balance: newBalance,
    updated_at: now,
  });
});

// POST /credits/:userId/low-credit-warning — send low credit email (max once per day, persisted in DB)
router.post("/:userId/low-credit-warning", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { balance } = req.body as { balance: number };

  const row = await dbGet<{ last_low_credit_warning_at: string | null }>(
    "SELECT last_low_credit_warning_at FROM credits WHERE user_id = ?",
    [userId]
  );
  if (row === undefined) {
    return res.status(404).json({ error: "Credits record not found" });
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const lastSent = row.last_low_credit_warning_at ? new Date(row.last_low_credit_warning_at).getTime() : 0;
  if (Date.now() - lastSent < oneDayMs) {
    return res.json({ sent: false, reason: "Already sent within 24 hours" });
  }

  const user = await dbGet<{ email: string }>("SELECT email FROM users WHERE id = ?", [userId]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    await sendLowCreditWarning(user.email, balance ?? 0);
    await dbRun(
      "UPDATE credits SET last_low_credit_warning_at = ? WHERE user_id = ?",
      [new Date().toISOString(), userId]
    );
    return res.json({ sent: true });
  } catch (err) {
    console.error("[low-credit-warning] Email error:", (err as Error).message);
    return res.status(500).json({ error: "Failed to send warning email" });
  }
});

// GET /credits/buy — redirect to top-up page (convenience link for email CTAs)
router.get("/buy", (req: Request, res: Response) => {
  const pack = req.query.pack ?? "250";
  const email = req.query.email ?? "";
  const params = new URLSearchParams({ pack: String(pack) });
  if (email) params.set("email", String(email));
  res.redirect(`/credits.html?${params.toString()}`);
});

export default router;
