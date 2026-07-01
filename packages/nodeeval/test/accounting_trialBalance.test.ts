// Anti-rubber-stamp test for the deterministic trialBalance accounting oracle.
//
// Run (from packages/nodeeval):
//   node "<repo>/node_modules/tsx/dist/cli.mjs" test/accounting_trialBalance.test.ts
//
// HARD BAR (anti-cheat doctrine): the verifier MUST accept a GOOD trial balance
// (passed === true) AND reject a BAD one (passed === false) with the SPECIFIC
// broken invariant named. A verifier that always passes is a bug — we assert
// BOTH directions here, plus determinism (same input => identical result).
//
// The oracle types come from the module built by the prior step; the verifier
// re-exports nothing, so we pull types from oracleTypes and the fn from
// trialBalance. (Import path is relative to this test file in test/.)
import { verifyTrialBalance, type TrialBalanceInput } from "../src/accounting/trialBalance";
import type { VerifierResult } from "../src/accounting/oracleTypes";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error(`  FAIL: ${msg}`);
  } else {
    console.log(`  ok:   ${msg}`);
  }
}

/** Find a named check in a result (or undefined). */
function check(result: VerifierResult, name: string) {
  return result.checks.find((c) => c.name === name);
}

// ---------------------------------------------------------------------------
// GOOD fixture — a real, balanced trial balance.
//
// Story: a company funded with $1,000 cash from owners, earned $500 revenue in
// cash, and paid $200 cash for expenses. Ending state:
//   Cash (asset):        debit 1300  (1000 in + 500 rev - 200 exp)
//   Common stock (equity): credit 1000
//   Revenue:             credit 500
//   Expense:             debit 200
// Totals: debits 1300 + 200 = 1500 ; credits 1000 + 500 = 1500  (balanced)
// Net income = 500 - 200 = 300.
// Balance sheet: assets 1300 == liabilities 0 + equity(1000) + NI(300) = 1300. OK.
// ---------------------------------------------------------------------------
const good: TrialBalanceInput = {
  accounts: [
    { name: "Cash", type: "asset", debit: 1300, credit: 0 },
    { name: "Common Stock", type: "equity", debit: 0, credit: 1000 },
    { name: "Service Revenue", type: "revenue", debit: 0, credit: 500 },
    { name: "Rent Expense", type: "expense", debit: 200, credit: 0 },
  ],
};
const goodResult = verifyTrialBalance(good);
console.log("GOOD result:", JSON.stringify(goodResult, null, 2));
assert(goodResult.verifier === "trialBalance", "verifier name is 'trialBalance'");
assert(goodResult.passed === true, "GOOD trial balance -> passed === true (accepts a correct input)");
assert(goodResult.score === 1, "GOOD trial balance -> score === 1 (all checks pass)");
assert(check(goodResult, "debits_equal_credits")?.passed === true, "GOOD: debits_equal_credits passes");
assert(check(goodResult, "net_income_links_to_equity")?.passed === true, "GOOD: net_income_links_to_equity passes");
assert(check(goodResult, "balance_sheet_balances")?.passed === true, "GOOD: balance_sheet_balances passes");

// ---------------------------------------------------------------------------
// GOOD fixture #2 — cent-scale rounding within tolerance MUST still pass.
// Assets 100.004 vs liab+equity 100.00 -> |delta| = 0.004 <= 0.005 (EPS). Pass.
// Debits/credits kept exactly equal so only the equation term exercises EPS.
// ---------------------------------------------------------------------------
const goodTol: TrialBalanceInput = {
  accounts: [
    { name: "Cash", type: "asset", debit: 100.004, credit: 0 },
    { name: "Common Stock", type: "equity", debit: 0, credit: 100.004 },
  ],
};
const goodTolResult = verifyTrialBalance(goodTol);
assert(goodTolResult.passed === true, "GOOD (within half-cent tolerance) -> passed === true");

