/**
 * Scenario-based tests for Trace Storybook v1 — the deterministic HTML render of a merged trajectory.
 *
 * Persona: "Priya", an eval curator. After Dana's accounting run produces a `NodeMergedTrajectory`, Priya
 * opens the ONE self-contained storybook .html to review the run before it enters the SFT/DPO/RLVR lane.
 * She never wants to boot the app; she needs to trust that what she reads IS what the trace recorded.
 * These scenarios exercise renderStorybook the way her review + the CI honesty gate do:
 *  (a) CONTENT      — the room goal, an evidence card WITH the needs_review flag, the cost badge, and a
 *                     verdict badge are all present in the HTML.
 *  (b) HONEST_STATUS — the failing UI assertion => FAIL verdict; needs_review stays needs_review (not green).
 *  (c) HONEST_SCORES — unsupplied reward components surface as "unscored:<name>", never a fabricated floor.
 *  (d) DETERMINISM  — same trajectory => byte-identical HTML (no clock/nonce/random).
 *  (e) NO-LEAK      — no raw screenshot bytes / data: URIs are inlined; paths render as text; bytes throw.
 *  (f) ESCAPING     — a claim containing HTML is escaped, not injected as live markup.
 *
 * Run: node <tsx> packages/nodetrace/test/storybook.test.ts
 * (No test framework — plain node:assert so it runs anywhere tsx/node can.)
 */
import assert from "node:assert/strict";
import { mergeTrajectory, type NodeMergedTrajectory, type OuterTraceInput } from "../src/merged";
import { renderStorybook } from "../src/storybook";
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

/**
 * Merge the canonical accounting fixture WITH a partial reward. The partial reward makes the storybook
 * exercise (a) the verdict badge with a real total, and (b) the "unscored:<name>" honesty labels for the
 * five components the caller did not supply. The failing UI assertion + needs_review evidence in the
 * fixture drive the verdict to FAIL and the failureCategories.
 */
function mergedWithReward(): NodeMergedTrajectory {
  return mergeTrajectory(
    accountingInner,
    accountingOuter,
    accountingArtifacts,
    accountingEvidence,
    { ...accountingMeta, reward: { taskCompletion: 0.8, uiStateCorrectness: 0.6 } },
  );
}

/** Merge the canonical fixture WITHOUT a reward — verdict falls back to the UI assertions only. */
function mergedNoReward(): NodeMergedTrajectory {
  return mergeTrajectory(accountingInner, accountingOuter, accountingArtifacts, accountingEvidence, accountingMeta);
}

/* -------------------------------------------------------------------------- */

scenario("(a) CONTENT — HTML contains room goal, needs_review evidence card, cost badge, verdict badge", () => {
  const html = renderStorybook(mergedWithReward());

  // The room goal is rendered (from RoomHeaderAtom).
  assert.ok(html.includes("Bank reconciliation for March"), "room goal must appear in the HTML");
  assert.ok(html.includes('data-testid="room-goal"'), "room goal atom testid present");

  // An evidence card carrying the needs_review flag is present.
  assert.ok(html.includes('data-atom="evidence-card"'), "at least one evidence card rendered");
  assert.ok(html.includes('data-testid="needs-review"'), "needs_review flag rendered on an evidence card");
  assert.ok(html.includes("NEEDS REVIEW"), "needs_review flag has a visible label");
  // The needs_review claim text itself is present.
  assert.ok(
    html.includes("Check #1042 for 412.50 is uncleared"),
    "the needs_review claim text is rendered",
  );

  // A cost badge summing the per-step costs. Fixture: 0.0012+0.0031+0.0074+0.0019 = 0.0136 => $0.01.
  assert.ok(html.includes('data-testid="cost-badge"'), "cost badge present");
  assert.ok(/cost:\s*\$0\.01/.test(html), `cost badge shows summed cost; got mismatch. HTML slice: ${html.match(/cost:[^<]*/)?.[0]}`);

  // A verdict badge is present.
  assert.ok(html.includes('data-testid="verdict-badge"'), "verdict badge present");
});

scenario("(b) HONEST_STATUS — failing UI assertion => FAIL verdict; needs_review never promoted", () => {
  const html = renderStorybook(mergedWithReward());
  // The fixture's ending-cash assertion fails, so the verdict must be FAIL (not PASS).
  assert.ok(html.includes('data-verdict="fail"'), "failing assertion must yield a FAIL verdict");
  assert.ok(!html.includes('data-verdict="pass"'), "must not render a PASS verdict when an assertion failed");
  // The failure category derived from the failing assertion is surfaced.
  assert.ok(html.includes("ui_assertion_failed"), "ui_assertion_failed category surfaced");
  assert.ok(html.includes("evidence_needs_review"), "evidence_needs_review category surfaced");
  // needs_review must not be rendered as source_backed anywhere on that card.
  assert.ok(
    html.includes('data-needs-review="true"'),
    "the needs_review evidence card is marked, not silently promoted",
  );
});

