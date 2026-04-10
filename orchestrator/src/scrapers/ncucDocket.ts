// ─── NCUC eDockets Portal Scraper ────────────────────────────────────────────
// Uses Playwright Chromium to navigate the North Carolina Utilities Commission
// eDockets portal (starw1.ncuc.gov) — which is behind Cloudflare and requires
// a real browser to pass the managed challenge.
//
// Portal:   https://starw1.ncuc.gov/NCUC/page/Dockets/portal.aspx
// Recent:   https://starw1.ncuc.gov/NCUC/Page/recentFilings/portal.aspx
// Doc search: https://starw1.ncuc.gov/NCUC/page/DocumentsParameterSearch/portal.aspx
//
// For Duke Energy large-load queue reports we search by company name and the
// keyword "large load", then download and parse any PDF attachments.

import https  from "https";
import { chromium, Browser, Page } from "playwright";
import { parseDukeLargeLoadPdf }   from "./dukeLargeLoad.js";
import { DocketEntry, ScrapeResult } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const PORTAL_BASE     = "https://starw1.ncuc.gov/NCUC";
const DOCKET_SEARCH   = `${PORTAL_BASE}/page/Dockets/portal.aspx`;
const RECENT_FILINGS  = `${PORTAL_BASE}/Page/recentFilings/portal.aspx`;
const CF_TIMEOUT_MS   = 30_000;   // max wait for Cloudflare challenge
const SCRAPE_TIMEOUT  = 60_000;   // overall scrape timeout per search

// Map utility display name → NCUC company search term
const UTILITY_SEARCH_TERM: Record<string, string> = {
  "Duke Energy Progress":  "Duke Energy Progress",
  "Duke Energy Carolinas": "Duke Energy Carolinas",
  "Dominion Energy NC":    "Dominion Energy North Carolina",
};

// ─── HTTP helper (for PDF download — no Cloudflare on direct doc endpoints) ──

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "SecurityOrchestraAgent/1.0" } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── Cloudflare challenge handler ─────────────────────────────────────────────
// Playwright's real Chromium browser typically solves CF managed challenges
// automatically within 5-15 seconds. We poll until the challenge iframe is gone.

async function waitForCloudflare(page: Page): Promise<void> {
  const deadline = Date.now() + CF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => "");
    if (!title.toLowerCase().includes("just a moment")) return;
    await page.waitForTimeout(1_500);
  }
  throw new Error("Cloudflare challenge did not resolve within timeout");
}

// ─── Parse a docket results table row ─────────────────────────────────────────
// The NCUC portal renders results as an ASP.NET GridView — a plain <table>.
// Columns (typical): Docket | Company | Description | Status | Filed Date
// We extract the first row that has a docket number in E-N format.

function parseDocketRow(cells: string[]): Partial<DocketEntry> | null {
  if (cells.length < 3) return null;

  // Docket number pattern: E-7, Sub 1166 / E-2, Sub 1200 / E-5
  const docketMatch = cells.join(" ").match(/\b(E|G|W|T)-\d+(?:,\s*Sub\s+\d+)?/i);
  if (!docketMatch) return null;

  // Filed date: look for MM/DD/YYYY in any cell
  const dateStr = cells
    .map(c => c.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1])
    .find(Boolean);
  let filed_date = "";
  if (dateStr) {
    const [m, d, y] = dateStr.split("/");
    filed_date = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }

  // Summary: longest non-docket, non-date cell
  const summary = cells
    .filter(c => c.length > 10 && !c.match(/^[\d/\-]+$/) && !c.match(/^E-\d/))
    .sort((a, b) => b.length - a.length)[0] ?? "";

  return {
    docket:       docketMatch[0],
    filed_date,
    summary:      summary.replace(/\s+/g, " ").trim(),
    tranche_data: [],
  };
}

// ─── Extract PDF document links from a docket detail page ────────────────────