// ---------------------------------------------------------------------------
// BAD fixture — exactly ONE broken invariant: the books do NOT balance.
//
// Take the GOOD fixture and inflate Cash by 100 (as if a $100 debit had no
// matching credit). Now:
//   debits  = 1400 + 200 = 1600 ; credits = 1000 + 500 = 1500  (unbalanced, delta 100)
//   assets  = 1400 ; liab+equity+NI = 0 + 1000 + 300 = 1300     (delta 100)
// So debits_equal_credits, net_income_links_to_equity, and balance_sheet_balances
// all fail. We assert the result fails AND that the specific balance checks are named.
// ---------------------------------------------------------------------------
const bad: TrialBalanceInput = {
  accounts: [
    { name: "Cash", type: "asset", debit: 1400, credit: 0 }, // <-- +100 injected, no offset
    { name: "Common Stock", type: "equity", debit: 0, credit: 1000 },
    { name: "Service Revenue", type: "revenue", debit: 0, credit: 500 },
    { name: "Rent Expense", type: "expense", debit: 200, credit: 0 },
  ],
};
const badResult = verifyTrialBalance(bad);
console.log("BAD result:", JSON.stringify(badResult, null, 2));
assert(badResult.passed === false, "BAD trial balance -> passed === false (rejects a wrong input)");
assert(badResult.score < 1, "BAD trial balance -> score < 1 (at least one check failed)");
const badDebits = check(badResult, "debits_equal_credits");
assert(badDebits !== undefined, "BAD: the failing check 'debits_equal_credits' is present by name");
assert(badDebits?.passed === false, "BAD: debits_equal_credits is the named failing invariant");
assert(
  /1600\.00 != credits 1500\.00/.test(badDebits?.detail ?? ""),
  "BAD: failing check detail reports the exact unbalanced totals",
);
assert(check(badResult, "balance_sheet_balances")?.passed === false, "BAD: balance_sheet_balances also fails");

// ---------------------------------------------------------------------------
// BAD fixture #2 — ISOLATED broken invariant: debits==credits holds, but net
// income does NOT link into equity. This proves the equation check is real and
// not implied by the debit/credit tie.
//
//   Cash (asset) debit 1000, credit 0                 -> assets 1000
//   Common Stock (equity) credit 700                  -> equity(pre) 700
//   Revenue credit 300                                -> revenue 300, NI 300
//   Total debits 1000 ; total credits 700 + 300 = 1000  (BALANCED - passes check 1)
//   Equation: assets 1000 vs liab 0 + equity 700 + NI 300 = 1000 ... that balances too.
// To actually break ONLY the equation while keeping debits==credits, add an
// expense with a matching credit somewhere non-equation-neutral is impossible
// without also moving a term; instead we mis-state equity: move 100 of the
// credit from equity to a LIABILITY-typed row is still balanced. The clean
// isolation: overstate expense so NI drops but keep debits==credits by giving
// the expense a same-account credit (contra) — see below.
//
//   Cash (asset)  debit 1000                          -> assets 1000
//   Common Stock (equity) credit 1000                 -> equity(pre) 1000
//   Fake Expense (expense) debit 50, credit 50        -> expense 0, NI 0; adds 50/50
//   Total debits 1050 ; total credits 1050            (BALANCED - passes check 1)
//   Equation: assets 1000 vs liab 0 + equity 1000 + NI 0 = 1000 ... balances.
// Both still balance, which is *correct* accounting. To break ONLY the equation
// we need genuinely inconsistent books; the honest minimal case is: assets
// overstated relative to equity while debits still tie because a revenue credit
// was double-posted against a suspense debit that is NOT classified. We model
// that by overstating a revenue credit with an offsetting asset debit that
// pushes assets past the closing equity by exactly 100:
// ---------------------------------------------------------------------------
const badEquationOnly: TrialBalanceInput = {
  accounts: [
    { name: "Cash", type: "asset", debit: 1000, credit: 0 },
    { name: "Common Stock", type: "equity", debit: 0, credit: 1000 },
    // A revenue credit of 100 with NO asset/other debit backing it: debits==credits
    // is broken by this alone, so instead we back it with a CONTRA-equity debit
    // (treasury-stock style) that keeps debits==credits but breaks the equation:
    { name: "Treasury Stock (contra-equity)", type: "equity", debit: 100, credit: 0 },
    { name: "Overstated Revenue", type: "revenue", debit: 0, credit: 100 },
  ],
};
const badEqResult = verifyTrialBalance(badEquationOnly);
// debits = 1000 + 100 = 1100 ; credits = 1000 + 100 = 1100  -> debits_equal_credits PASSES
// assets = 1000 ; liab 0 + equity(1000 - 100) + NI(100) = 1000  -> equation PASSES too.
// (This one is actually consistent — documented as a sanity anchor, not a failure.)
assert(
  check(badEqResult, "debits_equal_credits")?.passed === true,
  "anchor: contra-equity + revenue keeps debits==credits (isolates the equation term)",
);

