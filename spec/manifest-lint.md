# NODE-LOOPS.md author-time lint

> Five checks run over a repo's `NODE-LOOPS.md` **before** NodeRL executes its loop. A manifest that
> fails a check is a *generic/templated* manifest — exactly the "no signal" failure the
> [node-loops spec](node-loops.md) warns against ("ground it, don't template it").
>
> The check *patterns* are extracted from **looper**'s rubrics (Kevin Simback,
> [github.com/ksimback/looper](https://github.com/ksimback/looper), **MIT**) and re-expressed for our
> 7-section manifest. See [`docs/looper-foraging.md`](../docs/looper-foraging.md) for the full
> foraging ledger. Patterns reimplemented, not copied.

Each check is `pass` / `warn` / `fail`. A `fail` blocks the manifest from being treated as grounded;
a `warn` is recorded on the manifest's status line.

---

## 1. goal-check → §1 Goal & milestones
*(from looper [`goal-rubric.md`](https://github.com/ksimback/looper/blob/main/references/goal-rubric.md))*

§1 must state a **falsifiable outcome**, not an activity. Require all of:
- a concrete **done-artifact** (what exists when the loop succeeds — a receipt, a passing gate, a shipped file), not "improve X";
- explicit **scope** (what's in / out);
- the **context sources** the loop may read (maps to §4);
- a **named consumer** of the result.

**The "two agents disagree" test:** if two readers could disagree on whether the goal is met, it's not
falsifiable → `fail`. Anti-patterns (→ `fail`): "make it better", "polish", unbounded "handle all
cases", a goal with no artifact.

## 2. verification-check → §5 Verification protocol
*(from looper [`verification-rubric.md`](https://github.com/ksimback/looper/blob/main/references/verification-rubric.md))*

§5 must carry **typed** criteria, not prose:
- each criterion is `programmatic` (an executable check + expected exit/stdout), `judge` (a named rubric), or `human` (a sign-off prompt);
- **≥1 non-vibe criterion** (at least one `programmatic` or a deterministic grader) — a manifest whose only check is "an LLM thinks it looks good" → `fail`;
- **deterministic-before-judge** ordering: the programmatic/deterministic check runs first; the LLM judge is triage on top, never the sole gate.

NodeRL addition (not looper's): §5 must also name the **HELD-OUT / NO-ANSWER-KEYS / IN-APP-TRANSFER**
posture (or explicitly state why it doesn't apply). A `judge`/`human` criterion with no programmatic
backstop → `warn`.

## 3. control-check → §6 Reward & safety
*(from looper [`control-rubric.md`](https://github.com/ksimback/looper/blob/main/references/control-rubric.md))*

§6 must declare **enforced** termination guards (prose "we stop when done" → `fail`):
- an **iteration cap** (`max_iterations`);
- a **revision cap** per gate;
- a **no-progress stop** (stall detector → stop or human-checkpoint);
- an **enforced budget cap** (NodeRL enforces via `NodeTraceStep.cost`, not advisory);
- a real **success stop**.

Anti-pattern (→ `fail`): the only stop is "subjective self-satisfaction" / "until it feels right".
NodeRL addition: the cap being hit must wire to `NodeTrajectory.truncated`.

## 4. council-check → §5 separate-verifier
*(from looper [`council-rubric.md`](https://github.com/ksimback/looper/blob/main/references/council-rubric.md))*

The verifier seat must obey gate legality:
- a **notes-only reviewer may never set status = "clean/passed"**;
- a `revise_until_clean` gate must name a real `verdict_source`;
- prefer a **different model family** from the host (blind-spot coverage).

**NodeRL tightening (hard):** the only legal **scored-path** `verdict_source` is the **deterministic
grader** (or a human) — *no LLM on the scored path* ([`anti-cheat-doctrine.md`](anti-cheat-doctrine.md)).
A cross-family LLM is allowed only in the **triage** seat: it emits `{verdict, blocking_issues,
confidence, notes}`, which feed `NodeRewardSummary.failureCategories` + nodemem — **never**
`taskSuccess`. A §5 that lets an LLM/reviewer emit the headline verdict → `fail`.

## 5. privacy-check → §4 / §6
*(from looper [`model-detection.md`](https://github.com/ksimback/looper/blob/main/references/model-detection.md) Default Redactions + spec §9)*

If §5's verifier is **cross-vendor** (prompt text leaves our boundary), §4/§6 must declare:
- the **destination** (which provider/CLI);
- **redaction** scope (what is withheld);
- **consent** posture.

A local (ollama / in-cluster) verifier with no egress → `pass` trivially. A cross-vendor verifier with
no declared destination/redaction → `fail`. NodeRL note: secrets are resolved from the Convex env and
must never enter a verifier prompt (our keys-handling boundary + SSRF rule).

---

## Running the lint

This is a checklist gate today (run it by reading the manifest against the five checks; record the
verdict on the manifest's §7 status line). It is a natural **follow-on** to graduate into a script that
consumes the typed `node-loops.schema` companion (see [`docs/looper-foraging.md`](../docs/looper-foraging.md)
A1/A5) and emits a pass/warn/fail receipt per check.

**Applies to:** every NODE-LOOPS.md in the agent-ecosystem rollout (noderoom, solo-founder-agent-builder,
NodeAgent, NodeMem, nodetrace, visual-judge, feature-walkthrough-gif, and this repo). Running it over
that set is the quality gate that closes Phase 1 of the rollout.
