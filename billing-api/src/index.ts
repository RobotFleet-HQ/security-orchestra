import express from "express";
import { initDb } from "./database.js";
import usersRouter from "./routes/users.js";
import creditsRouter from "./routes/credits.js";
import checkoutRouter from "./routes/checkout.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

// Stripe webhooks need raw body — mount BEFORE json middleware
app.use(
  "/webhooks",
  express.raw({ type: "application/json" }),
  webhooksRouter
);

app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "billing-api" });
});

// Routes
app.use("/users", usersRouter);
app.use("/credits", creditsRouter);
app.use("/checkout", checkoutRouter);
app.use("/audit", auditRouter);

// Generic error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Billing API running on http://localhost:${PORT}`);
    console.log("Stripe configured:", !!process.env.STRIPE_SECRET_KEY);
  });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
