# PROVE-BEFORE-CLAIM — the agent-side honesty gate

> Companion to [`anti-cheat-doctrine.md`](anti-cheat-doctrine.md). Anti-cheat governs the *system's*
> scores; this governs the *agent's* claims. Same principle, turned on the agent running the loop.

## The failure signal (one root cause)

An agent states a conclusion from a **proxy that resembles proof** instead of **ground truth**. The
proxy feels like proof; it isn't. In an agent loop a false PASS becomes a false belief downstream —
the most expensive bug class. Observed faces (real, from a live run):

| Claim | Proxy that fooled it | Ground truth it should have checked |
|---|---|---|
| task "passed/responded" | a completion affordance + keyword — belonging to the page's **seeded demo content**, not the answer | output **content-matches the specific task** (mentions the query subject) AND an independent judge agrees |
| "authenticated" | the composer was **visible** | a real session token exists, or the gated action actually completes |
| headline "N/N pass" | a single run before the false-pass was caught | the honest aggregate **after** the independent check; re-run for flakiness |
| "that doesn't exist" | skepticism / a third party's claim | `grep`/read the real source before asserting absence |
| "the benchmark ran" | an **ad-hoc query** treated as the test | a benchmark was actually **picked** to match the deliverable shape, with acceptance criteria |
| "you have to do it / it's gated" | gave up at the first wall | the autonomous path (real browser, local env, anon/password, reading config) was **tried first** |
| "root cause is X" | a hypothesis from priors | the **actual error/log line** was read first; the fix maps to it |

## The gate

Before emitting any of: **done · passed · works · fixed · shipped · blocked · gated · "doesn't exist" ·
"can't" · "root cause is"** —

1. **Name the artifact that proves it, and check THAT, not a proxy.**
   - `pass` → output content-matches the SPECIFIC goal (not an affordance/keyword/template echo).
   - `authed`/`works` → real token/state exists OR the gated action actually completes.
   - `absent`/`can't` → you `grep`/read/**tried** the real thing first.
   - `root-cause` → you read the actual error/log line; the fix maps to it.
   - `done`/`shipped` → a **live** rendered signal (not build-green/exit-0); re-run for flakiness.
2. **Independent confirmation for anything that "looks done."** A deterministic check that can match
   template/demo content is insufficient alone — pair it with an independent judge (visual /
   fresh-context) OR a content-match to the specific goal. They must agree.
3. **A gate is not real until the autonomous path is exhausted.** Try the real route before declaring a
   human gate. Only a genuine credential, an irreversible/outward action, or genuinely-ambiguous
   direction is a true stop.

## How the loop enforces it (not a promise)

- **Content-match, not affordance** — the verification scorer requires the output to address the
  specific task; an affordance/keyword alone cannot pass (see [`trajectory-schema.md`](trajectory-schema.md) reward).
- **Independent judge can veto** a deterministic PASS (the cross-family verifier is triage that can
  block; see [`anti-cheat-doctrine.md`](anti-cheat-doctrine.md)).
- **Honest status + no-fake-shipped** — a gated/failed step is a FAIL with its reason; "shipped" needs
  a live signal.
- **CI / gate is the backstop** — the check runs outside the agent so a forgotten step still fails the
  gate. The guarantee does not depend on the agent remembering.

This is the agent-facing half of [`node-loops.md`](node-loops.md) §5 (Verification protocol).
