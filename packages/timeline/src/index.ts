import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

interface TimelineEvent {
  id: string;
  incidentId: string;
  timestamp: string;
  actor: string;
  actorType: 'system' | 'analyst' | 'attacker' | 'automation';
  action: string;
  detail: string;
  severity?: 'info' | 'warning' | 'critical';
}

const baseTime = Date.now() - 3600000;
const makeEvents = (incidentId: string): TimelineEvent[] => [
  { id: 'E001', incidentId, timestamp: new Date(baseTime).toISOString(), actor: 'SIEM', actorType: 'system', action: 'Alert Generated', detail: 'Initial alert triggered by correlation rule CR-447', severity: 'critical' },
  { id: 'E002', incidentId, timestamp: new Date(baseTime + 120000).toISOString(), actor: 'EDR Agent', actorType: 'system', action: 'Process Snapshot', detail: 'Captured running processes on WORKSTATION-14: mimikatz.exe, cmd.exe', severity: 'critical' },
  { id: 'E003', incidentId, timestamp: new Date(baseTime + 240000).toISOString(), actor: 'rsaun', actorType: 'analyst', action: 'Alert Acknowledged', detail: 'Analyst opened alert and began investigation', severity: 'info' },
  { id: 'E004', incidentId, timestamp: new Date(baseTime + 360000).toISOString(), actor: 'Attacker', actorType: 'attacker', action: 'Lateral Movement', detail: 'PsExec executed on DC-01 from WORKSTATION-14 (10.0.1.14)', severity: 'critical' },
  { id: 'E005', incidentId, timestamp: new Date(baseTime + 480000).toISOString(), actor: 'UCP', actorType: 'automation', action: 'Isolation Initiated', detail: 'Network isolation applied to WORKSTATION-14 via NAC policy', severity: 'warning' },
  { id: 'E006', incidentId, timestamp: new Date(baseTime + 600000).toISOString(), actor: 'rsaun', actorType: 'analyst', action: 'IOC Extraction', detail: 'Extracted 3 IOCs: 198.51.100.42, mimikatz.exe hash, C2 domain', severity: 'info' },
  { id: 'E007', incidentId, timestamp: new Date(baseTime + 720000).toISOString(), actor: 'Firewall', actorType: 'automation', action: 'IOC Blocked', detail: 'Rule added to block 198.51.100.42 on all egress interfaces', severity: 'warning' },
  { id: 'E008', incidentId, timestamp: new Date(baseTime + 900000).toISOString(), actor: 'rsaun', actorType: 'analyst', action: 'Ticket Created', detail: 'ServiceNow ticket INC0012345 created with full forensic data', severity: 'info' },
  { id: 'E009', incidentId, timestamp: new Date(baseTime + 1200000).toISOString(), actor: 'Attacker', actorType: 'attacker', action: 'Exfiltration Attempt', detail: 'DNS tunneling attempt to d4t4exf1l.attacker.io — BLOCKED', severity: 'critical' },
  { id: 'E010', incidentId, timestamp: new Date(baseTime + 1800000).toISOString(), actor: 'Remediation Bot', actorType: 'automation', action: 'Remediation Complete', detail: 'Host re-imaged, credentials rotated, endpoint hardened', severity: 'info' },
];

const incidentTimelines: Record<string, TimelineEvent[]> = {};

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'timeline' }));

app.get('/incidents/:id/timeline', (req, res) => {
  const { id } = req.params;
  if (!incidentTimelines[id]) {
    incidentTimelines[id] = makeEvents(id);
  }
  res.json(incidentTimelines[id]);
});

app.post('/incidents/:id/timeline', (req, res) => {
  const { id } = req.params;
  if (!incidentTimelines[id]) incidentTimelines[id] = makeEvents(id);
  const event: TimelineEvent = { id: `E${Date.now()}`, incidentId: id, ...req.body, timestamp: new Date().toISOString() };
  incidentTimelines[id].push(event);
  res.status(201).json(event);
});

app.listen(3013, () => console.log('timeline on :3013'));