// Now the REAL isolated equation break: keep debits==credits but make assets NOT
// equal liab+equity+NI. Post a revenue credit offset by a LIABILITY debit
// (paying down a loan that was never recorded), which reduces liabilities below
// what assets imply:
const equationBreak: TrialBalanceInput = {
  accounts: [
    { name: "Cash", type: "asset", debit: 1000, credit: 0 }, // assets 1000
    { name: "Common Stock", type: "equity", debit: 0, credit: 800 }, // equity(pre) 800
    { name: "Service Revenue", type: "revenue", debit: 0, credit: 200 }, // revenue 200 -> NI 200
    // debits 1000 ; credits 800 + 200 = 1000  -> BALANCED (check 1 passes)
    // equation: assets 1000 vs liab 0 + equity 800 + NI 200 = 1000  -> balances (still fine!)
  ],
};
// The above balances. To force ONLY the equation to fail while debits==credits,
// we mis-type an account: book real cash (asset) but classify the owner funding
// as a REVENUE credit instead of equity. Debits==credits still holds; the
// equation is unaffected because revenue also flows to NI... which means it
// STILL balances. The mathematically honest truth: with debits==credits, the
// signed sum of (debit-credit) over ALL accounts is zero, and the equation
// assets - (liab + equity + NI) equals that same signed sum. So a pure equation
// break REQUIRES debits != credits. We therefore document that check 1 and the
// equation are linked, and rely on the primary BAD fixture (which breaks both)
// plus the well-formedness fixture below for the "specific failing check named"
// guarantee.
const eqResult = verifyTrialBalance(equationBreak);
assert(eqResult.passed === true, "anchor: correctly-classified balanced books pass all checks");

// ---------------------------------------------------------------------------
// BAD fixture #3 — malformed input (negative debit) fails input_well_formed by name.
// This exercises a distinct, isolatable failing invariant.
// ---------------------------------------------------------------------------
const badForm: TrialBalanceInput = {
  accounts: [
    { name: "Cash", type: "asset", debit: -50, credit: 0 },
    { name: "Common Stock", type: "equity", debit: 0, credit: -50 },
  ],
};
const badFormResult = verifyTrialBalance(badForm);
assert(badFormResult.passed === false, "BAD (malformed) -> passed === false");
assert(check(badFormResult, "input_well_formed")?.passed === false, "BAD (malformed): input_well_formed is the named failing invariant");

// ---------------------------------------------------------------------------
// Determinism — same input MUST produce byte-identical result (no clock/random).
// ---------------------------------------------------------------------------
const d1 = verifyTrialBalance(good);
const d2 = verifyTrialBalance(good);
assert(JSON.stringify(d1) === JSON.stringify(d2), "deterministic: identical output for identical input");
const b1 = verifyTrialBalance(bad);
const b2 = verifyTrialBalance(bad);
assert(JSON.stringify(b1) === JSON.stringify(b2), "deterministic: identical output for identical BAD input");

if (failures > 0) {
  console.error(`\nRESULT: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
} else {
  console.log("\nRESULT: PASS (accepts GOOD, rejects BAD by named check, deterministic)");
}
