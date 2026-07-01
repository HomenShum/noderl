// Shared oracle result types for the accounting verifiers.
//
// These are the DETERMINISTIC accounting oracles — the official scorer for the
// accounting proofloop. Everything here is a PURE function of its inputs:
//   - NO Date.now / new Date / Math.random / clocks / IO / LLM calls.
//   - Given the same checks, `summarize` always returns the same VerifierResult.
//
// Downstream verifiers do the exact rational/integer arithmetic over the domain
// inputs (balances, debits/credits, cents) and emit a list of OracleCheck. When
// comparing floats, callers should use a cents-tolerance for ties, e.g.
//   const equalToTheCent = Math.abs(a - b) <= 0.005;  // half a cent
// so that 100.00 and 100.004999… are treated as equal. That tolerance lives in
// each verifier (it is domain-specific); this module only aggregates the boolean
// pass/fail results deterministically.

/** A single named assertion produced by a verifier. */
export interface OracleCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** Aggregate result for one verifier over its list of checks. */
export interface VerifierResult {
  verifier: string;
  /** True iff EVERY check passed (vacuously true when there are no checks). */
  passed: boolean;
  checks: OracleCheck[];
  /**
   * Ratio of passed checks to total checks, in [0, 1].
   * score = passedChecks / totalChecks.
   * With zero checks the ratio is 0/0; by convention we report 1 (nothing failed).
   */
  score: number;
}

/**
 * Aggregate a verifier's checks into a VerifierResult.
 *
 * Deterministic and pure: `passed` is the logical AND of every check, `score` is
 * the exact passed/total ratio. No wall-clock, randomness, or ordering surprises —
 * the checks array is copied verbatim (same order in, same order out).
 */
export function summarize(verifier: string, checks: OracleCheck[]): VerifierResult {
  const total = checks.length;
  let passedChecks = 0;
  for (const check of checks) {
    if (check.passed) passedChecks += 1;
  }
  const passed = passedChecks === total; // all passed (true when total === 0)
  // 0/0 is reported as 1 (a verifier with no checks has failed nothing).
  const score = total === 0 ? 1 : passedChecks / total;
  return {
    verifier,
    passed,
    checks: checks.slice(), // defensive copy: callers can't mutate our snapshot
    score,
  };
}
