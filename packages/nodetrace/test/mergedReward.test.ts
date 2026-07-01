/**
 * Scenario-based tests for NodeEval v1 — the HONEST reward builder over a merged trajectory.
 *
 * Persona: "Dana", the staff accountant from the merged fixture. Her March reconciliation produced an
 * HONEST-but-imperfect trace: 2 of 3 UI assertions pass (the ending-cash tie FAILS), and 2 of 3 evidence
 * facts are source_backed (the uncleared check #1042 is needs_review). NodeEval must read those signals
 * off the trace and turn them into a reward WITHOUT papering over the failures or inventing a score for
 * anything the trace does not support.
 *
 * We build the same merged trajectory Dana's tooling ships, then run computeMergedReward over it and check:
 *  (a) DERIVE-TASK      — taskCompletion reflects 2/3 passed UI assertions (and uiStateCorrectness matches).
 *  (b) DERIVE-EVIDENCE  — evidenceGrounding = 2/3 (source_backed / total).
 *  (c) HONEST_STATUS    — the failed assertion + needs_review evidence appear in failureCategories.
 *  (d) HONEST_SCORES    — unsupplied visualQuality is 0 AND labeled "unscored:visualQuality" (no floor);
 *                         cost/latency without a documented budget are likewise unscored.
 *  (e) SUPPLIED-WINS    — a supplied component (VLM visualQuality) is carried verbatim, no unscored label.
 *  (f) BUDGET-DERIVE    — with a documented budget, cost/latency efficiency derive from step sums (no label).
 *  (g) DETERMINISM      — same trajectory => byte-identical reward (no Date.now/Math.random).
 *
 * Run: npx tsx packages/nodetrace/test/mergedReward.test.ts
 * (No test framework — plain node:assert so it runs anywhere tsx/node can.)
 */
import assert from "node:assert/strict";
import { mergeTrajectory, type NodeMergedTrajectory } from "../src/merged";
import { computeMergedReward } from "../src/mergedReward";
import {
  accountingInner,
  accountingOuter,
  accountingArtifacts,
  accountingEvidence,
  accountingMeta,
} from "./merged.fixture";

let passed = 0;
let failed = 0;
function scenario(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error("        " + (err instanceof Error ? err.stack ?? err.message : String(err)));
  }
}

/** Merge the canonical accounting fixture (no reward — NodeEval derives it from the trace). */
function mergeFixture(): NodeMergedTrajectory {
  return mergeTrajectory(
    accountingInner,
    accountingOuter,
    accountingArtifacts,
    accountingEvidence,
    accountingMeta,
  );
}

const APPROX = 1e-12;

/* -------------------------------------------------------------------------- */

scenario("(a) DERIVE-TASK — taskCompletion reflects 2/3 passed UI assertions", () => {
  const merged = mergeFixture();
  const r = computeMergedReward(merged);
  // Fixture has 3 assertions, 2 passed (recon-tab, exceptions) + 1 failed (ending-cash ties).
  assert.equal(merged.outerTrace.uiAssertions.length, 3, "fixture has 3 UI assertions");
  assert.equal(
    merged.outerTrace.uiAssertions.filter((a) => a.passed).length,
    2,
    "fixture has exactly 2 passing assertions",
  );
  assert.ok(Math.abs(r.taskCompletion - 2 / 3) < APPROX, "taskCompletion must be 2/3");
  // uiStateCorrectness rides the same honest signal.
  assert.ok(Math.abs(r.uiStateCorrectness - 2 / 3) < APPROX, "uiStateCorrectness must also be 2/3");
  // Neither derived-from-trace component is labeled unscored.
  assert.ok(!r.labels.includes("unscored:taskCompletion"), "taskCompletion is derived, not unscored");
  assert.ok(!r.labels.includes("unscored:uiStateCorrectness"), "uiStateCorrectness is derived, not unscored");
});

scenario("(b) DERIVE-EVIDENCE — evidenceGrounding = 2/3 (source_backed / total)", () => {
  const merged = mergeFixture();
  const r = computeMergedReward(merged);
  // 3 evidence facts, 2 source_backed + 1 needs_review.
  assert.equal(merged.evidence.length, 3, "fixture has 3 evidence facts");
  assert.equal(
    merged.evidence.filter((e) => e.status === "source_backed").length,
    2,
    "fixture has exactly 2 source_backed facts",
  );
  assert.ok(Math.abs(r.evidenceGrounding - 2 / 3) < APPROX, "evidenceGrounding must be 2/3");
  assert.ok(!r.labels.includes("unscored:evidenceGrounding"), "evidenceGrounding is derived, not unscored");
});

