import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const BILLING_API_URL = process.env.BILLING_API_URL ?? "http://localhost:3001";

// Credits consumed per workflow
export const WORKFLOW_COSTS: Record<string, number> = {
  subdomain_discovery:      5,
  asset_discovery:          15,
  vulnerability_assessment: 25,
  generator_sizing:         10,
  utility_interconnect:     30,
  nc_utility_interconnect:  50,
  pue_calculator:           10,
  construction_cost:        10,
  nfpa_110_checker:         15,
  ats_sizing:               10,
  ups_sizing:               10,
  fuel_storage:             10,
  cooling_load:             10,
  power_density:            10,
  redundancy_validator:     15,
  // Phase 1 — previously unregistered agents
  demand_response:          15,
  environmental_impact:     15,
  fire_suppression:         10,
  incentive_finder:         20,
  noise_compliance:         10,
  permit_timeline:          15,
  roi_calculator:           10,
  tco_analyzer:             15,
  fiber_connectivity:       20,
  harmonic_analysis:        15,
  site_scoring:             25,
  voltage_drop:             10,
  water_availability:       10,
  // Phase 2 — new agents
  network_topology:         15,
  bandwidth_sizing:         10,
  latency_calculator:       10,
  ip_addressing:            10,
  dns_architecture:         10,
  bgp_peering:              15,
  physical_security:        15,
  biometric_design:         15,
  surveillance_coverage:    15,
  cybersecurity_controls:   20,
  compliance_checker:       20,
  chiller_sizing:           15,
  crac_vs_crah:             15,
  airflow_modeling:         15,
  humidification:           10,
  economizer_analysis:      15,
  construction_timeline:    15,
  commissioning_plan:       15,
  maintenance_schedule:     10,
  capacity_planning:        15,
  sla_calculator:           10,
  change_management:        10,
  carbon_footprint:         15,
  solar_feasibility:        20,
  battery_storage:          15,
  energy_procurement:       20,
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
