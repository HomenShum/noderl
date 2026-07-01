// Deterministic accounting oracle: bank reconciliation.
//
// This is a DETERMINISTIC accounting oracle — part of the official scorer for the
// accounting proofloop. `verifyBankReconciliation` is a PURE function of its input:
//   - NO Date.now / new Date / Math.random / clocks / IO / LLM calls.
//   - Given the same input, it always returns the identical VerifierResult.
//
// It emits a list of named OracleCheck and aggregates them with `summarize`, so the
// pass/fail and score are computed deterministically upstream.
//
// TOLERANCE (documented, domain-specific):
//   Monetary amounts are compared with a half-cent tolerance: two amounts are
//   "equal to the cent" iff Math.abs(a - b) <= CENT_TOLERANCE, with
//   CENT_TOLERANCE = 0.005. This absorbs float representation error (e.g. 100.00
//   vs 100.004999…) without masking a real 1-cent discrepancy (a full 0.01 delta
//   fails the tie). The tolerance lives here because it is a property of the
//   money domain, not of the summarizer.
import { type OracleCheck, type VerifierResult, summarize } from "./oracleTypes";

/** Half a cent: the documented monetary tie tolerance (see file header). */
export const CENT_TOLERANCE = 0.005;

/** True iff `a` and `b` are equal within the documented half-cent tolerance. */
function equalToTheCent(a: number, b: number): boolean {
  return Math.abs(a - b) <= CENT_TOLERANCE;
}

/** Fixed 2-decimal rendering for stable, deterministic detail strings. */
function money(n: number): string {
  // Avoid "-0.00" so identical inputs always render identically.
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(2);
}

/** One line of a proposed journal entry. Absent side defaults to 0. */
export interface JournalLine {
  debit?: number;
  credit?: number;
}

/** A proposed journal entry: a set of debit/credit lines that must balance. */
export interface JournalEntry {
  lines: JournalLine[];
}

/**
 * A reconciliation item (matched or unmatched). Only its presence and amount
 * matter to the oracle; callers may attach whatever else they like.
 */
export interface ReconciliationItem {
  amount?: number;
  [k: string]: unknown;
}

/** Input to the bank-reconciliation oracle. */
export interface BankReconciliationInput {
  /** Ending balance per the bank statement. */
  bankEndingBalance: number;
  /** Ending balance per the company's general ledger (book cash). */
  ledgerEndingBalance: number;
  /** Items successfully matched between bank and ledger. */
  matched: ReconciliationItem[];
  /** Reconciling items present on one side but not (yet) the other. */
  unmatched: ReconciliationItem[];
  /** Proposed adjusting journal entries; each must have debits == credits. */
  journalEntries: JournalEntry[];
}

function sumSide(lines: JournalLine[], side: "debit" | "credit"): number {
  let total = 0;
  for (const line of lines) {
    const v = side === "debit" ? line.debit : line.credit;
    total += typeof v === "number" ? v : 0;
  }
  return total;
}

function sumUnmatched(items: ReconciliationItem[]): number {
  let total = 0;
  for (const item of items) {
    total += typeof item.amount === "number" ? item.amount : 0;
  }
  return total;
}

/**
 * Verify a bank reconciliation, deterministically.
 *
 * Checks emitted (in a fixed, stable order):
 *  1. `ending_cash_tie` — the reconciled ending cash ties to the bank ending
 *     balance within tolerance. Reconciled ending cash = ledger ending balance
 *     adjusted by the net of the unmatched reconciling items
 *     (ledgerEndingBalance + sum(unmatched.amount)). This is the classic
 *     "adjusted book balance == adjusted bank balance" tie.
 *  2. `partition_covers_all_items` — matched and unmatched partition every item
 *     with no overlap: matched.length + unmatched.length === total item count,
 *     and (since the two arrays are the item universe here) this is a structural
 *     coverage check — there are no items outside the two buckets and the counts
 *     are non-negative. A NaN/negative count would fail.
 *  3. `je_<i>_balanced` — for each proposed journal entry i, debits == credits
 *     within tolerance. One check per entry so a single bad JE is named exactly.
 *
 * Returns `summarize("bankReconciliation", checks)`.
 */
export function verifyBankReconciliation(input: BankReconciliationInput): VerifierResult {
  const checks: OracleCheck[] = [];

  // --- Check 1: ending-cash tie ---
  // Reconciled ending cash = book (ledger) ending balance + net unmatched
  // reconciling items. It must tie to the bank ending balance within tolerance.
  const netUnmatched = sumUnmatched(input.unmatched);
  const reconciledEndingCash = input.ledgerEndingBalance + netUnmatched;
  const tieDelta = reconciledEndingCash - input.bankEndingBalance;
  const tiePassed = equalToTheCent(reconciledEndingCash, input.bankEndingBalance);
  checks.push({
    name: "ending_cash_tie",
    passed: tiePassed,
    detail: tiePassed
      ? `reconciled ending cash ${money(reconciledEndingCash)} == bank ending balance ${money(
          input.bankEndingBalance,
        )} (|delta| ${money(Math.abs(tieDelta))} <= ${CENT_TOLERANCE})`
      : `reconciled ending cash ${money(reconciledEndingCash)} != bank ending balance ${money(
          input.bankEndingBalance,
        )} (|delta| ${money(Math.abs(tieDelta))} > ${CENT_TOLERANCE}); ` +
        `ledger ${money(input.ledgerEndingBalance)} + net unmatched ${money(netUnmatched)}`,
  });

  // --- Check 2: matched + unmatched partition covers all items ---
  // The two buckets ARE the item universe; a valid partition has non-negative,
  // finite counts and their sum equals the total. This rejects malformed inputs
  // (e.g. a non-array coerced to NaN length) rather than silently passing.
  const matchedCount = Array.isArray(input.matched) ? input.matched.length : NaN;
  const unmatchedCount = Array.isArray(input.unmatched) ? input.unmatched.length : NaN;
  const totalCount = matchedCount + unmatchedCount;
  const partitionPassed =
    Number.isInteger(matchedCount) &&
    Number.isInteger(unmatchedCount) &&
    matchedCount >= 0 &&
    unmatchedCount >= 0 &&
    matchedCount + unmatchedCount === totalCount;
  checks.push({
    name: "partition_covers_all_items",
    passed: partitionPassed,
    detail: partitionPassed
      ? `matched ${matchedCount} + unmatched ${unmatchedCount} = ${totalCount} items, no overlap or gap`
      : `invalid partition: matched=${String(matchedCount)}, unmatched=${String(
          unmatchedCount,
        )} (counts must be non-negative integers summing to the total)`,
  });

  // --- Check 3..N: each proposed JE has debits == credits ---
  const entries = Array.isArray(input.journalEntries) ? input.journalEntries : [];
  for (let i = 0; i < entries.length; i += 1) {
    const lines = Array.isArray(entries[i]?.lines) ? entries[i].lines : [];
    const debits = sumSide(lines, "debit");
    const credits = sumSide(lines, "credit");
    const jeDelta = debits - credits;
    const jePassed = equalToTheCent(debits, credits);
    checks.push({
      name: `je_${i}_balanced`,
      passed: jePassed,
      detail: jePassed
        ? `JE ${i}: debits ${money(debits)} == credits ${money(credits)} (|delta| ${money(
            Math.abs(jeDelta),
          )} <= ${CENT_TOLERANCE})`
        : `JE ${i}: debits ${money(debits)} != credits ${money(credits)} (|delta| ${money(
            Math.abs(jeDelta),
          )} > ${CENT_TOLERANCE})`,
    });
  }

  return summarize("bankReconciliation", checks);
}
