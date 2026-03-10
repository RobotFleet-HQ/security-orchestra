import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { dbGet, dbRun, TIERS } from "../database.js";

const router = Router();

interface User {
  id: string;
  email: string;
  tier: string;
  created_at: string;
}

interface Credits {
  user_id: string;
  balance: number;
  total_purchased: number;
  total_used: number;
  updated_at: string;
}

// POST /users — create a new user (default tier: free)
router.post("/", async (req: Request, res: Response) => {
  const { email, tier = "free" } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }
  if (!TIERS[tier]) {
    return res.status(400).json({ error: `Invalid tier. Must be one of: ${Object.keys(TIERS).join(", ")}` });
  }

  const existing = await dbGet<User>("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    return res.status(409).json({ error: "User with this email already exists" });
  }

  const userId = uuidv4();
  const now = new Date().toISOString();
  const initialCredits = TIERS[tier].credits;

  await dbRun(
    "INSERT INTO users (id, email, tier, created_at) VALUES (?, ?, ?, ?)",
    [userId, email, tier, now]
  );
  await dbRun(
    "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, ?, ?, 0, ?)",
    [userId, initialCredits, initialCredits, now]
  );

  return res.status(201).json({
    id: userId,
    email,
    tier,
    credits: initialCredits,
    created_at: now,
  });
});

// GET /users/:userId — get user info + credit balance
router.get("/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;

  const user = await dbGet<User>("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const credits = await dbGet<Credits>("SELECT * FROM credits WHERE user_id = ?", [userId]);

  return res.json({
    id: user.id,
    email: user.email,
    tier: user.tier,
    tier_label: TIERS[user.tier]?.label ?? user.tier,
    credits: {
      balance: credits?.balance ?? 0,
      total_purchased: credits?.total_purchased ?? 0,
      total_used: credits?.total_used ?? 0,
    },
    created_at: user.created_at,
  });
});

export default router;
