import express from "express";
import path from "path";
import { initDb, TIERS } from "./database.js";
import usersRouter from "./routes/users.js";
import creditsRouter from "./routes/credits.js";
import checkoutRouter from "./routes/checkout.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";
import supportRouter from "./routes/support.js";
import dashboardRouter from "./routes/dashboard.js";
import signupRouter from "./routes/signup.js";
import verifyRouter from "./routes/verify.js";
import creditPurchaseRouter, { handleCreditPurchase } from "./routes/creditPurchase.js";
import subscriptionRouter from "./routes/subscription.js";
import manageRouter from "./routes/manage.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://www.google-analytics.com; connect-src 'self' https://www.google-analytics.com; frame-ancestors 'none'"
  );
  next();
});

// ─── Global request logger ────────────────────────────────────────────────────
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  console.log(`[req] ${req.method} ${req.path}`);
  next();
});

// ─── Stripe webhooks: MUST receive raw body for signature verification ────────
// express.raw() captures the body as a Buffer BEFORE express.json() can touch it.
// The probe middleware below runs between raw() and the router to confirm the
// buffer is intact — look for "[webhook-probe]" lines in logs.
app.use("/webhooks", express.raw({ type: "*/*" }), webhooksRouter);

app.use(express.json());

// ─── Credit purchase ──────────────────────────────────────────────────────────
// Registered as app.post() directly — avoids sub-router mounting path issues.
app.post("/credits/purchase", handleCreditPurchase);

// ─── Static files (signup.html, etc.) ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// ─── Landing page ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(LANDING_HTML);
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "billing-api" });
});

// ─── Plans ────────────────────────────────────────────────────────────────────
app.get("/plans", (_req, res) => {
  const FEATURES: Record<string, string[]> = {
    free:       ["100 credits/month", "All 54 agents", "API access"],
    starter:    ["500 credits/month", "All 54 agents", "API access", "Email support"],
    pro:        ["2,000 credits/month", "All 54 agents", "API access", "Priority support"],
    enterprise: ["10,000 credits/month", "All 54 agents", "API access", "Dedicated support", "Custom integrations"],
  };
  const plans = Object.entries(TIERS).map(([id, t]) => ({
    id,
    name: t.label,
    price_usd: t.price_cents / 100,
    credits_per_month: t.credits,
    features: FEATURES[id] ?? [],
  }));
  res.json({ plans });
});

// ─── Success pages ────────────────────────────────────────────────────────────
app.get("/signup-success", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(successPage("Payment successful! Your API key and setup instructions have been emailed to you."));
});
app.get("/credits-success", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(successPage("Credits added! Your new balance will be reflected immediately."));
});

