// Anti-rubber-stamp test for the deterministic journalEntry accounting oracle.
//
// Run:
//   node "<repo>/node_modules/tsx/dist/cli.mjs" test/accounting_journalEntry.test.ts
// from packages/nodeeval.
//
// Hard bar (anti-cheat doctrine): the verifier MUST accept a GOOD input
// (passed=true) AND reject a BAD input (passed=false). A verifier that always
// passes is a bug — so we assert BOTH directions. For the BAD case we also assert
// that the SPECIFIC failing check is named, and that the verifier is deterministic
// (same input => byte-identical result).
import assert from "node:assert/strict";
import { verifyJournalEntries, type JournalEntriesInput } from "../src/accounting/journalEntry";

// -----------------------------------------------------------------------------
// GOOD fixture: a real double-entry set. Every entry balances, every account is
// in the chart, no negative amounts. Uses non-round cents to exercise tolerance.
// -----------------------------------------------------------------------------
const good: JournalEntriesInput = {
  chart: ["1000-cash", "4000-revenue", "5000-cogs", "2000-payable"],
  entries: [
    {
      // Record a sale: cash debited, revenue credited.
      lines: [
        { accountId: "1000-cash", debit: 300.3, credit: 0 },
        { accountId: "4000-revenue", debit: 0, credit: 100.1 },
        { accountId: "4000-revenue", debit: 0, credit: 200.2 }, // 100.10 + 200.20 == 300.30 (float ties covered by tolerance)
      ],
    },
    {
      // Record COGS: cogs debited, payable credited.
      lines: [
        { accountId: "5000-cogs", debit: 42.5, credit: 0 },
        { accountId: "2000-payable", debit: 0, credit: 42.5 },
      ],
    },
  ],
};

const goodResult = verifyJournalEntries(good);
assert.equal(goodResult.verifier, "journalEntry", "verifier name is journalEntry");
assert.equal(goodResult.passed, true, "GOOD input -> passed === true (accepts a correct set)");
assert.equal(goodResult.score, 1, "GOOD input -> score === 1 (all checks pass)");
assert.ok(goodResult.checks.length > 0, "GOOD input produced checks (not vacuous)");
console.log(`  ok:   GOOD accepted (passed=${goodResult.passed}, score=${goodResult.score}, ${goodResult.checks.length} checks)`);

// -----------------------------------------------------------------------------
// BAD fixture: exactly ONE broken invariant — the first entry is off by a full
// cent (credits total 300.29 vs debits 300.30). Everything else is valid, so we
// prove the verifier catches the imbalance specifically, not just "something".
// -----------------------------------------------------------------------------
const bad: JournalEntriesInput = {
  chart: ["1000-cash", "4000-revenue", "5000-cogs", "2000-payable"],
  entries: [
    {
      lines: [
        { accountId: "1000-cash", debit: 300.3, credit: 0 },
        { accountId: "4000-revenue", debit: 0, credit: 100.1 },
        { accountId: "4000-revenue", debit: 0, credit: 200.19 }, // 300.29 != 300.30 -> delta 0.01 > 0.005
      ],
    },
    {
      lines: [
        { accountId: "5000-cogs", debit: 42.5, credit: 0 },
        { accountId: "2000-payable", debit: 0, credit: 42.5 },
      ],
    },
  ],
};

const badResult = verifyJournalEntries(bad);
assert.equal(badResult.passed, false, "BAD input -> passed === false (rejects a wrong set)");
assert.ok(badResult.score < 1, "BAD input -> score < 1");

// The SPECIFIC failing check must be named and be the balance check for entry 0.
const failing = badResult.checks.filter((c) => !c.passed);
assert.equal(failing.length, 1, "exactly one check failed (only the injected defect)");
assert.equal(failing[0].name, "balances[entry 0]", "the named failing check is balances[entry 0]");
console.log(`  ok:   BAD rejected (failing check: ${failing[0].name} — ${failing[0].detail})`);

// -----------------------------------------------------------------------------
// Second BAD fixture: a different broken invariant (unknown account) — proves the
// verifier is not hardcoded to only catch imbalances.
// -----------------------------------------------------------------------------
const badAccount: JournalEntriesInput = {
  chart: ["1000-cash", "4000-revenue"],
  entries: [
    {
      lines: [
        { accountId: "1000-cash", debit: 50, credit: 0 },
        { accountId: "9999-ghost", debit: 0, credit: 50 }, // balances, but 9999-ghost is not in the chart
      ],
    },
  ],
};
const badAccountResult = verifyJournalEntries(badAccount);
assert.equal(badAccountResult.passed, false, "BAD (unknown account) -> passed === false");
const acctFail = badAccountResult.checks.filter((c) => !c.passed);
assert.equal(acctFail.length, 1, "exactly one check failed (the unknown account)");
assert.equal(acctFail[0].name, "accounts_exist[entry 0][line 1]", "named failing check is accounts_exist[entry 0][line 1]");
console.log(`  ok:   BAD (unknown account) rejected (failing check: ${acctFail[0].name})`);

// -----------------------------------------------------------------------------
// Third BAD fixture: a negative amount — proves the no_negative invariant fires.
// -----------------------------------------------------------------------------
const badNegative: JournalEntriesInput = {
  chart: ["1000-cash", "4000-revenue"],
  entries: [
    {
      lines: [
        { accountId: "1000-cash", debit: -10, credit: 0 }, // negative debit
        { accountId: "4000-revenue", debit: 0, credit: -10 }, // negative credit — still "balances" (both -10) but is illegal
      ],
    },
  ],
};
const badNegativeResult = verifyJournalEntries(badNegative);
assert.equal(badNegativeResult.passed, false, "BAD (negative amounts) -> passed === false");
const negNames = badNegativeResult.checks.filter((c) => !c.passed).map((c) => c.name);
assert.ok(negNames.includes("no_negative[entry 0][line 0]"), "no_negative[entry 0][line 0] failed");
assert.ok(negNames.includes("no_negative[entry 0][line 1]"), "no_negative[entry 0][line 1] failed");
console.log(`  ok:   BAD (negative amounts) rejected (failing checks: ${negNames.join(", ")})`);

// -----------------------------------------------------------------------------
// Determinism: same input -> byte-identical result (no clock/random/IO).
// -----------------------------------------------------------------------------
const d1 = verifyJournalEntries(good);
const d2 = verifyJournalEntries(good);
assert.equal(JSON.stringify(d1), JSON.stringify(d2), "deterministic: identical output for identical input");
console.log("  ok:   deterministic (identical output for identical input)");

console.log("\nRESULT: PASS (accepts GOOD, rejects BAD across 3 invariants, deterministic)");