scenario("(c) HONEST_STATUS — failed assertion + needs_review evidence appear in failureCategories", () => {
  const merged = mergeFixture();
  const r = computeMergedReward(merged);
  assert.ok(
    r.failureCategories.includes("ui_assertion_failed"),
    "a failed UI assertion must appear in failureCategories",
  );
  assert.ok(
    r.failureCategories.includes("evidence_needs_review"),
    "needs_review evidence must appear in failureCategories",
  );
  // No fake unsafe categories: the fixture has no console errors, step errors, or reopen failures.
  assert.ok(!r.failureCategories.includes("console_error"), "no console error in fixture");
  assert.ok(!r.failureCategories.includes("step_error"), "no step error in fixture");
  assert.ok(!r.failureCategories.includes("artifact_reopen_failed"), "artifact reopen passed in fixture");
});

scenario("(d) HONEST_SCORES — unsupplied visualQuality is 0 + 'unscored:visualQuality' (no floor)", () => {
  const merged = mergeFixture();
  const r = computeMergedReward(merged); // no supplied reward, no budget
  // visualQuality has no trace signal and was not supplied => 0 AND labeled, never a floor.
  assert.equal(r.visualQuality, 0, "unsupplied visualQuality must be exactly 0 (not a floor)");
  assert.ok(r.labels.includes("unscored:visualQuality"), "visualQuality must be labeled unscored");
  // cost/latency have no documented budget here => also unscored (honest, not assumed).
  assert.equal(r.costEfficiency, 0, "cost efficiency without a budget is 0");
  assert.ok(r.labels.includes("unscored:costEfficiency"), "costEfficiency unscored without a budget");
  assert.equal(r.latencyEfficiency, 0, "latency efficiency without a budget is 0");
  assert.ok(r.labels.includes("unscored:latencyEfficiency"), "latencyEfficiency unscored without a budget");
  // safety is always derivable (no unsafe signal => 1); it must NOT be labeled unscored.
  assert.equal(r.safety, 1, "no unsafe signal => safety 1");
  assert.ok(!r.labels.includes("unscored:safety"), "safety is derived, not unscored");
  // total = documented equal-weight mean of resolved components.
  const expectedTotal = (2 / 3 + 2 / 3 + 0 + 2 / 3 + 0 + 0 + 1) / 7;
  assert.ok(Math.abs(r.total - expectedTotal) < APPROX, "total is the documented mean of resolved components");
});

scenario("(e) SUPPLIED-WINS — a supplied visualQuality is carried verbatim (no unscored label)", () => {
  const merged = mergeFixture();
  const r = computeMergedReward(merged, { visualQuality: 0.92 });
  assert.equal(r.visualQuality, 0.92, "supplied visualQuality carried verbatim");
  assert.ok(!r.labels.includes("unscored:visualQuality"), "supplied component must not be labeled unscored");
  // A supplied component does NOT clobber the honestly-derived ones.
  assert.ok(Math.abs(r.taskCompletion - 2 / 3) < APPROX, "derived taskCompletion still 2/3");
  assert.ok(Math.abs(r.evidenceGrounding - 2 / 3) < APPROX, "derived evidenceGrounding still 2/3");
});

scenario("(f) BUDGET-DERIVE — with a documented budget, cost/latency efficiency derive from step sums", () => {
  const merged = mergeFixture();
  // Fixture step costs: 0.0012 + 0.0031 + 0.0074 + 0.0019 = 0.0136 ; latencies: 640+1180+2960+900 = 5680.
  const totalCost = 0.0012 + 0.0031 + 0.0074 + 0.0019;
  const totalLatency = 640 + 1180 + 2960 + 900;
  // Budget: cost exactly at actual (=> efficiency 1.0), latency at 2x actual (=> efficiency 1.0, under budget).
  const r = computeMergedReward(merged, undefined, {
    budget: { costUsdBudget: totalCost, latencyMsBudget: totalLatency * 2 },
  });
  // At-budget cost => 1.0 (documented curve: ratio 1 -> 1.0).
  assert.ok(Math.abs(r.costEfficiency - 1) < APPROX, "cost exactly at budget => efficiency 1.0");
  assert.ok(!r.labels.includes("unscored:costEfficiency"), "costEfficiency derived with a budget, not unscored");
  // Half-budget latency => under budget => clamped to 1.0.
  assert.ok(Math.abs(r.latencyEfficiency - 1) < APPROX, "latency under budget => efficiency 1.0");
  assert.ok(!r.labels.includes("unscored:latencyEfficiency"), "latencyEfficiency derived with a budget");
  // Sanity: a tighter budget (half the actual cost => ratio 2 => efficiency 0) degrades honestly.
  const tight = computeMergedReward(merged, undefined, { budget: { costUsdBudget: totalCost / 2 } });
  assert.ok(Math.abs(tight.costEfficiency - 0) < APPROX, "cost at 2x budget => efficiency 0.0");
});

scenario("(g) DETERMINISM — same trajectory => byte-identical reward", () => {
  const merged = mergeFixture();
  const a = computeMergedReward(merged);
  const b = computeMergedReward(merged);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "reward must be byte-identical across runs");
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
