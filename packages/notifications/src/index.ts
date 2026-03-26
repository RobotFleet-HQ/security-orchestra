import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

interface Notification { id: string; channel: string; message: string; sentBy: string; sentAt: string; status: 'sent' | 'failed' | 'pending'; }

const notifications: Notification[] = [
  { id: 'N-001', channel: 'slack:#soc-alerts', message: 'CRITICAL: Ransomware detected on WORKSTATION-14. Isolation initiated.', sentBy: 'system', sentAt: new Date(Date.now() - 60000).toISOString(), status: 'sent' },
  { id: 'N-002', channel: 'email:ciso@company.com', message: 'Incident INC-001 escalated to critical. SOC analyst rsaun responding.', sentBy: 'rsaun', sentAt: new Date(Date.now() - 120000).toISOString(), status: 'sent' },
  { id: 'N-003', channel: 'slack:#incident-response', message: 'Playbook PB-001 started. ETA to containment: 15 minutes.', sentBy: 'automation', sentAt: new Date(Date.now() - 300000).toISOString(), status: 'sent' },
];

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notifications' }));
app.get('/notifications', (_req, res) => res.json(notifications.slice(-20)));
app.post('/notify/slack', (req, res) => {
  const { channel = '#soc-alerts', message, sentBy = 'rsaun' } = req.body;
  const n: Notification = { id: `N-${randomUUID().slice(0, 8)}`, channel: `slack:${channel}`, message, sentBy, sentAt: new Date().toISOString(), status: 'sent' };
  notifications.push(n);
  res.status(201).json(n);
});
app.post('/notify/email', (req, res) => {
  const { to, message, sentBy = 'rsaun' } = req.body;
  const n: Notification = { id: `N-${randomUUID().slice(0, 8)}`, channel: `email:${to}`, message, sentBy, sentAt: new Date().toISOString(), status: 'sent' };
  notifications.push(n);
  res.status(201).json(n);
});

app.listen(3017, () => console.log('notifications on :3017'));
