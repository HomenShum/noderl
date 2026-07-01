/**
 * Fixture — a realistic ACCOUNTING FRESH-ROOM merged trajectory.
 *
 * Persona: "Dana", a staff accountant who opens a fresh NodeRoom to do the March bank reconciliation.
 * Her NodeAgent loads the bank statement + GL export, builds a `reconciliation.xlsx` artifact, and the
 * outer UI proof screenshots the room before/during/after and asserts the reconciliation tab is visible.
 *
 * This is an HONEST fixture, not a perfect one:
 *  - The "ending cash ties" UI assertion FAILS (passed:false) — the reconciled ending cash did not tie to
 *    the bank statement (a $412.50 unexplained delta). The merge carries that failure verbatim.
 *  - One evidence fact ("uncleared check #1042") is `needs_review` — we could not source it to a document.
 * These are exactly the signals the RL/eval layer wants; the fixture does not paper over them.
 *
 * The inner steps cover plan -> tool(findDocument) -> write(sheet) -> verify, each with costUsd/latencyMs.
 * No reward is supplied here (mergeTrajectory leaves reward undefined) — the test that wants a reward
 * supplies one explicitly, so the fixture stays a pure record of what happened.
 */
import type {
  InnerTraceInput,
  OuterTraceInput,
  MergedArtifact,
  MergedEvidence,
  MergeMeta,
} from "../src/merged";

/** The OUTER UI proof: room URL, 3 screenshots (before/during/after), 3 UI assertions (one failing). */
export const accountingOuter: OuterTraceInput = {
  url: "https://noderoom.live/room/RC-MAR-RECON-8271",
  screenshots: [
    {
      label: "before",
      path: "runs/RC-MAR-RECON-8271/outer/before.png",
      visibleComponentIds: ["room-shell", "empty-artifact-tabs", "composer"],
    },
    {
      label: "during",
      path: "runs/RC-MAR-RECON-8271/outer/during.png",
      visibleComponentIds: ["reconciliation-sheet", "sheet-tab-reconciliation", "agent-thinking"],
    },
    {
      label: "after",
      path: "runs/RC-MAR-RECON-8271/outer/after.png",
      visibleComponentIds: ["reconciliation-sheet", "sheet-tab-exceptions", "ending-cash-cell"],
    },
  ],
  consoleErrors: [],
  uiAssertions: [
    {
      id: "assert-recon-tab-visible",
      expected: "a sheet tab labeled 'reconciliation.xlsx' is rendered in the work surface",
      observed: "tab 'reconciliation.xlsx' present and active",
      passed: true,
    },
    {
      id: "assert-exceptions-tab-present",
      expected: "an 'exceptions' tab lists uncleared/unmatched items",
      observed: "tab 'exceptions' present with 2 rows",
      passed: true,
    },
    {
      id: "assert-ending-cash-ties",
      expected: "reconciled ending cash equals the bank statement ending balance (delta = 0.00)",
      observed: "reconciled ending cash is off by 412.50 vs bank statement",
      passed: false,
    },
  ],
};

/** The INNER agent trace: plan -> tool(findDocument) -> write(sheet) -> verify, with cost + latency. */
export const accountingInner: InnerTraceInput = {
  model: "glm-5.2",
  steps: [
    {
      stepIndex: 0,
      phase: "plan",
      action: "Draft a 3-step reconciliation plan: locate March bank statement + GL cash export, build a matched-ledger sheet, then verify the ending balance ties.",
      observation: "Plan accepted; two source documents are expected in the room's attachments.",
      costUsd: 0.0012,
      latencyMs: 640,
    },
    {
      stepIndex: 1,
      phase: "tool",
      action: "Call findDocument to locate the March bank statement and the GL cash export in the room attachments.",
      observation: "Found 'bank-statement-march.pdf' and 'gl-cash-march.csv'; both attached to room RC-MAR-RECON-8271.",
      toolName: "findDocument",
      evidenceRefs: ["fact-bank-ending-balance", "fact-gl-ending-cash"],
      costUsd: 0.0031,
      latencyMs: 1180,
    },
    {
      stepIndex: 2,
      phase: "write",
      action: "Write reconciliation.xlsx: import both sources, match cleared items by amount+date, list unmatched items on an exceptions tab.",
      observation: "Sheet created with 84 matched rows and 2 exceptions; ending-cash formula wired to the reconciliation tab.",
      toolName: "writeSheet",
      artifactRefs: ["artifact-reconciliation-xlsx"],
      evidenceRefs: ["fact-uncleared-check-1042"],
      costUsd: 0.0074,
      latencyMs: 2960,
    },
    {
      stepIndex: 3,
      phase: "verify",
      action: "Verify reconciled ending cash equals the bank statement ending balance and re-open the exported sheet.",
      observation: "Reopen OK, but ending cash is off by 412.50 — one exception (check #1042) is unsourced; flagged for review rather than forced to tie.",
      artifactRefs: ["artifact-reconciliation-xlsx"],
      evidenceRefs: ["fact-uncleared-check-1042"],
      costUsd: 0.0019,
      latencyMs: 900,
    },
  ],
};

/** The ARTIFACT produced: the reconciliation sheet, exported and re-opened successfully. */
export const accountingArtifacts: MergedArtifact[] = [
  {
    artifactId: "artifact-reconciliation-xlsx",
    kind: "sheet",
    beforeHash: "fnv:00000000",
    afterHash: "fnv:9c1e77a3",
    exportPath: "runs/RC-MAR-RECON-8271/artifacts/reconciliation.xlsx",
    reopenPassed: true,
  },
];

/** The EVIDENCE facts: 2 source_backed, 1 needs_review (the unsourced uncleared check). */
export const accountingEvidence: MergedEvidence[] = [
  {
    factId: "fact-bank-ending-balance",
    claim: "March bank statement ending balance is 128,540.75",
    sourceUrl: "attachment://bank-statement-march.pdf#p3",
    quote: "Ending balance as of March 31: $128,540.75",
    status: "source_backed",
  },
  {
    factId: "fact-gl-ending-cash",
    claim: "GL cash account ending balance for March is 128,128.25",
    sourceUrl: "attachment://gl-cash-march.csv",
    quote: "1000-Cash,03/31,,,128128.25",
    status: "source_backed",
  },
  {
    factId: "fact-uncleared-check-1042",
    claim: "Check #1042 for 412.50 is uncleared and explains the reconciliation delta",
    status: "needs_review",
  },
];

/** Merge-level metadata. No reward supplied — the fixture is a pure record; tests add reward explicitly. */
export const accountingMeta: MergeMeta = {
  runId: "RC-MAR-RECON-8271",
  userGoal: "Bank reconciliation for March",
};