scenario("(c) HONEST_SCORES — unsupplied reward components surface as unscored:<name>, no floor", () => {
  const html = renderStorybook(mergedWithReward());
  // The five unsupplied components must appear as unscored labels (never a fabricated positive score).
  for (const k of ["visualQuality", "evidenceGrounding", "costEfficiency", "latencyEfficiency", "safety"]) {
    assert.ok(html.includes(`unscored:${k}`), `unsupplied component ${k} must be surfaced as unscored`);
  }
  assert.ok(html.includes('data-testid="unscored-badge"'), "unscored badge present");
  // No verdict without a reward should invent a total number.
  const noReward = renderStorybook(mergedNoReward());
  assert.ok(!/total\s+\d/.test(noReward), "no reward => no fabricated total number in the verdict");
});

scenario("(d) DETERMINISM — same trajectory => byte-identical HTML", () => {
  const t = mergedWithReward();
  const a = renderStorybook(t);
  const b = renderStorybook(t);
  assert.equal(a, b, "same input must render byte-identical HTML");
  // Independently merged (fresh objects) but logically identical inputs also match.
  const c = renderStorybook(mergedWithReward());
  assert.equal(a, c, "logically identical trajectories must render identical HTML");
  // Sanity: no forbidden non-deterministic tokens leaked into the source path (belt-and-suspenders).
  assert.ok(!a.includes("Date.now"), "no Date.now in output");
});

scenario("(e) NO-LEAK — no raw screenshot bytes/data: URIs inlined; paths render as text; bytes throw", () => {
  const html = renderStorybook(mergedWithReward());
  // No inlined image bytes anywhere.
  assert.ok(!html.includes("data:image"), "no inlined image data: URI");
  assert.ok(!html.includes("base64"), "no base64 blob inlined");
  // Screenshots are rendered as their PATHS (text), never as <img src>.
  assert.ok(html.includes("runs/RC-MAR-RECON-8271/outer/before.png"), "screenshot path rendered as text");
  assert.ok(!/<img[^>]*src=/.test(html), "no <img src> tag — screenshots are paths only");
  assert.ok(html.includes('data-atom="focus-box"'), "focus box atom rendered");

  // A data: URI screenshot must throw when merged/rendered (guarded in both merge and render).
  const leaky: OuterTraceInput = {
    ...accountingOuter,
    screenshots: [{ label: "before", path: "data:image/png;base64,iVBORw0KGgo=" }],
  };
  assert.throws(
    () => renderStorybook(mergeTrajectory(accountingInner, leaky, accountingArtifacts, accountingEvidence, accountingMeta)),
    /NO-LEAK/,
    "data: URI screenshot must be rejected before rendering",
  );

  // Raw bytes that slip past merge (constructed object) must still throw at render time.
  const bytesTrajectory = {
    ...mergedNoReward(),
    outerTrace: {
      ...accountingOuter,
      consoleErrors: [],
      uiAssertions: [],
      screenshots: [{ label: "before" as const, path: new Uint8Array([1, 2, 3]) as unknown as string }],
    },
  } as NodeMergedTrajectory;
  assert.throws(() => renderStorybook(bytesTrajectory), /NO-LEAK/, "inlined bytes must be rejected at render time");
});

scenario("(f) ESCAPING — a claim containing HTML is escaped, not injected as live markup", () => {
  const evilTrajectory: NodeMergedTrajectory = {
    ...mergedNoReward(),
    userGoal: "<script>alert('goal')</script>",
    evidence: [
      {
        factId: "fact-evil",
        claim: "<img src=x onerror=alert(1)> & \"quotes\" 'and' <b>bold</b>",
        status: "needs_review",
      },
    ],
  };
  const html = renderStorybook(evilTrajectory);
  // The dangerous markup is escaped in the output...
  assert.ok(html.includes("&lt;script&gt;"), "script tag in goal is escaped");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "img/onerror in claim is escaped");
  // ...and the raw injectable forms are NOT present as live markup.
  assert.ok(!html.includes("<script>alert('goal')</script>"), "no live <script> injected");
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"), "no live <img onerror> injected");
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
