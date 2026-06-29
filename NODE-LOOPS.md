# NODE-LOOPS.md — NodeRL

> This repo's self-improving-loop manifest. Companion to `README.md` + `docs/thesis.md`.
> Spec for the format: [`spec/node-loops.md`](spec/node-loops.md).

## 1. Goal & milestones
NodeRL is the **trace → reward → memory → repair** substrate for agentic RL. "Good" = an agent's run
becomes *trainable experience*: a recorded trajectory, evidence-grounded rewards, failure memory, and
a gate-driven verdict. **Milestone:** `experiments/NodeRL-BTB-ToolPolicy-v0.md` — a thin policy nudge
improves next-action choice on a held-out BTB split without degrading evidence-grounding.

## 2. Inner loop (agent-status trace)
- **task:** an agent runs a BankerToolBench-style task (any host — Codex / Claude Code / NodeAgent).
- **state / action / observation:** captured by `packages/nodetrace` (`CaptureStep`: phase / action /
  observation / screenshot / normalized box / ms).
- **judge:** a **separate verifier** — the official Gandalf scorer + the boundary-box (citation)
  verifier + the Gemini visual judge — **not** the model that produced the output (the `/goal` pattern).
- **reward:** `spec/reward-design.md` — taskSuccess + evidence-grounded ratio + visual + export/reopen
  − unsupported claims − cost/latency.

## 3. Outer loop (self-improve)
- `packages/nodemem/failureMemory.ts` records per-task failures + **repair targets**, dropping resolved ones.
- the gates (`packages/nodeeval` full-suite / live-suite) decide **promotion**: a claim flips
  blocked→passed **only when its verdict earns it** (no-proof-no-claim, gate-driven, never hand-edited).
- **kill criteria:** refuse to flip on unearned proof; run a reward-hacking check (did a metric rise via a shortcut?).

## 4. Context anchors
- **modules:** `packages/nodetrace` (inner-loop observer) · `packages/nodemem` (memory + failure store)
  · `packages/nodeeval` (reward builder + proof gates).
- **proof corpus:** the FR-020B / FR-020C BTB trajectories — completion + scoring, **mean reward ≈ 0.25,
  NOT a pass rate** (which is *why* they're useful RL data: real partial-success trajectories).
- **specs:** `spec/trajectory-schema.md`, `spec/reward-design.md`, `spec/proof-receipt-contract.md`, `spec/anti-cheat-doctrine.md`.
- **research:** `docs/literature-review.md` (the threads this loop sits in — incl. self-improving inner/outer loop).
- *Note:* NodeRL is the substrate; the rich memory/graph/OKF substrates it instruments live in the
  originating NodeRoom repo — see that repo's NODE-LOOPS.md for the high-context arm of the experiment.

## 5. Verification protocol
- **separate-verifier** (the `/goal` pattern): completion is checked by a model/scorer that did *not*
  write the output.
- **no-proof-no-claim:** a registry claim flips only when its gate verdict earns it.
- **runtime reliability:** budgets, honest status, SSRF guards, bounded reads, deterministic CAS.

## 6. Reward & safety
- reward components reported **separately** (no single-number inflation).
- safety: held-out-only training, budget caps, no-clobber, no foreground starvation, no data leakage,
  BYO keys (`SECURITY.md`).

## 7. Status / receipts
- **PROVEN:** FR-020B (isolated/Harbor, 100/100 scored generic-only, mean 0.2519) + FR-020C
  (live product UI, 100/100 completed). Completion + scoring — not a 100% pass rate.
- **OPEN:** the BTB-ToolPolicy-v0 experiment (`(s,a,o,r)` exporter + policy nudge); per-task live-UI held-out eval.
