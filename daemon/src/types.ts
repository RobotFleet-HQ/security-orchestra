// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SiteConfig {
  id:                   string;
  name:                 string;
  components:           ComponentSpec[];   // stored as JSON string in DB
  claimed_tier:         string;
  as_built_description: string;
  scan_interval_hours:  number;
  contact_email:        string;
}

export interface ComponentSpec {
  name:                 string;
  type:                 string;
  manufacturer:         string;
  internet_exposed:     boolean;
  handles_unauth_input: boolean;
  has_known_cves:       boolean;
  is_passive:           boolean;
}

export interface ThresholdRow {
  id:               number;
  site_id:          string;
  metric:           string;
  operator:         "gt" | "lt" | "gte" | "lte";
  value:            number;
  agent_name:       string;
  cooldown_minutes: number;
  last_fired_at:    string | null;
}

export interface ScanResultRow {
  id:       number;
  site_id:  string;
  ran_at:   string;
  status:   "success" | "error";
  findings: string | null;
  error:    string | null;
}

export interface CveRow {
  cve_id:       string;
  source:       string;
  published_at: string;
  description:  string;
  cvss_score:   number | null;
  is_ics_scada: number;
  fired_at:     string | null;
  raw_json:     string;
}

export interface ThresholdEventRow {
  id:             number;
  site_id:        string;
  metric:         string;
  value:          number;
  threshold:      number;
  agent_name:     string;
  fired_at:       string;
  agent_response: string | null;
}
