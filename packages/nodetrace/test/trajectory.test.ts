/**
 * Scenario-based tests for the NodeTrace trajectory exporter.
 *
 * Persona: "Mara", a banking analyst at a VC fund. She runs the NodeAgent capture loop to pull Q3
 * revenue-variance evidence off a public investor-relations page into a shared NodeRoom artifact, then
 * exports the run for the RL/eval pipeline. We exercise the exporter the way her tooling actually does:
 *  (a) HAPPY  — a successful multi-step capture with extracted data + product-supplied reward components.
 *  (b) FAILURE — a capture that hit a blocked page (ok:false, error set, a "risk" step): honest failure.
 *  (c) DETERMINISM — exporting the SAME run twice yields byte-identical JSONL.
 *  (d) NO-LEAK — a step carrying screenshotPng bytes: bytes absent from JSONL, a path present.
 *  (e) HONEST_SCORES — omitting taskSuccess yields 0 + an "unscored:taskSuccess" label (no floor).
 *
 * Run: npx tsx packages/nodetrace/test/trajectory.test.ts
 * (No test framework — plain node:assert so it runs anywhere tsx/node can.)
 */
import assert from "node:assert/strict";
import type { CaptureResult } from "../src/types";
import {
  toTrajectory,
  toJSONL,
  summarizeReward,
  deterministicId,
  type NodeTrajectory,
  type ToTrajectoryMeta,
  type TraceAction,
} from "../src/trajectory";

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

/* -------------------------------------------------------------------------- */
/* Fixtures — realistic captures Mara's loop would emit.                       */
/* -------------------------------------------------------------------------- */

/** A successful 4-step capture: observe IR page -> click filings -> extract -> done, with a screenshot. */
function happyCapture(): CaptureResult {
  return {
    ok: true,
    url: "https://ir.example-corp.com/quarterly/q3",
    title: "Example Corp — Q3 Investor Relations",
    steps: [
      { phase: "Observe", label: "Load IR landing page", status: "ok", detail: "model: page is the Q3 IR hub", ms: 820 },
      { phase: "Act", label: "Open Q3 filing", status: "ok", detail: "model: click the 'Q3 10-Q' link", ms: 410, box: { x: 0.12, y: 0.4, w: 0.2, h: 0.05 } },
      {
        phase: "Observe",
        label: "Read revenue table",
        status: "ok",
        detail: "model: revenue variance is in the second table",
        ms: 530,
        // NO-LEAK fixture: this step carries raw PNG bytes that must never be inlined into JSONL.
        screenshotPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]),
        box: { x: 0.05, y: 0.55, w: 0.6, h: 0.18 },
      },
      { phase: "Extract", label: "Extract Q3 revenue + YoY variance", status: "ok", detail: "model: $1.24B, +8.3% YoY", ms: 290 },
    ],
    data: { revenueUsd: 1_240_000_000, yoyVariancePct: 8.3, period: "Q3" },
  };
}

/** A failed capture: the IR page redirected to a login/paywall; the loop flagged a risk step and gave up. */
function failureCapture(): CaptureResult {
  return {
    ok: false,
    url: "https://ir.example-corp.com/quarterly/q3",
    title: "Sign in to continue",
    steps: [
      { phase: "Observe", label: "Load IR landing page", status: "ok", detail: "model: looks like the IR hub", ms: 760 },
      { phase: "Observe", label: "Detect auth wall", status: "warn", detail: "model: this is a login form, not the filing", ms: 300 },
      {
        phase: "Error",
        label: "Blocked by auth wall",
        status: "risk",
        detail: "model: cannot proceed without credentials; refusing to enter any",
        ms: 120,
      },
    ],
    error: "capture aborted: target requires authentication (auth wall)",
  };
}

const baseMeta = (over: Partial<ToTrajectoryMeta> = {}): ToTrajectoryMeta => ({
  environment: "noderoom",
  agentHost: "nodeagent",
  goal: "Extract Q3 revenue and YoY variance from Example Corp IR page",
  model: "glm-5.2",
  initialState: { gitCommit: "abc1234", contextPackHash: "ctx-deadbeef" },
  ...over,
});

/* -------------------------------------------------------------------------- */
/* (a) HAPPY path                                                              */
/* -------------------------------------------------------------------------- */

