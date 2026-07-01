/**
 * NodeEval v1 — the HONEST reward builder over a merged trajectory.
 *
 * `mergeTrajectory` (in ./merged) is deliberately dumb about scoring: it carries a reward VERBATIM only
 * when the product side supplies one, and never fabricates. NodeEval is the complementary step — it looks
 * at the joined trace (`NodeMergedTrajectory`) and DERIVES the reward components that ARE grounded in the
 * trace, while still refusing to invent the ones that are not.
 *
 * Split of responsibilities (why this is a separate file, root-caused):
 *  - A reward component that can be READ OFF the trace (uiAssertions, evidence status, per-step cost/latency)
 *    is derived here from those honest signals — this is the RL/eval reward the merge step could not produce.
 *  - A component with NO trace signal (visualQuality, and cost/latency when no budget is documented) is NOT
 *    guessed: it is set to 0 AND labeled "unscored:<name>". A caller may still SUPPLY it (e.g. a VLM visual
 *    judge score), in which case the supplied value is carried verbatim and takes precedence over derivation.
 *
 * HONESTY invariants (hard — same doctrine as merged.ts / trajectory.ts):
 *  - HONEST_SCORES: never fabricate. Supplied > derived-from-trace > (0 + "unscored:<name>"). A component
 *    that is neither supplied nor derivable is 0 AND labeled unscored — NEVER a hardcoded floor.
 *  - HONEST_STATUS: failed uiAssertions and needs_review evidence are read as-is; they LOWER the derived
 *    score and populate failureCategories. The merge never flipped them and neither do we.
 *  - DETERMINISTIC: no Date.now / Math.random / new Date. Pure function of (trajectory, supplied). Same
 *    input => byte-identical output. All derivations are exact rational arithmetic over counts/sums.
 *  - NO-LEAK: this module only reads screenshot PATHS (counts/labels); it never inlines bytes. (The merge
 *    step already rejected inlined bytes; we never re-serialize a screenshot body.)
 */
import type {
  NodeMergedTrajectory,
  MergedReward,
  MergedStep,
} from "./merged";
import { MERGED_REWARD_COMPONENTS } from "./merged";

/* ------------------------------------------------------------------------------------------------ *
 * Budget — the DOCUMENTED reference for cost/latency efficiency.                                     *
 * A component that compares against a budget is only honest if the budget is explicit. When no budget *
 * is supplied, cost/latency efficiency is UNSCORED (0 + label), never assumed.                        *
 * ------------------------------------------------------------------------------------------------ */

/**
 * The reference budget for a run. `costUsdBudget` / `latencyMsBudget` are the "at-or-under = full credit"
 * targets. Efficiency degrades LINEARLY to 0 at 2x budget (documented curve below), so a run exactly at
 * budget scores 1.0, at 2x scores 0.0, and over 2x is clamped to 0. Under-budget is clamped to 1.0.
 */
export interface EvalBudget {
  costUsdBudget?: number;
  latencyMsBudget?: number;
}

/** Options for computeMergedReward beyond the supplied partial reward. */
export interface EvalOptions {
  /** Documented budget for cost/latency efficiency. Absent budget => that efficiency is unscored. */
  budget?: EvalBudget;
  /** Optional weights for the total formula; defaults to an equal-weight mean over the seven components. */
  weights?: Partial<Record<(typeof MERGED_REWARD_COMPONENTS)[number], number>>;
}

/* ------------------------------------------------------------------------------------------------ *
 * Pure helpers.                                                                                      *
 * ------------------------------------------------------------------------------------------------ */

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Clamp to [0,1] — the product convention for reward components. */
function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Stable de-dup preserving first-seen order (DETERMINISTIC — no Set-iteration surprises). */
function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Documented efficiency curve against a budget: at-or-under budget = 1.0; linearly to 0 at 2x budget;
 * clamped to [0,1]. Returns null when the budget is not a usable positive number (=> caller marks unscored).
 */
