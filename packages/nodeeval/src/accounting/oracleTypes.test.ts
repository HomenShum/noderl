// Inline anti-rubber-stamp test for the accounting oracle summarizer.
// Run: npx tsx packages/nodeeval/src/accounting/oracleTypes.test.ts
//
// Hard bar (anti-cheat doctrine): the summarizer MUST accept a GOOD input
// (passed=true) AND reject a BAD input (passed=false). A summarizer that always
// passes is a bug — so we assert BOTH directions, plus determinism.
import { summarize, type OracleCheck } from "./oracleTypes";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error(`  FAIL: ${msg}`);
  } else {
    console.log(`  ok:   ${msg}`);
  }
}

// --- GOOD input: every check passes -> verifier passes, score = 1 ---
const good: OracleCheck[] = [
  { name: "balance_sheet_balances", passed: true, detail: "assets 1000.00 == liabilities+equity 1000.00" },
  { name: "debits_equal_credits", passed: true, detail: "debits 500.00 == credits 500.00" },
];
const goodResult = summarize("balance-oracle", good);
assert(goodResult.passed === true, "GOOD input -> passed === true");
assert(goodResult.score === 1, "GOOD input -> score === 1 (2/2)");
assert(goodResult.verifier === "balance-oracle", "verifier name preserved");
assert(goodResult.checks.length === 2, "checks preserved");

// --- BAD input: one check fails -> verifier fails, score = 1/2 ---
const bad: OracleCheck[] = [
  { name: "balance_sheet_balances", passed: true, detail: "assets 1000.00 == liabilities+equity 1000.00" },
  { name: "debits_equal_credits", passed: false, detail: "debits 500.00 != credits 499.00 (delta 1.00 > 0.005)" },
];
const badResult = summarize("balance-oracle", bad);
assert(badResult.passed === false, "BAD input -> passed === false (rejects a wrong input)");
assert(badResult.score === 0.5, "BAD input -> score === 0.5 (1/2)");

// --- Empty checks: vacuous pass, score reported as 1 (0/0 convention) ---
const emptyResult = summarize("empty-oracle", []);
assert(emptyResult.passed === true, "empty checks -> passed === true (vacuous)");
assert(emptyResult.score === 1, "empty checks -> score === 1 (0/0 convention)");

// --- Determinism: same input -> identical output (no clock/random) ---
const a = summarize("balance-oracle", good);
const b = summarize("balance-oracle", good);
assert(JSON.stringify(a) === JSON.stringify(b), "deterministic: identical output for identical input");

// --- Defensive copy: mutating input array does not change the snapshot ---
const src: OracleCheck[] = [{ name: "x", passed: true, detail: "" }];
const snap = summarize("copy-oracle", src);
src.push({ name: "y", passed: false, detail: "" });
assert(snap.checks.length === 1, "checks are a defensive copy (input mutation ignored)");

if (failures > 0) {
  console.error(`\nRESULT: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
} else {
  console.log("\nRESULT: PASS (accepts GOOD, rejects BAD, deterministic)");
}
