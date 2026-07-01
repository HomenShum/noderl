// Anti-rubber-stamp test for the deterministic indirect-method cash-flow oracle.
// Run (from packages/nodeeval): npx tsx test/accounting_cashFlowIndirect.test.ts
//
// Hard bar (anti-cheat doctrine): the verifier MUST accept a GOOD statement
// (passed=true) AND reject a BAD statement (passed=false) — and when it rejects,
// the SPECIFIC failing check must be named. A verifier that always passes is a bug.
// We assert BOTH directions, plus determinism (same input => identical result).
//
// NOTE ON IMPORT PATH: the oracle sources live under src/accounting/. From this
// root-level test/ directory the correct relative path is ../src/accounting/*.
// (../accounting/* would point at a non-existent pkg-root accounting/ dir.)
import assert from "node:assert";
import {
  verifyCashFlowIndirect,
  type CashFlowIndirectInput,
} from "../src/accounting/cashFlowIndirect";
import type { VerifierResult } from "../src/accounting/oracleTypes";

/** Find a named check in a result, or throw with a helpful message. */
function check(result: VerifierResult, name: string) {
  const c = result.checks.find((x) => x.name === name);
  assert.ok(c, `expected a check named "${name}"; got [${result.checks.map((x) => x.name).join(", ")}]`);
  return c;
}

// ---------------------------------------------------------------------------
// GOOD fixture: a well-formed indirect-method cash-flow statement.
//   operating starts from net income (120.00) then adds back depreciation and a
//   working-capital change => operating total 150.00.
//   investing = -60.00, financing = 30.00 => net change 120.00.
//   beginningCash 200.00 -> endingCash 320.00 => cash delta 120.00. Ties out.
// ---------------------------------------------------------------------------
const good: CashFlowIndirectInput = {
  netIncome: 120.0,
  sections: {
    operating: [
      { label: "Net income", amount: 120.0 },
      { label: "Depreciation add-back", amount: 40.0 },
      { label: "Increase in accounts receivable", amount: -10.0 },
    ],
    investing: [{ label: "Purchase of equipment", amount: -60.0 }],
    financing: [{ label: "Proceeds from note payable", amount: 30.0 }],
  },
  beginningCash: 200.0,
  endingCash: 320.0,
};

const goodResult = verifyCashFlowIndirect(good);
assert.strictEqual(goodResult.verifier, "cashFlowIndirect", "verifier name is cashFlowIndirect");
assert.strictEqual(goodResult.passed, true, "GOOD statement -> passed === true (accepts a correct input)");
assert.strictEqual(goodResult.score, 1, "GOOD statement -> score === 1 (all checks pass)");
assert.strictEqual(check(goodResult, "operating_starts_from_net_income").passed, true, "GOOD: operating anchored on net income");
assert.strictEqual(check(goodResult, "net_change_ties_to_cash_balances").passed, true, "GOOD: net change ties to cash balances");
console.log("  ok:   GOOD fixture accepted (passed=true, score=1)");

// GOOD-with-float-noise: sub-cent rounding must still pass via the documented tolerance.
const goodNoisy: CashFlowIndirectInput = {
  ...good,
  sections: {
    ...good.sections,
    // 40.00 - 10.00 + 120.00 = 150.00; nudge by +0.004 (under half a cent) -> still ties out.
    operating: [
      { label: "Net income", amount: 120.0 },
      { label: "Depreciation add-back", amount: 40.004 },
      { label: "Increase in accounts receivable", amount: -10.0 },
    ],
  },
};
const goodNoisyResult = verifyCashFlowIndirect(goodNoisy);
assert.strictEqual(goodNoisyResult.passed, true, "GOOD (sub-cent noise) -> passed === true within tolerance");
console.log("  ok:   GOOD fixture with sub-cent float noise accepted (tolerance honored)");

// ---------------------------------------------------------------------------
// BAD fixture #1: net change does NOT tie to the cash balances.
//   Same sections (net change 120.00) but endingCash forced to 999.00 so the
//   balance delta (799.00) disagrees. The tie-out check must FAIL, by name.
// ---------------------------------------------------------------------------
const badTieOut: CashFlowIndirectInput = {
  ...good,
  endingCash: 999.0, // beginningCash 200.00 -> delta 799.00 != net change 120.00
};
const badTieOutResult = verifyCashFlowIndirect(badTieOut);
assert.strictEqual(badTieOutResult.passed, false, "BAD (broken tie-out) -> passed === false (rejects a wrong input)");
assert.strictEqual(check(badTieOutResult, "net_change_ties_to_cash_balances").passed, false, "BAD: the tie-out check is the one that FAILS (named)");
assert.strictEqual(check(badTieOutResult, "operating_starts_from_net_income").passed, true, "BAD: unrelated check (net-income anchor) still passes");
assert.ok(badTieOutResult.score < 1, "BAD -> score < 1");
console.log("  ok:   BAD fixture (broken cash tie-out) rejected; failing check named");

// ---------------------------------------------------------------------------
// BAD fixture #2: operating section does NOT start from net income.
//   First operating line is depreciation, not net income. The anchor check fails.
// ---------------------------------------------------------------------------
const badAnchor: CashFlowIndirectInput = {
  netIncome: 120.0,
  sections: {
    operating: [
      { label: "Depreciation add-back", amount: 40.0 }, // WRONG first line
      { label: "Net income", amount: 120.0 },
      { label: "Increase in accounts receivable", amount: -10.0 },
    ],
    investing: [{ label: "Purchase of equipment", amount: -60.0 }],
    financing: [{ label: "Proceeds from note payable", amount: 30.0 }],
  },
  beginningCash: 200.0,
  endingCash: 320.0, // still ties out (150 - 60 + 30 = 120)
};
const badAnchorResult = verifyCashFlowIndirect(badAnchor);
assert.strictEqual(badAnchorResult.passed, false, "BAD (wrong anchor) -> passed === false");
assert.strictEqual(check(badAnchorResult, "operating_starts_from_net_income").passed, false, "BAD: the net-income-anchor check is the one that FAILS (named)");
assert.strictEqual(check(badAnchorResult, "net_change_ties_to_cash_balances").passed, true, "BAD: tie-out still passes (isolates the failing invariant)");
console.log("  ok:   BAD fixture (operating not anchored on net income) rejected; failing check named");

// ---------------------------------------------------------------------------
// Determinism: same input => byte-identical result (no clock, no randomness).
// ---------------------------------------------------------------------------
const d1 = verifyCashFlowIndirect(good);
const d2 = verifyCashFlowIndirect(good);
assert.strictEqual(JSON.stringify(d1), JSON.stringify(d2), "deterministic: identical output for identical input");
console.log("  ok:   deterministic (identical output for identical input)");

console.log("\nRESULT: PASS (accepts GOOD, rejects BAD by named check, deterministic)");