function efficiencyVsBudget(actual: number, budget: number | undefined): number | null {
  if (!isFiniteNumber(budget) || budget <= 0) return null;
  if (!isFiniteNumber(actual)) return null;
  // ratio 1 (at budget) -> 1.0 ; ratio 2 (2x budget) -> 0.0 ; slope = 2 - ratio.
  const ratio = actual / budget;
  return clamp01(2 - ratio);
}

/** Sum a per-step numeric field over only the steps that carry a finite value. Returns null if none do. */
function sumStepField(steps: MergedStep[], field: "costUsd" | "latencyMs"): number | null {
  let sum = 0;
  let seen = false;
  for (const s of steps) {
    const v = s[field];
    if (isFiniteNumber(v)) {
      sum += v;
      seen = true;
    }
  }
  return seen ? sum : null;
}

/* ------------------------------------------------------------------------------------------------ *
 * computeMergedReward — the honest derivation.                                                       *
 * ------------------------------------------------------------------------------------------------ */

/**
 * Derive a `MergedReward` from a merged trajectory, HONESTLY.
 *
 * Resolution order per component (highest precedence first):
 *   1. SUPPLIED — if `supplied.<name>` is a finite number, carry it verbatim (product/VLM score wins).
 *   2. DERIVED  — else derive from honest trace signals when possible.
 *   3. UNSCORED — else 0 AND push "unscored:<name>" (never a floor).
 *
 * Per-component derivation (all read-only over honest signals):
 *   - taskCompletion    = passedAssertions / totalAssertions   (unscored if there are no assertions)
 *   - uiStateCorrectness = SAME signal (assertion pass fraction) (unscored if no assertions)
 *   - visualQuality     = no trace signal => unscored unless supplied
 *   - evidenceGrounding = source_backed / totalEvidence         (unscored if there is no evidence)
 *   - costEfficiency    = efficiencyVsBudget(sum step costUsd, budget.costUsdBudget)  (unscored w/o budget)
 *   - latencyEfficiency = efficiencyVsBudget(sum step latencyMs, budget.latencyMsBudget)(unscored w/o budget)
 *   - safety            = 1 unless an honest UNSAFE signal is present (consoleError / artifact-reopen-fail
 *                         "clobber" / step error), each of which drops safety to 0. Always derivable => the
 *                         one component with a documented default of 1 (an honest "no unsafe signal seen").
 *
 * `total` = weighted mean of the resolved components (equal weights unless `opts.weights` supplied).
 * `failureCategories` = derived from honest signals only (failed assertions, needs_review evidence, step
 *  errors, artifact reopen failures, console errors) + any supplied categories, de-duped.
 */
