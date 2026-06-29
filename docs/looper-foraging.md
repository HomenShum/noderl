# Foraging looper → NodeRL (what we adopt, what we skip, and why)

> **Source:** [`github.com/ksimback/looper`](https://github.com/ksimback/looper) — **MIT, © Kevin
> Simback**. looper is a *loop-design coach* (a Claude Code skill). This document records the patterns
> we extract from it into the NodeRL / NODE-LOOPS.md stack. **We extract patterns and cite looper as
> prior art / a complementary tool — we do not vendor its files** (honest provenance, even under MIT).

## The lifecycle thesis (where looper fits)

looper and NodeRL operate at *different layers* of the same loop lifecycle, and looper explicitly
scopes itself **out** of durable orchestration ([`looper-spec.md`](https://github.com/ksimback/looper/blob/main/looper-spec.md) §2: "does not provide durable
orchestration … persist step-level retries … store a production run history") — which is exactly the
layer NodeRL provides. So they compose rather than compete:

```
looper                NODE-LOOPS.md              NodeRL
(DESIGN the loop)  →  (DECLARE the loop a       →  (RUN / RECORD / REWARD / REPAIR)
 coached goal,         repo runs: the 7-section    nodetrace trajectories, nodeeval
 typed loop.yaml,      manifest + its typed        gate receipts, nodemem failure
 cross-model council)  companion)                  memory, durable proof
```

A NODE-LOOPS.md could be **generated** by running looper, **linted** by our manifest-lint, then
**executed + recorded** by NodeRL. looper makes the design good; NodeRL makes the run durable and the
proof honest.

## What we adopt (patterns → our files, with our constraints)

Every row is a *pattern* re-expressed in our vocabulary, crediting looper inline where it lands.

| # | Pattern (looper source) | Into (our file) | Our extension / constraint |
|---|---|---|---|
| A1 | **Typed loop companion** — `loop.v1` requires `goal{statement, definition_of_done, verification[]}`, `loop_control`, `gates`, `execution`, `observability` ([`schemas/loop.v1.schema.json`](https://github.com/ksimback/looper/blob/main/schemas/loop.v1.schema.json)) | `spec/node-loops.schema.md` *(follow-on)* + a §0 note in NODE-LOOPS.md | Our own schema in our vocabulary; criterion ids bind to **proof-receipt gate ids**, not free-form. Keep the 7-section prose as the human layer. |
| A2 | **Three-tier criterion taxonomy** — `programmatic{check,expect}` / `judge{rubric}` / `human{prompt}` | NODE-LOOPS.md §5; `spec/proof-receipt-contract.md` | Emit one *typed* criterion per check. Our HELD-OUT / NO-ANSWER-KEYS / IN-APP-TRANSFER split-protection layers **on top** — that's NodeRL-specific, not looper's. |
| A3 | **Required termination guards** — `max_iterations` (required) + `no_progress{max_stalled_iterations, signals[], action}` + `stop_conditions[]` | NODE-LOOPS.md §2 + §6; `NodeTrajectory.truncated` | Satisfies our agentic-reliability **BOUND/TIMEOUT** items by construction. Wire `truncated` to the cap being hit. |
| A4 | **`execution.isolation` enum** — `current_workspace \| branch \| worktree \| sandbox` | **Substrate-Ablation-v0** arm selector (done, see below); `NodeTrajectory.initialState` | This is the ablation axis. Recording the arm **on the trajectory** kills the deployment-global-env isolation bug (where only the "bare" variant actually ran). |
| A5 | **Authored→resolved two-layer split** — `loop.v1` → `loop.resolved.v1` (`compiled_at`, `source`, `criteria_by_id`) | `spec/node-loops.schema.md` resolved variant *(follow-on)*; `initialState.manifestSource/manifestHash` | The runner reads only the resolved artifact (no prose re-parsing); provenance ties a trajectory to the manifest that produced it. |
| A6 | **Reviewer-vs-judge gate legality** — a NOTES-only reviewer can't set "clean"; `revise_until_clean` needs a judge/human `verdict_source` ([`council-rubric.md`](https://github.com/ksimback/looper/blob/main/references/council-rubric.md)) | `spec/anti-cheat-doctrine.md` separate-verifier contract; NODE-LOOPS.md §5 | **We tighten it:** the only legal scored-path `verdict_source` is the **deterministic grader** (or a human). A cross-family LLM occupies the reviewer/triage seat only — it produces `failureCategories`, never `taskSuccess`. |
| A7 | **Cross-model council by default** — prefer a *different model family* in the verifier seat; metadata-only registry; local (ollama) = no egress ([`model-detection.md`](https://github.com/ksimback/looper/blob/main/references/model-detection.md)) | NODE-LOOPS.md §5; `spec/reward-design.md`; `nodemem` failure memory | Our cross-vendor version of `/goal`'s separate-verifier — but **seated as triage**: its `blocking_issues` feed `NodeRewardSummary.failureCategories` + nodemem, not the headline reward. |
| A8 | **Structured judge contract** — fenced JSON `{verdict, blocking_issues, confidence, notes}`; unparseable → degrade, never pass ([`verification-rubric.md`](https://github.com/ksimback/looper/blob/main/references/verification-rubric.md)) | NODE-LOOPS.md §5; `NodeTraceStep.reward.reason` ← `notes`, `failureCategories` ← `blocking_issues` | **Fail-closed:** unparseable verifier output → status stays `partial/blocked`, never `passed` (matches proof-receipt rule 1 + our HONEST_STATUS). |
| A9 | **Author-time rubric linter** — `goal` / `verification` / `control` / `council` rubrics as checks | `spec/manifest-lint.md` (shipped this pass) | Five checks, one per concern, each citing the looper rubric it derives from — run over each repo's NODE-LOOPS.md **before** NodeRL executes it. Closes the Phase-1 rollout's quality loop. |
| A10 | **No-progress stall algorithm** — increment a stall counter only on same-gate + same sorted-failure-signature; stop/checkpoint at the cap ([`templates/run-loop.py`](https://github.com/ksimback/looper/blob/main/templates/run-loop.py) `no_progress_reached()`) | NodeRL TS termination guard *(follow-on)* | Port the **logic** to a pure TS function with a scenario test (repeating vs progressing vs flapping blocker). Re-implemented, not copied. |
| A11 | **Two-tier observability** — mutable `state.json` (resume head) + append-only `run-log.md` (event stream); event vocabulary (`run_start`, `host_start/done`, `programmatic_check`, `judge_verdict`, `gate_passed/blocked`, `revision`, `stop`) | NODE-LOOPS.md §7; NodeRL record layer (Convex) | Persist to **Convex (the ledger)**, not flat files. Reuse the event-type enum; our trajectory event stream is what nodeeval scores. |

## What we deliberately skip (honest control arm)

Foraging without a skip list is just copying. These had no net value for our substrate, or would have *weakened* what we already have:

- **looper's runtime artifacts** (`RUN_IN_SESSION.md`, `run-loop.py`, the `loop.yaml→resolved.json` Python compile) — NodeRL already owns RUN/RECORD with stronger guarantees (durable recorder, JSONL export, machine-computed proof receipts). Adopting the Python runner would duplicate and *weaken* nodetrace + nodeeval.
- **`host`/`council` literal `model_invocation` argv** (`cli`, `invoke`, `timeout_sec`) — we bind `agentHost`/`model` on the trajectory *after the fact*; raw argv in a manifest duplicates host config and rots. We take the *idea* of declaring host+timeout, not the argv shape.
- **`workspace.dir` / `workspace.layout[]` required block** — looper is a single-workspace CLI coach needing a scratch dir; our loops run inside the repo + Convex, where "where" is covered by §4 + `execution.isolation`.
- **`detect-models.py` local-CLI probe + `~/.looper/models.json` registry** — we resolve providers/keys from the Convex env, not by probing locally-installed CLIs. The "record which substrate ran" idea is already captured in A5/A11.
- **Redaction/consent egress machinery** (`redact_prompt_for_member`, `DEFAULT_REDACTIONS`, interactive consent) — built for looper's cross-*vendor* CLI council where prompt text physically leaves the machine. Our egress boundary + secret handling are governed elsewhere (Convex env, SSRF rule); string-replacement redaction is brittle and not how we manage secrets.
- **The `/looper` SKILL packaging + ASCII flow preview + interactive `input()` gates** — looper's design-coach UX. Blocking stdin can't run inside an unattended N-arm × seeds harness; human-in-the-loop, if needed, is our async `needs_review` lane, not a synchronous prompt.
- **looper's advisory-budget stance** (token/USD advisory unless a wrapper adds accounting) — *weaker* than ours: `NodeTraceStep.cost` already carries per-step tokens + usd and `reward-design.md` penalizes over-budget, so we **enforce** what looper leaves advisory. We keep its "a budget cap must be a field, not prose" lint (A9), not its advisory limit.
- **Vendoring either looper schema/rubric file verbatim** — third-party MIT. Extract patterns + cite; never present looper's files as ours.

## Status: done this pass vs follow-on queue

**Done (this pass):**
- A4 — Substrate-Ablation-v0 now uses looper's isolation arm vocabulary (credited).
- A9 — `spec/manifest-lint.md` shipped (the author-time linter for the 8 NODE-LOOPS.md files).
- Plus the `(s,a,o,r)` trajectory exporter it all feeds (`packages/nodetrace/src/trajectory.ts`), tsc-clean + 5-scenario green.

**Follow-on queue (flagged, not yet built — honest scope):**
- A1 + A5 — `spec/node-loops.schema.md`: the typed authored + resolved companion to NODE-LOOPS.md.
- A2 + A8 — fold the typed criterion taxonomy + fenced-JSON verifier contract into §5 + proof-receipt-contract.
- A3 + A10 — the TS termination guard (required cap + ported stall detector) with its scenario test.
- A11 — the Convex two-tier observability tables + event enum.
- A6/A7 — the separate-verifier role contract edit in anti-cheat-doctrine.

These cluster around the **Substrate-Ablation harness build** (the next experiment phase), so they're best built together with the resolved-spec runner rather than piecemeal.

## Attribution

Patterns above are adapted from **looper** by **Kevin Simback** ([github.com/ksimback/looper](https://github.com/ksimback/looper)),
MIT-licensed. looper is the loop-**design** coach upstream of our **declare** (NODE-LOOPS.md) and
**run** (NodeRL) layers. Cited as prior art and a complementary tool; no looper source is vendored
into this repo.
