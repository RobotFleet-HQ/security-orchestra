import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

interface ActionRequest {
  id: string;
  alertId: string;
  action: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
}

const requests: Record<string, ActionRequest> = {};

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ap2' }));

app.post('/actions/request', (req, res) => {
  const { alertId, action, requestedBy = 'rsaun' } = req.body;
  const id = `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
  const req2: ActionRequest = {
    id, alertId, action, requestedBy,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  requests[id] = req2;
  // Auto-approve after 5 seconds for demo
  setTimeout(() => {
    if (requests[id] && requests[id].status === 'pending') {
      requests[id].status = 'approved';
      requests[id].reason = 'Auto-approved by policy P-14 (critical severity)';
      requests[id].resolvedAt = new Date().toISOString();
    }
  }, 5000);
  res.status(201).json(req2);
});

app.get('/actions/request/:id', (req, res) => {
  const r = requests[req.params.id];
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

app.get('/actions/requests', (_req, res) => res.json(Object.values(requests)));

app.listen(3012, () => console.log('ap2 on :3012'));
