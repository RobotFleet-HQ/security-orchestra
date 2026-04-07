import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const BILLING_API_URL = process.env.BILLING_API_URL ?? "http://localhost:3001";

// Credits consumed per workflow
// Simple: 5 | Compliance: 20 | Complex: 50 | Premium: 100
// Effective cost to customer ≈ $0.05/credit (Pro/Enterprise rate)
export const WORKFLOW_COSTS: Record<string, number> = {
  subdomain_discovery:      5,
  asset_discovery:          15,
  vulnerability_assessment: 25,
  // ── Premium Reports (100 credits = $10.00/call) ───────────────────────────
  generator_sizing:         100,
  utility_interconnect:     100,
  nc_utility_interconnect:  100,
  // ── Simple (5 credits = $0.50/call) ──────────────────────────────────────
  pue_calculator:           5,
  construction_cost:        5,
  ats_sizing:               5,
  ups_sizing:               5,
  fuel_storage:             5,
  cooling_load:             5,
  // ── Compliance (20 credits = $2.00/call) ─────────────────────────────────
  nfpa_110_checker:         20,
  redundancy_validator:     20,
  // ── Complex Analysis (50 credits = $5.00/call) ───────────────────────────
  power_density:            50,
  // Phase 1 — previously unregistered agents
  // Premium Reports
  demand_response:          100,
  incentive_finder:         100,
  roi_calculator:           100,
  tco_analyzer:             100,
  fiber_connectivity:       100,
  site_scoring:             100,
  solar_feasibility:        100,
  energy_procurement:       100,
  // Compliance
  environmental_impact:     20,
  fire_suppression:         20,
  noise_compliance:         20,
  permit_timeline:          20,
  voltage_drop:             20,
  // Complex Analysis
  harmonic_analysis:        50,
  water_availability:       50,
  // Phase 2 — new agents
  // Simple
  bandwidth_sizing:         5,
  latency_calculator:       5,
  ip_addressing:            5,
  crac_vs_crah:             5,
  humidification:           5,
  maintenance_schedule:     5,
  sla_calculator:           5,
  change_management:        5,
  // Compliance
  physical_security:        20,
  biometric_design:         20,
  surveillance_coverage:    20,
  // Complex Analysis
  network_topology:         50,
  dns_architecture:         50,
  bgp_peering:              50,
  chiller_sizing:           50,
  airflow_modeling:         50,
  economizer_analysis:      50,
  construction_timeline:    50,
  commissioning_plan:       50,
  capacity_planning:        50,
  carbon_footprint:         50,
  battery_storage:          50,
  // Premium Reports
  cybersecurity_controls:   100,
  compliance_checker:       100,
  // Phase 3 — premium agents
  tier_certification_checker: 100,
  // Phase 4 — grid & weather intelligence
  get_grid_telemetry:         5,
  get_active_weather_alerts:  5,
};

// ─── Per-leaf chain billing ────────────────────────────────────────────────────
// Credits charged per agent when it runs as a leaf inside a compound chain.
// Always lower than WORKFLOW_COSTS (standalone rate).
// Default for unlisted agents: 1 credit.
//   1 credit = single-domain computation (sizing, calculation, lookup)
//   2 credits = multi-factor analysis (ROI, TCO, PUE, carbon, site scoring, etc.)
export const CHAIN_OVERHEAD_CREDITS = 1; // flat orchestration tax per chain invocation

export const CHAIN_LEAF_CREDITS: Record<string, number> = {
  // ── 2 credits — analysis agents ────────────────────────────────────────────
  roi_calculator:             2,
  tco_analyzer:               2,
  pue_calculator:             2,
  carbon_footprint:           2,
  site_scoring:               2,
  solar_feasibility:          2,
  energy_procurement:         2,
  fiber_connectivity:         2,
  demand_response:            2,
  incentive_finder:           2,
  cybersecurity_controls:     2,
  compliance_checker:         2,
  tier_certification_checker: 2,
  network_topology:           2,
  bgp_peering:                2,
  harmonic_analysis:          2,
  capacity_planning:          2,
  economizer_analysis:        2,
  commissioning_plan:         2,
  construction_timeline:      2,
  battery_storage:            2,
  water_availability:         2,
  // ── 1 credit — single-domain computation agents (default) ──────────────────
  // All others (generator_sizing, ups_sizing, cooling_load, nfpa_110_checker,
  // ats_sizing, fuel_storage, etc.) default to 1 via the ?? 1 fallback.
};

interface CreditsResponse {
  balance: number;
  user_id: string;
}

interface DeductResponse {
  balance: number;
  deducted: number;
  error?: string;
}

export async function checkCredits(userId: string): Promise<number> {
  const res = await fetch(`${BILLING_API_URL}/credits/${userId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new McpError(
      ErrorCode.InternalError,
      `Billing API error checking credits: ${body.error ?? res.statusText}`
    );
  }
  const data = await res.json() as CreditsResponse;
  return data.balance;
}

export async function deductCredits(
  userId: string,
  amount: number,
  reason: string
): Promise<number> {
  const res = await fetch(`${BILLING_API_URL}/credits/${userId}/deduct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, reason }),
  });

  if (res.status === 402) {
    const body = await res.json() as { error: string; balance: number; required: number };
    const billingUrl = BILLING_API_URL.replace("localhost:3001", "security-orchestra-billing.onrender.com");
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Insufficient credits — balance: ${body.balance}, required: ${body.required}.\n\n` +
      `Options to continue:\n` +
      `• Buy credits: POST ${billingUrl}/credits/purchase {"email":"your@email.com","pack":"250"}\n` +
      `• Buy 100 credits ($10): ${billingUrl}/credits/buy?pack=100\n` +
      `• Buy 250 credits ($20): ${billingUrl}/credits/buy?pack=250\n` +
      `• Buy 500 credits ($35): ${billingUrl}/credits/buy?pack=500\n` +
      `• Upgrade plan: ${billingUrl}/subscription/upgrade`
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new McpError(
      ErrorCode.InternalError,
      `Billing API error deducting credits: ${body.error ?? res.statusText}`
    );
  }

  const data = await res.json() as DeductResponse;

  // Trigger low-credit warning (fire-and-forget)
  if (data.balance > 0 && data.balance < 50) {
    triggerLowCreditWarning(userId, data.balance).catch(() => {});
  }

  return data.balance;
}

async function triggerLowCreditWarning(userId: string, balance: number): Promise<void> {
  try {
    await fetch(`${BILLING_API_URL}/credits/${userId}/low-credit-warning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balance }),
    });
  } catch {
    // Ignore — warning is best-effort
  }
}
