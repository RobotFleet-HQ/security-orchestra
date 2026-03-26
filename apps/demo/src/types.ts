export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Alert {
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

export interface UcpStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  completedAt?: string;
}

export interface UcpSession {
  id: string;
  alertId: string;
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed';
  steps: UcpStep[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  alertId: string;
  action: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface TimelineEvent {
  id: string;
  incidentId: string;
  timestamp: string;
  actor: string;
  actorType: 'system' | 'analyst' | 'attacker' | 'automation';
  action: string;
  detail: string;
  severity?: 'info' | 'warning' | 'critical';
}

export interface PlaybookStep {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  triggerConditions: string[];
  steps: PlaybookStep[];
  createdAt: string;
}

export interface PlaybookExecution {
  id: string;
  playbookId: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: number;
  steps: { name: string; status: 'pending' | 'running' | 'done' }[];
  startedAt: string;
  completedAt?: string;
}

export interface AgentCommand {
  id: string;
  type: string;
  target: string;
  reason: string;
  status: 'queued' | 'executing' | 'done' | 'failed';
  timestamp: string;
}

export interface SocMetrics {
  mttd: { value: number; unit: string; trend: number; label: string };
  mttr: { value: number; unit: string; trend: number; label: string };
  openIncidents: { value: number; trend: number; label: string };
  alertVolume: { value: number; unit: string; trend: number; label: string };
  falsePositiveRate: { value: number; unit: string; trend: number; label: string };
  slaCompliance: { value: number; unit: string; trend: number; label: string };
  analysts: { name: string; status: string; assignedCases: number; resolvedToday: number }[];
  topRules: { rule: string; hits: number; severity: string }[];
}

export interface Notification {
  id: string;
  channel: string;
  message: string;
  sentBy: string;
  sentAt: string;
  status: 'sent' | 'failed' | 'pending';
}

export interface Ticket {
  id: string;
  title: string;
  severity: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assignee: string;
  alertId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface A2ATask {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  assignedTo: string;
  createdAt: string;
  completedAt?: string;
}

export interface A2AAgent {
  id: string;
  name: string;
  type: 'orchestrator' | 'worker';
  status: 'idle' | 'busy' | 'error';
  currentTask?: string;
  tasksCompleted: number;
  lastSeen: string;
}

export type ServiceStatus = 'up' | 'down' | 'unknown';
export interface ServiceHealth {
  name: string;
  label: string;
  status: ServiceStatus;
}
