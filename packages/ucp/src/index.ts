import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

interface Session {
  id: string;
  alertId: string;
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed';
  steps: { name: string; status: 'pending' | 'running' | 'done' | 'failed'; completedAt?: string }[];
  createdAt: string;
  updatedAt: string;
}

const sessions: Record<string, Session> = {};

const STEPS = [
  'Isolate Host',
  'Collect Forensics',
  'Block IOCs',
  'Notify Stakeholders',
  'Patch & Remediate',
  'Verify Clean',
];

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ucp' }));

app.post('/sessions', (req, res) => {
  const { alertId } = req.body;
  const id = `SES-${randomUUID().slice(0, 8).toUpperCase()}`;
  const session: Session = {
    id, alertId,
    status: 'running',
    steps: STEPS.map((name, i) => ({ name, status: i === 0 ? 'running' : 'pending' })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sessions[id] = session;
  // Simulate step completion
  let step = 0;
  const tick = setInterval(() => {
    if (!sessions[id]) { clearInterval(tick); return; }
    sessions[id].steps[step].status = 'done';
    sessions[id].steps[step].completedAt = new Date().toISOString();
    step++;
    if (step < STEPS.length) {
      sessions[id].steps[step].status = 'running';
    } else {
      sessions[id].status = 'completed';
      sessions[id].updatedAt = new Date().toISOString();
      clearInterval(tick);
    }
  }, 3000);
  res.status(201).json(session);
});

app.get('/sessions/:id', (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

app.get('/sessions', (_req, res) => res.json(Object.values(sessions)));

app.listen(3011, () => console.log('ucp on :3011'));
