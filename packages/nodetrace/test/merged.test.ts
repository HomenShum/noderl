/**
 * Scenario-based tests for NodeTrace v2 — the merged loop trajectory.
 *
 * Persona: "Dana", a staff accountant. Her NodeAgent opens a fresh room and reconciles March. Her tooling
 * joins the outer UI proof + inner agent trace + artifacts + evidence into one NodeMergedTrajectory, then
 * ships it to the RL/eval + Trace Storybook lanes. We exercise mergeTrajectory the way her tooling does:
 *  (a) SEQUENTIAL   — inner steps come out with a contiguous 0..n stepIndex even when the input's are wrong.
 *  (b) DETERMINISM  — merging the SAME slices twice yields the SAME trajectoryId (byte-identical object).
 *  (c) NO-LEAK      — screenshots are PATHS; inlined bytes (data: URI / Uint8Array) are rejected.
 *  (d) ROUND-TRIP   — the fixture survives JSON.stringify -> JSON.parse unchanged.
 *  (e) HONEST_SCORES — a partial reward zero-fills + labels the unsupplied component; no reward => none.
 *  (f) HONEST_STATUS — the failing UI assertion + needs_review evidence survive and drive failureCategories.
 *
 * Run: npx tsx packages/nodetrace/test/merged.test.ts
 * (No test framework — plain node:assert so it runs anywhere tsx/node can.)
 */
import assert from "node:assert/strict";
import {
  mergeTrajectory,
  type NodeMergedTrajectory,
  type MergeMeta,
  type OuterTraceInput,
} from "../src/merged";
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

/** Merge the canonical accounting fixture (no reward). */
function mergeFixture(): NodeMergedTrajectory {
  return mergeTrajectory(
    accountingInner,
    accountingOuter,
    accountingArtifacts,
    accountingEvidence,
    accountingMeta,
  );
}

/* -------------------------------------------------------------------------- */

scenario("(a) SEQUENTIAL — stepIndex is contiguous 0..n regardless of input", () => {
  // Feed inner steps whose stepIndex values are wrong (all 99) — merge must re-stamp them.
  const scrambled = {
    ...accountingInner,
    steps: accountingInner.steps.map((s) => ({ ...s, stepIndex: 99 })),
  };
  const merged = mergeTrajectory(scrambled, accountingOuter, accountingArtifacts, accountingEvidence, accountingMeta);
  const indices = merged.innerTrace.steps.map((s) => s.stepIndex);
  assert.deepEqual(indices, [0, 1, 2, 3], "stepIndex must be re-stamped sequentially from 0");
  // And the phases are preserved in order: plan -> tool -> write -> verify.
  assert.deepEqual(
    merged.innerTrace.steps.map((s) => s.phase),
    ["plan", "tool", "write", "verify"],
  );
  // The caller's array must not be mutated (pure joiner).
  assert.equal(scrambled.steps[0].stepIndex, 99, "input steps must not be mutated");
});

scenario("(b) DETERMINISM — same inputs => same trajectoryId + byte-identical object", () => {
  const a = mergeFixture();
  const b = mergeFixture();
  assert.equal(a.trajectoryId, b.trajectoryId, "trajectoryId must be deterministic");
  assert.match(a.trajectoryId, /^mtraj_[0-9a-f]{16}$/, "id shape is mtraj_<16 hex>");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "merged object must be byte-identical across runs");

  // A meaningfully different input (different goal) must yield a different id.
  const otherMeta: MergeMeta = { ...accountingMeta, userGoal: "Bank reconciliation for April" };
  const c = mergeTrajectory(accountingInner, accountingOuter, accountingArtifacts, accountingEvidence, otherMeta);
  assert.notEqual(a.trajectoryId, c.trajectoryId, "different goal must change the id");
});

