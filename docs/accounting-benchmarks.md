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

## Kaggle datasets — verified via live browser (not just search snippet)

> Search results can hallucinate; the discipline here is the same as the arxiv table above. Each row
> below was opened live in a real browser on 2026-07-01 and its actual Data Card / Data Explorer stats
> (rows, columns, file size, usability score, download count) were read from the rendered page, not
> just a search-result title.

| Dataset | URL | Verified stats | Maps to |
|---|---|---|---|
| **Bank Reconciliation Statement** | [kaggle.com/datasets/fozianazar/bank-reconciliation-statement](https://www.kaggle.com/datasets/fozianazar/bank-reconciliation-statement) | 26.52 KB xlsx, 5 sheets (Bank Reconciliation Statement 19×8, Bank Statement 23×6, Company Cashbook 16×8, W-1 34×12, W-2 12×12). Usability 4.12, 1,222 downloads, 6,155 views. Worked example with a known-correct reconciliation. | `bankReconciliation` oracle — real worked-example ground truth, directly usable as accept-good fixture data (same shape as FR-A1). |
| **General Ledger (Financial data set)** | [kaggle.com/datasets/irfansharif/generalledger](https://www.kaggle.com/datasets/irfansharif/generalledger) | 2.1 MB xlsx, 37 columns. Usability 2.94 (no description on the page), 3,746 downloads, 19.5K views. | `trialBalance` oracle — GL-shaped data for FR-A2/A3 scenarios. |
| **Synthetic Financial Accounting Dataset** | [kaggle.com/datasets/redfaction95/synthetic-financial-accounting-dataset](https://www.kaggle.com/datasets/redfaction95/synthetic-financial-accounting-dataset) | 27.04 MB CSV, ~533K rows, 10 columns. SAP-ERP journal-entry schema (BELNR/BUKRS/BSCHL/HKONT/PRCTR/WAERS/KTOSL/DMBTR/WRBTR — document number, company code, posting key, GL account, profit center, currency, GL account key, local/document amount). Usability 2.35, 281 downloads. | `journalEntry` oracle at scale — large enough to sample many synthetic journal-entry pairs for oracle stress-testing, not just single worked examples. |

Not yet pinned to a specific version/sha256 (per the rule below) — these are recorded as **verified-real
candidates**, not yet wired as scored dependencies.

## Pinning rule

Before wiring any of these into the accounting proofloop as a scored dependency: pin `{arxiv id (resolved),
dataset slug/commit, license, sha256 of the fetched split}`. No `latest`. Kaggle datasets follow the same
rule. The **verified deterministic** benchmarks (FinBalance, FinRule-Bench) are the best first adapters
because our Layer-A oracles (`packages/nodeeval/src/accounting/`) already encode the same tie-out checks —
run our oracle as the scorer, use the benchmark's tasks as inputs.
