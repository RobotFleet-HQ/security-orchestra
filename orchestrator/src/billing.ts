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
    throw new McpError(
      ErrorCode.InvalidRequest,
      `402: Insufficient credits — balance: ${body.balance}, required: ${body.required}. ` +
      `Upgrade your plan at /checkout/tiers`
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
  return data.balance;
}
