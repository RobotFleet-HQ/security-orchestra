import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

interface Ticket { id: string; title: string; severity: string; status: 'open' | 'in_progress' | 'resolved' | 'closed'; assignee: string; alertId?: string; createdAt: string; updatedAt: string; }

const tickets: Ticket[] = [
  { id: 'INC-001', title: 'Ransomware Outbreak — WORKSTATION-14', severity: 'critical', status: 'in_progress', assignee: 'rsaun', alertId: 'ALT-001', createdAt: new Date(Date.now() - 180000).toISOString(), updatedAt: new Date(Date.now() - 60000).toISOString() },
  { id: 'INC-002', title: 'Credential Dumping Investigation', severity: 'high', status: 'open', assignee: 'jdoe', alertId: 'ALT-003', createdAt: new Date(Date.now() - 360000).toISOString(), updatedAt: new Date(Date.now() - 300000).toISOString() },
  { id: 'INC-003', title: 'C2 Beaconing — Cobalt Strike Suspected', severity: 'high', status: 'in_progress', assignee: 'rsaun', alertId: 'ALT-004', createdAt: new Date(Date.now() - 600000).toISOString(), updatedAt: new Date(Date.now() - 120000).toISOString() },
];

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ticketing-bridge' }));
app.get('/tickets', (_req, res) => res.json(tickets));
app.get('/tickets/:id', (req, res) => {
  const t = tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});
app.post('/tickets', (req, res) => {
  const { title, severity = 'medium', alertId, assignee = 'rsaun' } = req.body;
  const t: Ticket = { id: `INC-${String(tickets.length + 1).padStart(3, '0')}`, title, severity, status: 'open', assignee, alertId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  tickets.push(t);
  res.status(201).json(t);
});
app.patch('/tickets/:id', (req, res) => {
  const t = tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  Object.assign(t, req.body, { updatedAt: new Date().toISOString() });
  res.json(t);
});

// Suppress unused import warning
void randomUUID;

app.listen(3018, () => console.log('ticketing-bridge on :3018'));
