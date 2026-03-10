import express from "express";
import { initDb } from "./database.js";
import usersRouter from "./routes/users.js";
import creditsRouter from "./routes/credits.js";
import checkoutRouter from "./routes/checkout.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";
import supportRouter from "./routes/support.js";
import dashboardRouter from "./routes/dashboard.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Orchestra — Data Center Power Intelligence</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 48px 52px;
      max-width: 560px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 36px; margin-bottom: 20px; }
    h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 15px; margin-bottom: 36px; line-height: 1.5; }
    .agents { display: flex; gap: 12px; margin-bottom: 36px; }
    .agent {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      text-align: left;
    }
    .agent-name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .agent-price { font-size: 12px; color: #3fb950; font-weight: 600; }
    .divider { border: none; border-top: 1px solid #21262d; margin: 0 0 28px; }
    .info-row { display: flex; flex-direction: column; gap: 10px; text-align: left; }
    .info-item { display: flex; align-items: flex-start; gap: 12px; }
    .info-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.6px; min-width: 72px; padding-top: 2px; }
    .info-value { font-size: 13px; font-family: 'SFMono-Regular', Consolas, monospace; color: #58a6ff; word-break: break-all; }
    .info-value a { color: inherit; text-decoration: none; }
    .info-value a:hover { text-decoration: underline; }
    .info-value.plain { color: #e6edf3; font-family: inherit; }
    footer { margin-top: 28px; color: #484f58; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#9670;</div>
    <h1>Security Orchestra</h1>
    <p class="subtitle">Data Center Power Infrastructure Intelligence</p>

    <div class="agents">
      <div class="agent">
        <div class="agent-name">Generator Sizing</div>
        <div class="agent-price">$0.10 / call</div>
      </div>
      <div class="agent">
        <div class="agent-name">Utility Interconnect</div>
        <div class="agent-price">$0.30 / call</div>
      </div>
    </div>

    <hr class="divider">

    <div class="info-row">
      <div class="info-item">
        <span class="info-label">API</span>
        <span class="info-value">
          <a href="https://security-orchestra-orchestrator.onrender.com" target="_blank">
            security-orchestra-orchestrator.onrender.com
          </a>
        </span>
      </div>
      <div class="info-item">
        <span class="info-label">Support</span>
        <span class="info-value">
          <a href="mailto:rsaunders612@gmail.com">rsaunders612@gmail.com</a>
        </span>
      </div>
      <div class="info-item">
        <span class="info-label">Status</span>
        <span class="info-value">
          <a href="/dashboard" target="_blank">
            security-orchestra-billing.onrender.com/dashboard
          </a>
        </span>
      </div>
    </div>
  </div>
  <footer>Powered by MCP &mdash; Model Context Protocol</footer>
</body>
</html>`;

// Stripe webhooks need raw body — mount BEFORE json middleware
app.use(
  "/webhooks",
  express.raw({ type: "application/json" }),
  webhooksRouter
);

app.use(express.json());

// Landing page
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(LANDING_HTML);
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "billing-api" });
});

// Routes
app.use("/users", usersRouter);
app.use("/credits", creditsRouter);
app.use("/checkout", checkoutRouter);
app.use("/audit", auditRouter);
app.use("/contact", supportRouter);
app.use("/dashboard", dashboardRouter);

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
