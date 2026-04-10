// ─── Duke Energy Large Load Service Queue PDF Parser ──────────────────────────
// Accepts a raw PDF buffer (downloaded from a NCUC docket attachment) and
// extracts tranche / queue-position data using pdf-parse + regex heuristics.
//
// Target document: Duke Energy Progress / Carolinas quarterly
// "Large Load Service Queue Status Report" filed with the NCUC.
//
// Typical table columns (may vary by filing year):
//   Queue Position | Project Name | County | kW Requested | Status | Est. COD
//
// Typical tranche block header:
//   "TRANCHE 1" or "Tranche No. 2" or "TRANCHE A"

import pdfParse from "pdf-parse";
import { TrancheEntry } from "./types.js";

// ─── NC county list (for column detection heuristic) ─────────────────────────

const NC_COUNTIES = new Set([
  "alamance","alexander","alleghany","anson","ashe","avery","beaufort","bertie",
  "bladen","brunswick","buncombe","burke","cabarrus","caldwell","camden",
  "carteret","caswell","catawba","chatham","cherokee","chowan","clay","cleveland",
  "columbus","craven","cumberland","currituck","dare","davidson","davie","duplin",
  "durham","edgecombe","forsyth","franklin","gaston","gates","graham","granville",
  "greene","guilford","halifax","harnett","haywood","henderson","hertford","hoke",
  "hyde","iredell","jackson","johnston","jones","lee","lenoir","lincoln",
  "macon","madison","martin","mcdowell","mecklenburg","mitchell","montgomery",
  "moore","nash","new hanover","northampton","onslow","orange","pamlico",
  "pasquotank","pender","perquimans","person","pitt","polk","randolph","richmond",
  "robeson","rockingham","rowan","rutherford","sampson","scotland","stanly",
  "stokes","surry","swain","transylvania","tyrrell","union","vance","wake",
  "warren","washington","watauga","wayne","wilkes","wilson","yadkin","yancey",
]);

// ─── Status normalization ─────────────────────────────────────────────────────

function normalizeStatus(raw: string): TrancheEntry["status"] {
  const s = raw.toLowerCase().trim();
  if (s.includes("approv") || s.includes("active") || s.includes("interconnect")) return "approved";
  if (s.includes("withdraw") || s.includes("cancel"))                              return "withdrawn";
  if (s.includes("reject") || s.includes("deni"))                                 return "rejected";
  if (s.includes("pend") || s.includes("queue") || s.includes("study") ||
      s.includes("in review") || s.includes("under review"))                       return "pending";
  return "unknown";
}

// ─── kW / MW normalizer → always returns MW ──────────────────────────────────

function toMw(valueStr: string, unit: string): number {
  const n = parseFloat(valueStr.replace(/,/g, ""));
  if (isNaN(n)) return 0;
  const u = unit.toLowerCase();
  if (u === "kw" || u === "kva")  return parseFloat((n / 1000).toFixed(3));
  if (u === "mw" || u === "mva")  return n;
  // bare number > 100 assumed kW (data center load), otherwise MW
  return n >= 100 ? parseFloat((n / 1000).toFixed(3)) : n;
}

