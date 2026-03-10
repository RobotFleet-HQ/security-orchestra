import { Router, Request, Response, NextFunction } from "express";
import sqlite3 from "sqlite3";
import path from "path";
import { db, dbAll, dbGet, dbRun } from "../database.js";

const router = Router();

// ─── Audit DB (read-only, same path logic as routes/audit.ts) ────────────────

const AUDIT_DB_PATH =
  process.env.AUDIT_DB_PATH ??
  path.join(__dirname, "..", "..", "..", "audit.db");

const auditDb = new sqlite3.Database(AUDIT_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error("[dashboard] Cannot open audit DB (will show N/A):", err.message);
  }
});

function auditAll<T>(sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    auditDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

function auditGet<T>(sql: string, params: unknown[]): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    auditDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(503).send("Dashboard disabled — set ADMIN_PASSWORD env var to enable.");
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Dashboard"');
    res.status(401).send("Authentication required.");
    return;
  }
  const decoded  = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
  if (password !== adminPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Dashboard"');
    res.status(401).send("Invalid credentials.");
    return;
  }
  next();
}

router.use(requireAdmin);

// ─── GET /dashboard/data — JSON feed for the dashboard page ──────────────────

router.get("/data", async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    // Billing DB queries
    const [totalUsers, activeUsers, tierCounts, tickets, unreadCount] = await Promise.all([
      dbGet<{ count: number }>("SELECT COUNT(*) as count FROM users", []),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM credits WHERE updated_at >= ?", [todayIso]
      ),
      dbAll<{ tier: string; count: number }>(
        "SELECT tier, COUNT(*) as count FROM users GROUP BY tier ORDER BY count DESC", []
      ),
      dbAll<{ id: string; email: string; issue_type: string; message: string; status: string; created_at: string }>(
        "SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 50", []
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM support_tickets WHERE status = 'unread'", []
      ),
    ]);

    // Audit DB queries (may be unavailable)
    let callsToday  = 0;
    let errorsToday = 0;
    let errors:    unknown[] = [];
    let workflows: unknown[] = [];
    let activity:  unknown[] = [];
    let lastCallAt: string | null = null;
    let auditStatus = "unavailable";

    try {
      const [callsRow, errorsRow, errorsRows, workflowRows, activityRows, lastCallRow] = await Promise.all([
        auditGet<{ count: number }>(
          "SELECT COUNT(*) as count FROM audit_logs WHERE action = 'workflow_complete' AND timestamp >= ?",
          [todayIso]
        ),
        auditGet<{ count: number }>(
          "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'failure' AND timestamp >= ?",
          [todayIso]
        ),
        auditAll<unknown>(
          `SELECT id, timestamp, user_id, action, resource, result, details, duration_ms
           FROM audit_logs WHERE result = 'failure'
           ORDER BY timestamp DESC LIMIT 100`,
          []
        ),
        auditAll<unknown>(
          `SELECT resource, COUNT(*) as count FROM audit_logs
           WHERE action = 'workflow_complete' AND resource IS NOT NULL
           GROUP BY resource ORDER BY count DESC`,
          []
        ),
        auditAll<unknown>(
          `SELECT id, timestamp, user_id, action, resource, result, duration_ms
           FROM audit_logs ORDER BY timestamp DESC LIMIT 30`,
          []
        ),
        auditGet<{ timestamp: string }>(
          "SELECT timestamp FROM audit_logs WHERE action = 'workflow_complete' ORDER BY timestamp DESC LIMIT 1",
          []
        ),
      ]);

      callsToday  = callsRow?.count  ?? 0;
      errorsToday = errorsRow?.count ?? 0;
      errors      = errorsRows;
      workflows   = workflowRows;
      activity    = activityRows;
      lastCallAt  = lastCallRow?.timestamp ?? null;
      auditStatus = "ok";
    } catch {
      // audit.db not yet written (orchestrator not started) — non-fatal
    }

    return res.json({
      stats: {
        calls_today:    callsToday,
        active_users:   activeUsers?.count  ?? 0,
        total_users:    totalUsers?.count   ?? 0,
        errors_today:   errorsToday,
        unread_tickets: unreadCount?.count  ?? 0,
      },
      health: {
        billing_db:      "ok",
        audit_db:        auditStatus,
        last_call_at:    lastCallAt,
        uptime_seconds:  Math.floor(process.uptime()),
      },
      tier_counts: tierCounts,
      errors,
      workflows,
      activity,
      tickets,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

// ─── POST /dashboard/tickets/:id/read — mark support ticket read ──────────────

router.post("/tickets/:id/read", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await dbRun("UPDATE support_tickets SET status = 'read' WHERE id = ?", [id]);
    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

// ─── GET /dashboard — HTML page ───────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Orchestra — Admin</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d1117; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }
    header { background: #161b22; border-bottom: 1px solid #30363d; padding: 14px 24px; display: flex; align-items: center; gap: 14px; }
    header h1 { font-size: 17px; font-weight: 600; color: #58a6ff; letter-spacing: -0.3px; }
    .spacer { flex: 1; }
    #last-updated { color: #8b949e; font-size: 12px; }
    header button { background: #238636; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    header button:hover { background: #2ea043; }
    .container { padding: 20px 24px; max-width: 1400px; margin: 0 auto; }
    .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 18px; }
    .stat-card .label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px; }
    .stat-card .value { font-size: 30px; font-weight: 700; color: #e6edf3; }
    .stat-card.alert .value { color: #f85149; }
    .stat-card.warn  .value { color: #d29922; }
    .stat-card.ok    .value { color: #3fb950; }
    .grid-3 { display: grid; grid-template-columns: 280px 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .panel:last-child { margin-bottom: 0; }
    .panel h2 { font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    .badge { background: #f85149; color: #fff; border-radius: 10px; padding: 1px 7px; font-size: 11px; font-weight: 600; }
    .badge.warn { background: #9e6a03; color: #e3b341; }
    .health-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .health-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #0d1117; border-radius: 6px; }
    .health-item.span2 { grid-column: span 2; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.ok   { background: #3fb950; box-shadow: 0 0 4px #3fb95088; }
    .dot.err  { background: #f85149; box-shadow: 0 0 4px #f8514988; }
    .dot.warn { background: #d29922; box-shadow: 0 0 4px #d2992288; }
    .hi-label { color: #8b949e; font-size: 11px; min-width: 70px; }
    .hi-value { color: #e6edf3; font-size: 12px; font-weight: 500; }
    .tier-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #21262d; font-size: 12px; }
    .tier-row:last-child { border-bottom: none; }
    .tier-name { color: #8b949e; text-transform: capitalize; }
    .tier-count { font-weight: 600; }
    #workflow-chart-wrap { position: relative; height: 190px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; color: #8b949e; font-weight: 600; padding: 5px 8px; border-bottom: 1px solid #30363d; white-space: nowrap; }
    td { padding: 6px 8px; border-bottom: 1px solid #21262d; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #1c2128; }
    .ts { color: #8b949e; font-size: 11px; white-space: nowrap; }
    .mono { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11px; }
    .badge-r { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-r.success { background: #1a3a1e; color: #3fb950; }
    .badge-r.failure { background: #3d1616; color: #f85149; }
    .badge-r.blocked { background: #2e2200; color: #d29922; }
    .detail-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8b949e; cursor: help; }
    .overflow-table { overflow-x: auto; max-height: 380px; overflow-y: auto; }
    .ticket { border: 1px solid #30363d; border-radius: 6px; padding: 12px 14px; margin-bottom: 8px; }
    .ticket.unread { border-color: #388bfd55; background: #0e1e2e; }
    .t-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
    .t-email { color: #58a6ff; font-weight: 600; font-size: 13px; }
    .t-type { background: #21262d; padding: 2px 8px; border-radius: 10px; font-size: 11px; color: #8b949e; }
    .t-time { color: #8b949e; font-size: 11px; margin-left: auto; }
    .t-msg { color: #c9d1d9; font-size: 13px; line-height: 1.5; }
    .t-btn { margin-top: 8px; background: #21262d; color: #8b949e; border: 1px solid #30363d; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
    .t-btn:hover { color: #e6edf3; border-color: #8b949e; }
    .empty { color: #484f58; text-align: center; padding: 24px 0; font-size: 13px; }
    @media (max-width: 960px) {
      .stats-grid { grid-template-columns: repeat(3, 1fr); }
      .grid-3 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>&#9670; Security Orchestra</h1>
    <span class="spacer"></span>
    <span id="last-updated">Loading…</span>
    <button onclick="loadData()">&#8635; Refresh</button>
  </header>

  <div class="container">

    <!-- Stat cards -->
    <div class="stats-grid">
      <div class="stat-card ok">
        <div class="label">Calls Today</div>
        <div class="value" id="sc-calls">—</div>
      </div>
      <div class="stat-card">
        <div class="label">Active Users</div>
        <div class="value" id="sc-active">—</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Users</div>
        <div class="value" id="sc-total">—</div>
      </div>
      <div class="stat-card" id="card-errors">
        <div class="label">Errors Today</div>
        <div class="value" id="sc-errors">—</div>
      </div>
      <div class="stat-card" id="card-tickets">
        <div class="label">Unread Tickets</div>
        <div class="value" id="sc-tickets">—</div>
      </div>
    </div>

    <!-- Health / Workflows / Activity -->
    <div class="grid-3">

      <div class="panel" style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <h2>System Health</h2>
          <div class="health-grid">
            <div class="health-item">
              <div class="dot ok" id="dot-billing"></div>
              <span class="hi-label">Billing DB</span>
              <span class="hi-value" id="hv-billing">—</span>
            </div>
            <div class="health-item">
              <div class="dot warn" id="dot-audit"></div>
              <span class="hi-label">Audit DB</span>
              <span class="hi-value" id="hv-audit">—</span>
            </div>
            <div class="health-item span2">
              <div class="dot ok"></div>
              <span class="hi-label">Last Call</span>
              <span class="hi-value" id="hv-lastcall">—</span>
            </div>
            <div class="health-item span2">
              <div class="dot ok"></div>
              <span class="hi-label">Uptime</span>
              <span class="hi-value" id="hv-uptime">—</span>
            </div>
          </div>
        </div>
        <div>
          <h2>Tier Distribution</h2>
          <div id="tier-dist"><div class="empty">No users yet</div></div>
        </div>
      </div>

      <div class="panel">
        <h2>Workflow Usage</h2>
        <div id="workflow-chart-wrap"><canvas id="wf-chart"></canvas></div>
        <div id="wf-empty" class="empty" style="display:none">No workflow data yet</div>
      </div>

      <div class="panel" style="overflow:hidden;">
        <h2>Recent Activity</h2>
        <div style="overflow-y:auto;max-height:300px;">
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Result</th></tr></thead>
            <tbody id="activity-body"></tbody>
          </table>
          <div id="activity-empty" class="empty" style="display:none">No activity yet</div>
        </div>
      </div>

    </div>

    <!-- Error Log -->
    <div class="panel">
      <h2>Error Log <span class="badge" id="err-badge" style="display:none"></span></h2>
      <div class="overflow-table">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Workflow</th><th>Action</th><th>Details</th><th>ms</th></tr></thead>
          <tbody id="error-body"></tbody>
        </table>
        <div id="error-empty" class="empty" style="display:none">No errors recorded</div>
      </div>
    </div>

    <!-- Support Tickets -->
    <div class="panel">
      <h2>Support Tickets <span class="badge warn" id="ticket-badge" style="display:none"></span></h2>
      <div id="tickets-list"></div>
      <div id="tickets-empty" class="empty" style="display:none">No support tickets</div>
    </div>

  </div>

  <script>
    var wfChart = null;

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function fmtTs(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString();
    }
    function fmtTsShort(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleTimeString();
    }
    function fmtUptime(sec) {
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    async function markRead(id) {
      await fetch('/dashboard/tickets/' + id + '/read', { method: 'POST' });
      loadData();
    }

    async function loadData() {
      try {
        var resp = await fetch('/dashboard/data');
        if (!resp.ok) { document.getElementById('last-updated').textContent = 'Error ' + resp.status; return; }
        var d = await resp.json();
        renderStats(d.stats || {});
        renderHealth(d.health || {});
        renderTiers(d.tier_counts || []);
        renderWorkflows(d.workflows || []);
        renderActivity(d.activity || []);
        renderErrors(d.errors || []);
        renderTickets(d.tickets || []);
        document.getElementById('last-updated').textContent = 'Updated ' + fmtTsShort(new Date().toISOString());
      } catch(e) {
        document.getElementById('last-updated').textContent = 'Failed: ' + e.message;
      }
    }

    function renderStats(s) {
      document.getElementById('sc-calls').textContent   = s.calls_today    ?? '—';
      document.getElementById('sc-active').textContent  = s.active_users   ?? '—';
      document.getElementById('sc-total').textContent   = s.total_users    ?? '—';
      document.getElementById('sc-errors').textContent  = s.errors_today   ?? '—';
      document.getElementById('sc-tickets').textContent = s.unread_tickets ?? '—';
      document.getElementById('card-errors').className  = 'stat-card ' + (s.errors_today  > 0 ? 'alert' : 'ok');
      document.getElementById('card-tickets').className = 'stat-card ' + (s.unread_tickets > 0 ? 'warn'  : 'ok');
    }

    function renderHealth(h) {
      var billingOk = h.billing_db === 'ok', auditOk = h.audit_db === 'ok';
      document.getElementById('dot-billing').className = 'dot ' + (billingOk ? 'ok' : 'err');
      document.getElementById('hv-billing').textContent = billingOk ? 'Connected' : 'Error';
      document.getElementById('dot-audit').className   = 'dot ' + (auditOk ? 'ok' : 'warn');
      document.getElementById('hv-audit').textContent  = auditOk ? 'Connected' : 'Unavailable';
      document.getElementById('hv-lastcall').textContent = h.last_call_at ? fmtTs(h.last_call_at) : 'None yet';
      document.getElementById('hv-uptime').textContent   = fmtUptime(h.uptime_seconds || 0);
    }

    function renderTiers(tiers) {
      var el = document.getElementById('tier-dist');
      if (!tiers.length) { el.innerHTML = '<div class="empty">No users yet</div>'; return; }
      el.innerHTML = tiers.map(function(t) {
        return '<div class="tier-row"><span class="tier-name">' + esc(t.tier) + '</span><span class="tier-count">' + t.count + '</span></div>';
      }).join('');
    }

    function renderWorkflows(wfs) {
      var wrap = document.getElementById('workflow-chart-wrap');
      var empty = document.getElementById('wf-empty');
      if (!wfs.length) { wrap.style.display = 'none'; empty.style.display = ''; return; }
      wrap.style.display = ''; empty.style.display = 'none';
      var labels = wfs.map(function(w) { return w.resource.replace(/_/g,' '); });
      var values = wfs.map(function(w) { return w.count; });
      var colors = ['#58a6ff','#3fb950','#d2a679','#f78166','#a5d6ff','#7ee787'];
      if (wfChart) wfChart.destroy();
      var ctx = document.getElementById('wf-chart').getContext('2d');
      wfChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: values, backgroundColor: labels.map(function(_,i){ return colors[i % colors.length]; }), borderRadius: 4 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8b949e', font: { size: 11 } }, grid: { color: '#21262d' } },
            y: { ticks: { color: '#8b949e', font: { size: 11 } }, grid: { color: '#21262d' } }
          }
        }
      });
    }

    function renderActivity(rows) {
      var tbody = document.getElementById('activity-body');
      var empty = document.getElementById('activity-empty');
      if (!rows.length) { tbody.innerHTML = ''; empty.style.display = ''; return; }
      empty.style.display = 'none';
      tbody.innerHTML = rows.map(function(r) {
        return '<tr>' +
          '<td class="ts">'   + fmtTsShort(r.timestamp) + '</td>' +
          '<td class="mono">' + esc(r.user_id) + '</td>' +
          '<td>' + esc(r.action) + (r.resource ? ' <span style="color:#8b949e;font-size:11px;">(' + esc(r.resource) + ')</span>' : '') + '</td>' +
          '<td><span class="badge-r ' + esc(r.result) + '">' + esc(r.result) + '</span></td>' +
          '</tr>';
      }).join('');
    }

    function renderErrors(rows) {
      var tbody = document.getElementById('error-body');
      var empty = document.getElementById('error-empty');
      var badge = document.getElementById('err-badge');
      if (!rows.length) { tbody.innerHTML = ''; empty.style.display = ''; badge.style.display = 'none'; return; }
      empty.style.display = 'none';
      badge.textContent = rows.length; badge.style.display = '';
      tbody.innerHTML = rows.map(function(r) {
        var detail = '';
        if (r.details) {
          try {
            var d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            detail = d.message || d.reason || JSON.stringify(d);
          } catch(e) { detail = String(r.details); }
        }
        return '<tr>' +
          '<td class="ts">'   + fmtTsShort(r.timestamp) + '</td>' +
          '<td class="mono">' + esc(r.user_id) + '</td>' +
          '<td>'              + esc(r.resource || '—') + '</td>' +
          '<td>'              + esc(r.action) + '</td>' +
          '<td class="detail-cell" title="' + esc(detail) + '">' + esc(detail) + '</td>' +
          '<td class="ts">'   + (r.duration_ms != null ? r.duration_ms : '—') + '</td>' +
          '</tr>';
      }).join('');
    }

    function renderTickets(tickets) {
      var el    = document.getElementById('tickets-list');
      var empty = document.getElementById('tickets-empty');
      var badge = document.getElementById('ticket-badge');
      var unread = tickets.filter(function(t){ return t.status === 'unread'; }).length;
      if (!tickets.length) { el.innerHTML = ''; empty.style.display = ''; badge.style.display = 'none'; return; }
      empty.style.display = 'none';
      badge.textContent = unread > 0 ? unread + ' unread' : '';
      badge.style.display = unread > 0 ? '' : 'none';
      el.innerHTML = tickets.map(function(t) {
        return '<div class="ticket ' + esc(t.status) + '">' +
          '<div class="t-head">' +
          '<span class="t-email">' + esc(t.email) + '</span>' +
          '<span class="t-type">'  + esc(t.issue_type) + '</span>' +
          '<span class="t-time">'  + fmtTs(t.created_at) + '</span>' +
          '</div>' +
          '<div class="t-msg">' + esc(t.message) + '</div>' +
          (t.status === 'unread' ? '<button class="t-btn" onclick="markRead(\'' + esc(t.id) + '\')">Mark as read</button>' : '') +
          '</div>';
      }).join('');
    }

    loadData();
    setInterval(loadData, 30000);
  </script>
</body>
</html>`;

router.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(DASHBOARD_HTML);
});

export default router;
