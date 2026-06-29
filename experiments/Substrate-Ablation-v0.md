# Experiment: Substrate-Ablation-v0

> **Does a grounded `NODE-LOOPS.md` + agent-status substrates (memory · codebase graph · OKF/RAG ·
> committed eval) measurably help an agent self-improve — versus the same large codebase without
> them?** This is the NODE-LOOPS.md thesis (`../spec/node-loops.md` §Why), tested as a within-repo
> ablation rather than asserted.

Status: **OPEN — runnable design, not yet run.** Companion to
[`NodeRL-BTB-ToolPolicy-v0.md`](NodeRL-BTB-ToolPolicy-v0.md). Phase 2 of the rollout described in
[`../spec/node-loops.md`](../spec/node-loops.md) §The experiment.

---

## 1. Hypothesis (falsifiable)

For a fixed agent + model + task set, an agent operating in a repo that carries a grounded loop
manifest **and** the agent-status substrates it points at will, relative to the same repo with those
removed:

- **H1 (manifest):** spend fewer tokens re-deriving the repo's structure on the first attempt.
- **H2 (substrates):** reach a correct, verifier-passed result in **fewer attempts** (lower retries-to-pass).
- **H3 (memory):** repeat a previously-seen failure class **less often** across a task sequence.

**Null result is a real outcome.** If the deltas are within noise, the thesis is wrong *for this task
class* and we say so — a generic manifest that doesn't move the metric is exactly the "templated =
no signal" failure the spec warns about.

## 2. Why within-repo (not cross-repo)

Comparing two *different* repos (e.g. a 6/6-substrate repo vs a 1/6 control) confounds **substrate
level** with **task difficulty and codebase size**. The clean design holds the codebase, task, model,
and seed fixed and varies **only** the substrate layer. The cross-repo comparison is saved for *after*
the within-repo A/B establishes direction.

Instantiation: **the originating NodeRoom checkout** (the only 6/6-substrate repo in the ecosystem
census). The team maps substrate *categories* below → concrete files via that repo's own
`NODE-LOOPS.md` §4 (kept private; not reproduced here).

## 3. The three arms

A 3-arm design isolates "does the manifest alone help" from "do the substrates help" — which is the
two-part question the thesis actually poses.

| Arm | `NODE-LOOPS.md` | Memory store | Codebase graph | OKF/RAG | Committed eval | What it tests |
|---|:--:|:--:|:--:|:--:|:--:|---|
| **A — BARE** | removed | removed | removed | removed | kept* | the large-repo-without-context baseline |
| **B — MANIFEST-ONLY** | present | removed | removed | removed | kept* | does the grounded manifest alone help? (H1) |
| **C — FULL** | present | present | present | present | kept* | manifest + substrates, the production arm (H2, H3) |

\* The committed-eval gate is the **dependent variable's measuring instrument** (it scores
pass/fail), so it is held constant across all arms — it is never the thing being ablated.

**Stripping is non-destructive and reversible:** each arm is a fresh `git worktree` of the same commit
with the relevant substrate directories/files moved out (not edited), so the diff between arms is
exactly the substrate layer and nothing else. Record the strip manifest (which paths were removed per
arm) as a receipt.

