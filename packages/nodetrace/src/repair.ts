/**
 * Auto-repair — the REPAIR stage of the loop (trace → reward → repair → rerun → regression).
 *
 * Turns a FAILED NodeMergedTrajectory into (a) a coding-agent repair prompt and (b) a promotable
 * regression case. Pure + DETERMINISTIC (no Date.now/Math.random/new Date). It NEVER fabricates a
 * fix — it packages the exact ground-truth failure + evidence and asks the coding agent to trace the
 * root cause, propose the smallest shared fix, resolve unsourced claims, and add the regression.
 */
import type { NodeMergedTrajectory, MergedReward, UiAssertion } from "./merged";
import { computeMergedReward } from "./mergedReward";

export interface RegressionCase {
  id: string;
  fromTrajectory: string;
  userGoal: string;
  failedAssertions: UiAssertion[];
  failureCategories: string[];
  needsReviewClaims: string[];
  expectation: string;
}

/** Extract a promotable regression case from a (typically failed) trajectory. */
export function toRegressionCase(t: NodeMergedTrajectory, reward?: MergedReward): RegressionCase {
  const r = reward ?? computeMergedReward(t);
  const failed = t.outerTrace.uiAssertions.filter((a) => !a.passed);
  const needsReviewClaims = t.evidence.filter((e) => e.status === "needs_review").map((e) => e.claim);
  const expectation =
    failed.length > 0
      ? `Re-running "${t.userGoal}" must make these ${failed.length} assertion(s) pass: ${failed
          .map((a) => a.id)
          .join(", ")}`
      : `Re-running "${t.userGoal}" must keep all UI assertions passing and resolve ${needsReviewClaims.length} needs_review evidence fact(s).`;
  return {
    id: `regression_${t.trajectoryId}`,
    fromTrajectory: t.trajectoryId,
    userGoal: t.userGoal,
    failedAssertions: failed,
    failureCategories: r.failureCategories,
    needsReviewClaims,
    expectation,
  };
}

/** Build the coding-agent repair prompt (markdown). Deterministic; grounds every claim in the trace. */
export function generateRepairPrompt(t: NodeMergedTrajectory, reward?: MergedReward): string {
  const r = reward ?? computeMergedReward(t);
  const failed = t.outerTrace.uiAssertions.filter((a) => !a.passed);
  const errorSteps = t.innerTrace.steps.filter((s) => s.error);
  const reopenFails = t.artifacts.filter((a) => a.reopenPassed === false);
  const needsReview = t.evidence.filter((e) => e.status === "needs_review");
  const rc = toRegressionCase(t, r);
  const verdict = failed.length === 0 && errorSteps.length === 0 ? "PARTIAL/REVIEW" : "FAIL";

  const L: string[] = [];
  L.push(`# Repair prompt — ${t.userGoal}`);
  L.push("");
  L.push(`- trajectory: \`${t.trajectoryId}\`  ·  run: \`${t.runId}\``);
  L.push(`- verdict: **${verdict}**  ·  total reward: ${r.total.toFixed(3)}`);
  L.push(`- failure categories: ${r.failureCategories.length ? r.failureCategories.join(", ") : "(none)"}`);
  L.push("");
  L.push(`## What failed (ground truth — do NOT guess)`);
  if (failed.length) {
    for (const a of failed) L.push(`- **${a.id}** — expected: ${a.expected} · observed: ${a.observed}`);
  } else {
    L.push("- (no failed UI assertion)");
  }
  if (errorSteps.length) {
    L.push("");
    L.push(`## Erroring steps`);
    for (const s of errorSteps) L.push(`- step ${s.stepIndex} (${s.phase}${s.toolName ? `/${s.toolName}` : ""}): ${s.error}`);
  }
  if (reopenFails.length) {
    L.push("");
    L.push(`## Artifacts that failed to reopen`);
    for (const a of reopenFails) L.push(`- ${a.artifactId} (${a.kind})${a.exportPath ? ` — ${a.exportPath}` : ""}`);
  }
  L.push("");
  L.push(`## Evidence`);
  L.push(`- screenshots: ${t.outerTrace.screenshots.map((s) => `${s.label}=${s.path}`).join(", ") || "(none)"}`);
  if (needsReview.length) {
    L.push(`- **needs_review (unsourced) claims — resolve with a real source or drop:**`);
    for (const e of needsReview) L.push(`  - ${e.claim}`);
  }
  L.push("");
  L.push(`## Your task`);
  L.push(`1. Trace each failed assertion to its root cause (read the failing step + artifact; do not fabricate).`);
  L.push(`2. Propose the SMALLEST shared fix that makes the failed assertion(s) pass — never a per-task patch.`);
  L.push(`3. Resolve every needs_review claim with a real source, or remove it.`);
  L.push(`4. Add the regression below so this failure cannot silently return.`);
  L.push("");
  L.push(`## Regression to add`);
  L.push("```json");
  L.push(JSON.stringify(rc, null, 2));
  L.push("```");
  return L.join("\n");
}