export function computeMergedReward(
  t: NodeMergedTrajectory,
  supplied?: Partial<MergedReward>,
  opts?: EvalOptions,
): MergedReward {
  const src = supplied ?? {};
  const labels: string[] = Array.isArray(src.labels) ? [...src.labels] : [];

  const outer = t.outerTrace;
  const inner = t.innerTrace;
  const artifacts = t.artifacts;
  const evidence = t.evidence;

  // --- Honest count signals (read verbatim; never flipped). ---
  const totalAssertions = outer.uiAssertions.length;
  const passedAssertions = outer.uiAssertions.filter((a) => a.passed === true).length;
  const totalEvidence = evidence.length;
  const sourceBackedEvidence = evidence.filter((e) => e.status === "source_backed").length;

  const hasConsoleError = outer.consoleErrors.length > 0;
  const hasStepError = inner.steps.some((s) => typeof s.error === "string" && s.error.length > 0);
  const hasReopenFail = artifacts.some((a) => a.reopenPassed === false);

  const budget = opts?.budget;

  // resolved values + a parallel record of how each was resolved (for labels).
  const resolved: Record<(typeof MERGED_REWARD_COMPONENTS)[number], number> = {
    taskCompletion: 0,
    uiStateCorrectness: 0,
    visualQuality: 0,
    evidenceGrounding: 0,
    costEfficiency: 0,
    latencyEfficiency: 0,
    safety: 0,
  };

  /** Resolve one component: supplied > derived > unscored. `derive` returns null when not derivable. */
  function resolve(
    name: (typeof MERGED_REWARD_COMPONENTS)[number],
    derive: () => number | null,
  ): void {
    const s = src[name];
    if (isFiniteNumber(s)) {
      resolved[name] = s; // SUPPLIED — verbatim (no clamp; carry exactly what the product judged).
      return;
    }
    const d = derive();
    if (d === null) {
      resolved[name] = 0;
      labels.push(`unscored:${name}`);
      return;
    }
    resolved[name] = d;
  }

  // taskCompletion — fraction of UI assertions that passed.
  resolve("taskCompletion", () =>
    totalAssertions > 0 ? passedAssertions / totalAssertions : null,
  );

  // uiStateCorrectness — SAME honest signal (did the UI end in the asserted state?).
  resolve("uiStateCorrectness", () =>
    totalAssertions > 0 ? passedAssertions / totalAssertions : null,
  );

  // visualQuality — no signal in the trace (screenshots are paths, not judged here). Unscored unless supplied.
  resolve("visualQuality", () => null);

  // evidenceGrounding — fraction of evidence facts that are source_backed.
  resolve("evidenceGrounding", () =>
    totalEvidence > 0 ? sourceBackedEvidence / totalEvidence : null,
  );

  // costEfficiency — sum of per-step costUsd vs documented budget; unscored without a budget or without costs.
  resolve("costEfficiency", () => {
    const actual = sumStepField(inner.steps, "costUsd");
    if (actual === null) return null;
    return efficiencyVsBudget(actual, budget?.costUsdBudget);
  });

  // latencyEfficiency — sum of per-step latencyMs vs documented budget; unscored without a budget/latencies.
  resolve("latencyEfficiency", () => {
    const actual = sumStepField(inner.steps, "latencyMs");
    if (actual === null) return null;
    return efficiencyVsBudget(actual, budget?.latencyMsBudget);
  });

  // safety — always derivable: 1 (no unsafe signal) unless an honest unsafe signal is present, then 0.
  resolve("safety", () => (hasConsoleError || hasReopenFail || hasStepError ? 0 : 1));

  // --- failureCategories from honest signals only (+ supplied), de-duped. ---
  const failureCategories: string[] = Array.isArray(src.failureCategories)
    ? [...src.failureCategories]
    : [];
  if (outer.uiAssertions.some((a) => a.passed === false)) failureCategories.push("ui_assertion_failed");
  if (evidence.some((e) => e.status === "needs_review")) failureCategories.push("evidence_needs_review");
  if (hasStepError) failureCategories.push("step_error");
  if (hasReopenFail) failureCategories.push("artifact_reopen_failed");
  if (hasConsoleError) failureCategories.push("console_error");

  // --- total = documented weighted mean of resolved components. ---
  const weights = opts?.weights;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const k of MERGED_REWARD_COMPONENTS) {
    const w = isFiniteNumber(weights?.[k]) ? (weights![k] as number) : 1;
    weightedSum += resolved[k] * w;
    weightTotal += w;
  }
  const total = weightTotal > 0 ? weightedSum / weightTotal : 0;

  return {
    taskCompletion: resolved.taskCompletion,
    uiStateCorrectness: resolved.uiStateCorrectness,
    visualQuality: resolved.visualQuality,
    evidenceGrounding: resolved.evidenceGrounding,
    costEfficiency: resolved.costEfficiency,
    latencyEfficiency: resolved.latencyEfficiency,
    safety: resolved.safety,
    total,
    labels: dedupe(labels),
    failureCategories: dedupe(failureCategories),
  };
}
