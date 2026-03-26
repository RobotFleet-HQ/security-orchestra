import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  Alert, UcpSession, ApprovalRequest, TimelineEvent,
  Playbook, PlaybookExecution, AgentCommand,
  SocMetrics, Notification, Ticket, A2ATask, A2AAgent, ServiceHealth
} from './types';

// ─── Styles ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#0d0d0d', surface: '#141414', surface2: '#1a1a1a', surface3: '#1f1f1f',
  border: '#2a2a2a', border2: '#222',
  text: '#e0e0e0', muted: '#888', dim: '#555',
  green: '#00ff88', red: '#ff4757', orange: '#ff6b35', yellow: '#ffd32a', blue: '#2e86de',
  critical: '#ff4757', high: '#ff6b35', medium: '#ffd32a', low: '#2e86de',
};

const s = {
  col: { display: 'flex', flexDirection: 'column' as const },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
};

// ─── Severity helpers ────────────────────────────────────────────────────────
const sevColor = (sev: string) => ({ critical: C.critical, high: C.high, medium: C.medium, low: C.low }[sev] ?? C.muted);
const sevBg = (sev: string) => ({ critical: '#2a0a0a', high: '#2a1200', medium: '#2a2000', low: '#0a1a2a' }[sev] ?? '#1a1a1a');

// ─── useInterval ─────────────────────────────────────────────────────────────
function useInterval(cb: () => void, ms: number) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);
  useEffect(() => { const id = setInterval(() => ref.current(), ms); return () => clearInterval(id); }, [ms]);
}

// ─── useFetch ────────────────────────────────────────────────────────────────
function useFetch<T>(url: string, interval: number, fallback: T): [T, boolean] {
  const [data, setData] = useState<T>(fallback);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    try { const r = await fetch(url); if (r.ok) { setData(await r.json()); setErr(false); } else setErr(true); }
    catch { setErr(true); }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  useInterval(load, interval);
  return [data, err];
}

// ─── useServiceHealth ─────────────────────────────────────────────────────────
function useServiceHealth(): ServiceHealth[] {
  const SERVICES = [
    { name: 'orchestrator', label: 'Orchestrator', url: '/api/orchestrator/health' },
    { name: 'siem-connector', label: 'SIEM', url: '/api/siem/health' },
    { name: 'ucp', label: 'UCP', url: '/api/ucp/health' },
    { name: 'ap2', label: 'AP2', url: '/api/ap2/health' },
    { name: 'timeline', label: 'Timeline', url: '/api/timeline/health' },
    { name: 'playbook-builder', label: 'Playbooks', url: '/api/playbooks/health' },
    { name: 'a2ui', label: 'A2UI', url: '/api/a2ui/health' },
    { name: 'soc-dashboard', label: 'Metrics', url: '/api/soc/health' },
    { name: 'notifications', label: 'Notify', url: '/api/notifications/health' },
    { name: 'ticketing-bridge', label: 'Tickets', url: '/api/tickets/health' },
    { name: 'a2a', label: 'A2A', url: '/api/a2a/health' },
  ];
  const [statuses, setStatuses] = useState<ServiceHealth[]>(
    SERVICES.map(svc => ({ name: svc.name, label: svc.label, status: 'unknown' as const }))
  );
  const check = useCallback(async () => {
    const results = await Promise.all(SERVICES.map(async (svc) => {
      try { const r = await fetch(svc.url, { signal: AbortSignal.timeout(2000) }); return { name: svc.name, label: svc.label, status: r.ok ? 'up' as const : 'down' as const }; }
      catch { return { name: svc.name, label: svc.label, status: 'down' as const }; }
    }));
    setStatuses(results);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { check(); }, [check]);
  useInterval(check, 10000);
  return statuses;
}

// ─── TopNav ──────────────────────────────────────────────────────────────────
function TopNav({ services }: { services: ServiceHealth[] }) {
  const [time, setTime] = useState(new Date());
  useInterval(() => setTime(new Date()), 1000);
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, height: 54, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8 }}>
        <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg,#00ff88,#00c8ff)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, color: '#000' }}>SRO</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>Security Response Orchestration</div>
          <div style={{ fontSize: 10, color: C.muted }}>Live SOC Dashboard</div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap', overflow: 'hidden' }}>
        {services.map(svc => (
          <div key={svc.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.muted }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: svc.status === 'up' ? C.green : svc.status === 'down' ? C.red : '#555', boxShadow: svc.status === 'up' ? `0 0 6px ${C.green}` : 'none' }} />
            {svc.label}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: C.muted }}>
          <span style={{ color: C.green, fontWeight: 700 }}>Analyst: </span>rsaun
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: C.green }}>
          {time.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>
    </div>
  );
}