scenario("(a) HAPPY multi-step ok:true -> valid JSONL, sequential stepIndex, screenshots by path, supplied rewards carried", () => {
  const capture = happyCapture();
  // Mara's tooling supplies the product-side reward components (it ran the deterministic scorer + citation
  // verifier + Gemini judge). Per-step actions override the inference for the click + the test isn't run here.
  const actions: (TraceAction | undefined)[] = [
    undefined,
    { kind: "click", target: { description: "Q3 10-Q link" } },
    undefined,
    { kind: "tool_call", tool: "set_artifact_cells", args: { range: "B2:C2" } },
  ];
  const traj = toTrajectory(capture, baseMeta({
    actions,
    rewardComponents: {
      taskSuccess: 1,
      evidenceGrounding: 1,
      visualQuality: 0.8,
      noClobber: 1,
      costEfficiency: 0.9,
      latencyEfficiency: 0.7,
      safety: 1,
    },
    screenshotPathFor: (i) => `/public/qa-trace/q3-step-${i}.png`,
  }));

  // sequential stepIndex 0..3
  assert.deepEqual(traj.steps.map((s) => s.stepIndex), [0, 1, 2, 3]);
  // every step has the same episodeId
  const epIds = new Set(traj.steps.map((s) => s.episodeId));
  assert.equal(epIds.size, 1, "all steps share one episodeId");
  // action override respected; inferred where absent
  assert.equal(traj.steps[1].action.kind, "click");
  assert.equal(traj.steps[3].action.kind, "tool_call");
  assert.equal(traj.steps[0].action.kind, "scroll", "Observe inferred to neutral scroll");
  // happy run is NOT truncated
  assert.equal(traj.truncated, undefined, "successful capture is not truncated");
  // screenshot externalized to the supplied path
  assert.deepEqual(traj.outputs.screenshots, ["/public/qa-trace/q3-step-2.png"]);
  // per-step process reward is the heuristic, and discloses it
  assert.equal(traj.steps[0].reward?.process, 1);
  assert.match(traj.steps[0].reward?.reason ?? "", /heuristic/);
  // supplied components carried verbatim; no "unscored:" labels because all were supplied
  assert.equal(traj.rewards?.taskSuccess, 1);
  assert.equal(traj.rewards?.visualQuality, 0.8);
  assert.ok(!traj.rewards?.labels.some((l) => l.startsWith("unscored:")), "no unscored labels when all supplied");
  // happy run has no failure categories
  assert.deepEqual(traj.rewards?.failureCategories, []);

  // JSONL is exactly one line for one trajectory and parses back
  const jsonl = toJSONL([traj]);
  assert.equal(jsonl.split("\n").filter(Boolean).length, 1, "one trajectory -> one JSONL line");
  assert.ok(jsonl.endsWith("\n"), "trailing newline present");
  const parsed = JSON.parse(jsonl.trim());
  assert.equal(parsed.goal, capture.url ? traj.goal : traj.goal);
  assert.equal(parsed.steps.length, 4);
});

/* -------------------------------------------------------------------------- */
/* (b) FAILURE path — HONEST_STATUS                                            */
/* -------------------------------------------------------------------------- */

scenario("(b) FAILURE ok:false + error + risk step -> honest failure trajectory, error preserved, reward NOT positive-coerced, failureCategories populated", () => {
  const capture = failureCapture();
  const traj = toTrajectory(capture, baseMeta());

  // truncated flagged
  assert.equal(traj.truncated, true, "failed capture flagged truncated");
  // the risk step kept its negative process reward — not coerced positive
  const riskStep = traj.steps.find((s) => s.status === "risk");
  assert.ok(riskStep, "risk step survives");
  assert.equal(riskStep?.reward?.process, -1, "risk step process reward stays negative (honest)");
  // failure categories derived from honest signals
  const fc = traj.rewards?.failureCategories ?? [];
  assert.ok(fc.includes("capture_error"), "capture_error category present");
  assert.ok(fc.includes("error_phase_step"), "error_phase_step category present");
  assert.ok(fc.includes("risk_step"), "risk_step category present");
  assert.ok(fc.includes("truncated"), "truncated category present");
  // headline total is NOT inflated: every product component was unsupplied -> 0 -> total 0 (mean of zeros)
  assert.equal(traj.rewards?.total, 0, "no product components supplied => total not positive-coerced");
  // the error text is recoverable from the serialized JSONL (we don't drop it from provenance)
  const jsonl = toJSONL([traj]);
  assert.ok(jsonl.includes("requires authentication"), "original error text preserved in export");
});

/* -------------------------------------------------------------------------- */
/* (c) DETERMINISM                                                             */
/* -------------------------------------------------------------------------- */

