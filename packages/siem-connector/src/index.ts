import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Alert {
  id: string;
  severity: Severity;
  title: string;
  source: string;
  description: string;
  timestamp: string;
  status: 'open' | 'investigating' | 'resolved';
  ip?: string;
  user?: string;
  mitre?: string;
}

const alerts: Alert[] = [
  { id: 'ALT-001', severity: 'critical', title: 'Ransomware Activity Detected', source: 'EDR', description: 'Possible ransomware encryption loop on WORKSTATION-14. File modification rate exceeds 500/min.', timestamp: new Date(Date.now() - 120000).toISOString(), status: 'open', ip: '10.0.1.14', user: 'jsmith', mitre: 'T1486' },
  { id: 'ALT-002', severity: 'critical', title: 'Lateral Movement via PsExec', source: 'SIEM', description: 'PsExec execution detected from WORKSTATION-14 targeting domain controller DC-01.', timestamp: new Date(Date.now() - 180000).toISOString(), status: 'open', ip: '10.0.1.14', user: 'jsmith', mitre: 'T1570' },
  { id: 'ALT-003', severity: 'high', title: 'Credential Dumping — LSASS Access', source: 'EDR', description: 'Process mimikatz.exe accessed LSASS memory. Possible credential harvesting.', timestamp: new Date(Date.now() - 300000).toISOString(), status: 'investigating', ip: '10.0.1.22', user: 'admin', mitre: 'T1003' },
  { id: 'ALT-004', severity: 'high', title: 'C2 Beacon Traffic Detected', source: 'IDS', description: 'Regular outbound traffic to 198.51.100.42:443 every 60s. Cobalt Strike profile signature match.', timestamp: new Date(Date.now() - 450000).toISOString(), status: 'open', ip: '10.0.1.8', user: 'bwilson', mitre: 'T1071' },
  { id: 'ALT-005', severity: 'high', title: 'Suspicious PowerShell Execution', source: 'EDR', description: 'Encoded PowerShell command executed with -EncodedCommand flag. Downloads remote payload.', timestamp: new Date(Date.now() - 600000).toISOString(), status: 'open', ip: '10.0.1.33', user: 'mgreen', mitre: 'T1059.001' },
  { id: 'ALT-006', severity: 'medium', title: 'Failed Login Spike — VPN', source: 'SIEM', description: '47 failed VPN logins for user admin in 5 minutes from 203.0.113.50.', timestamp: new Date(Date.now() - 900000).toISOString(), status: 'open', ip: '203.0.113.50', user: 'admin', mitre: 'T1110' },
  { id: 'ALT-007', severity: 'medium', title: 'Sensitive File Access — HR Database', source: 'DLP', description: 'User tharris accessed payroll.xlsx (8MB) and immediately copied to USB.', timestamp: new Date(Date.now() - 1200000).toISOString(), status: 'investigating', ip: '10.0.1.55', user: 'tharris', mitre: 'T1005' },
  { id: 'ALT-008', severity: 'medium', title: 'DNS Tunneling Detected', source: 'IDS', description: 'High-entropy TXT record queries to d4t4exf1l.attacker.io. Possible data exfiltration via DNS.', timestamp: new Date(Date.now() - 1800000).toISOString(), status: 'open', ip: '10.0.1.19', user: 'unknown', mitre: 'T1048' },
  { id: 'ALT-009', severity: 'low', title: 'Port Scan from Internal Host', source: 'IDS', description: 'WORKSTATION-07 scanning internal /24 subnet on ports 22, 80, 443, 3389.', timestamp: new Date(Date.now() - 2400000).toISOString(), status: 'open', ip: '10.0.1.7', user: 'rjones', mitre: 'T1046' },
  { id: 'ALT-010', severity: 'low', title: 'Off-Hours Admin Login', source: 'SIEM', description: 'Administrator login at 02:17 AM from new device. No MFA challenge triggered.', timestamp: new Date(Date.now() - 3600000).toISOString(), status: 'open', ip: '10.0.1.1', user: 'administrator', mitre: 'T1078' },
];

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'siem-connector' }));
app.get('/alerts', (_req, res) => res.json(alerts));
app.get('/alerts/:id', (req, res) => {
  const alert = alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  res.json(alert);
});
app.patch('/alerts/:id', (req, res) => {
  const alert = alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  Object.assign(alert, req.body);
  res.json(alert);
});

app.listen(3010, () => console.log('siem-connector on :3010'));
