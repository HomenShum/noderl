import { mergeTrajectory } from "../../packages/nodetrace/src/merged.ts";
import { generateRepairPrompt, toRegressionCase } from "../../packages/nodetrace/src/repair.ts";

const outer = {
  url: "https://www.nodebenchai.com/redesign/chat",
  screenshots: [],
  consoleErrors: [],
  uiAssertions: [
    { id: "assert-correct-tie-out", expected: "answer states the correct tied-out amount ($12,128.25)", observed: "\"tie out exactly at $12,128.25 after adjusting for the outstanding check\"", passed: true },
    { id: "assert-shows-math", expected: "answer shows the derivation ($12,540.75 - $412.50 = $12,128.25)", observed: "no arithmetic shown anywhere in the response; conclusion is asserted, not derived", passed: false },
    { id: "assert-evidence-grounded-in-users-numbers", expected: "citations support the user's specific reconciliation, not generic process explainers", observed: "5/5 citations are generic 'how to reconcile' web articles (superfastcpa.com, reliabills.com, sage.com, help.acst.com, ledge.co); 2/5 flagged PROVIDER_GROUNDED_UNMATCHED", passed: false },
  ],
};
const inner = {
  model: "kimi-k2.6",
  steps: [
    { phase: "plan", action: "classify_query", observation: "classification: company_search . Bank (misrouted -- no accounting/calculation intent category exists)", costUsd: 0.0002, latencyMs: 0 },
    { phase: "tool", action: "fallback_source_search", toolName: "linkup_search", observation: "5 Linkup source results (generic reconciliation-process articles)", costUsd: 0.0005, latencyMs: 2400 },
    { phase: "verify", action: "bind_evidence", observation: "5 citations from 0 Gemini chunks + 5 fallback sources; 2 PROVIDER_GROUNDED_UNMATCHED", costUsd: 0, latencyMs: 0 },
    { phase: "final", action: "assemble_answer_packet", observation: "SHORT ANSWER: ties out at $12,128.25 (correct number, no shown derivation)", costUsd: 0.0003, latencyMs: 7400 },
  ],
};
const meta = {
  runId: "fr-a1-bank-reconciliation-live",
  userGoal: "Reconcile bank statement ($12,540.75) vs GL ($12,128.25) with one outstanding check #1042 ($412.50), showing the math.",
  trajectoryId: "fr-a1-bank-reconciliation-live",
  reward: { taskCompletion: 0.5, uiStateCorrectness: 0.5, evidenceGrounding: 0.2 },
};

const t = mergeTrajectory(inner, outer, [], [
  { factId: "final-answer-correct", claim: "Final reconciled amount stated as $12,128.25", status: "manual" },
  { factId: "evidence-ungrounded-1", claim: "Citation 1 (superfastcpa.com) provider-grounded-unmatched", status: "needs_review" },
], meta);

console.log("=== REPAIR PROMPT ===\n");
console.log(generateRepairPrompt(t));
console.log("\n=== REGRESSION CASE (JSON) ===\n");
console.log(JSON.stringify(toRegressionCase(t), null, 2));
