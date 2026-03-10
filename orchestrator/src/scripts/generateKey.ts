import { generateApiKey } from "../auth.js";
import { storeApiKey, db } from "../database.js";

async function main() {
  const [userId, tier] = process.argv.slice(2);

  if (!userId || !tier) {
    console.error("Usage: npm run generate-key <userId> <tier>");
    process.exit(1);
  }

  const apiKey = generateApiKey(userId, tier);

  try {
    await storeApiKey(apiKey, userId, tier);
  } catch (err) {
    console.error("Failed to store key:", err);
    db.close();
    process.exit(1);
  }

  // Print ONCE — never stored in plaintext
  console.log("\n========================================");
  console.log("  API Key Generated (shown only once!)");
  console.log("========================================");
  console.log(`  User  : ${userId}`);
  console.log(`  Tier  : ${tier}`);
  console.log(`  Key   : ${apiKey}`);
  console.log("========================================\n");
  console.log("Store this key securely. It cannot be recovered.");

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