// ─── Alert Feed ───────────────────────────────────────────────────────────────
function AlertFeed({ onSelect, selectedId }: { onSelect: (a: Alert) => void; selectedId?: string }) {
  const [alerts] = useFetch<Alert[]>('/api/siem/alerts', 5000, []);
  return (
    <div style={{ ...s.col, width: 280, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' }}>Alert Feed</span>
        <span style={{ fontSize: 10, color: C.green }}>● Live</span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {alerts.slice(0, 10).map(alert => (
          <div key={alert.id} onClick={() => onSelect(alert)}
            style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border2}`, cursor: 'pointer', background: selectedId === alert.id ? sevBg(alert.severity) : 'transparent', borderLeft: selectedId === alert.id ? `3px solid ${sevColor(alert.severity)}` : '3px solid transparent', transition: 'background 0.15s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: sevColor(alert.severity), textTransform: 'uppercase', background: sevBg(alert.severity), padding: '1px 6px', borderRadius: 3 }}>{alert.severity}</span>
              <span style={{ fontSize: 9, color: C.dim }}>{alert.id}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, marginBottom: 3 }}>{alert.title}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{alert.source} · {new Date(alert.timestamp).toLocaleTimeString()}</div>
            {alert.mitre && <div style={{ fontSize: 9, color: '#5e6ea8', marginTop: 2 }}>{alert.mitre}</div>}
          </div>
        ))}
        {alerts.length === 0 && <div style={{ padding: 20, color: C.dim, fontSize: 12, textAlign: 'center' }}>No alerts</div>}
      </div>
    </div>
  );
}

// ─── Tab system ───────────────────────────────────────────────────────────────
function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      {tabs.map(tab => (
        <button key={tab} onClick={() => onChange(tab)}
          style={{ padding: '10px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', color: active === tab ? C.green : C.muted, borderBottom: active === tab ? `2px solid ${C.green}` : '2px solid transparent', marginBottom: -1, transition: 'all 0.15s' }}>
          {tab}
        </button>
      ))}
    </div>
  );
}

// ─── Active Incident Tab ──────────────────────────────────────────────────────
function ActiveIncident({ alert }: { alert: Alert | null }) {
  const [session, setSession] = useState<UcpSession | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  const startRemediation = async () => {
    if (!alert) return;
    const r = await fetch('/api/ucp/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId: alert.id }) });
    if (r.ok) setSession(await r.json());
  };

  const requestApproval = async () => {
    if (!alert) return;
    const r = await fetch('/api/ap2/actions/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId: alert.id, action: 'Full Host Isolation + Memory Dump', requestedBy: 'rsaun' }) });
    if (r.ok) setApproval(await r.json());
  };

  // Poll session
  useInterval(async () => {
    if (session && session.status === 'running') {
      const r = await fetch(`/api/ucp/sessions/${session.id}`);
      if (r.ok) setSession(await r.json());
    }
  }, 2000);

  // Poll approval
  useInterval(async () => {
    if (approval && approval.status === 'pending') {
      const r = await fetch(`/api/ap2/actions/request/${approval.id}`);
      if (r.ok) setApproval(await r.json());
    }
  }, 1500);

  if (!alert) return <div style={{ flex: 1, ...s.center, color: C.muted, fontSize: 13 }}>Select an alert from the feed</div>;

  const doneSteps = session?.steps.filter(step => step.status === 'done').length ?? 0;
  const totalSteps = session?.steps.length ?? 0;
  const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      {/* Alert header */}
      <div style={{ background: sevBg(alert.severity), border: `1px solid ${sevColor(alert.severity)}33`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: sevColor(alert.severity), background: `${sevColor(alert.severity)}22`, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' }}>{alert.severity}</span>
          <span style={{ fontSize: 11, color: C.muted }}>{alert.id}</span>
          <span style={{ fontSize: 11, color: C.muted }}>·</span>
          <span style={{ fontSize: 11, color: C.muted }}>{alert.source}</span>
          {alert.mitre && <span style={{ fontSize: 10, color: '#5e6ea8', marginLeft: 'auto' }}>MITRE {alert.mitre}</span>}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{alert.title}</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{alert.description}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11 }}>
          {alert.ip && <span style={{ color: C.muted }}>IP: <span style={{ color: C.orange }}>{alert.ip}</span></span>}
          {alert.user && <span style={{ color: C.muted }}>User: <span style={{ color: C.yellow }}>{alert.user}</span></span>}
          <span style={{ color: C.muted }}>{new Date(alert.timestamp).toLocaleString()}</span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button onClick={startRemediation} disabled={!!session}
          style={{ padding: '8px 16px', background: session ? '#1a1a1a' : C.green, color: session ? C.dim : '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: session ? 'default' : 'pointer' }}>
          {session ? '✓ Remediation Started' : '▶ Start Remediation'}
        </button>
        <button onClick={requestApproval} disabled={!!approval}
          style={{ padding: '8px 16px', background: approval ? '#1a1a1a' : '#1e3a5f', color: approval ? C.dim : C.blue, border: `1px solid ${approval ? C.border : C.blue}`, borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: approval ? 'default' : 'pointer' }}>
          {approval ? `✓ Approval ${approval.status}` : '🔐 Request Action Approval'}
        </button>
      </div>

      {/* UCP Progress */}
      {session && (
        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Remediation Progress</span>
            <span style={{ fontSize: 11, color: session.status === 'completed' ? C.green : C.yellow }}>{session.status}</span>
          </div>
          <div style={{ height: 6, background: C.surface3, borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${C.green},#00c8ff)`, borderRadius: 3, transition: 'width 0.5s' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {session.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${step.status === 'done' ? C.green : step.status === 'running' ? C.yellow : C.border}`, background: step.status === 'done' ? C.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#000', flexShrink: 0 }}>
                  {step.status === 'done' ? '✓' : step.status === 'running' ? '…' : ''}
                </div>
                <span style={{ color: step.status === 'done' ? C.text : step.status === 'running' ? C.yellow : C.dim }}>{step.name}</span>
                {step.completedAt && <span style={{ marginLeft: 'auto', color: C.dim, fontSize: 10 }}>{new Date(step.completedAt).toLocaleTimeString()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval status */}
      {approval && (
        <div style={{ background: C.surface2, border: `1px solid ${approval.status === 'approved' ? C.green + '44' : C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Approval Request {approval.id}</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Action: {approval.action}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: approval.status === 'approved' ? C.green : approval.status === 'denied' ? C.red : C.yellow }} />
            <span style={{ fontSize: 12, color: approval.status === 'approved' ? C.green : approval.status === 'denied' ? C.red : C.yellow, fontWeight: 600 }}>{approval.status.toUpperCase()}</span>
            {approval.reason && <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{approval.reason}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────
function Timeline({ alert }: { alert: Alert | null }) {
  const [events] = useFetch<TimelineEvent[]>(alert ? `/api/timeline/incidents/${alert.id}/timeline` : '', 10000, []);
  if (!alert) return <div style={{ flex: 1, ...s.center, color: C.muted, fontSize: 13 }}>Select an alert to view timeline</div>;
  const actorColor = (t: string) => ({ system: C.blue, analyst: C.green, attacker: C.red, automation: C.yellow }[t] ?? C.muted);
  const eventBg = (sv?: string) => ({ critical: '#2a0a0a', warning: '#2a1a00', info: C.surface2 }[sv ?? ''] ?? C.surface2);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Incident Timeline — {alert.id}</div>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 16, top: 0, bottom: 0, width: 2, background: C.border }} />
        {events.map((ev) => (
          <div key={ev.id} style={{ display: 'flex', gap: 16, marginBottom: 16, paddingLeft: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: actorColor(ev.actorType), border: `2px solid ${C.bg}`, flexShrink: 0, marginTop: 2, zIndex: 1 }} />
            <div style={{ flex: 1, background: eventBg(ev.severity), border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{ev.action}</span>
                <span style={{ fontSize: 10, color: C.dim }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{ev.detail}</div>
              <span style={{ fontSize: 10, color: actorColor(ev.actorType), fontWeight: 600 }}>{ev.actor}</span>
            </div>
          </div>
        ))}
        {events.length === 0 && <div style={{ paddingLeft: 32, color: C.dim, fontSize: 12 }}>Loading timeline…</div>}
      </div>
    </div>
  );
}

// ─── Playbooks Tab ────────────────────────────────────────────────────────────
function PlaybooksTab() {
  const [playbooks] = useFetch<Playbook[]>('/api/playbooks/playbooks', 30000, []);
  const [executions, setExecutions] = useState<Record<string, PlaybookExecution>>({});

  const execute = async (id: string) => {
    const r = await fetch(`/api/playbooks/playbooks/${id}/execute`, { method: 'POST' });
    if (r.ok) { const ex: PlaybookExecution = await r.json(); setExecutions(prev => ({ ...prev, [id]: ex })); }
  };

  useInterval(async () => {
    for (const [pbId, exec] of Object.entries(executions)) {
      if (exec.status === 'running') {
        const r = await fetch(`/api/playbooks/executions/${exec.id}`);
        if (r.ok) { const updated: PlaybookExecution = await r.json(); setExecutions(prev => ({ ...prev, [pbId]: updated })); }
      }
    }
  }, 2000);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      {playbooks.map(pb => {
        const exec = executions[pb.id];
        const done = exec?.steps.filter(step => step.status === 'done').length ?? 0;
        const total = exec?.steps.length ?? 0;
        return (
          <div key={pb.id} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{pb.name}</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{pb.description}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {pb.triggerConditions.map(cond => <span key={cond} style={{ fontSize: 9, color: C.blue, background: '#0a1a2a', padding: '1px 6px', borderRadius: 3 }}>{cond}</span>)}
                </div>
              </div>
              <button onClick={() => execute(pb.id)} disabled={exec?.status === 'running'}
                style={{ padding: '6px 14px', background: exec ? '#1a1a1a' : C.green, color: exec ? C.dim : '#000', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: exec?.status === 'running' ? 'default' : 'pointer', flexShrink: 0 }}>
                {exec?.status === 'running' ? 'Running…' : exec?.status === 'completed' ? '✓ Done' : '▶ Execute'}
              </button>
            </div>
            {exec && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 4, background: C.surface3, borderRadius: 2, marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${total > 0 ? Math.round((done / total) * 100) : 0}%`, background: exec.status === 'completed' ? C.green : C.yellow, borderRadius: 2, transition: 'width 0.4s' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {exec.steps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: step.status === 'done' ? C.green : step.status === 'running' ? C.yellow : C.dim }}>
                      <span>{step.status === 'done' ? '✓' : step.status === 'running' ? '⟳' : '○'}</span>
                      <span>{step.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!exec && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {pb.steps.map((step) => (
                  <div key={step.id} style={{ fontSize: 10, color: C.dim, background: C.surface3, padding: '2px 8px', borderRadius: 3 }}>{step.name}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Agent Control Tab (a2ui) ─────────────────────────────────────────────────
function AgentControl() {
  const [commands, setCommands] = useState<AgentCommand[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://${location.host}/ws/a2ui`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const cmd: AgentCommand = JSON.parse(e.data as string);
          setCommands(prev => {
            const idx = prev.findIndex(c => c.id === cmd.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = cmd; return next; }
            return [cmd, ...prev].slice(0, 30);
          });
          setTimeout(() => listRef.current?.firstElementChild?.scrollIntoView({ behavior: 'smooth' }), 50);
        } catch { /* ignore */ }
      };
      ws.onclose = () => setTimeout(connect, 3000);
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const typeColor = (t: string) => ({ contain: C.red, investigate: C.yellow, remediate: C.green, notify: C.blue, scan: C.orange, block: C.red }[t] ?? C.muted);
  const typeIcon = (t: string) => ({ contain: '🔒', investigate: '🔍', remediate: '🛠', notify: '📣', scan: '🌐', block: '🚫' }[t] ?? '⚙');

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Live Agent Command Stream</div>
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {commands.map(cmd => (
          <div key={cmd.id} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{typeIcon(cmd.type)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: typeColor(cmd.type), textTransform: 'uppercase' }}>{cmd.type}</span>
                <span style={{ fontSize: 11, color: C.text }}>{cmd.target}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: cmd.status === 'done' ? C.green : cmd.status === 'executing' ? C.yellow : C.dim, fontWeight: 600 }}>{cmd.status}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>{cmd.reason}</div>
            </div>
            <div style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>{new Date(cmd.timestamp).toLocaleTimeString()}</div>
          </div>
        ))}
        {commands.length === 0 && <div style={{ color: C.dim, fontSize: 12 }}>Connecting to agent stream…</div>}
      </div>
    </div>
  );
}

// ─── Incident Workspace ───────────────────────────────────────────────────────
function IncidentWorkspace({ alert }: { alert: Alert | null }) {
  const [tab, setTab] = useState('Active Incident');
  const TABS = ['Active Incident', 'Timeline', 'Playbooks', 'Agent Control'];
  return (
    <div style={{ ...s.col, flex: 1, background: C.bg, overflow: 'hidden' }}>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'Active Incident' && <ActiveIncident alert={alert} />}
      {tab === 'Timeline' && <Timeline alert={alert} />}
      {tab === 'Playbooks' && <PlaybooksTab />}
      {tab === 'Agent Control' && <AgentControl />}
    </div>
  );
}

// ─── SOC Metrics sidebar ──────────────────────────────────────────────────────
function SocMetricsSidebar() {
  const [metrics] = useFetch<SocMetrics | null>('/api/soc/metrics/summary', 30000, null);
  if (!metrics) return <div style={{ width: 240, background: C.surface, borderLeft: `1px solid ${C.border}`, ...s.center }}><span style={{ color: C.dim, fontSize: 12 }}>Loading…</span></div>;
  const MetricCard = ({ label, value, unit, trend }: { label: string; value: number; unit?: string; trend: number }) => (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{value}</span>
        {unit && <span style={{ fontSize: 11, color: C.muted }}>{unit}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: trend > 0 ? C.red : C.green }}>{trend > 0 ? '▲' : '▼'} {Math.abs(trend)}</span>
      </div>
    </div>
  );
  return (
    <div style={{ width: 240, flexShrink: 0, background: C.surface, borderLeft: `1px solid ${C.border}`, ...s.col, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' }}>SOC Metrics</span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '12px 12px 0' }}>
        <MetricCard label="MTTD" value={metrics.mttd.value} unit={metrics.mttd.unit} trend={metrics.mttd.trend} />
        <MetricCard label="MTTR" value={metrics.mttr.value} unit={metrics.mttr.unit} trend={metrics.mttr.trend} />
        <MetricCard label="Open Incidents" value={metrics.openIncidents.value} trend={metrics.openIncidents.trend} />
        <MetricCard label="Alert Volume" value={metrics.alertVolume.value} unit={metrics.alertVolume.unit} trend={metrics.alertVolume.trend} />
        <MetricCard label="False Positives" value={metrics.falsePositiveRate.value} unit={metrics.falsePositiveRate.unit} trend={metrics.falsePositiveRate.trend} />
        <MetricCard label="SLA Compliance" value={metrics.slaCompliance.value} unit={metrics.slaCompliance.unit} trend={metrics.slaCompliance.trend} />
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '8px 0 6px' }}>Analyst Workload</div>
        {metrics.analysts.map(a => (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border2}`, fontSize: 11 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: a.status === 'active' ? C.green : a.status === 'break' ? C.yellow : C.dim, flexShrink: 0 }} />
            <span style={{ color: C.text, fontWeight: 600 }}>{a.name}</span>
            <span style={{ marginLeft: 'auto', color: C.muted }}>{a.assignedCases} open</span>
          </div>
        ))}
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 6px' }}>Top Rules</div>
        {metrics.topRules.map(r => (
          <div key={r.rule} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${C.border2}`, fontSize: 10 }}>
            <span style={{ color: C.muted, flex: 1, marginRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rule}</span>
            <span style={{ color: sevColor(r.severity), fontWeight: 700, flexShrink: 0 }}>{r.hits}</span>
          </div>
        ))}
        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}

// ─── Bottom Bar ───────────────────────────────────────────────────────────────
function BottomBar({ alert }: { alert: Alert | null }) {
  const [notifications] = useFetch<Notification[]>('/api/notifications/notifications', 10000, []);
  const [tickets] = useFetch<Ticket[]>('/api/tickets/tickets', 10000, []);
  const [expanded, setExpanded] = useState(false);
  const [slackMsg, setSlackMsg] = useState('');
  const [ticketTitle, setTicketTitle] = useState('');
  const [sending, setSending] = useState(false);

  const sendSlack = async () => {
    if (!slackMsg.trim()) return;
    setSending(true);
    await fetch('/api/notifications/notify/slack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: slackMsg }) });
    setSlackMsg('');
    setSending(false);
  };

  const createTicket = async () => {
    if (!ticketTitle.trim()) return;
    setSending(true);
    await fetch('/api/tickets/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ticketTitle, alertId: alert?.id, severity: alert?.severity ?? 'medium' }) });
    setTicketTitle('');
    setSending(false);
  };

  return (
    <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 16px', cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' }}>Notifications & Tickets</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {notifications.slice(0, 3).map(n => (
            <span key={n.id} style={{ fontSize: 10, color: C.muted, background: C.surface2, padding: '1px 8px', borderRadius: 3, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</span>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', color: C.dim, fontSize: 12 }}>{expanded ? '▼' : '▲'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 14px', display: 'flex', gap: 20 }}>
          {/* Notifications */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Recent Notifications</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 100, overflowY: 'auto', marginBottom: 8 }}>
              {notifications.slice(0, 5).map(n => (
                <div key={n.id} style={{ fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: C.blue, flexShrink: 0 }}>{n.channel}</span>
                  <span style={{ color: C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={slackMsg} onChange={e => setSlackMsg(e.target.value)} placeholder="Send Slack message…" onKeyDown={e => e.key === 'Enter' && sendSlack()}
                style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', color: C.text, fontSize: 11, outline: 'none' }} />
              <button onClick={sendSlack} disabled={sending}
                style={{ padding: '5px 12px', background: C.blue, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Send</button>
            </div>
          </div>
          {/* Tickets */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Recent Tickets</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 100, overflowY: 'auto', marginBottom: 8 }}>
              {tickets.slice(0, 5).map(t => (
                <div key={t.id} style={{ fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: sevColor(t.severity), flexShrink: 0 }}>{t.id}</span>
                  <span style={{ color: C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span style={{ color: t.status === 'in_progress' ? C.yellow : t.status === 'resolved' ? C.green : C.muted, fontSize: 10, flexShrink: 0 }}>{t.status}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={ticketTitle} onChange={e => setTicketTitle(e.target.value)} placeholder="Create ticket…" onKeyDown={e => e.key === 'Enter' && createTicket()}
                style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', color: C.text, fontSize: 11, outline: 'none' }} />
              <button onClick={createTicket} disabled={sending}
                style={{ padding: '5px 12px', background: C.green, color: '#000', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── A2A Panel ────────────────────────────────────────────────────────────────
function A2APanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [agents, setAgents] = useState<A2AAgent[]>([]);
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://${location.host}/ws/a2a`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; agents?: A2AAgent[]; tasks?: A2ATask[]; data?: A2AAgent | A2ATask };
          if (msg.type === 'init') {
            if (msg.agents) setAgents(msg.agents);
            if (msg.tasks) setTasks(msg.tasks);
          } else if (msg.type === 'agent') {
            const agentData = msg.data as A2AAgent;
            setAgents(prev => { const i = prev.findIndex(a => a.id === agentData.id); if (i >= 0) { const n = [...prev]; n[i] = agentData; return n; } return [...prev, agentData]; });
          } else if (msg.type === 'task' || msg.type === 'task_done') {
            const taskData = msg.data as A2ATask;
            setTasks(prev => { const i = prev.findIndex(t => t.id === taskData.id); if (i >= 0) { const n = [...prev]; n[i] = taskData; return n; } return [taskData, ...prev].slice(0, 20); });
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => setTimeout(connect, 3000);
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  return (
    <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 16px', cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' }}>A2A Agent Status</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {agents.slice(0, 4).map(a => (
            <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.muted }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: a.status === 'busy' ? C.yellow : a.status === 'idle' ? C.green : C.red }} />
              {a.name}
            </span>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', color: C.dim, fontSize: 12 }}>{collapsed ? '▼' : '▲'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '0 16px 14px', display: 'flex', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Agents</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {agents.map(a => (
                <div key={a.id} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: a.currentTask ? 4 : 0 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: a.status === 'busy' ? C.yellow : a.status === 'idle' ? C.green : C.red }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                    <span style={{ fontSize: 9, color: C.muted, background: C.surface3, padding: '1px 6px', borderRadius: 3 }}>{a.type}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: C.dim }}>{a.tasksCompleted} tasks</span>
                  </div>
                  {a.currentTask && <div style={{ fontSize: 10, color: C.muted, paddingLeft: 15 }}>{a.currentTask}</div>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Live Task Feed</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 130, overflowY: 'auto' }}>
              {tasks.slice(0, 10).map(t => (
                <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, padding: '3px 0', borderBottom: `1px solid ${C.border2}` }}>
                  <span style={{ color: t.status === 'done' ? C.green : t.status === 'running' ? C.yellow : C.dim, flexShrink: 0 }}>{t.status === 'done' ? '✓' : t.status === 'running' ? '⟳' : '○'}</span>
                  <span style={{ color: C.blue, flexShrink: 0 }}>{t.type}</span>
                  <span style={{ color: C.muted }}>{String(t.payload?.target ?? '')}</span>
                  <span style={{ marginLeft: 'auto', color: C.dim }}>{t.assignedTo}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const services = useServiceHealth();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: C.bg }}>
      <TopNav services={services} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <AlertFeed onSelect={setSelectedAlert} selectedId={selectedAlert?.id} />
        <IncidentWorkspace alert={selectedAlert} />
        <SocMetricsSidebar />
      </div>
      <BottomBar alert={selectedAlert} />
      <A2APanel />
    </div>
  );
}