scenario("(c) DETERMINISM: same input twice -> byte-identical JSONL", () => {
  const meta = baseMeta({ screenshotPathFor: (i) => `/public/qa-trace/q3-step-${i}.png` });
  const j1 = toJSONL([toTrajectory(happyCapture(), meta)]);
  const j2 = toJSONL([toTrajectory(happyCapture(), meta)]);
  assert.equal(j1, j2, "identical inputs => identical JSONL bytes");

  // and the derived id is itself deterministic + order-independent in its field map
  const idA = deterministicId("traj", { goal: "g", host: "h", n: 3 });
  const idB = deterministicId("traj", { n: 3, host: "h", goal: "g" });
  assert.equal(idA, idB, "deterministicId is key-order independent");
  // no time/random leakage: a fresh derivation matches
  assert.equal(deterministicId("traj", { goal: "g", host: "h", n: 3 }), idA);

  // batch of two distinct trajectories is stable too
  const batch = [toTrajectory(happyCapture(), meta), toTrajectory(failureCapture(), baseMeta())];
  assert.equal(toJSONL(batch), toJSONL(batch));
});

/* -------------------------------------------------------------------------- */
/* (d) NO-LEAK                                                                 */
/* -------------------------------------------------------------------------- */

scenario("(d) NO-LEAK: a step with screenshotPng -> bytes absent from JSONL, path present in outputs.screenshots", () => {
  const capture = happyCapture();
  const traj = toTrajectory(capture, baseMeta({ screenshotPathFor: (i) => `shots/ep/step-${i}.png` }));

  // the emitted step object must not carry screenshotPng anymore
  const stepWithShotIndex = 2;
  assert.equal((traj.steps[stepWithShotIndex] as unknown as Record<string, unknown>).screenshotPng, undefined, "bytes dropped from step");

  const jsonl = toJSONL([traj]);
  // The PNG signature bytes (0x89 'P' 'N' 'G' ...) must NOT appear as a JSON byte array in the output.
  assert.ok(!/\"screenshotPng\"/.test(jsonl), "no screenshotPng key in JSONL");
  assert.ok(!/137,\s*80,\s*78,\s*71/.test(jsonl), "no raw PNG byte array inlined");
  // the path IS present
  assert.ok(jsonl.includes("shots/ep/step-2.png"), "screenshot path present in JSONL");

  // defensive backstop: even a hand-built trajectory with stray bytes never inlines them
  const dirty = JSON.parse(JSON.stringify({ ...traj })) as NodeTrajectory;
  // simulate a caller stuffing bytes somewhere unexpected
  (dirty as unknown as Record<string, unknown>).strayBytes = new Uint8Array([1, 2, 3, 4]);
  const dirtyJsonl = toJSONL([dirty]);
  assert.ok(dirtyJsonl.includes("<bytes:4 omitted>"), "stray bytes replaced with marker, not inlined");
});

/* -------------------------------------------------------------------------- */
/* (e) HONEST_SCORES                                                           */
/* -------------------------------------------------------------------------- */

scenario("(e) HONEST_SCORES: omit taskSuccess -> 0 + 'unscored:taskSuccess' label, not a floor", () => {
  // Supply everything EXCEPT taskSuccess.
  const traj = toTrajectory(happyCapture(), baseMeta({
    rewardComponents: {
      evidenceGrounding: 1,
      visualQuality: 0.9,
      noClobber: 1,
      costEfficiency: 0.8,
      latencyEfficiency: 0.8,
      safety: 1,
      // taskSuccess intentionally omitted
    },
  }));
  assert.equal(traj.rewards?.taskSuccess, 0, "unsupplied taskSuccess is 0, not a floor");
  assert.ok(traj.rewards?.labels.includes("unscored:taskSuccess"), "unscored label recorded");
  // the components that WERE supplied are not labeled unscored
  assert.ok(!traj.rewards?.labels.includes("unscored:evidenceGrounding"));

  // direct summarizeReward call: omit everything -> all unscored, total 0
  const empty = summarizeReward(traj, {});
  for (const k of ["taskSuccess", "evidenceGrounding", "visualQuality", "noClobber", "costEfficiency", "latencyEfficiency", "safety"]) {
    assert.ok(empty.labels.includes(`unscored:${k}`), `unscored:${k} recorded`);
  }
  assert.equal(empty.total, 0, "all-unscored total is 0 (no fabricated floor)");

  // a supplied custom formula is honored
  const weighted = summarizeReward(traj, { taskSuccess: 1, safety: 1 }, (c) => 1.0 * c.taskSuccess - 1.0 * (1 - c.safety));
  assert.equal(weighted.total, 1, "custom formula applied to resolved components");
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
