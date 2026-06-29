# NodeRL-BTB-ToolPolicy-v0 — experiment spec

> The narrow first experiment from [`docs/literature-review.md`](../docs/literature-review.md).
> **Runnable**: it cites the real data, tool registry, and reward signals that already exist in the
> originating NodeRoom repo, and flags exactly what is net-new to build. **Black-box, test-time
> control** (Agentic Monte Carlo style, [arXiv 2606.05296](https://arxiv.org/abs/2606.05296)) — it
> does NOT train the base agent's weights.

## Question

Given a partial/failed BankerToolBench trajectory, can a small policy choose a better **next action**
(tool / repair / context pack) from trace + reward + memory, improving NodeAgent's tool-use on a
**held-out** task split — *without* degrading evidence-grounding or tripping a safety gate?

## Success / exit criteria

v0 wins iff, on the held-out split, the nudge improves **≥1 of {pass@1, retry count, tool-error
rate, cost/task}** by a meaningful margin, **and** does not reduce source-backed-claim ratio or
deliverable-reopen rate, **and** violates no safety gate (below).

## Data — already exists (NodeRoom)

| Source | Path | Gives |
|---|---|---|
| Live-UI per-task receipts | `docs/eval/fresh-room/FR-020/tasks/<id>/latest.json` | state, uploaded/created artifacts, export+reopen, scorer verdict, boundary-box (citation) receipts, visual-judge verdict |
| Isolated-lane ledger | `docs/eval/loop-ledger/btb-ledger-import-full100-write.json` | per-task Gandalf reward, clean-generic-only flag, modelCalls, exceptions |
| Sweep summary | `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json` | per-task reward + clean-capability gate fields |
| Step traces | `docs/eval/bankertoolbench/live-room/<id>.json` + NodeTrace `CaptureStep[]` | per-step phase / action / observation / screenshot / box / ms |

**Honest scope:** this corpus is **completion + scoring** (FR-020B mean reward ≈ **0.25**; FR-020C
completion), **not** a pass rate — which is *why* it is good RL data: many real partial-success
trajectories with dense, verifiable per-step signals.

## The transition the policy learns over

`(state, action, observation, reward, next_state)` — see [`spec/trajectory-schema.md`](../spec/trajectory-schema.md).

### state `sₜ`
- **goal**: BTB prompt; required tickers/entities; expected deliverables (`.xlsx/.xlsm/.pptx/.docx/.pdf`)
- **room**: uploaded files, created artifacts, active artifact/cell
- **history**: last tool + result, last error `failureKind`, step index
- **memory**: NodeMem context-pack summary + any `failureMemory` pattern for this task family
- **budget**: tokens / cost / latency spent so far

### action `aₜ` — discrete, from the real tool registry
Canonical source: `src/nodeagent/skills/server/productionTools.ts` (`SERVER_PRODUCTION_TOOL_NAMES`).
v0 action set:

```
search | tavily_search | you_research | you_finance_research      # gather
sec_facts | capture_source | cite_in_file                         # evidence
define_columns | write_cells | set_artifact_meta | reconcile_cell # build
create_btb_deliverable_package                                    # emit
retry_tool | switch_model | ask_user | stop_and_finalize          # control
```

### reward `r` — from the real NodeEval signals ([`spec/reward-design.md`](../spec/reward-design.md))
Final (per trajectory):

```
R = 1.00·gandalf_reward          # official scorer, 0..1 (taskSuccess)
  + 0.40·deliverables_reopened   # export/reopen receipt
  + 0.40·evidence_grounded_ratio # supported / total boundary-box receipts
  + 0.20·visual_judge_pass       # Gemini media judge verdict
  + 0.25·no_clobber
  − 0.25·unsupported_claims
  − 0.20·repeated_tool_error
  − 0.15·missing_tool_args
  − 0.15·cost_over_budget
  − 0.15·latency_over_budget
  − 1.00·privacy_or_security_violation
```

Process (per step, where checkable): `+ source_captured & bbox_valid`, `+ tool_ok`;
`− args_missing`, `− repeated_failure`. (Dense process signal — see the credit-assignment thread in
the lit review: [ReBel 2605.20061](https://arxiv.org/abs/2605.20061).)

## Policy interface (the nudge)

```ts
policySuggestNextAction(state: BtbState): { action: BtbAction; rationale: string; confidence: number }
```

- **Black-box**: the base agent/model is unchanged; the policy is a thin re-ranker/selector over the
  action set (steer at test time, à la Agentic Monte Carlo).
- **Trained**: SFT on good trajectories (action sequences from high-reward tasks) + DPO on
  good-vs-bad pairs (same `state`, action → higher vs lower reward). LoRA/QLoRA on a small open model.

## Harness — baseline vs nudge

1. **Export** `(s,a,o,r)` JSONL from the data sources above.  *(net-new: NodeTrace JSONL exporter + reward-attach from receipts/ledger.)*
2. **Held-out split** — freeze a task split BEFORE training; never train on it.  *(reuse the `held-out-split.json` anchor from solo-founder `references/ralph-anchors.md`.)*
3. **Train v0 policy** (SFT + DPO, LoRA).  *(Inference.ai compute.)*
4. **Wire** `policySuggestNextAction` into the BTB runner as a **flag-gated** nudge (default off).  *(net-new, small.)*
5. **Run** baseline NodeAgent and NodeAgent+nudge on the held-out tasks — same models, same budgets.
6. **Score + report** via the existing gates (`benchmark:bankertoolbench:fullsuite-gate` / fresh-room receipts).

## Metrics (baseline vs nudge, held-out)

`pass@1` · `retry_count` · `tool_error_rate` · `cost/task ($)` · `latency/task` ·
`source_backed_claim_ratio` · `deliverable_reopen_rate`. Report reward **components separately** — no
single-number inflation.

## Safety / reward-hacking gates (non-optional)

- **Held-out only** — no eval-split leakage into training.
- **Budget caps + tool permissions + no foreground starvation** (the NodeRoom passive-intelligence
  lesson; cf. the ROME incident in the lit review).
- **Reward-hacking check**: did a metric rise via a shortcut (e.g., emitting a package with no
  evidence)? If so the reward is wrong — fix the reward, not the number.

## Exists vs net-new

| Piece | State |
|---|---|
| Trajectory corpus (100 tasks × 2 lanes) | ✅ exists |
| Action registry | ✅ exists (`productionTools.ts`) |
| Reward signals (scorer, evidence, visual, export/reopen, cost) | ✅ exists (gates + judges) |
| `(s,a,o,r)` JSONL exporter | ⚠️ net-new (small) |
| v0 policy training (SFT/DPO LoRA) | ⚠️ net-new (Inference.ai) |
| nudge wiring in the runner | ⚠️ net-new (flag-gated) |
| held-out run + comparison report | ✅ harness exists; wire the A/B |

## The ask to Inference.ai (scoped)

Not "train a giant model." Compute + support to train a **small policy adapter** from real
trajectories and measure pass@1 / retries / tool-error / cost on the held-out BTB split — baseline
vs nudge. SFT first, DPO on pairs, RLVR only where verifiable.
