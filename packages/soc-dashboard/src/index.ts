import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const getMetrics = () => ({
  mttd: { value: 4.2, unit: 'min', trend: -0.8, label: 'Mean Time to Detect' },
  mttr: { value: 47.5, unit: 'min', trend: 2.1, label: 'Mean Time to Respond' },
  openIncidents: { value: 7, trend: 2, label: 'Open Incidents' },
  alertVolume: { value: 234, unit: '/hr', trend: 18, label: 'Alert Volume' },
  falsePositiveRate: { value: 12, unit: '%', trend: -3, label: 'False Positive Rate' },
  slaCompliance: { value: 94.7, unit: '%', trend: 1.2, label: 'SLA Compliance' },
  analysts: [
    { name: 'rsaun', status: 'active', assignedCases: 3, resolvedToday: 7 },
    { name: 'jdoe', status: 'active', assignedCases: 2, resolvedToday: 4 },
    { name: 'mchen', status: 'break', assignedCases: 1, resolvedToday: 6 },
    { name: 'asmith', status: 'offline', assignedCases: 0, resolvedToday: 5 },
  ],
  alertsByHour: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: Math.floor(Math.random() * 50 + 10) })),
  topRules: [
    { rule: 'CR-447 Ransomware Behavior', hits: 12, severity: 'critical' },
    { rule: 'CR-208 Lateral Movement', hits: 8, severity: 'high' },
    { rule: 'CR-312 Credential Theft', hits: 15, severity: 'high' },
    { rule: 'CR-091 Port Scan', hits: 24, severity: 'medium' },
    { rule: 'CR-155 DNS Anomaly', hits: 6, severity: 'medium' },
  ],
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'soc-dashboard' }));
app.get('/metrics/summary', (_req, res) => res.json(getMetrics()));

app.listen(3016, () => console.log('soc-dashboard on :3016'));
