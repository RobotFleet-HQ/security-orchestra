import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const BILLING_API_URL = process.env.BILLING_API_URL ?? "http://localhost:3001";

// Credits consumed per workflow
// Simple (5 = $0.50) | Compliance (20 = $2.00) | Complex (50 = $5.00) | Premium (100 = $10.00)
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
  short_circuit:            20,
  grounding_design:         20,
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
