// ─── NCUC Docket Agent ────────────────────────────────────────────────────────
// Specialized agent: scrape NC Utilities Commission eDockets Recent Filings and
// extract tranche / MW capacity data from Duke Energy large-load PDF reports.
//
// Data source: starw1.ncuc.gov — NCUC eDockets portal (public)
// PDF enrichment: ViewFile.aspx (requires live Playwright session; CF-gated)
// NCID auth: set NCID_USERNAME + NCID_PASSWORD env vars for authenticated access

import { scrapeNcucDockets } from "../scrapers/ncucDocket.js";
import { DocketEntry, TrancheEntry } from "../scrapers/types.js";

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface NcucDocketParams {
  /** Utility company to filter by. Default: "Duke Energy Progress". */
  utility?:                string;
  /** Keyword to match in filing description. Default: "large load". */
  keyword?:                string;
  /**
   * Comma-separated list of docket numbers to narrow results.
   * e.g. "E-100 Sub 208A,E-100 Sub 207CS"
   */
  docket_numbers?:         string;
  /**
   * "true" → keep tranche_data from PDF extraction in the response.
   * "false" (default) → strip tranche_data; still scrapes docket metadata.
   * Note: the underlying scraper always attempts PDF enrichment when dockets
   * are found; this param controls whether the data is surfaced to callers.
   */
  include_pdf_enrichment?: string;
  /**
   * "true" → signal intent to use NCID authentication for higher-privilege
   * PDF access. Actual auth uses NCID_USERNAME / NCID_PASSWORD env vars —
   * no credentials are passed at call time.
   */
  ncid_auth?:              string;
  /** Max docket entries to return (1–20). Default: 10. */
  max_entries?:            string;
}

export interface NcucDocketResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results: {
    dockets:              DocketEntry[];
    tranche_summary:      TrancheEntry[];
    docket_count:         number;
    tranche_count:        number;
    source:               string;
    scraped_at:           string;
    enrichment_attempted: boolean;
    ncid_auth_requested:  boolean;
    note?:                string;
    pricing_note:         string;
    duration_ms:          number;
  };
}

// ─── Agent implementation ─────────────────────────────────────────────────────

export async function runNcucDocketAgent(
  params: NcucDocketParams
): Promise<NcucDocketResult> {
  const t0 = Date.now();

  const utility    = params.utility  ?? "Duke Energy Progress";
  const keyword    = params.keyword  ?? "large load";
  const maxEntries = Math.min(parseInt(params.max_entries ?? "10", 10) || 10, 20);
  const includePdf = params.include_pdf_enrichment === "true";
  const ncidAuth   = params.ncid_auth === "true";

  // Optional docket number filter (comma-separated)
  const docketFilter = params.docket_numbers
    ? params.docket_numbers.split(",").map(s => s.trim()).filter(Boolean)
    : null;

  // Scrape NCUC Recent Filings — always resolves, never throws
  const scrapeResult = await scrapeNcucDockets(utility, keyword);

  let dockets: DocketEntry[] = scrapeResult.dockets.slice(0, maxEntries);

  // Apply docket-number filter when provided
  if (docketFilter && docketFilter.length > 0) {
    dockets = dockets.filter(d =>
      docketFilter.some(f => d.docket.toLowerCase().includes(f.toLowerCase()))
    );
  }

  // Strip PDF-extracted data when caller did not request enrichment.
  // The scraper always attempts extraction; this surfaces or hides the result.
  if (!includePdf) {
    dockets = dockets.map(d => ({ ...d, tranche_data: [] }));
  }

  // Flatten tranche entries across all dockets for the top-level summary
  const tranche_summary: TrancheEntry[] = dockets.flatMap(d => d.tranche_data);

  return {
    workflow:  "ncuc_docket_agent",
    target:    `${utility} — keyword: "${keyword}"`,
    timestamp: new Date().toISOString(),
    results: {
      dockets,
      tranche_summary,
      docket_count:         dockets.length,
      tranche_count:        tranche_summary.length,
      source:               scrapeResult.source,
      scraped_at:           scrapeResult.scraped_at,
      enrichment_attempted: includePdf,
      ncid_auth_requested:  ncidAuth,
      ...(scrapeResult.note && { note: scrapeResult.note }),
      pricing_note:
        "NCUC data is public; PDF enrichment requires a live Playwright session " +
        "and may be Cloudflare-gated without NCID authentication. Set " +
        "NCID_USERNAME + NCID_PASSWORD env vars for authenticated ViewFile access.",
      duration_ms: Date.now() - t0,
    },
  };
}
