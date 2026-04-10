// ─── NCUC eDockets Portal Scraper ────────────────────────────────────────────
// Uses Playwright Chromium to scrape the North Carolina Utilities Commission
// eDockets Recent Filings page (starw1.ncuc.gov).
//
// Strategy: Recent Filings page (/Page/recentFilings/portal.aspx) is a plain
// GET request — no form POST, no Cloudflare managed challenge.  It lists all
// recent NCUC filings including Duke Energy rows.
//
// Confirmed table structure (from live page inspection 2026-04-09):
//   Grid id: ctl00_ContentPlaceHolder1_PortalPageControl1_ctl86_resultsGridView
//   Columns per row:
//     0: Docket Number  (e.g. "E-2 Sub 1403")
//     1: Company Name   (e.g. "Duke Energy Progress, LLC")
//     2: Description    (<a> link to PSCDocumentDetailsPageNCUC.aspx?DocumentId=<GUID>&Class=Filing)
//     3: Date Filed     (e.g. "4/9/2026")
//
// PDF download: ViewFile.aspx?Id=<GUID> is behind Cloudflare and returns 403
// to plain Node https.get().  We download PDFs using an in-browser fetch()
// call that carries the NCUC session cookie set by navigating the document
// details page first.  If NCID_USERNAME / NCID_PASSWORD env vars are set,
// we also attempt NCID authentication before the download retry.

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { parseDukeLargeLoadPdf }   from "./dukeLargeLoad.js";
import { DocketEntry, ScrapeResult } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const PORTAL_BASE    = "https://starw1.ncuc.gov/NCUC";
const RECENT_FILINGS = `${PORTAL_BASE}/Page/recentFilings/portal.aspx`;
const NCUC_LOGIN     = `${PORTAL_BASE}/page/NCIDLogin/portal.aspx`;

// Duke Energy's semiannual large-load / data-center queue reports are filed
// under docket E-100 by "Generic Electric" (a catch-all NCUC filer name), not
// under the Duke Energy Progress or Carolinas company names.  When the caller's
// keyword signals large-load or data-center intent, we automatically run a
// supplemental scrape for "Generic Electric" and merge the results.
const LARGE_LOAD_KEYWORDS = ["large load", "large-load", "data center", "datacenter"];

function isLargeLoadKeyword(kw: string): boolean {
  const lower = kw.toLowerCase();
  return LARGE_LOAD_KEYWORDS.some(k => lower.includes(k));
}

// ─── Shared browser context options ──────────────────────────────────────────

const CTX_OPTS = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 } as const,
};

// ─── Date normalizer ─────────────────────────────────────────────────────────

function normalizeDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return raw.trim();
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// ─── Absolute URL helper ──────────────────────────────────────────────────────

function absUrl(href: string): string {
  if (href.startsWith("http")) return href;
  return `${PORTAL_BASE}/${href.replace(/^\//, "")}`;
}

// ─── In-browser PDF download ──────────────────────────────────────────────────
// Uses page.evaluate to run fetch() inside Chromium — carries all session
// cookies set by previous navigations in the same context.  This bypasses
// Cloudflare's bot detection on ViewFile.aspx which blocks Node https.get
// and Playwright's context.request.get().
//
// The PDF bytes are transferred as a chunked base64 string rather than an
// array of numbers — serializing 935K numbers through the CDP bridge is
// unreliable; a 1.25 MB base64 string transfers cleanly.

async function downloadViaPageFetch(page: Page, url: string): Promise<Buffer | null> {
  const base64: string | null = await page.evaluate(async (u: string) => {
    try {
      const resp = await fetch(u, { credentials: "include" });
      if (!resp.ok) return null;
      const ab    = await resp.arrayBuffer();
      const bytes = new Uint8Array(ab);
      const CHUNK = 8192;
      let binary  = "";
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
      }
      return btoa(binary);
    } catch {
      return null;
    }
  }, url);

  if (!base64) return null;
  const buf = Buffer.from(base64, "base64");
  // Validate PDF magic bytes (%PDF = 0x25 0x50 0x44 0x46)
  if (buf.length < 4 || buf[0] !== 0x25 || buf[1] !== 0x50) return null;
  return buf;
}