async function extractPdfLinks(page: Page, docketUrl: string): Promise<string[]> {
  try {
    await page.goto(docketUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const anchors = await page
      .locator('a[href*=".pdf"], a[href*="DocumentDetails"], a[href*="document"]')
      .all();
    const hrefs: string[] = [];
    for (const a of anchors) {
      const href = await a.getAttribute("href");
      if (href && href.includes("starw1.ncuc.gov") &&
          (href.toLowerCase().includes(".pdf") || href.includes("DocumentDetails"))) {
        hrefs.push(href);
      }
    }
    return [...new Set(hrefs)];
  } catch {
    return [];
  }
}

// ─── Scrape one search result page ───────────────────────────────────────────

async function scrapeDocketPage(
  page:    Page,
  utility: string,
  keyword: string
): Promise<DocketEntry[]> {
  // Navigate to the docket search portal
  await page.goto(DOCKET_SEARCH, { waitUntil: "networkidle", timeout: 40_000 });
  await waitForCloudflare(page);

  // ── Fill in company/utility name ────────────────────────────────────────────
  // The NCUC portal has a "Company Name" text field. Selectors tried in order:
  //   - input[id*="Company"], input[name*="Company"]
  //   - input[id*="txtCompany"], input[placeholder*="company"]
  const companySelectors = [
    'input[id*="Company"]',
    'input[name*="Company"]',
    'input[placeholder*="company" i]',
    'input[id*="txtCompany"]',
  ];
  for (const sel of companySelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.fill(UTILITY_SEARCH_TERM[utility] ?? utility);
      break;
    }
  }

  // ── Fill in case description / keyword ──────────────────────────────────────
  const descSelectors = [
    'input[id*="Description"]',
    'input[id*="Keyword"]',
    'input[id*="txtSearch"]',
    'input[placeholder*="description" i]',
    'input[placeholder*="keyword" i]',
  ];
  for (const sel of descSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.fill(keyword);
      break;
    }
  }

  // ── Select "Electric" docket type if a dropdown exists ──────────────────────
  const typeSelectors = [
    'select[id*="DocketType"]',
    'select[id*="CaseType"]',
    'select[id*="Type"]',
  ];
  for (const sel of typeSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.selectOption({ label: "Electric" }).catch(() => {
        // "Electric" might not be a label — try value "E"
        return el.selectOption({ value: "E" }).catch(() => { /* ignore */ });
      });
      break;
    }
  }

  // ── Submit the search form ───────────────────────────────────────────────────
  const submitSelectors = [
    'input[type="submit"]',
    'button[type="submit"]',
    'input[value*="Search" i]',
    'button:has-text("Search")',
  ];
  for (const sel of submitSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => {}),
        el.click(),
      ]);
      break;
    }
  }

  // ── Parse results table ──────────────────────────────────────────────────────
  // NCUC renders results in a <table> — grab all rows via locators.
  const tableRows = await page.locator("table tr").all();
  const docketEntries: DocketEntry[] = [];
  for (const row of tableRows) {
    const cellTexts = await row.locator("td").allInnerTexts();
    const partial   = parseDocketRow(cellTexts);
    if (!partial?.docket) continue;
    if (!partial.docket.startsWith("E")) continue;   // electric dockets only
    docketEntries.push({ ...partial, tranche_data: [] } as DocketEntry);
  }

  // ── For each docket, attempt to get PDF and parse tranche data ───────────────
  // Limit to 5 most recent dockets to keep runtime reasonable.
  const relevant = docketEntries.slice(0, 5);
  const detailAnchors = await page.locator('a[href*="DocketDetails"]').all();
  const detailLinks: string[] = [];
  for (const a of detailAnchors) {
    const href = await a.getAttribute("href");
    if (href) detailLinks.push(href);
  }

  for (const entry of relevant) {
    if (detailLinks.length > 0) {
      const pdfLinks = await extractPdfLinks(page, detailLinks[0]);
      if (pdfLinks.length > 0) {
        try {
          const pdfBuf         = await fetchBuffer(pdfLinks[0]);
          entry.tranche_data   = await parseDukeLargeLoadPdf(pdfBuf);
          entry.document_url   = pdfLinks[0];
        } catch {
          // PDF parse failure is non-fatal — keep docket entry without tranche data
        }
      }
    }
  }

  return relevant;
}

// ─── Recent-filings fallback scraper ─────────────────────────────────────────
// If the search form approach fails (DOM changed), scrape the recent-filings
// page and filter by the utility keyword.

async function scrapeRecentFilings(
  page:    Page,
  utility: string
): Promise<DocketEntry[]> {
  await page.goto(RECENT_FILINGS, { waitUntil: "networkidle", timeout: 40_000 });
  await waitForCloudflare(page);

  const searchTerm = (UTILITY_SEARCH_TERM[utility] ?? utility).toLowerCase();

  const tableRows2 = await page.locator("table tr").all();
  const rows: string[][] = [];
  for (const row of tableRows2) {
    rows.push(await row.locator("td").allInnerTexts());
  }

  const entries: DocketEntry[] = [];
  for (const cells of rows) {
    const rowText = cells.join(" ").toLowerCase();
    if (!rowText.includes(searchTerm.split(" ")[0].toLowerCase())) continue;
    if (!rowText.includes("large load") && !rowText.includes("interconnect")) continue;
    const partial = parseDocketRow(cells);
    if (partial?.docket) {
      entries.push({ ...partial, tranche_data: [] } as DocketEntry);
    }
  }
  return entries.slice(0, 5);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape NCUC eDockets portal for Duke Energy large-load / interconnection
 * queue filings. Downloads and parses PDF attachments for tranche data.
 *
 * @param utility  One of the VALID_NC_UTILITIES strings from validation.ts.
 * @param keyword  Search keyword (default "large load").
 * @returns        ScrapeResult — always resolves, never throws.
 */
export async function scrapeNcucDockets(
  utility: string,
  keyword = "large load"
): Promise<ScrapeResult> {
  const scraped_at = new Date().toISOString();
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Primary: docket search form
    let dockets: DocketEntry[] = [];
    try {
      dockets = await Promise.race([
        scrapeDocketPage(page, utility, keyword),
        new Promise<DocketEntry[]>((_, reject) =>
          setTimeout(() => reject(new Error("scrape timeout")), SCRAPE_TIMEOUT)
        ),
      ]);
    } catch (primaryErr) {
      // Fallback: recent-filings list
      try {
        dockets = await scrapeRecentFilings(page, utility);
      } catch {
        // Both paths failed — return empty with note
        const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        return { source: "ncuc_portal", utility, scraped_at, dockets: [],
          note: `Scrape failed: ${msg}` };
      }
    }

    return { source: "ncuc_portal", utility, scraped_at, dockets };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { source: "ncuc_portal", utility, scraped_at, dockets: [],
      note: `Browser launch failed: ${msg}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
