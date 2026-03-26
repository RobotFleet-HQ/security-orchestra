import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

interface PlaybookStep { id: string; name: string; type: string; description: string; }
interface Playbook { id: string; name: string; description: string; triggerConditions: string[]; steps: PlaybookStep[]; createdAt: string; }
interface Execution { id: string; playbookId: string; status: 'running' | 'completed' | 'failed'; currentStep: number; steps: { name: string; status: 'pending' | 'running' | 'done' }[]; startedAt: string; completedAt?: string; }

const playbooks: Playbook[] = [
  {
    id: 'PB-001', name: 'Ransomware Containment', description: 'Full isolation and remediation playbook for ransomware incidents',
    triggerConditions: ['severity:critical', 'mitre:T1486', 'mitre:T1570'],
    steps: [
      { id: 's1', name: 'Isolate Affected Hosts', type: 'automated', description: 'Apply NAC isolation to all affected endpoints immediately' },
      { id: 's2', name: 'Capture Memory Forensics', type: 'automated', description: 'Run Volatility on LSASS and suspicious processes' },
      { id: 's3', name: 'Extract IOCs', type: 'automated', description: 'Parse forensics for hashes, IPs, domains, and registry keys' },
      { id: 's4', name: 'Block IOCs at Perimeter', type: 'automated', description: 'Push IOC blocklist to firewall and DNS sinkholes' },
      { id: 's5', name: 'Notify CISO and Legal', type: 'manual', description: 'Send executive notification with impact assessment' },
      { id: 's6', name: 'Re-image Affected Systems', type: 'manual', description: 'Wipe and restore from last known-good backup' },
    ],
    createdAt: '2026-03-01T09:00:00Z',
  },
  {
    id: 'PB-002', name: 'Credential Theft Response', description: 'Respond to credential dumping and account compromise incidents',
    triggerConditions: ['severity:high', 'mitre:T1003', 'mitre:T1078'],
    steps: [
      { id: 's1', name: 'Identify Compromised Accounts', type: 'automated', description: 'Query AD for accounts accessed from affected host' },
      { id: 's2', name: 'Force Password Reset', type: 'automated', description: 'Reset passwords and revoke sessions for compromised accounts' },
      { id: 's3', name: 'Enable MFA Enforcement', type: 'automated', description: 'Enable step-up MFA for admin and privileged accounts' },
      { id: 's4', name: 'Audit Privileged Activity', type: 'automated', description: 'Review all privileged commands in last 24h from affected users' },
      { id: 's5', name: 'Deploy Honeypot Credentials', type: 'manual', description: 'Plant canary credentials to detect reuse attempts' },
    ],
    createdAt: '2026-03-05T14:30:00Z',
  },
  {
    id: 'PB-003', name: 'C2 Beaconing Disruption', description: 'Disrupt command-and-control communication and evict attacker access',
    triggerConditions: ['severity:high', 'mitre:T1071', 'mitre:T1048'],
    steps: [
      { id: 's1', name: 'Identify All C2 Channels', type: 'automated', description: 'Correlate DNS, proxy, and flow logs for C2 patterns' },
      { id: 's2', name: 'Block C2 Infrastructure', type: 'automated', description: 'Null-route all identified C2 IPs and domains' },
      { id: 's3', name: 'Kill Implant Processes', type: 'automated', description: 'Terminate beacon processes via EDR response action' },
      { id: 's4', name: 'Rotate Affected Credentials', type: 'automated', description: 'Rotate creds for any service accounts with access from beaconing host' },
      { id: 's5', name: 'Threat Hunt for Persistence', type: 'manual', description: 'Check scheduled tasks, registry run keys, services, WMI subscriptions' },
      { id: 's6', name: 'Full Disk Forensics', type: 'manual', description: 'Image disk and submit to malware analysis sandbox' },
    ],
    createdAt: '2026-03-10T11:00:00Z',
  },
];

const executions: Record<string, Execution> = {};

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'playbook-builder' }));
app.get('/playbooks', (_req, res) => res.json(playbooks));
app.get('/playbooks/:id', (req, res) => {
  const pb = playbooks.find(p => p.id === req.params.id);
  if (!pb) return res.status(404).json({ error: 'Not found' });
  res.json(pb);
});

app.post('/playbooks/:id/execute', (req, res) => {
  const pb = playbooks.find(p => p.id === req.params.id);
  if (!pb) return res.status(404).json({ error: 'Not found' });
  const id = `EXEC-${randomUUID().slice(0, 8).toUpperCase()}`;
  const exec: Execution = {
    id, playbookId: pb.id, status: 'running', currentStep: 0,
    steps: pb.steps.map((s, i) => ({ name: s.name, status: i === 0 ? 'running' : 'pending' as const })),
    startedAt: new Date().toISOString(),
  };
  executions[id] = exec;
  let step = 0;
  const tick = setInterval(() => {
    if (!executions[id]) { clearInterval(tick); return; }
    executions[id].steps[step].status = 'done';
    step++;
    executions[id].currentStep = step;
    if (step < pb.steps.length) {
      executions[id].steps[step].status = 'running';
    } else {
      executions[id].status = 'completed';
      executions[id].completedAt = new Date().toISOString();
      clearInterval(tick);
    }
  }, 2500);
  res.status(201).json(exec);
});

app.get('/executions/:id', (req, res) => {
  const exec = executions[req.params.id];
  if (!exec) return res.status(404).json({ error: 'Not found' });
  res.json(exec);
});

app.listen(3014, () => console.log('playbook-builder on :3014'));