**Arm isolation is a first-class, recorded knob.** Each arm declares its isolation as one of
`current_workspace | branch | worktree | sandbox` (vocabulary adopted from looper's `execution.isolation`
— Kevin Simback, [github.com/ksimback/looper](https://github.com/ksimback/looper), MIT; see
[`docs/looper-foraging.md`](../docs/looper-foraging.md) A4), and that arm label is written onto each
run's `NodeTrajectory.initialState`. This is not cosmetic: recording the arm *on the trajectory*
(rather than flipping a deployment-global env var) is what prevents the isolation bug that silently made
an earlier A/B run only the one variant — the arm becomes per-run data the scorer can verify, not a
global mode that can desync.

## 4. The task set

- **N ≥ 10 held-out tasks** drawn from the BankerToolBench-style corpus already referenced in
  [`NodeRL-BTB-ToolPolicy-v0.md`](NodeRL-BTB-ToolPolicy-v0.md) — held-out so no arm can have been
  tuned on them, and **ordered** so H3 (repeated-failure) is observable across the sequence.
- Each task is run **identically** in all three arms: same prompt, same model, same temperature,
  same tool registry. The agent is told only "complete this task in this repo" — it must discover
  structure itself in arm A.
- **≥ 3 seeds per (arm, task)** to separate substrate effect from model nondeterminism. Report
  mean ± spread, not a single run.

## 5. Metrics (all derived from the trace, never self-reported)

Captured via NodeTrace `(state, action, observation, reward)` per step
([`../spec/trajectory-schema.md`](../spec/trajectory-schema.md)):

| Metric | Definition | Hypothesis |
|---|---|---|
| **pass@1** | verifier-passed on first attempt (the committed-eval gate, unchanged) | C > B ≥ A |
| **retries-to-pass** | attempts until the verifier passes (cap at K, then `unsolved`) | C < B < A |
| **context re-derivation cost** | tokens spent on read/search/grep actions *before the first edit* | B,C < A (H1) |
| **repeated-failure rate** | fraction of failures whose failure-class was already seen earlier in the sequence | C < A (H3) |
| **cost / latency** | total tokens + wall-clock to terminal verdict | reported, not optimized |

The **reward** is the verifier verdict (`../spec/reward-design.md`) — evidence-grounded, separate from
the agent that did the work (`/goal` pattern). No metric is the agent's own claim.

## 6. Harness

1. `git worktree add` three trees off the same commit; apply each arm's strip manifest; record it.
2. For each (arm, task, seed): run the agent host against that worktree, capturing every step with
   NodeTrace → one JSONL trajectory per run (`episode_id = arm:task:seed`).
3. Score each terminal state with the **committed-eval gate** (identical binary; no LLM on the scored
   path) → reward + pass/fail.
4. Reduce trajectories → the §5 metric table; emit a single results receipt + the raw JSONL.
5. **Promotion / claim gate:** a "substrates help" claim flips OPEN→PROVEN only if C beats A on
   pass@1 **and** retries-to-pass with the seed-spread accounted for — gate-driven, never hand-asserted
   (same no-proof-no-claim rule as the FR-020 gates).

## 7. Predicted result (per the thesis — stated up front so we can't move the goalposts)

- **C > B > A** on pass@1 and retries-to-pass.
- The **A→B** gap (manifest alone) is expected to be smaller than the **B→C** gap (substrates) — the
  manifest orients; the substrates supply the structure the agent would otherwise re-derive.
- **H3 (repeated-failure) shows up only in C**, because only C has the memory store that records a
  failure class and surfaces it on the next related task. If B reduces repeated-failure as much as C,
  the memory substrate is not the active ingredient and that is a finding.

## 8. Confounds & kill criteria

- **Model nondeterminism** → ≥3 seeds; if within-arm spread ≥ between-arm delta, the result is null
  for this task — report it, don't fish for a seed that confirms.
- **Manifest-as-leakage** → the manifest must not contain task answers; it describes the *loop*, not
  the solutions. Audit it before the run.
- **Strip incompleteness** → if arm A still resolves substrate data through a cached index or a
  hard-coded path, the ablation is contaminated; the strip manifest + a "no substrate reachable" probe
  guard against this (the lesson from the NodeMem recall benchmark: injection wired to the wrong
  runner produced a fake 0-lift).
- **Kill:** if C does not beat A after a full N×3-seed run, the thesis is **not supported for this
  task class** — record the null result in §7's predicted-vs-actual and stop; do not re-spec until a
  reason is understood.

## 9. What "starting" this experiment requires (the next concrete steps)

1. Freeze the task set (N held-out BTB tasks) + the K retry cap.
2. Write the **strip manifest** per arm against the NodeRoom checkout (private; maps the §3 categories
   to real paths).
3. Wire the NodeTrace `(s,a,o,r)` exporter for the agent host (shared with
   [`NodeRL-BTB-ToolPolicy-v0.md`](NodeRL-BTB-ToolPolicy-v0.md) §exporter — build once, both
   experiments consume it).
4. Run A/B/C × N × 3 seeds; reduce; emit the receipt.
