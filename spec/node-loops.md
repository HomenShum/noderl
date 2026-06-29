# NODE-LOOPS.md — the per-repo self-improving-loop manifest (spec)

Every repo that hosts (or is operated on by) an agent loop should carry a root **`NODE-LOOPS.md`**.
It is the companion to `CLAUDE.md`: CLAUDE.md says how the agent should *behave*; NODE-LOOPS.md defines
the *loop* the repo runs — **goal → inner loop (act / observe / judge) → outer loop (self-heal)** —
grounded in *this* repo's real context.

## Why (the hypothesis)
A large codebase **with** a grounded loop manifest + a memory substrate + a codebase graph + a
knowledge layer (OKF/RAG) gives an agent the **agent-status structure** it needs to self-improve. The
same codebase **without** them forces the agent to re-derive context every run, sprawl, and repeat
failures. NODE-LOOPS.md + those substrates is the testable variable — the agent-status thesis applied
per-repo (see `docs/literature-review.md`).

## Hard rule: ground it, don't template it
A copy-pasted NODE-LOOPS.md across repos **disproves** the thesis. Each must be filled from the repo's
*actual* goal, files, loop, and substrates. Generic = no signal. (That's why the rollout is per-repo,
not a blast.)

## Sections (every NODE-LOOPS.md has these)
1. **Goal & milestones** — what "good" is for this repo's loop; the milestone steps the loop checks against.
2. **Inner loop (agent-status trace)** — the task; the state/action/observation it produces; how it's
   traced; the per-step + final **judge (a separate verifier — not the model that did the work)**; reward signals.
3. **Outer loop (self-improve)** — how traces/failures feed back; what the outer agent edits
   (tools / prompts / skills / compaction / eval); the promotion gate; kill criteria.
4. **Context anchors** — the substrates that ground the loop: memory substrate, codebase graph,
   knowledge layer (OKF/RAG), key modules, eval/proof gates. **Link the real files.** (Absence here is itself a finding.)
5. **Verification protocol** — the separate-verifier / honest-gate rules (the `/goal`-style completion
   check; no-proof-no-claim; the runtime reliability checklist: budgets, honest status, SSRF, bounded reads, deterministic CAS).
6. **Reward & safety** — reward components + safety gates (budget caps, approval for outward actions,
   no-clobber, no foreground starvation, no data leakage).
7. **Status / receipts** — where proof/eval receipts live; what's **PROVEN vs OPEN** (honest scope, no overclaim).

## Generation (fill it from codebase context, don't hand-wave)
Where the substrates exist, **generate** rather than guess:
- codebase graph → key modules + their loop roles (§4)
- memory / failure store → known failure patterns + repairs (§3, §6)
- knowledge layer (OKF/RAG) → goal/milestone framing + concept anchors (§1, §4)
- eval/proof gates → the verification protocol + status (§5, §7)

Repos *without* these substrates get a lighter, hand-written manifest — and that gap is the **control
arm** of the experiment.

## The experiment
- **Phase 1** — author grounded NODE-LOOPS.md across the agent-ecosystem repos (not the dead ones).
- **Phase 2 (the measurement)** — run the same agent task in a repo **with** (e.g. NodeRoom: manifest +
  memory + graph + OKF) vs **without** (a bare large repo); compare pass@1, retries, context
  re-derivation cost, and repeated-failure rate. That delta is the thesis, tested.
