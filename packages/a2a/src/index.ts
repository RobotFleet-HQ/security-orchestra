import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface AgentStatus { id: string; name: string; type: 'orchestrator' | 'worker'; status: 'idle' | 'busy' | 'error'; currentTask?: string; tasksCompleted: number; lastSeen: string; }
interface Task { id: string; type: string; payload: Record<string, unknown>; status: 'queued' | 'running' | 'done' | 'failed'; assignedTo: string; createdAt: string; completedAt?: string; }

const agents: AgentStatus[] = [
  { id: 'ORCH-01', name: 'OrchestratorAgent', type: 'orchestrator', status: 'busy', currentTask: 'Coordinating ransomware response', tasksCompleted: 47, lastSeen: new Date().toISOString() },
  { id: 'WORK-01', name: 'WorkerAgent-Containment', type: 'worker', status: 'busy', currentTask: 'Isolating WORKSTATION-14', tasksCompleted: 23, lastSeen: new Date().toISOString() },
  { id: 'WORK-02', name: 'WorkerAgent-Forensics', type: 'worker', status: 'busy', currentTask: 'Memory forensics on LSASS', tasksCompleted: 31, lastSeen: new Date().toISOString() },
  { id: 'WORK-03', name: 'WorkerAgent-Threat', type: 'worker', status: 'idle', tasksCompleted: 18, lastSeen: new Date().toISOString() },
];

const tasks: Task[] = [];

const TASK_TYPES = ['IsolateHost', 'CollectForensics', 'BlockIOC', 'ScanNetwork', 'RotateCredentials', 'NotifyStakeholder'];
const AGENTS_IDS = ['WORK-01', 'WORK-02', 'WORK-03'];

const broadcast = (data: unknown) => {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === c.OPEN) c.send(msg); });
};

// Generate tasks periodically
setInterval(() => {
  const task: Task = {
    id: `TASK-${randomUUID().slice(0, 8).toUpperCase()}`,
    type: TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)],
    payload: { target: `10.0.1.${Math.floor(Math.random() * 50 + 1)}`, alertId: `ALT-00${Math.floor(Math.random() * 9) + 1}` },
    status: 'running',
    assignedTo: AGENTS_IDS[Math.floor(Math.random() * AGENTS_IDS.length)],
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  if (tasks.length > 100) tasks.shift();
  broadcast({ type: 'task', data: task });
  // Update agent
  const agent = agents.find(a => a.id === task.assignedTo);
  if (agent) { agent.status = 'busy'; agent.currentTask = `${task.type} on ${task.payload.target}`; agent.lastSeen = new Date().toISOString(); }
  broadcast({ type: 'agent', data: agent });
  setTimeout(() => {
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    if (agent) { agent.tasksCompleted++; agent.status = 'idle'; agent.currentTask = undefined; agent.lastSeen = new Date().toISOString(); }
    broadcast({ type: 'task_done', data: task });
    broadcast({ type: 'agent', data: agent });
  }, 3000 + Math.random() * 4000);
}, 5000);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'a2a' }));
app.get('/agents', (_req, res) => res.json(agents));
app.get('/tasks', (_req, res) => res.json(tasks.slice(-20)));

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', agents, tasks: tasks.slice(-10) }));
});

server.listen(3019, () => console.log('a2a on :3019'));
