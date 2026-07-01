// Anti-rubber-stamp test for the deterministic AR/AP aging oracle.
// Run: npx tsx test/accounting_arApAging.test.ts   (from packages/nodeeval)
//
// Hard bar (anti-cheat doctrine): the verifier MUST accept a GOOD schedule
// (passed=true) AND reject a BAD schedule (passed=false), naming the specific
// broken invariant. A verifier that always passes is a bug — assert BOTH
// directions, plus determinism (same input => byte-identical result).
import assert from "node:assert/strict";
import { verifyAging, dayNumber, type AgingInput } from "../src/accounting/arApAging";

// -----------------------------------------------------------------------------
// Fixture: asOf 2026-07-01. Four invoices, one per bucket, hand-computed ages.
//   daysOverdue = dayNumber(asOf) - dayNumber(dueDate)
//   2026-06-20 -> 11 days  -> 0-30
//   2026-05-20 -> 42 days  -> 31-60
//   2026-04-10 -> 82 days  -> 61-90
//   2026-01-01 -> 181 days -> 90+
// Amounts: 100, 200, 300, 400  => total 1000.
// Reserve rates ascend with age: 0.00, 0.25, 0.50, 1.00 (monotonic).
// -----------------------------------------------------------------------------
const ASOF = "2026-07-01";

// Sanity-check the pure day math the fixture relies on (documents the boundaries).
assert.equal(dayNumber(ASOF) - dayNumber("2026-06-20"), 11, "0-30 age");
assert.equal(dayNumber(ASOF) - dayNumber("2026-05-20"), 42, "31-60 age");
assert.equal(dayNumber(ASOF) - dayNumber("2026-04-10"), 82, "61-90 age");
assert.equal(dayNumber(ASOF) - dayNumber("2026-01-01"), 181, "90+ age");

function baseBuckets() {
  return [
    { label: "0-30", minDays: 0, maxDays: 30, reserveRate: 0.0, amount: 100 },
    { label: "31-60", minDays: 31, maxDays: 60, reserveRate: 0.25, amount: 200 },
    { label: "61-90", minDays: 61, maxDays: 90, reserveRate: 0.5, amount: 300 },
    { label: "90+", minDays: 91, maxDays: null, reserveRate: 1.0, amount: 400 },
  ];
}

function baseInvoices() {
  return [
    { amount: 100, dueDate: "2026-06-20" },
    { amount: 200, dueDate: "2026-05-20" },
    { amount: 300, dueDate: "2026-04-10" },
    { amount: 400, dueDate: "2026-01-01" },
  ];
}

// === GOOD: every invariant holds -> passed === true, all checks pass ===
const good: AgingInput = { asOf: ASOF, invoices: baseInvoices(), buckets: baseBuckets() };
const goodResult = verifyAging(good);
console.log("GOOD result:", JSON.stringify(goodResult, null, 2));
assert.equal(goodResult.verifier, "arApAging", "verifier name is arApAging");
assert.equal(goodResult.passed, true, "GOOD schedule -> passed === true");
assert.equal(goodResult.score, 1, "GOOD schedule -> score === 1 (all checks pass)");
for (const c of goodResult.checks) {
  assert.equal(c.passed, true, `GOOD: check "${c.name}" should pass`);
}

// === BAD #1: bucket_sums_total broken (one bucket amount is wrong) ===
// Break ONLY the sums invariant: claim bucket "31-60" holds 999 instead of 200.
// Partition and monotonicity stay intact, so exactly one named check fails.
const badBuckets = baseBuckets();
badBuckets[1].amount = 999; // recomputed says 200 -> mismatch of 799
const badSums: AgingInput = { asOf: ASOF, invoices: baseInvoices(), buckets: badBuckets };
const badSumsResult = verifyAging(badSums);
console.log("BAD(sums) result:", JSON.stringify(badSumsResult, null, 2));
assert.equal(badSumsResult.passed, false, "BAD sums -> passed === false (rejects wrong input)");
const sumsCheck = badSumsResult.checks.find((c) => c.name === "bucket_sums_total");
assert.ok(sumsCheck, "the failing check named bucket_sums_total exists");
assert.equal(sumsCheck.passed, false, "bucket_sums_total is the failing check");
// The OTHER invariants must still hold — proves the failure is specific, not blanket.
assert.equal(
  badSumsResult.checks.find((c) => c.name === "bucket_partition").passed,
  true,
  "BAD sums: partition still passes (failure is isolated to sums)",
);
assert.equal(
  badSumsResult.checks.find((c) => c.name === "reserve_monotonic").passed,
  true,
  "BAD sums: monotonicity still passes (failure is isolated to sums)",
);

// === BAD #2: reserve_monotonic broken (older bucket reserves LESS) ===
// 90+ reserveRate drops to 0.10 (< 61-90's 0.50): older money reserved cheaper.
const badMonoBuckets = baseBuckets();
badMonoBuckets[3].reserveRate = 0.1;
const badMono: AgingInput = { asOf: ASOF, invoices: baseInvoices(), buckets: badMonoBuckets };
const badMonoResult = verifyAging(badMono);
console.log("BAD(mono) result:", JSON.stringify(badMonoResult, null, 2));
assert.equal(badMonoResult.passed, false, "BAD monotonicity -> passed === false");
const monoCheck = badMonoResult.checks.find((c) => c.name === "reserve_monotonic");
assert.ok(monoCheck, "the failing check named reserve_monotonic exists");
assert.equal(monoCheck.passed, false, "reserve_monotonic is the failing check");

// === BAD #3: bucket_partition broken (an invoice matches ZERO buckets) ===
// Make a gap: 0-30 shrinks to 0-10, so the 11-day invoice falls in no bucket.
const badPartBuckets = baseBuckets();
badPartBuckets[0].maxDays = 10; // 11-day invoice now unbucketed
const badPart: AgingInput = { asOf: ASOF, invoices: baseInvoices(), buckets: badPartBuckets };
const badPartResult = verifyAging(badPart);
console.log("BAD(partition) result:", JSON.stringify(badPartResult, null, 2));
assert.equal(badPartResult.passed, false, "BAD partition -> passed === false");
const partCheck = badPartResult.checks.find((c) => c.name === "bucket_partition");
assert.ok(partCheck, "the failing check named bucket_partition exists");
assert.equal(partCheck.passed, false, "bucket_partition is the failing check");

// === Determinism: same input => byte-identical result (no clock/random) ===
const d1 = verifyAging({ asOf: ASOF, invoices: baseInvoices(), buckets: baseBuckets() });
const d2 = verifyAging({ asOf: ASOF, invoices: baseInvoices(), buckets: baseBuckets() });
assert.equal(
  JSON.stringify(d1),
  JSON.stringify(d2),
  "deterministic: identical output for identical input",
);

console.log("\nRESULT: PASS (accepts GOOD, rejects BAD on each invariant, deterministic)");