// ─── Find PDF link on a document-details page ────────────────────────────────
// NCUC document details pages (PSCDocumentDetailsPageNCUC.aspx) list attached
// files as links to ViewFile.aspx?Id=<GUID>.  We prefer the actual report PDF
// over cover letters.

async function findPdfOnDetailsPage(page: Page, detailsUrl: string): Promise<string | null> {
  try {
    await page.goto(detailsUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Collect all ViewFile links with their anchor text
    const viewFileAnchors = await page.locator('a[href*="ViewFile"]').all();
    if (viewFileAnchors.length > 0) {
      const candidates: Array<{ href: string; txt: string }> = [];
      for (const a of viewFileAnchors) {
        const txt  = (await a.innerText()).trim();
        const href = await a.getAttribute("href");
        if (href) candidates.push({ href: absUrl(href), txt });
      }
      // Preference order:
      //   1. Starts with "Semi-Annual" (the actual data report)
      //   2. Contains "update" but not starting with "Letter"
      //   3. Any non-letter ViewFile link
      //   4. First ViewFile link (last resort)
      const tier1 = candidates.find(c => c.txt.toLowerCase().startsWith("semi-annual"));
      if (tier1) return tier1.href;
      const tier2 = candidates.find(c => {
        const t = c.txt.toLowerCase();
        return t.includes("update") && !t.startsWith("letter");
      });
      if (tier2) return tier2.href;
      const tier3 = candidates.find(c => !c.txt.toLowerCase().startsWith("letter"));
      if (tier3) return tier3.href;
      return candidates[0].href;
    }

    // Fallback: direct .pdf links
    const pdfAnchors = await page.locator('a[href*=".pdf"]').all();
    for (const a of pdfAnchors) {
      const href = await a.getAttribute("href");
      if (href) return absUrl(href);
    }

    return null;
  } catch {
    return null;
  }
}

// ─── NCID authentication ──────────────────────────────────────────────────────
// The NCUC eDockets portal has its own native NCID login form at
// /page/NCIDLogin/portal.aspx (confirmed ASP.NET — not an OAuth redirect).
//
// Selector ID suffixes (confirmed from live page):
//   userNameTextBox  — NCID username
//   passwordTextBox  — NCID password
//   loginButton      — submit
//
// Returns an authenticated BrowserContext on success, null on failure.
// Caller is responsible for closing the context.

async function loginNcid(
  browser: Browser
): Promise<BrowserContext | null> {
  const username = process.env.NCID_USERNAME;
  const password = process.env.NCID_PASSWORD;
  if (!username || !password) return null;

  const ctx  = await browser.newContext(CTX_OPTS);
  const page = await ctx.newPage();

  try {
    await page.goto(NCUC_LOGIN, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Check CF didn't block the login page
    const title = await page.title();
    if (title.toLowerCase().includes("just a moment")) {
      await ctx.close();
      return null;
    }

    // Fill credentials
    await page.locator('input[id$="userNameTextBox"]').fill(username);
    await page.locator('input[id$="passwordTextBox"]').fill(password);

    // Submit and wait for navigation away from the login page
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => { /* timeout is non-fatal — check URL after */ }),
      page.locator('input[id$="loginButton"]').click(),
    ]);

    await page.waitForTimeout(1_000);

    const finalUrl   = page.url();
    const finalTitle = await page.title();

    // Failure signals: still on login page, or error message visible
    const onLoginPage = finalUrl.includes("NCIDLogin");
    const hasError    = await page.locator('[class*="error"], [id*="error"], [class*="Error"]')
      .count()
      .then(n => n > 0)
      .catch(() => false);

    if (onLoginPage || hasError || finalTitle.toLowerCase().includes("just a moment")) {
      await ctx.close();
      return null;
    }

    // Auth succeeded — return the authenticated context (page stays open in it)
    return ctx;
  } catch {
    await ctx.close();
    return null;
  }
}

// ─── Scrape Recent Filings ────────────────────────────────────────────────────