// ─── Date / quarter normalizer ────────────────────────────────────────────────

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  // Quarter format: "Q1 2026", "Q3/2025"
  if (/^Q[1-4][\s/]\d{4}$/i.test(trimmed)) return trimmed.replace("/", " ");
  // MM/DD/YYYY or MM/YYYY
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,"0")}-${mdy[2].padStart(2,"0")}`;
  const my  = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) return `${my[2]}-${my[1].padStart(2,"0")}`;
  // YYYY-MM-DD already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

// ─── Single-table row parser ──────────────────────────────────────────────────
// Duke's queue tables are typically tab- or multi-space-delimited in PDF text.
// This handles the most common two-column layouts.

function parseTableRow(
  line: string,
  trancheLabel: number | string
): TrancheEntry | null {
  // Split on 2+ consecutive spaces or tabs (PDF column delimiters)
  const cols = line.split(/\t|  +/).map(c => c.trim()).filter(Boolean);
  if (cols.length < 3) return null;

  // col[0] is usually the queue position (numeric) or project name
  const posCandidate = parseInt(cols[0], 10);
  const hasPos       = !isNaN(posCandidate) && posCandidate > 0 && posCandidate < 9999;

  const offset = hasPos ? 1 : 0;
  const projectName = cols[offset] ?? "";
  const countyRaw   = cols[offset + 1] ?? "";
  const capacityRaw = cols[offset + 2] ?? "";
  const statusRaw   = cols[offset + 3] ?? "unknown";
  const codRaw      = cols[offset + 4] ?? "";

  // Capacity: match "10,000 kW" or "10 MW" or bare "10000"
  const capMatch = capacityRaw.match(/([\d,]+(?:\.\d+)?)\s*(kw|mw|kva|mva)?/i);
  if (!capMatch) return null;
  const capacity_mw = toMw(capMatch[1], capMatch[2] ?? "kw");
  if (capacity_mw <= 0) return null;

  const county = NC_COUNTIES.has(countyRaw.toLowerCase()) ? countyRaw : undefined;

  return {
    tranche:                    trancheLabel,
    project_name:               projectName || undefined,
    county,
    capacity_mw,
    queue_position:             hasPos ? posCandidate : undefined,
    status:                     normalizeStatus(statusRaw),
    commercial_operation_date:  codRaw ? normalizeDate(codRaw) : undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a Duke Energy Large Load Service Queue Status Report PDF.
 * @param pdfBuffer  Raw bytes of the PDF document.
 * @returns          Array of tranche entries, empty on parse failure.
 */
export async function parseDukeLargeLoadPdf(
  pdfBuffer: Buffer
): Promise<TrancheEntry[]> {
  let text: string;
  try {
    const parsed = await pdfParse(pdfBuffer);
    text = parsed.text;
  } catch {
    return [];
  }

  const lines   = text.split("\n");
  const entries: TrancheEntry[] = [];

  // ── Strategy A: tranche-block parsing ─────────────────────────────────────
  // Look for "TRANCHE N" headers and parse rows that follow them.
  let currentTranche: number | string = 1;
  let inBlock = false;
  let headerSkip = 0;  // lines to skip after tranche header (table header row)

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Detect tranche header: "TRANCHE 1", "Tranche No. 2", "TRANCHE A"
    const trancheHeader = line.match(/\btranche\b[\s.#]*([A-Z0-9]+)/i);
    if (trancheHeader) {
      const label = trancheHeader[1];
      currentTranche = /^\d+$/.test(label) ? parseInt(label, 10) : label;
      inBlock    = true;
      headerSkip = 1;  // next non-empty line is typically the column-header row
      continue;
    }

    if (!inBlock) continue;

    // Skip the table header row (contains "Queue Position", "Customer", etc.)
    if (headerSkip > 0) {
      headerSkip--;
      continue;
    }

    // Stop block on blank line preceded by data
    const entry = parseTableRow(line, currentTranche);
    if (entry) entries.push(entry);
  }

  // ── Strategy B: flat table (no tranche headers) ───────────────────────────
  // If strategy A found nothing, try to parse a flat queue table.
  if (entries.length === 0) {
    // Find the header row — look for a line containing "Queue" or "Position"
    let headerIdx = lines.findIndex(l =>
      /queue.{0,20}position|position.{0,20}customer|project.{0,20}county/i.test(l)
    );
    if (headerIdx >= 0) {
      for (const raw of lines.slice(headerIdx + 1)) {
        const line = raw.trim();
        if (!line) continue;
        const entry = parseTableRow(line, 1);
        if (entry) entries.push(entry);
      }
    }
  }

  // ── Strategy C: capacity-only extraction (last resort) ───────────────────
  // Grab any line matching a capacity + status pattern without table structure.
  if (entries.length === 0) {
    const capPattern = /([\d,]+(?:\.\d+)?)\s*(kw|mw)\b[^\n]*?(pending|approved|withdrawn|active)/ig;
    let m: RegExpExecArray | null;
    let pos = 1;
    while ((m = capPattern.exec(text)) !== null) {
      const capacity_mw = toMw(m[1], m[2]);
      if (capacity_mw > 0) {
        entries.push({
          tranche:       1,
          capacity_mw,
          queue_position: pos++,
          status:        normalizeStatus(m[3]),
        });
      }
    }
  }

  return entries;
}
