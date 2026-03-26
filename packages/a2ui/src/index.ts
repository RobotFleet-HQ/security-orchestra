import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface AgentCommand {
  id: string;
  type: 'contain' | 'investigate' | 'remediate' | 'notify' | 'scan' | 'block';
  target: string;
  reason: string;
  status: 'queued' | 'executing' | 'done' | 'failed';
  timestamp: string;
}

const COMMANDS: Omit<AgentCommand, 'id' | 'timestamp' | 'status'>[] = [
  { type: 'contain', target: 'WORKSTATION-14', reason: 'Ransomware encryption loop detected' },
  { type: 'investigate', target: 'LSASS process', reason: 'Credential dumping attempt via mimikatz' },
  { type: 'block', target: '198.51.100.42', reason: 'C2 beacon destination' },
  { type: 'scan', target: '10.0.1.0/24', reason: 'Lateral movement detection sweep' },
  { type: 'remediate', target: 'jsmith account', reason: 'Account involved in PsExec lateral movement' },
  { type: 'notify', target: 'CISO', reason: 'Critical incident threshold exceeded' },
  { type: 'contain', target: 'DC-01', reason: 'Possible domain controller compromise' },
  { type: 'block', target: 'd4t4exf1l.attacker.io', reason: 'DNS tunneling C2 domain' },
];

const history: AgentCommand[] = [];

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'a2ui' }));
app.get('/commands', (_req, res) => res.json(history));

wss.on('connection', (ws) => {
  // Send existing history
  history.forEach(cmd => ws.send(JSON.stringify(cmd)));

  // Stream new commands every 4 seconds
  let idx = 0;
  const tick = setInterval(() => {
    if (ws.readyState !== ws.OPEN) { clearInterval(tick); return; }
    const template = COMMANDS[idx % COMMANDS.length];
    idx++;
    const cmd: AgentCommand = {
      id: `CMD-${Date.now()}`,
      ...template,
      status: 'executing',
      timestamp: new Date().toISOString(),
    };
    history.push(cmd);
    if (history.length > 50) history.shift();
    ws.send(JSON.stringify(cmd));
    // Mark done after 1.5s
    setTimeout(() => {
      cmd.status = 'done';
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...cmd, status: 'done' }));
    }, 1500);
  }, 4000);
});

server.listen(3015, () => console.log('a2ui on :3015'));
