=== REPAIR PROMPT ===

# Repair prompt — Reconcile bank statement ($12,540.75) vs GL ($12,128.25) with one outstanding check #1042 ($412.50), showing the math.

- trajectory: `fr-a1-bank-reconciliation-live`  ·  run: `fr-a1-bank-reconciliation-live`
- verdict: **FAIL**  ·  total reward: 0.238
- failure categories: ui_assertion_failed, evidence_needs_review

## What failed (ground truth — do NOT guess)
- **assert-shows-math** — expected: answer shows the derivation ($12,540.75 - $412.50 = $12,128.25) · observed: no arithmetic shown anywhere in the response; conclusion is asserted, not derived
- **assert-evidence-grounded-in-users-numbers** — expected: citations support the user's specific reconciliation, not generic process explainers · observed: 5/5 citations are generic 'how to reconcile' web articles (superfastcpa.com, reliabills.com, sage.com, help.acst.com, ledge.co); 2/5 flagged PROVIDER_GROUNDED_UNMATCHED

## Evidence
- screenshots: (none)
- **needs_review (unsourced) claims — resolve with a real source or drop:**
  - Citation 1 (superfastcpa.com) provider-grounded-unmatched

## Your task
1. Trace each failed assertion to its root cause (read the failing step + artifact; do not fabricate).
2. Propose the SMALLEST shared fix that makes the failed assertion(s) pass — never a per-task patch.
3. Resolve every needs_review claim with a real source, or remove it.
4. Add the regression below so this failure cannot silently return.

## Regression to add
```json
{
  "id": "regression_fr-a1-bank-reconciliation-live",
  "fromTrajectory": "fr-a1-bank-reconciliation-live",
  "userGoal": "Reconcile bank statement ($12,540.75) vs GL ($12,128.25) with one outstanding check #1042 ($412.50), showing the math.",
  "failedAssertions": [
    {
      "id": "assert-shows-math",
      "expected": "answer shows the derivation ($12,540.75 - $412.50 = $12,128.25)",
      "observed": "no arithmetic shown anywhere in the response; conclusion is asserted, not derived",
      "passed": false
    },
    {
      "id": "assert-evidence-grounded-in-users-numbers",
      "expected": "citations support the user's specific reconciliation, not generic process explainers",
      "observed": "5/5 citations are generic 'how to reconcile' web articles (superfastcpa.com, reliabills.com, sage.com, help.acst.com, ledge.co); 2/5 flagged PROVIDER_GROUNDED_UNMATCHED",
      "passed": false
    }
  ],
  "failureCategories": [
    "ui_assertion_failed",
    "evidence_needs_review"
  ],
  "needsReviewClaims": [
    "Citation 1 (superfastcpa.com) provider-grounded-unmatched"
  ],
  "expectation": "Re-running \"Reconcile bank statement ($12,540.75) vs GL ($12,128.25) with one outstanding check #1042 ($412.50), showing the math.\" must make these 2 assertion(s) pass: assert-shows-math, assert-evidence-grounded-in-users-numbers"
}
```

=== REGRESSION CASE (JSON) ===

{
  "id": "regression_fr-a1-bank-reconciliation-live",
  "fromTrajectory": "fr-a1-bank-reconciliation-live",
  "userGoal": "Reconcile bank statement ($12,540.75) vs GL ($12,128.25) with one outstanding check #1042 ($412.50), showing the math.",
  "failedAssertions": [
    {
      "id": "assert-shows-math",
      "expected": "answer shows the derivation ($12,540.75 - $412.50 = $12,128.25)",
      "observed": "no arithmetic shown anywhere in the response; conclusion is asserted, not derived",
      "passed": false
    },
    {
      "id": "assert-evidence-grounded-in-users-numbers",
      "expected": "citations support the user's specific reconciliation, not generic process explainers",
      "observed": "5/5 citations are generic 'how to reconcile' web articles (superfastcpa.com, reliabills.com, sage.com, help.acst.com, ledge.co); 2/5 flagged PROVIDER_GROUNDED_UNMATCHED",
      "passed": false
    }
  ],
  "failureCategories": [
    "ui_assertion_failed",
    "evidence_needs_review"
  ],
  "needsReviewClaims": [
    "Citation 1 (superfastcpa.com) provider-grounded-unmatched"
  ],
  "expectation": "Re-running \"Reconcile bank statement ($12,540.75) vs GL ($12,128.25) with one outstanding check #1042 ($412.50), showing the math.\" must make these 2 assertion(s) pass: assert-shows-math, assert-evidence-grounded-in-users-numbers"
}