scenario("(c) NO-LEAK — screenshots are paths; inlined bytes are rejected", () => {
  const merged = mergeFixture();
  // Every screenshot is a stored path, never inlined bytes.
  for (const shot of merged.outerTrace.screenshots) {
    assert.equal(typeof shot.path, "string");
    assert.ok(!shot.path.startsWith("data:"), `screenshot ${shot.label} must not be a data: URI`);
    assert.ok(/\.png$/.test(shot.path), `screenshot ${shot.label} path should be a real file ref`);
  }
  // The whole serialized object contains no base64 image blob.
  assert.ok(!JSON.stringify(merged).includes("data:image"), "no inlined image bytes anywhere");

  // A data: URI screenshot must throw.
  const leakyDataUri: OuterTraceInput = {
    ...accountingOuter,
    screenshots: [{ label: "before", path: "data:image/png;base64,iVBORw0KGgo=" }],
  };
  assert.throws(
    () => mergeTrajectory(accountingInner, leakyDataUri, accountingArtifacts, accountingEvidence, accountingMeta),
    /NO-LEAK/,
    "data: URI screenshot must be rejected",
  );

  // Raw bytes in the path field must throw too.
  const leakyBytes = {
    ...accountingOuter,
    screenshots: [{ label: "before", path: new Uint8Array([1, 2, 3]) as unknown as string }],
  } as OuterTraceInput;
  assert.throws(
    () => mergeTrajectory(accountingInner, leakyBytes, accountingArtifacts, accountingEvidence, accountingMeta),
    /NO-LEAK/,
    "Uint8Array screenshot path must be rejected",
  );
});

scenario("(d) ROUND-TRIP — fixture survives JSON.stringify -> JSON.parse", () => {
  const merged = mergeFixture();
  const roundTripped = JSON.parse(JSON.stringify(merged)) as NodeMergedTrajectory;
  assert.deepEqual(roundTripped, merged, "merged trajectory must round-trip through JSON unchanged");
  // Spot-check the load-bearing fields survived.
  assert.equal(roundTripped.userGoal, "Bank reconciliation for March");
  assert.equal(roundTripped.runId, "RC-MAR-RECON-8271");
  assert.equal(roundTripped.innerTrace.model, "glm-5.2");
  assert.equal(roundTripped.outerTrace.url, "https://noderoom.live/room/RC-MAR-RECON-8271");
  assert.equal(roundTripped.artifacts.length, 1);
  assert.equal(roundTripped.evidence.length, 3);
});

scenario("(e) HONEST_SCORES — partial reward zero-fills + labels; no reward => none", () => {
  // No reward supplied => reward stays undefined (never fabricated).
  const bare = mergeFixture();
  assert.equal(bare.reward, undefined, "no reward supplied => no reward attached");

  // Supply only two components; the other five must be 0 AND labeled unscored (no floor).
  const withReward = mergeTrajectory(
    accountingInner,
    accountingOuter,
    accountingArtifacts,
    accountingEvidence,
    { ...accountingMeta, reward: { taskCompletion: 0.8, uiStateCorrectness: 0.6 } },
  );
  const r = withReward.reward!;
  assert.equal(r.taskCompletion, 0.8, "supplied component carried verbatim");
  assert.equal(r.uiStateCorrectness, 0.6, "supplied component carried verbatim");
  for (const k of ["visualQuality", "evidenceGrounding", "costEfficiency", "latencyEfficiency", "safety"] as const) {
    assert.equal(r[k], 0, `${k} unsupplied => 0 (not a floor)`);
    assert.ok(r.labels.includes(`unscored:${k}`), `${k} must be labeled unscored`);
  }
  // total = mean of resolved components = (0.8 + 0.6 + 0 + 0 + 0 + 0 + 0) / 7
  assert.ok(Math.abs(r.total - (0.8 + 0.6) / 7) < 1e-12, "total is the documented mean of resolved components");
});

scenario("(f) HONEST_STATUS — failing assertion + needs_review evidence survive and categorize", () => {
  const merged = mergeTrajectory(
    accountingInner,
    accountingOuter,
    accountingArtifacts,
    accountingEvidence,
    { ...accountingMeta, reward: {} }, // empty reward object => attach reward, derive failureCategories
  );
  // The failing UI assertion is carried verbatim (never flipped to passed).
  const tie = merged.outerTrace.uiAssertions.find((a) => a.id === "assert-ending-cash-ties");
  assert.ok(tie, "ending-cash assertion present");
  assert.equal(tie!.passed, false, "failing assertion must stay failed");
  // The needs_review evidence survives.
  const nr = merged.evidence.find((e) => e.factId === "fact-uncleared-check-1042");
  assert.ok(nr, "needs_review evidence present");
  assert.equal(nr!.status, "needs_review", "needs_review must not be promoted");
  // failureCategories derived from those honest signals.
  const cats = merged.reward!.failureCategories;
  assert.ok(cats.includes("ui_assertion_failed"), "failing assertion => ui_assertion_failed");
  assert.ok(cats.includes("evidence_needs_review"), "needs_review evidence => evidence_needs_review");
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