// ─── Webhook diagnostic endpoint ──────────────────────────────────────────────
// POST /webhook-test — logs everything about the incoming request body & headers
// Used to diagnose Stripe webhook body-parsing issues. Remove after debugging.
app.post("/webhook-test", express.raw({ type: "*/*" }), (req, res) => {
  const info = {
    headers: {
      "content-type": req.headers["content-type"],
      "stripe-signature": req.headers["stripe-signature"]
        ? (req.headers["stripe-signature"] as string).slice(0, 40) + "..."
        : null,
      "transfer-encoding": req.headers["transfer-encoding"],
      "x-forwarded-for": req.headers["x-forwarded-for"],
    },
    body: {
      isBuffer: Buffer.isBuffer(req.body),
      type: typeof req.body,
      length: Buffer.isBuffer(req.body)
        ? req.body.length
        : req.body
        ? JSON.stringify(req.body).length
        : 0,
      preview: Buffer.isBuffer(req.body)
        ? req.body.slice(0, 200).toString("utf8")
        : JSON.stringify(req.body)?.slice(0, 200),
    },
    env: {
      STRIPE_WEBHOOK_SECRET_SET: !!process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_WEBHOOK_SECRET_PREFIX: process.env.STRIPE_WEBHOOK_SECRET
        ? process.env.STRIPE_WEBHOOK_SECRET.slice(0, 10) + "..."
        : null,
      STRIPE_SECRET_KEY_SET: !!process.env.STRIPE_SECRET_KEY,
    },
  };
  console.log("[webhook-test]", JSON.stringify(info, null, 2));
  res.json({ received: true, debug: info });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/signup", signupRouter);
app.use("/verify", verifyRouter);
app.use("/users", usersRouter);
app.use("/credits", creditsRouter);
app.use("/checkout", checkoutRouter);
app.use("/subscription", subscriptionRouter);
app.use("/audit", auditRouter);
app.use("/contact", supportRouter);
app.use("/dashboard", dashboardRouter);
app.use("/manage", manageRouter);

// ─── 404 handler — catches any unmatched route ────────────────────────────────
app.use((req: express.Request, res: express.Response) => {
  console.warn(`[404] ${req.method} ${req.originalUrl} — no route matched`);
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[error]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
);

async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Billing API running on http://localhost:${PORT}`);
    console.log("Stripe configured:", !!process.env.STRIPE_SECRET_KEY);
    console.log("SendGrid configured:", !!process.env.SENDGRID_API_KEY);
  });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

// ─── Page helpers ─────────────────────────────────────────────────────────────

function successPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Orchestra — Success</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background:#0d1117; color:#e6edf3; font-family:-apple-system,sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
    .card { background:#161b22; border:1px solid #30363d; border-radius:12px;
            padding:48px; max-width:480px; width:100%; text-align:center; }
    .icon { font-size:52px; color:#238636; margin-bottom:20px; }
    h1 { font-size:22px; font-weight:700; margin-bottom:16px; }
    p { color:#8b949e; line-height:1.6; }
    a { color:#58a6ff; text-decoration:none; }
    a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Security Orchestra</h1>
    <p>${message}</p>
    <p style="margin-top:20px"><a href="/">Return home</a></p>
  </div>
</body>
</html>`;
}

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Orchestra — Data Center Intelligence Platform</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 40px 24px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .hero { text-align: center; padding: 60px 0 40px; }
    .icon { font-size: 42px; margin-bottom: 20px; }
    h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 12px; }
    .tagline { color: #8b949e; font-size: 16px; margin-bottom: 36px; line-height: 1.5; }
    .btn {
      display: inline-block; background: #238636; color: #fff;
      padding: 14px 32px; border-radius: 8px; text-decoration: none;
      font-weight: 600; font-size: 15px; margin: 0 8px 12px;
      transition: background 0.15s;
    }
    .btn:hover { background: #2ea043; }
    .btn-secondary {
      background: transparent; border: 1px solid #30363d; color: #e6edf3;
    }
    .btn-secondary:hover { background: #161b22; }
    .section { margin: 48px 0; }
    .section-title { font-size: 20px; font-weight: 700; margin-bottom: 20px; color: #f0f6fc; }
    .category { margin-bottom: 32px; }
    .cat-title {
      font-size: 13px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.8px; color: #8b949e; margin-bottom: 12px; padding-bottom: 8px;
      border-bottom: 1px solid #21262d;
    }
    .agents { display: flex; flex-wrap: wrap; gap: 8px; }
    .agent {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 10px 14px; font-size: 13px;
    }
    .agent-name { font-weight: 600; color: #f0f6fc; }
    .agent-cost { font-size: 11px; color: #3fb950; margin-top: 2px; }
    .pricing { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .plan {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px;
    }
    .plan.featured { border-color: #238636; }
    .plan-name { font-weight: 700; font-size: 16px; margin-bottom: 4px; }
    .plan-price { font-size: 24px; font-weight: 700; color: #3fb950; margin-bottom: 4px; }
    .plan-credits { font-size: 13px; color: #8b949e; margin-bottom: 16px; }
    .plan-cta {
      display: block; text-align: center; background: #21262d;
      color: #e6edf3; padding: 10px; border-radius: 6px;
      text-decoration: none; font-weight: 600; font-size: 13px;
    }
    .plan.featured .plan-cta { background: #238636; }
    .plan-cta:hover { opacity: 0.85; }
    .info-block {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 24px; margin-bottom: 16px; font-size: 13px; line-height: 1.7;
    }
    .info-block code {
      background: #0d1117; padding: 2px 6px; border-radius: 4px;
      font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px;
      color: #58a6ff;
    }
    .info-block pre {
      background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
      padding: 16px; overflow-x: auto; margin: 12px 0; font-size: 12px;
      font-family: 'SFMono-Regular', Consolas, monospace; color: #e6edf3; line-height: 1.5;
    }
    .links { display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin: 16px 0; }
    .links a { color: #58a6ff; font-size: 13px; text-decoration: none; }
    .links a:hover { text-decoration: underline; }
    footer { text-align: center; color: #484f58; font-size: 12px; padding: 40px 0 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <div class="icon">&#9670;</div>
      <h1>Security Orchestra</h1>
      <p class="tagline">Data Center Intelligence Platform — 54 AI-powered tools via MCP</p>
      <a href="/signup" class="btn">Get Started Free</a>
      <a href="#pricing" class="btn btn-secondary">View Plans</a>
      <a href="https://security-orchestra-orchestrator.onrender.com/webchat.html" target="_blank" rel="noopener" class="btn btn-secondary">💬 Web Chat</a>
    </div>

    <div class="section">
      <div class="section-title">All 54 Tools</div>

      <div class="category">
        <div class="cat-title">Power Infrastructure (12 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Generator Sizing</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Utility Interconnect</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">NC Utility Interconnect</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">ATS Sizing</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">UPS Sizing</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Fuel Storage</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Cooling Load</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Power Density</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">PUE Calculator</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Redundancy Validator</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Harmonic Analysis</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Voltage Drop</div><div class="agent-cost">20 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Network &amp; Connectivity (6 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Network Topology</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Bandwidth Sizing</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Latency Calculator</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">IP Addressing</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">DNS Architecture</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">BGP Peering</div><div class="agent-cost">50 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Security &amp; Access (6 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Physical Security</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Biometric Design</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Surveillance Coverage</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Cybersecurity Controls</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Compliance Checker</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Fire Suppression</div><div class="agent-cost">20 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Mechanical / HVAC (6 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Chiller Sizing</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">CRAC vs CRAH</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Airflow Modeling</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Humidification</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Economizer Analysis</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Construction Cost</div><div class="agent-cost">5 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Site &amp; Finance (8 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Site Scoring</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">ROI Calculator</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">TCO Analyzer</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Water Availability</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Noise Compliance</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Incentive Finder</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Permit Timeline</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Fiber Connectivity</div><div class="agent-cost">100 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Project &amp; Operations (6 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Construction Timeline</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Commissioning Plan</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Maintenance Schedule</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Capacity Planning</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">SLA Calculator</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Change Management</div><div class="agent-cost">5 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Energy &amp; Sustainability (6 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">Carbon Footprint</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Solar Feasibility</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Battery Storage</div><div class="agent-cost">50 credits</div></div>
          <div class="agent"><div class="agent-name">Energy Procurement</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Demand Response</div><div class="agent-cost">100 credits</div></div>
          <div class="agent"><div class="agent-name">Environmental Impact</div><div class="agent-cost">20 credits</div></div>
        </div>
      </div>

      <div class="category">
        <div class="cat-title">Compliance &amp; Standards (4 tools)</div>
        <div class="agents">
          <div class="agent"><div class="agent-name">NFPA 110 Checker</div><div class="agent-cost">20 credits</div></div>
          <div class="agent"><div class="agent-name">Subdomain Discovery</div><div class="agent-cost">5 credits</div></div>
          <div class="agent"><div class="agent-name">Asset Discovery</div><div class="agent-cost">15 credits</div></div>
          <div class="agent"><div class="agent-name">Vulnerability Assessment</div><div class="agent-cost">25 credits</div></div>
        </div>
      </div>
    </div>

    <!-- Pricing -->
    <div class="section" id="pricing">
      <div class="section-title">Plans &amp; Pricing</div>
      <div class="pricing">
        <div class="plan">
          <div class="plan-name">Free</div>
          <div class="plan-price">$0</div>
          <div class="plan-credits">100 credits / signup</div>
          <a href="/signup" class="plan-cta">Get Started</a>
        </div>
        <div class="plan featured">
          <div class="plan-name">Starter</div>
          <div class="plan-price">$29</div>
          <div class="plan-credits">500 credits</div>
          <a href="/signup?tier=starter" class="plan-cta">Buy Starter</a>
        </div>
        <div class="plan">
          <div class="plan-name">Pro</div>
          <div class="plan-price">$99</div>
          <div class="plan-credits">2,000 credits</div>
          <a href="/signup?tier=pro" class="plan-cta">Buy Pro</a>
        </div>
        <div class="plan">
          <div class="plan-name">Enterprise</div>
          <div class="plan-price">$499</div>
          <div class="plan-credits">10,000 credits</div>
          <a href="/signup?tier=enterprise" class="plan-cta">Buy Enterprise</a>
        </div>
      </div>
      <p style="color:#8b949e;font-size:13px;margin-top:16px;text-align:center">
        Need more credits?
        <a href="#" style="color:#58a6ff" onclick="document.getElementById('topup').scrollIntoView()">Buy credit top-ups</a> — 100 for $10, 250 for $20, 500 for $35.
      </p>
      <div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #d29922;border-radius:6px;padding:12px 16px;margin-top:16px;font-size:13px;color:#c9d1d9">
        &#9888;&#65039; <strong>Credits reset monthly.</strong> Unused credits do not roll over. No refunds on unused credits. <a href="/terms.html" style="color:#58a6ff">Terms of Service</a>
      </div>
    </div>

    <!-- Setup instructions -->
    <div class="section">
      <div class="section-title">Claude Desktop Setup</div>
      <div class="info-block">
        <p>Add this to your <code>claude_desktop_config.json</code>:</p>
        <pre>{
  "mcpServers": {
    "security-orchestra": {
      "url": "https://security-orchestra-orchestrator.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer sk_live_YOUR_API_KEY"
      }
    }
  }
}</pre>
        <p>Config file location:</p>
        <ul style="margin:12px 0 0 20px;line-height:2">
          <li><strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
          <li><strong>Windows:</strong> <code>%APPDATA%\\Claude\\claude_desktop_config.json</code></li>
        </ul>
      </div>
    </div>

    <div class="links">
      <a href="/signup">Sign Up</a>
      <a href="/dashboard">Dashboard</a>
      <a href="/health">API Status</a>
      <a href="mailto:contact.securityorchestra@gmail.com">Support</a>
      <a href="/terms.html">Terms of Service</a>
      <a href="/privacy.html">Privacy Policy</a>
    </div>
  </div>
  <footer>Powered by MCP &mdash; Model Context Protocol &mdash; Security Orchestra &mdash; <a href="/terms.html" style="color:#484f58">Terms of Service</a> &mdash; <a href="/privacy.html" style="color:#484f58">Privacy Policy</a></footer>
</body>
</html>`;
