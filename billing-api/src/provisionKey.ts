/**
 * provisionKey.ts
 * Calls the orchestrator's POST /admin/provision-key endpoint with retry +
 * exponential backoff. Handles 429 / 503 (Render spin-up throttling) gracefully.
 */

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1500; // 1.5 s → 3 s → 6 s

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function provisionApiKey(
  userId: string,
  tier: string
): Promise<string | null> {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  const adminKey = process.env.ORCHESTRATOR_ADMIN_KEY;

  if (!orchestratorUrl || !adminKey) {
    console.warn(
      "[provision-key] ORCHESTRATOR_URL or ORCHESTRATOR_ADMIN_KEY not set — skipping"
    );
    return null;
  }

  const url = `${orchestratorUrl}/admin/provision-key`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status = 0;
    let bodyText = "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ userId, tier }),
        // 10-second timeout per attempt
        signal: AbortSignal.timeout(10_000),
      });

      status = res.status;
      bodyText = await res.text();

      if (res.ok) {
        const data = JSON.parse(bodyText) as { apiKey: string };
        console.log(
          `[provision-key] Success on attempt ${attempt} for user ${userId} (tier: ${tier})`
        );
        return data.apiKey;
      }

      // Retryable: 429 (rate-limited) or 503 (Render spin-up / unavailable)
      if ((status === 429 || status === 503) && attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[provision-key] ${status} on attempt ${attempt}/${MAX_ATTEMPTS} — ` +
          `retrying in ${delay}ms. Body: ${bodyText.slice(0, 120)}`
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error
      console.error(
        `[provision-key] Failed (${status}) for user ${userId} after attempt ${attempt}. ` +
        `Body: ${bodyText.slice(0, 200)}`
      );
      return null;
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[provision-key] Network error on attempt ${attempt}/${MAX_ATTEMPTS}: ${msg} — ` +
          `retrying in ${delay}ms`
        );
        await sleep(delay);
      } else {
        console.error(
          `[provision-key] All ${MAX_ATTEMPTS} attempts failed for user ${userId}. Last error: ${msg}`
        );
      }
    }
  }

  return null;
}
