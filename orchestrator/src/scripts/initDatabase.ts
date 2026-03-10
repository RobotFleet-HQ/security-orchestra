/**
 * initDatabase.ts
 * ---------------
 * Run once before the server starts (via `npm start`).
 * If the keys table is empty, generates a default enterprise API key and
 * prints it to stderr so it appears in Railway / Render deployment logs.
 *
 * On subsequent startups the table already has rows, so this is a no-op.
 */

import { generateApiKey } from "../auth.js";
import { storeApiKey, findAllKeys, db } from "../database.js";

const DEFAULT_USER_ID = "admin";
const DEFAULT_TIER    = "enterprise";

async function main() {
  const existing = await findAllKeys();

  if (existing.length > 0) {
    console.error(
      `[init] Database already has ${existing.length} key(s) — skipping auto-generation.`
    );
    db.close();
    return;
  }

  // No keys exist — generate one for first-time startup
  const apiKey = generateApiKey(DEFAULT_USER_ID, DEFAULT_TIER);

  try {
    await storeApiKey(apiKey, DEFAULT_USER_ID, DEFAULT_TIER);
  } catch (err) {
    console.error("[init] Failed to store auto-generated key:", err);
    db.close();
    process.exit(1);
  }

  // Print to stderr so Railway / Render surface it in the deploy log.
  // This is the ONLY time the plaintext key is visible — save it immediately.
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════╗");
  console.error("║          AUTO-GENERATED API KEY (shown once only)        ║");
  console.error("╠══════════════════════════════════════════════════════════╣");
  console.error(`║  User : ${DEFAULT_USER_ID.padEnd(50)} ║`);
  console.error(`║  Tier : ${DEFAULT_TIER.padEnd(50)} ║`);
  console.error(`║  Key  : ${apiKey.padEnd(50)} ║`);
  console.error("╠══════════════════════════════════════════════════════════╣");
  console.error("║  Set ORCHESTRATOR_API_KEY to this value in your client.  ║");
  console.error("║  It cannot be recovered — copy it now.                   ║");
  console.error("╚══════════════════════════════════════════════════════════╝");
  console.error("");

  db.close();
}

main().catch((err) => {
  console.error("[init] Fatal:", err);
  process.exit(1);
});
