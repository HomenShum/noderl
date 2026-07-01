# Accounting benchmarks — verified & pinned (PROVE-BEFORE-CLAIM)

> The external finance/accounting benchmarks the accounting proofloop may pressure-test against.
> Every entry below was **verified to exist** via web search on 2026-07-01 (arxiv id resolves + a
> code/dataset or paper page). ChatGPT-supplied names that did NOT resolve are flagged and excluded —
> an unverified benchmark is not a pinned dependency (see `PROOFLOOP-FAILURE-SIGNALS.md`).

## Verified (usable as external pressure tests)

| Benchmark | arxiv | What it tests | Maps to our oracle |
|---|---|---|---|
| **Finch** | [2512.13168](https://arxiv.org/abs/2512.13168) | Enterprise finance/accounting across messy spreadsheets/PDFs/emails — 172 workflows, 384 tasks, 1,710 sheets, 27M cells. Frontier bar: GPT‑5.1 Pro ~38.4% pass. Code+dataset: FinWorkBench/Finch. | the whole fresh-room spreadsheet flow |
| **FinBalance** | [2606.15949](https://arxiv.org/html/2606.15949) | **Multi-document accounting *reconciliation*** — direct match. | `bankReconciliation` oracle |
| **FinRule-Bench** | [2603.11339](https://arxiv.org/abs/2603.11339) | Rule-based reasoning over Balance Sheet / Cash Flow / Income / Equity with **deterministic validators**. | `trialBalance`, `cashFlowIndirect` oracles |
| **FinAuditing** | [2510.08886](https://arxiv.org/abs/2510.08886) | US-GAAP XBRL multi-document consistency (semantic/relational/numerical). Code: The-FinAI/FinAuditing. | XBRL/GAAP layer (future) |
| **Fin-RATE** | [2602.07294](https://arxiv.org/abs/2602.07294) | SEC-filing analyst workflows: single-disclosure, cross-entity, longitudinal (KDD'26). | SEC longitudinal layer (future) |
| **WorkstreamBench** | [2605.22664](https://arxiv.org/html/2605.22664v1) | LLM agents on end-to-end finance **spreadsheet** tasks. | fresh-room spreadsheet flow |
| **TAT-QA** | [2105.07624](https://arxiv.org/abs/2105.07624) | Table + text numerical reasoning in financial reports (well-established, 2021). | table/text QA layer |

## Excluded — NOT verified

| Claimed name | Claimed id | Status |
|---|---|---|
| **FinVerBench** | `2605.29586` | **Not found.** ChatGPT-supplied; the real analog is **FinBen** ([2402.12659](https://arxiv.org/abs/2402.12659)). Do not cite/pin until confirmed. |

## Pinning rule

Before wiring any of these into the accounting proofloop as a scored dependency: pin `{arxiv id (resolved),
dataset slug/commit, license, sha256 of the fetched split}`. No `latest`. Kaggle datasets follow the same
rule. The **verified deterministic** benchmarks (FinBalance, FinRule-Bench) are the best first adapters
because our Layer-A oracles (`packages/nodeeval/src/accounting/`) already encode the same tie-out checks —
run our oracle as the scorer, use the benchmark's tasks as inputs.
