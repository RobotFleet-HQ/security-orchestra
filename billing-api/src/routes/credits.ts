import { Router, Request, Response } from "express";
import { dbGet, dbRun } from "../database.js";

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

  const credits = await dbGet<Credits>("SELECT * FROM credits WHERE user_id = ?", [userId]);
  if (!credits) {
    return res.status(404).json({ error: "Credits record not found" });
  }

  if (credits.balance < amount) {
    return res.status(402).json({
      error: "Insufficient credits",
      balance: credits.balance,
      required: amount,
    });
  }

  const now = new Date().toISOString();
  const newBalance = credits.balance - amount;
  const newTotalUsed = credits.total_used + amount;

  await dbRun(
    "UPDATE credits SET balance = ?, total_used = ?, updated_at = ? WHERE user_id = ?",
    [newBalance, newTotalUsed, now, userId]
  );

  return res.json({
    user_id: userId,
    deducted: amount,
    reason: reason ?? null,
    balance: newBalance,
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

export default router;
