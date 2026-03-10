/**
 * Test: utility_interconnect workflow v2
 * Covers all 9 utilities (adding Xcel), per-load-size timelines,
 * deposit $/kW ranges, first-year cost, competitive intel, state validation.
 */

import { runUtilityInterconnect, VALID_UTILITIES } from "../workflows/utilityInterconnect.js";
import { validateWorkflowParams } from "../validation.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => {
    console.log(`  ✓  ${label}`);
    passed++;
  }).catch((err: unknown) => {
    console.error(`  ✗  ${label}`);
    console.error(`     → ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  });
}

function bar(w = 62) { return "─".repeat(w); }
function usd(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

// ─── Scenario printer ─────────────────────────────────────────────────────────

async function printScenario(
  utility: typeof VALID_UTILITIES[number],
  load_mw: number,
  load_type: "data_center" | "industrial" | "commercial" = "data_center",
  state?: string,
) {
  const result = await runUtilityInterconnect({ utility, load_mw, load_type, state });
  const r  = result.results;
  const ip = r.interconnect_process;
  const c  = r.costs;
  const sd = c.study_deposits;

  console.log(`\n  ${bar(58)}`);
  console.log(`  ${r.utility} (${r.abbreviation}) — ${load_mw} MW ${load_type}${state ? ` [${state}]` : ""}`);
  console.log(`  ${bar(58)}`);
  console.log(`  RTO/ISO   : ${r.rto_iso}`);
  console.log(`  Timeline  : ${ip.timeline_months_min}–${ip.timeline_months_typical}–${ip.timeline_months_max} mo  |  ${ip.timeline_note}`);
  console.log(`  Deposit/kW: $${sd.deposit_per_kw_range_low}–$${sd.deposit_per_kw_range_high}/kW  →  ${usd(sd.deposit_range_low_usd)}–${usd(sd.deposit_range_high_usd)}`);
  console.log(`  Upfront   : ${usd(c.total_upfront_low_usd)} – ${usd(c.total_upfront_high_usd)}`);
  console.log(`  1st-year  : ${usd(c.first_year_total_low_usd)} – ${usd(c.first_year_total_high_usd)}`);
  console.log(`  Annual ops: ${usd(r.annual_operating_cost.total_annual_cost_usd)}  ($${r.annual_operating_cost.effective_rate_per_kwh}/kWh all-in)`);
  console.log(`  10yr NPV  : ${usd(r["10yr_electricity_npv_usd"])}`);
  if (r.competitive_intel.length) {
    console.log(`  Intel[0]  : ${r.competitive_intel[0].substring(0, 100)}`);
  }
  if (r.warnings.length) {
    console.log(`  Warning   : ${r.warnings[0].substring(0, 100)}`);
  }
  console.log(`  Duration  : ${r.duration_ms}ms`);
  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nUtility Interconnect v2 — Integration Tests`);
  console.log(bar());

  // ── 1. All 9 utilities @ 100 MW ───────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` All 9 utilities — 100 MW data center`);
  console.log(bar());

  for (const utility of VALID_UTILITIES) {
    await test(`${utility} — 100 MW returns valid result`, async () => {
      const r = await printScenario(utility, 100);
      if (!r.results.utility)            throw new Error("Missing utility name");
      if (!r.results.rto_iso)            throw new Error("Missing rto_iso");
      if (r.results.costs.total_upfront_low_usd <= 0)
        throw new Error("upfront low must be > 0");
      if (r.results.interconnect_process.steps.length < 3)
        throw new Error("Expected ≥3 interconnect steps");
      if (!r.results.competitive_intel?.length)
        throw new Error("Missing competitive_intel");
    });
  }

  // ── 2. Per-load-size timeline breakpoints ─────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Per-load-size timeline breakpoints`);
  console.log(bar());

  // Dominion: each tier should have progressively longer timelines
  await test("Dominion: timeline escalates with load size", async () => {
    const loads = [5, 25, 75, 200];
    let prevTypical = 0;
    for (const mw of loads) {
      const r = await runUtilityInterconnect({ utility: "dominion", load_mw: mw });
      const t = r.results.interconnect_process.timeline_months_typical;
      if (t < prevTypical)
        throw new Error(`Timeline should increase: ${mw} MW gave ${t} mo < prev ${prevTypical}`);
      prevTypical = t;
      console.log(`       dominion ${mw} MW → ${t} mo typical`);
    }
  });

  // Oncor should be fastest at every tier
  await test("Oncor: fastest typical timeline at all load sizes", async () => {
    const loadSizes = [5, 50, 150];
    for (const mw of loadSizes) {
      const oncor = await runUtilityInterconnect({ utility: "oncor", load_mw: mw });
      const sce   = await runUtilityInterconnect({ utility: "sce",   load_mw: mw });
      const tOncor = oncor.results.interconnect_process.timeline_months_typical;
      const tSce   = sce.results.interconnect_process.timeline_months_typical;
      if (tOncor >= tSce)
        throw new Error(`Oncor (${tOncor} mo) should be faster than SCE (${tSce} mo) at ${mw} MW`);
      console.log(`       ${mw} MW: Oncor ${tOncor} mo vs SCE ${tSce} mo ✓`);
    }
  });

  // SCE should be slowest at every tier
  await test("SCE: slowest typical timeline at every load size", async () => {
    const loadSizes = [10, 50, 100];
    for (const mw of loadSizes) {
      const sce = await runUtilityInterconnect({ utility: "sce", load_mw: mw });
      for (const u of (["dominion", "comed", "georgia_power", "oncor"] as const)) {
        const other = await runUtilityInterconnect({ utility: u, load_mw: mw });
        const tSce   = sce.results.interconnect_process.timeline_months_typical;
        const tOther = other.results.interconnect_process.timeline_months_typical;
        if (tSce <= tOther)
          throw new Error(`SCE (${tSce} mo) should be slower than ${u} (${tOther} mo) at ${mw} MW`);
      }
    }
    console.log(`       SCE is slowest vs Dominion/ComEd/Georgia/Oncor at 10, 50, 100 MW`);
  });

  // ── 3. Deposit $/kW ranges ────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Deposit $/kW range validation`);
  console.log(bar());

  await test("All utilities: deposit_per_kw_range_high >= deposit_per_kw_range_low", async () => {
    for (const utility of VALID_UTILITIES) {
      const r = await runUtilityInterconnect({ utility, load_mw: 100 });
      const sd = r.results.costs.study_deposits;
      if (sd.deposit_per_kw_range_high < sd.deposit_per_kw_range_low)
        throw new Error(`${utility}: high (${sd.deposit_per_kw_range_high}) < low (${sd.deposit_per_kw_range_low})`);
      console.log(`       ${utility}: $${sd.deposit_per_kw_range_low}–$${sd.deposit_per_kw_range_high}/kW → ${usd(sd.deposit_range_low_usd)}–${usd(sd.deposit_range_high_usd)}`);
    }
  });

  await test("Deposit range scales with load_mw", async () => {
    const r10  = await runUtilityInterconnect({ utility: "dominion", load_mw: 10 });
    const r100 = await runUtilityInterconnect({ utility: "dominion", load_mw: 100 });
    const lo10  = r10.results.costs.study_deposits.deposit_range_low_usd;
    const lo100 = r100.results.costs.study_deposits.deposit_range_low_usd;
    if (lo100 <= lo10) throw new Error(`100 MW deposit (${usd(lo100)}) must exceed 10 MW (${usd(lo10)})`);
    console.log(`       10 MW: ${usd(lo10)}  →  100 MW: ${usd(lo100)}`);
  });

  await test("SCE has highest deposit/kW (most constrained CA market)", async () => {
    const sce    = await runUtilityInterconnect({ utility: "sce",           load_mw: 100 });
    const oncor  = await runUtilityInterconnect({ utility: "oncor",         load_mw: 100 });
    const gpower = await runUtilityInterconnect({ utility: "georgia_power", load_mw: 100 });
    const sceLow   = sce.results.costs.study_deposits.deposit_per_kw_range_low;
    const oncorLow = oncor.results.costs.study_deposits.deposit_per_kw_range_low;
    const gpLow    = gpower.results.costs.study_deposits.deposit_per_kw_range_low;
    if (sceLow <= oncorLow) throw new Error(`SCE low ($${sceLow}/kW) should exceed Oncor ($${oncorLow}/kW)`);
    if (sceLow <= gpLow)    throw new Error(`SCE low ($${sceLow}/kW) should exceed Georgia ($${gpLow}/kW)`);
    console.log(`       SCE $${sceLow}/kW > Oncor $${oncorLow}/kW, Georgia $${gpLow}/kW`);
  });

  // ── 4. First-year cost ────────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` First-year total cost`);
  console.log(bar());

  await test("All utilities: first_year_total_high > first_year_total_low", async () => {
    for (const utility of VALID_UTILITIES) {
      const r = await runUtilityInterconnect({ utility, load_mw: 50 });
      const c = r.results.costs;
      if (c.first_year_total_high_usd <= c.first_year_total_low_usd)
        throw new Error(`${utility}: high (${usd(c.first_year_total_high_usd)}) <= low (${usd(c.first_year_total_low_usd)})`);
    }
    console.log(`       all 9 utilities pass first-year cost ordering`);
  });

  await test("First-year cost includes annual operating cost", async () => {
    const r    = await runUtilityInterconnect({ utility: "oncor", load_mw: 100 });
    const ann  = r.results.annual_operating_cost.total_annual_cost_usd;
    const low1 = r.results.costs.first_year_total_low_usd;
    if (low1 < ann) throw new Error(`First-year low (${usd(low1)}) must be >= annual cost (${usd(ann)})`);
    console.log(`       Oncor 100 MW: annual ${usd(ann)} + deposits/upgrades = ${usd(low1)} low first year`);
  });

  // ── 5. Competitive intel ──────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Competitive intel`);
  console.log(bar());

  await test("All 9 utilities have competitive_intel array with ≥2 entries", async () => {
    for (const utility of VALID_UTILITIES) {
      const r = await runUtilityInterconnect({ utility, load_mw: 100 });
      const intel = r.results.competitive_intel;
      if (!intel || intel.length < 2)
        throw new Error(`${utility}: expected ≥2 competitive_intel entries, got ${intel?.length ?? 0}`);
    }
    console.log(`       all 9 utilities have competitive intel`);
  });

  // ── 6. Xcel Energy specific tests ────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Xcel Energy (CO/MN) — specific tests`);
  console.log(bar());

  await test("Xcel CO — 50 MW data center full scenario", async () => {
    await printScenario("xcel", 50, "data_center", "CO");
  });

  await test("Xcel MN state triggers MISO warning", async () => {
    const r = await runUtilityInterconnect({ utility: "xcel", load_mw: 100, state: "MN" });
    const hasWarning = r.results.warnings.some(w => w.includes("MISO") || w.includes("Minnesota"));
    if (!hasWarning) throw new Error("Expected MISO/MN warning for MN state");
    console.log(`       MN warning: ${r.results.warnings.find(w => w.includes("MISO"))?.substring(0, 80)}`);
  });

  await test("Xcel CO altitude warning present", async () => {
    const r = await runUtilityInterconnect({ utility: "xcel", load_mw: 50, state: "CO" });
    const hasWarning = r.results.warnings.some(w => w.includes("altitude") || w.includes("HIGH ALTITUDE"));
    if (!hasWarning) throw new Error("Expected altitude warning for Xcel CO");
    console.log(`       Altitude warning: ${r.results.warnings.find(w => w.includes("ALTITUDE"))?.substring(0, 80)}`);
  });

  await test("Xcel timeline is between Georgia (fast) and PG&E (slow) at 100 MW", async () => {
    const xcel  = await runUtilityInterconnect({ utility: "xcel",          load_mw: 100 });
    const ga    = await runUtilityInterconnect({ utility: "georgia_power",  load_mw: 100 });
    const pge   = await runUtilityInterconnect({ utility: "pge",            load_mw: 100 });
    const tX  = xcel.results.interconnect_process.timeline_months_typical;
    const tGA = ga.results.interconnect_process.timeline_months_typical;
    const tPG = pge.results.interconnect_process.timeline_months_typical;
    if (tX <= tGA) throw new Error(`Xcel (${tX} mo) should be slower than Georgia (${tGA} mo)`);
    if (tX >= tPG) throw new Error(`Xcel (${tX} mo) should be faster than PG&E (${tPG} mo)`);
    console.log(`       Georgia ${tGA} mo < Xcel ${tX} mo < PG&E ${tPG} mo ✓`);
  });

  // ── 7. State validation ───────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` State validation`);
  console.log(bar());

  await test("State mismatch generates warning (Dominion + CA)", async () => {
    const r = await runUtilityInterconnect({ utility: "dominion", load_mw: 50, state: "CA" });
    const hasMismatch = r.results.warnings.some(w => w.includes("STATE MISMATCH") || w.includes("mismatch"));
    if (!hasMismatch) throw new Error("Expected STATE MISMATCH warning");
    console.log(`       Mismatch warning: ${r.results.warnings[0].substring(0, 90)}`);
  });

  await test("Correct state produces no mismatch warning (Dominion + VA)", async () => {
    const r = await runUtilityInterconnect({ utility: "dominion", load_mw: 50, state: "VA" });
    const hasMismatch = r.results.warnings.some(w => w.includes("STATE MISMATCH"));
    if (hasMismatch) throw new Error("Unexpected STATE MISMATCH warning for correct state");
    console.log(`       No mismatch warning for Dominion + VA ✓`);
  });

  await test("Validation rejects invalid state code (3 letters)", () => {
    try {
      validateWorkflowParams("utility_interconnect", { utility: "dominion", load_mw: "100", state: "VAA" });
      throw new Error("Expected rejection");
    } catch (err) {
      if (err instanceof McpError) {
        console.log(`       rejected: ${err.message.substring(0, 80)}`);
        return;
      }
      throw err;
    }
  });

  await test("Validation accepts valid 2-letter state code", () => {
    const clean = validateWorkflowParams("utility_interconnect",
      { utility: "xcel", load_mw: "100", state: "CO" });
    if (clean.state !== "CO") throw new Error(`Expected CO, got ${clean.state}`);
    console.log(`       clean.state = ${clean.state} ✓`);
  });

  // ── 8. Rate comparison — highest vs lowest rates ──────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Rate comparison across all utilities`);
  console.log(bar());

  await test("SCE has highest effective rate; Georgia Power / Oncor near lowest", async () => {
    const results = await Promise.all(
      VALID_UTILITIES.map(u => runUtilityInterconnect({ utility: u, load_mw: 100 }))
    );
    const rates = results.map(r => ({
      abbr: r.results.abbreviation,
      rate: r.results.annual_operating_cost.effective_rate_per_kwh,
    })).sort((a, b) => b.rate - a.rate);

    rates.forEach(r => console.log(`       ${r.abbr.padEnd(12)} $${r.rate}/kWh`));

    if (rates[0].abbr !== "SCE") throw new Error(`Expected SCE highest rate, got ${rates[0].abbr}`);
    const lowAbbrList = rates.slice(-3).map(r => r.abbr);
    const hasGpOrOncor = lowAbbrList.some(a => ["GPC", "Oncor", "DEC/DEP"].includes(a));
    if (!hasGpOrOncor)
      throw new Error(`Expected Georgia/Oncor/Duke in lowest 3 rates, got: ${lowAbbrList.join(", ")}`);
  });

  // ── 9. Input validation — rejections ─────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Input validation — bad inputs must be REJECTED`);
  console.log(bar());

  const badCases: Array<[string, Record<string, string>]> = [
    ["utility=xcel_invalid",            { utility: "xcel_invalid",  load_mw: "100" }],
    ["utility=empty",                   { utility: "",              load_mw: "100" }],
    ["load_mw=0",                       { utility: "dominion",      load_mw: "0"   }],
    ["load_mw=501 (above 500 max)",     { utility: "dominion",      load_mw: "501" }],
    ["load_mw=abc",                     { utility: "pge",           load_mw: "abc" }],
    ["load_mw=-5",                      { utility: "comed",         load_mw: "-5"  }],
    ["voltage_kv=3 (<4 kV min)",        { utility: "dominion",      load_mw: "100", voltage_kv: "3"   }],
    ["voltage_kv=766 (>765 kV max)",    { utility: "dominion",      load_mw: "100", voltage_kv: "766" }],
    ["load_type=residential",           { utility: "dominion",      load_mw: "100", load_type: "residential" }],
    ["state=VAA (3 letters)",           { utility: "dominion",      load_mw: "100", state: "VAA" }],
    ["shell injection in utility",      { utility: "dominion; ls",  load_mw: "100" }],
    ["path traversal in utility",       { utility: "../../../etc",  load_mw: "100" }],
    ["load_mw with trailing garbage",    { utility: "oncor",         load_mw: "abc100"     }],
  ];

  for (const [label, params] of badCases) {
    await test(`Rejects ${label}`, () => {
      try {
        validateWorkflowParams("utility_interconnect", params);
        throw new Error("Expected rejection but validation passed");
      } catch (err) {
        if (err instanceof McpError) {
          console.log(`       rejected: ${err.message.substring(0, 80)}`);
          return;
        }
        throw err;
      }
    });
  }

  // ── 10. Input validation — acceptance ────────────────────────────────────
  console.log(`\n  Valid inputs — all must be ACCEPTED`);

  const goodCases: Array<[string, Record<string, string>]> = [
    ["minimal dominion",             { utility: "dominion",      load_mw: "100"  }],
    ["xcel CO with state",           { utility: "xcel",          load_mw: "50",  state: "CO" }],
    ["xcel MN with state",           { utility: "xcel",          load_mw: "75",  state: "MN" }],
    ["pge all params",               { utility: "pge",           load_mw: "200", voltage_kv: "115", load_type: "industrial", state: "CA" }],
    ["georgia commercial",           { utility: "georgia_power", load_mw: "20",  load_type: "commercial" }],
    ["oncor fractional MW",          { utility: "oncor",         load_mw: "12.5" }],
    ["sce max load",                 { utility: "sce",           load_mw: "500"  }],
    ["duke_energy min load",         { utility: "duke_energy",   load_mw: "1"   }],
  ];

  for (const [label, params] of goodCases) {
    await test(`Accepts ${label}`, () => {
      const clean = validateWorkflowParams("utility_interconnect", params);
      console.log(`       clean=${JSON.stringify(clean)}`);
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Results`);
  console.log(bar());
  console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Total: ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
