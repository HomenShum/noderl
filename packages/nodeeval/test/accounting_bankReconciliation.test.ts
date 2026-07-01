// Anti-rubber-stamp test for the deterministic bank-reconciliation oracle.
//
// Run: tsx test/accounting_bankReconciliation.test.ts  (from packages/nodeeval)
//
// HARD BAR (anti-cheat doctrine): the oracle MUST accept a GOOD reconciliation
// (passed === true) AND reject a BAD one (passed === false), and when it rejects
// it must name the SPECIFIC failing check. A verifier that always passes is a bug,
// so we assert BOTH directions. We also assert determinism: the same input must
// yield an identical result (no clock / randomness).
//
// Scenario framing: a solo-founder controller closing the month. The GOOD fixture
// is a clean reconciliation (bank statement ties to adjusted book cash; every
// adjusting journal entry balances). Each BAD fixture breaks exactly one invariant
// so we can prove the oracle fails for the right reason.
import assert from "node:assert/strict";
import {
  verifyBankReconciliation,
  type BankReconciliationInput,
} from "../src/accounting/bankReconciliation.ts";

let passed = 0;
function it(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok:   ${name}`);
}

const namesOf = (r: ReturnType<typeof verifyBankReconciliation>) =>
  r.checks.map((c) => c.name);
const failing = (r: ReturnType<typeof verifyBankReconciliation>) =>
  r.checks.filter((c) => !c.passed).map((c) => c.name);

// -------------------------------------------------------------------------
// GOOD fixture — a clean month-end reconciliation.
//   Bank ending balance: 10,000.00
//   Ledger (book) ending balance: 9,850.00
//   Unmatched reconciling items net +150.00 (e.g. deposit in transit +200,
//     outstanding check -50) -> adjusted book cash 9,850 + 150 = 10,000.00.
//   Two matched items. Two adjusting JEs, each balanced (debits == credits).
// -------------------------------------------------------------------------
const good: BankReconciliationInput = {
  bankEndingBalance: 10000.0,
  ledgerEndingBalance: 9850.0,
  matched: [{ amount: 5000.0 }, { amount: 4850.0 }],
  unmatched: [
    { amount: 200.0 }, // deposit in transit
    { amount: -50.0 }, // outstanding check
  ],
  journalEntries: [
    // Record bank service charge: Dr Expense 25 / Cr Cash 25
    { lines: [{ debit: 25.0 }, { credit: 25.0 }] },
    // Record interest earned split across two credit lines: Dr Cash 30 / Cr x2 15+15
    { lines: [{ debit: 30.0 }, { credit: 15.0 }, { credit: 15.0 }] },
  ],
};

it("GOOD reconciliation -> passed === true, score === 1", () => {
  const r = verifyBankReconciliation(good);
  assert.equal(r.verifier, "bankReconciliation");
  assert.equal(r.passed, true, "clean reconciliation must pass");
  assert.equal(r.score, 1, "every check passes -> score 1");
  // Structural: tie + partition + one check per JE.
  assert.deepEqual(namesOf(r), [
    "ending_cash_tie",
    "partition_covers_all_items",
    "je_0_balanced",
    "je_1_balanced",
  ]);
  assert.deepEqual(failing(r), []);
});

// -------------------------------------------------------------------------
// BAD fixture #1 — the ending cash does NOT tie (off by 1.00, well past the
// half-cent tolerance). One broken invariant: ending_cash_tie.
// -------------------------------------------------------------------------
const badTie: BankReconciliationInput = {
  ...good,
  // Adjusted book cash = 9850 + 150 = 10000, but bank says 10001 -> delta 1.00.
  bankEndingBalance: 10001.0,
};

it("BAD (ending cash off by 1.00) -> passed === false, names ending_cash_tie", () => {
  const r = verifyBankReconciliation(badTie);
  assert.equal(r.passed, false, "an untied reconciliation must fail");
  assert.deepEqual(failing(r), ["ending_cash_tie"], "only the tie check fails");
  const tie = r.checks.find((c) => c.name === "ending_cash_tie")!;
  assert.equal(tie.passed, false);
  assert.match(tie.detail, /!=/, "detail explains the mismatch");
});

// -------------------------------------------------------------------------
// BAD fixture #2 — an unbalanced journal entry (debits 25 != credits 24).
// One broken invariant: je_1_balanced (the second JE), which must be named.
// -------------------------------------------------------------------------
const badJE: BankReconciliationInput = {
  ...good,
  journalEntries: [
    { lines: [{ debit: 25.0 }, { credit: 25.0 }] }, // balanced
    { lines: [{ debit: 30.0 }, { credit: 15.0 }, { credit: 14.0 }] }, // 30 != 29
  ],
};

it("BAD (unbalanced JE) -> passed === false, names the specific je_1_balanced", () => {
  const r = verifyBankReconciliation(badJE);
  assert.equal(r.passed, false, "an unbalanced JE must fail the oracle");
  assert.deepEqual(failing(r), ["je_1_balanced"], "the SECOND JE is the one flagged");
  const je = r.checks.find((c) => c.name === "je_1_balanced")!;
  assert.match(je.detail, /debits 30\.00 != credits 29\.00/);
  // The tie and the first (balanced) JE must still pass — no collateral failure.
  assert.equal(r.checks.find((c) => c.name === "ending_cash_tie")!.passed, true);
  assert.equal(r.checks.find((c) => c.name === "je_0_balanced")!.passed, true);
});

// -------------------------------------------------------------------------
// Tolerance boundary — a half-cent delta ties (<= 0.005), a full cent does not.
// Proves the documented tolerance is neither too loose nor too strict.
// -------------------------------------------------------------------------
it("tolerance: half-cent delta still ties; full-cent delta fails", () => {
  const withinTol: BankReconciliationInput = {
    ...good,
    bankEndingBalance: 10000.004, // delta 0.004 <= 0.005 -> tie holds
  };
  assert.equal(
    verifyBankReconciliation(withinTol).checks.find((c) => c.name === "ending_cash_tie")!.passed,
    true,
    "0.004 delta is within the half-cent tolerance",
  );

  const outsideTol: BankReconciliationInput = {
    ...good,
    bankEndingBalance: 10000.01, // delta 0.01 > 0.005 -> tie breaks
  };
  assert.equal(
    verifyBankReconciliation(outsideTol).checks.find((c) => c.name === "ending_cash_tie")!.passed,
    false,
    "0.01 delta exceeds the half-cent tolerance",
  );
});

// -------------------------------------------------------------------------
// Determinism — same input -> byte-identical result (no Date/Math.random).
// Runs the GOOD and a BAD fixture twice each and compares JSON.
// -------------------------------------------------------------------------
it("deterministic: identical input -> identical result (good & bad)", () => {
  const g1 = JSON.stringify(verifyBankReconciliation(good));
  const g2 = JSON.stringify(verifyBankReconciliation(good));
  assert.equal(g1, g2, "GOOD is deterministic");
  const b1 = JSON.stringify(verifyBankReconciliation(badJE));
  const b2 = JSON.stringify(verifyBankReconciliation(badJE));
  assert.equal(b1, b2, "BAD is deterministic");
});

console.log(`\nRESULT: PASS (${passed} scenarios — accepts GOOD, rejects BAD by named check, deterministic)`);
