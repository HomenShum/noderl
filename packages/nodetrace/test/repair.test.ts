/**
 * repair.test.ts — the REPAIR stage over the accounting fresh-room fixture (one failing assertion +
 * one needs_review evidence). Verifies the repair prompt grounds every claim in the trace, the
 * regression case captures the real failure, and both are deterministic. Run: tsx test/repair.test.ts
 */
import assert from "node:assert/strict";
import { mergeTrajectory } from "../src/merged";
import { generateRepairPrompt, toRegressionCase } from "../src/repair";
import {
  accountingOuter,
  accountingInner,
  accountingArtifacts,
  accountingEvidence,
  accountingMeta,
} from "./merged.fixture";

let pass = 0, fail = 0;
function scenario(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const t = mergeTrajectory(accountingInner, accountingOuter, accountingArtifacts, accountingEvidence, accountingMeta);

scenario("(a) GROUND-TRUTH — prompt names the failing assertion + observed delta, not a guess", () => {
  const p = generateRepairPrompt(t);
  assert.match(p, /Bank reconciliation for March/);
  assert.match(p, /assert-ending-cash-ties/);
  assert.match(p, /412\.50/); // the real observed delta from the trace
  assert.match(p, /verdict: \*\*FAIL\*\*/);
});

scenario("(b) EVIDENCE-GATE — needs_review claim surfaces as must-resolve, never silently accepted", () => {
  const p = generateRepairPrompt(t);
  assert.match(p, /needs_review/);
  assert.match(p, /Check #1042/); // the unsourced claim must be shown for resolution
});

scenario("(c) REGRESSION — a promotable regression case captures the real failure", () => {
  const rc = toRegressionCase(t);
  assert.ok(rc.failedAssertions.some((a) => a.id === "assert-ending-cash-ties"), "failed assertion captured");
  assert.ok(rc.failureCategories.includes("ui_assertion_failed"), "failure category present");
  assert.ok(rc.needsReviewClaims.some((c) => /1042/.test(c)), "needs_review claim captured");
  assert.match(rc.expectation, /must make these 1 assertion\(s\) pass/);
  // the regression is embedded in the prompt as valid JSON
  const p = generateRepairPrompt(t);
  const json = p.slice(p.indexOf("```json") + 7, p.lastIndexOf("```")).trim();
  assert.deepEqual(JSON.parse(json).id, rc.id);
});

scenario("(d) NO-FABRICATION — prompt asks for the smallest fix; it does not invent one", () => {
  const p = generateRepairPrompt(t);
  assert.match(p, /SMALLEST shared fix/);
  assert.match(p, /do not fabricate/i);
});

scenario("(e) DETERMINISM — same trajectory => byte-identical repair prompt + regression", () => {
  assert.equal(generateRepairPrompt(t), generateRepairPrompt(t));
  assert.equal(JSON.stringify(toRegressionCase(t)), JSON.stringify(toRegressionCase(t)));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
