// ─── NCUC Docket Scraper — Shared Types ───────────────────────────────────────
// Used by ncucDocket.ts (Playwright scraper) and dukeLargeLoad.ts (PDF parser).
// DocketEntry is the canonical output shape wired into ncUtilityInterconnect.

export interface TrancheEntry {
  tranche:                    number | string;  // 1, 2, … or "A", "B", etc.
  project_name?:              string;
  county?:                    string;           // NC county
  capacity_mw:                number;           // requested capacity in MW
  queue_position?:            number;
  status:                     "pending" | "approved" | "withdrawn" | "rejected" | "unknown";
  commercial_operation_date?: string;           // ISO date or quarter string e.g. "Q3 2026"
  substation?:                string;
  voltage_kv?:                number;
}

export interface DocketEntry {
  docket:       string;        // e.g. "E-7, Sub 1166" or "E-2, Sub 1200"
  filed_date:   string;        // ISO 8601 date "YYYY-MM-DD"
  summary:      string;        // case/filing title from NCUC portal
  filing_type?: string;        // e.g. "Large Load Service Report", "Quarterly Status"
  document_url?: string;       // direct URL to the PDF on starw1.ncuc.gov
  tranche_data: TrancheEntry[];
}

export interface ScrapeResult {
  source:      "ncuc_portal";
  utility:     string;
  scraped_at:  string;         // ISO 8601 timestamp
  dockets:     DocketEntry[];
  note?:       string;         // warning or partial-failure message
}
