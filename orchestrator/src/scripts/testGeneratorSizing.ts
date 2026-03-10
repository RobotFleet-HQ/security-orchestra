/**
 * Test: generator_sizing workflow
 * Runs the Python agent through the TypeScript wrapper for multiple scenarios
 * and validates the output against expected engineering constraints.
 */

import { runGeneratorSizing } from "../workflows/generatorSizing.js";
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

function fmt(n: number, unit = "") {
  return n.toLocaleString() + (unit ? " " + unit : "");
}

function bar(w = 62) { return "─".repeat(w); }

// ─── Scenario runner ──────────────────────────────────────────────────────────

interface Scenario {
  label:       string;
  load_kw:     number;
  tier:        "N" | "N+1" | "2N" | "2N+1";
  altitude_ft?: number;
  temp_f?:     number;
}

async function runScenario(s: Scenario) {
  console.log(`\n  ${bar(58)}`);
  console.log(`  Scenario: ${s.label}`);
  console.log(`  ${bar(58)}`);

  const result = await runGeneratorSizing({
    load_kw:     s.load_kw,
    tier:        s.tier,
    altitude_ft: s.altitude_ft ?? 0,
    temp_f:      s.temp_f ?? 77,
  });

  const r = result.results;
  const d = r.derating;
  const c = r.redundancy_config;

  console.log(`  Input            : ${fmt(s.load_kw, "kW")} load · ${s.tier} redundancy ·` +
    ` ${s.altitude_ft ?? 0} ft · ${s.temp_f ?? 77}°F`);
  console.log(`  Derating         : alt×${d.altitude_factor} × temp×${d.temperature_factor}` +
    ` = ×${d.combined_factor} → ${fmt(d.derated_required_kw, "kW")} required`);
  console.log(`  Unit selected    : ${r.unit_model} (${fmt(r.unit_kw, "kW")} each)`);
  console.log(`  Genset output    : ${fmt(r.genset_kw, "kW")} / ${fmt(r.genset_kva, "kVA")}`);
  console.log(`  Configuration    : ${c.active_units} active + ${c.standby_units} standby` +
    ` = ${c.total_units} total units`);
  console.log(`  Fuel consumption : ${fmt(r.fuel_gph, "gph")} at full load`);
  console.log(`  Tank size        : ${fmt(r.tank_size_gal, "gal")} (${fmt(r.runtime_hours, "hrs")} runtime)`);
  console.log(`  ATS sizing       : ${fmt(r.ats_amps_480v, "A")} at 480V 3Ø`);
  console.log(`  NOx emissions    : ${r.nox_lb_per_hr} lb/hr`);
  console.log(`  Cost estimate    : $${fmt(r.cost_estimate.equipment_usd)} equipment` +
    ` / $${fmt(r.cost_estimate.installed_usd)} installed` +
    ` ($${fmt(r.cost_estimate.per_kw_installed)}/kW)`);
  console.log(`  NFPA 110         : ${r.compliance.nfpa_110_class}`);
  if (r.notes.length) console.log(`  Notes            : ${r.notes.join("; ")}`);
  console.log(`  Duration         : ${r.duration_ms}ms`);

  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nGenerator Sizing Workflow — Integration Tests`);
  console.log(bar());

  // ── 1. Small edge data centre — 100 kW N+1 ───────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Load scenarios`);
  console.log(bar());

  let r100: Awaited<ReturnType<typeof runGeneratorSizing>>;
  await test("100 kW N+1 — small edge DC", async () => {
    r100 = await runScenario({ label: "100 kW edge data centre", load_kw: 100, tier: "N+1" });
    if (r100.results.genset_kva <= 0) throw new Error("kVA must be > 0");
    if (r100.results.runtime_hours < 8)
      throw new Error(`NFPA 110 requires ≥8h runtime, got ${r100.results.runtime_hours}`);
  });

  let r1mw: Awaited<ReturnType<typeof runGeneratorSizing>>;
  await test("1 MW 2N — medium colocation", async () => {
    r1mw = await runScenario({ label: "1 MW colocation (2N)", load_kw: 1000, tier: "2N" });
    if (r1mw.results.redundancy_config.total_units < 2)
      throw new Error("2N must have ≥2 units");
  });

  let r10mw: Awaited<ReturnType<typeof runGeneratorSizing>>;
  await test("10 MW 2N+1 — hyperscale", async () => {
    r10mw = await runScenario({ label: "10 MW hyperscale (2N+1)", load_kw: 10000, tier: "2N+1" });
    if (r10mw.results.genset_kw < 10000)
      throw new Error(`Genset kW ${r10mw.results.genset_kw} must cover 10000 kW load`);
  });

  // ── 2. Derating scenarios ────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Derating scenarios`);
  console.log(bar());

  await test("High-altitude Denver (5280 ft) — derating applied", async () => {
    const r = await runScenario({
      label: "Denver high altitude (5280 ft)", load_kw: 500, tier: "N+1",
      altitude_ft: 5280, temp_f: 77,
    });
    if (r.results.derating.altitude_factor >= 1.0)
      throw new Error("Altitude derating must be < 1.0 at 5280 ft");
    if (r.results.derating.derated_required_kw <= 500)
      throw new Error("Derated required kW must exceed load_kw when derating < 1");
  });

  await test("Hot climate (115°F) — temperature derating applied", async () => {
    const r = await runScenario({
      label: "Phoenix hot climate (115°F)", load_kw: 500, tier: "N",
      altitude_ft: 1083, temp_f: 115,
    });
    if (r.results.derating.temperature_factor >= 1.0)
      throw new Error("Temp derating must be < 1.0 at 115°F");
  });

  await test("Combined derating — high altitude + high temp", async () => {
    const r = await runScenario({
      label: "Extreme site (6000 ft, 120°F)", load_kw: 250, tier: "N+1",
      altitude_ft: 6000, temp_f: 120,
    });
    if (r.results.derating.combined_factor >= 1.0)
      throw new Error("Combined factor must be < 1.0");
  });

  // ── 3. Redundancy tier verification ─────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Redundancy tier unit counts — 500 kW base load`);
  console.log(bar());

  const tierTests: Array<["N" | "N+1" | "2N" | "2N+1", number]> = [
    ["N",    1],
    ["N+1",  2],
    ["2N",   2],
    ["2N+1", 3],
  ];

  for (const [tier, minUnits] of tierTests) {
    await test(`Tier ${tier} — ≥${minUnits} total unit(s)`, async () => {
      const r = await runGeneratorSizing({ load_kw: 500, tier });
      const actual = r.results.redundancy_config.total_units;
      if (actual < minUnits)
        throw new Error(`Expected ≥${minUnits} units for ${tier}, got ${actual}`);
      console.log(`       total_units=${actual}, active=${r.results.redundancy_config.active_units},` +
        ` standby=${r.results.redundancy_config.standby_units}`);
    });
  }

  // ── 4. Runtime — NFPA 110 minimum 8 hours ───────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` NFPA 110 compliance — runtime targets`);
  console.log(bar());

  const runtimeTargets: Array<["N" | "N+1" | "2N" | "2N+1", number]> = [
    ["N",    24],
    ["N+1",  48],
    ["2N",   72],
    ["2N+1", 96],
  ];

  for (const [tier, targetHours] of runtimeTargets) {
    await test(`Tier ${tier} — ≥${targetHours}h runtime target`, async () => {
      const r = await runGeneratorSizing({ load_kw: 200, tier });
      if (r.results.runtime_target_hours !== targetHours)
        throw new Error(`Expected ${targetHours}h, got ${r.results.runtime_target_hours}h`);
      if (r.results.runtime_hours < targetHours)
        throw new Error(`Actual runtime ${r.results.runtime_hours}h < target ${targetHours}h`);
      console.log(`       target=${targetHours}h, actual=${r.results.runtime_hours}h (tank: ${r.results.tank_size_gal} gal)`);
    });
  }

  // ── 5. Input validation ──────────────────────────────────────────────────
  console.log(`\n${bar()}`);
  console.log(` Input validation — all bad inputs must be REJECTED`);
  console.log(bar());

  const validationCases: Array<[string, Record<string, string>]> = [
    ["load_kw=0 (below minimum)",          { load_kw: "0",     tier: "N"   }],
    ["load_kw=99999 (above maximum)",       { load_kw: "99999", tier: "N"   }],
    ["load_kw=abc (non-numeric)",           { load_kw: "abc",   tier: "N+1" }],
    ["tier=INVALID (unknown tier)",         { load_kw: "100",   tier: "INVALID" }],
    ["altitude_ft=-1 (negative)",           { load_kw: "100",   tier: "N", altitude_ft: "-1"  }],
    ["altitude_ft=99999 (above max)",       { load_kw: "100",   tier: "N", altitude_ft: "99999" }],
    ["temp_f=999 (above operational max)",  { load_kw: "100",   tier: "N", temp_f: "999" }],
  ];

  for (const [label, params] of validationCases) {
    await test(`Rejects ${label}`, () => {
      try {
        validateWorkflowParams("generator_sizing", params);
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

  // ── 6. Valid inputs pass validation ─────────────────────────────────────
  const validCases: Array<[string, Record<string, string>]> = [
    ["minimal params",              { load_kw: "100",  tier: "N"   }],
    ["all params",                  { load_kw: "1000", tier: "2N+1", altitude_ft: "5000", temp_f: "95" }],
    ["max realistic load",          { load_kw: "50000",tier: "N"   }],
    ["fractional kW",               { load_kw: "150.5",tier: "N+1" }],
  ];

  console.log(`\n  Valid inputs — all must be ACCEPTED`);
  for (const [label, params] of validCases) {
    await test(`Accepts ${label}`, () => {
      const clean = validateWorkflowParams("generator_sizing", params);
      console.log(`       clean=${JSON.stringify(clean)}`);
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────
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
