import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { dbRun } from "../database.js";

const router = Router();

const VALID_ISSUE_TYPES = ["billing", "technical", "feature_request", "other"] as const;

// POST /contact
router.post("/", async (req: Request, res: Response) => {
  const { email, message, issue_type } = req.body ?? {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }
  if (!message || typeof message !== "string" || message.trim().length < 10) {
    return res.status(400).json({ error: "Message must be at least 10 characters" });
  }
  if (!issue_type || !(VALID_ISSUE_TYPES as readonly string[]).includes(issue_type)) {
    return res.status(400).json({
      error: `issue_type must be one of: ${VALID_ISSUE_TYPES.join(", ")}`,
    });
  }

  const id  = uuidv4();
  const now = new Date().toISOString();

  await dbRun(
    "INSERT INTO support_tickets (id, email, issue_type, message, status, created_at) VALUES (?, ?, ?, ?, 'unread', ?)",
    [id, email.trim().toLowerCase(), issue_type, message.trim(), now]
  );

  return res.status(201).json({ ok: true, ticket_id: id, created_at: now });
});

export default router;