async function scrapeRecentFilings(
  page:    Page,
  utility: string,
  keyword: string
): Promise<DocketEntry[]> {
  await page.goto(RECENT_FILINGS, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Give the UpdatePanel a moment in case JS re-renders the grid
  await page.waitForTimeout(1_500);

  const gridSelector = '[id*="resultsGridView"] tr, table tr';
  const tableRows    = await page.locator(gridSelector).all();

  const utilityLower = utility.toLowerCase();
  const keyLower     = keyword.toLowerCase();
  const entries: DocketEntry[] = [];

  for (const row of tableRows) {
    const cells = await row.locator("td").allInnerTexts();
    if (cells.length < 3) continue;

    const docketRaw = cells[0]?.trim() ?? "";
    const company   = cells[1]?.trim() ?? "";
    const descRaw   = cells[2]?.trim() ?? "";
    const dateRaw   = cells[3]?.trim() ?? "";

    // Filter: company must match utility name (partial, case-insensitive)
    if (!company.toLowerCase().includes(utilityLower.split(" ")[0])) continue;

    // Filter: keyword must appear in description.
    // Normalize hyphens → spaces so "Large-Load" matches keyword "large load".
    const descNorm = descRaw.toLowerCase().replace(/-/g, " ");
    if (keyLower && !descNorm.includes(keyLower)) continue;

    // Docket number must look like a utility docket (E-, G-, W-, T-)
    if (!/^[EGWT]-\d/i.test(docketRaw)) continue;

    const filed_date = normalizeDate(dateRaw);
    const summary    = descRaw.replace(/\s+/g, " ").trim();

    // Extract document link from the <a> in col 2
    const docAnchor = await row.locator("td").nth(2).locator("a").first();
    let document_url: string | undefined;
    try {
      const href = await docAnchor.getAttribute("href");
      if (href) document_url = absUrl(href);
    } catch { /* no link */ }

    entries.push({
      docket:       docketRaw,
      filed_date,
      summary,
      document_url,
      tranche_data: [],
    });
  }

  return entries;
}

// ─── Enrich: resolve ViewFile URLs and parse PDFs ────────────────────────────
// For each entry:
//   1. Navigate to its PSCDocumentDetailsPage → find the ViewFile URL
//   2. Download PDF via in-page fetch() (carries NCUC session cookies) — bypasses CF
//   3. If unauthenticated fetch fails and an authenticated page is provided, retry
//   4. Parse with parseDukeLargeLoadPdf; document_url is updated regardless of parse result

async function enrichWithPdfs(
  page:      Page,
  entries:   DocketEntry[],
  authPage?: Page          // optional NCID-authenticated page for retry
): Promise<void> {
  // Warm up the Cloudflare session by visiting the public Recent Filings page
  // before navigating to document details pages.  CF adaptive detection blocks
  // ViewFile.aspx fetches in cold-start contexts; this visit establishes the
  // session token that allows the subsequent in-page fetch to succeed.
  await page.goto(RECENT_FILINGS, { waitUntil: "domcontentloaded", timeout: 20_000 })
    .catch(() => {});

  for (const entry of entries.slice(0, 5)) {
    if (!entry.document_url) continue;

    // If already a direct ViewFile/pdf URL, skip the details page navigation
    const isViewFile = entry.document_url.includes("ViewFile");
    const isPdf      = entry.document_url.toLowerCase().includes(".pdf");

    let pdfUrl: string | null = (isViewFile || isPdf) ? entry.document_url : null;

    if (!pdfUrl) {
      pdfUrl = await findPdfOnDetailsPage(page, entry.document_url);
    } else {
      // Still navigate the details page so the browser context gets NCUC session cookies
      await page.goto(entry.document_url, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => {});
    }

    if (!pdfUrl) continue;

    // Always update document_url to the resolved file URL
    if (!isViewFile && !isPdf) entry.document_url = pdfUrl;

    // ── Download attempt 1: unauthenticated in-page fetch ────────────────────
    // The details-page navigation above sets NCUC session cookies that allow
    // in-browser fetch to retrieve ViewFile PDFs.
    let pdfBuf = await downloadViaPageFetch(page, pdfUrl);

    // ── Download attempt 2: authenticated retry (NCID) ───────────────────────
    // If the first attempt failed and we have an authenticated browser context,
    // navigate to the details page in that context, then retry the fetch.
    if (!pdfBuf && authPage) {
      if (!isViewFile && !isPdf && entry.document_url) {
        await authPage.goto(entry.document_url, { waitUntil: "domcontentloaded", timeout: 20_000 })
          .catch(() => {});
      }
      pdfBuf = await downloadViaPageFetch(authPage, pdfUrl);
    }

    if (!pdfBuf) continue;

    try {
      entry.tranche_data = await parseDukeLargeLoadPdf(pdfBuf);
    } catch {
      // non-fatal — keep empty tranche_data
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape NCUC eDockets Recent Filings page for Duke Energy large-load /
 * interconnection queue filings. Parses PDF attachments for tranche data.
 *
 * Uses GET-only navigation (no form POST) to avoid Cloudflare managed challenge.
 * PDF downloads use in-browser fetch() with session cookies, bypassing CF on
 * ViewFile.aspx.  If NCID_USERNAME + NCID_PASSWORD env vars are set, performs
 * NCID authentication first for a higher-privilege retry on protected files.
 *
 * @param utility  Utility display name (e.g. "Duke Energy Progress").
 * @param keyword  Client-side result filter (default "large load").
 * @returns        ScrapeResult — always resolves, never throws.
 */
export async function scrapeNcucDockets(
  utility: string,
  keyword = "large load"
): Promise<ScrapeResult> {
  const scraped_at = new Date().toISOString();
  let   browser: Browser | null = null;

  // ASP.NET ViewState conflict: navigating to the same Recent Filings URL twice
  // within a single browser context returns an empty grid on the second request.
  // Each scrape call uses its own browser context.
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    let dockets: DocketEntry[];
    let note:    string | undefined;

    try {
      // ── Primary scrape ──────────────────────────────────────────────────────
      {
        const ctx  = await browser.newContext(CTX_OPTS);
        const page = await ctx.newPage();
        dockets = await scrapeRecentFilings(page, utility, keyword);
        await ctx.close();
      }

      // ── Supplemental scrape (separate context) ──────────────────────────────
      // Duke's semiannual large-load / data-center reports are filed under E-100
      // by "Generic Electric".  Auto-merge when keyword signals that intent.
      if (isLargeLoadKeyword(keyword) && utility.toLowerCase() !== "generic electric") {
        const ctx  = await browser.newContext(CTX_OPTS);
        const page = await ctx.newPage();
        const geDockets = await scrapeRecentFilings(page, "Generic Electric", keyword);
        await ctx.close();

        const seen = new Set(dockets.map(d => `${d.docket}|${d.summary}`));
        for (const d of geDockets) {
          if (!seen.has(`${d.docket}|${d.summary}`)) dockets.push(d);
        }
      }

      if (dockets.length === 0) {
        note = `No recent filings matched utility="${utility}" keyword="${keyword}" on Recent Filings page`;
      } else {
        // ── Optional NCID login ────────────────────────────────────────────────
        let authCtx: BrowserContext | null = null;
        let authPage: Page | undefined;
        if (process.env.NCID_USERNAME && process.env.NCID_PASSWORD) {
          authCtx = await loginNcid(browser);
          if (authCtx) {
            authPage = await authCtx.newPage();
          } else {
            note = "NCID login failed — proceeding without authentication";
          }
        }

        // ── PDF enrichment (separate context for the primary page) ─────────────
        const enrichCtx  = await browser.newContext(CTX_OPTS);
        const enrichPage = await enrichCtx.newPage();
        await enrichWithPdfs(enrichPage, dockets, authPage);
        await enrichCtx.close();

        if (authCtx) await authCtx.close().catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        source:     "ncuc_portal",
        utility,
        scraped_at,
        dockets:    [],
        note:       `Scrape failed: ${msg}`,
      };
    }

    return {
      source: "ncuc_portal",
      utility,
      scraped_at,
      dockets: dockets.slice(0, 10),
      ...(note && { note }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      source:     "ncuc_portal",
      utility,
      scraped_at,
      dockets:    [],
      note:       `Browser launch failed: ${msg}`,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
