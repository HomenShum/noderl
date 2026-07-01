// Deterministic accounting oracle: journalEntry.
//
// This is a DETERMINISTIC accounting oracle — part of the official scorer for the
// accounting proofloop. It is a PURE function of its input:
//   - NO Date.now / new Date / Math.random / clocks / IO / LLM calls.
//   - Given the same input, verifyJournalEntries always returns the same result.
//
// It checks the three fundamental invariants of a set of double-entry journal
// entries:
//   1. balances        — for every entry, sum(debits) == sum(credits).
//   2. accounts_exist   — every accountId referenced by a line exists in the
//                         provided chart of accounts.
//   3. no_negative      — no line has a negative debit or credit amount.
//
// TOLERANCE (documented):
//   Debits/credits are real dollar amounts that can arrive as floats (e.g.
//   100.10 + 200.20 !== 300.30 exactly in IEEE-754). We compare the per-entry
//   debit and credit totals with a half-cent tolerance:
//       Math.abs(debitTotal - creditTotal) <= CENTS_TOLERANCE   // 0.005
//   so 300.30 and 300.30000000000004 are treated as balanced, while any real
//   imbalance of a full cent or more (delta >= 0.01) fails. The negative-amount
//   check uses the same half-cent tolerance for its zero-floor so that a value
//   like -0.0000001 (float noise) is not spuriously flagged, while -0.01 is.

import { type OracleCheck, summarize, type VerifierResult } from "./oracleTypes";

/** Half a cent. Any float delta at or below this is treated as an exact tie. */
export const CENTS_TOLERANCE = 0.005;

/** One line of a journal entry: a debit and/or credit against an account. */
export interface JournalLine {
  accountId: string;
  debit: number;
  credit: number;
}

/** A single journal entry: a set of lines that must net to zero (debits==credits). */
export interface JournalEntryInput {
  lines: JournalLine[];
}

/** Full verifier input: the chart of accounts + the entries to check. */
export interface JournalEntriesInput {
  /** The valid account ids (the chart of accounts). */
  chart: string[];
  entries: JournalEntryInput[];
}

/** Round to cents for stable, human-readable detail strings (not used for the pass/fail decision). */
function toCents(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Verify a set of double-entry journal entries against a chart of accounts.
 *
 * Emits one OracleCheck per invariant per entry (plus a line-level negative check),
 * then aggregates via `summarize`. Deterministic: the checks are produced in a
 * fixed order (entry index ascending, then line index ascending) with no clock,
 * randomness, or IO.
 */
export function verifyJournalEntries(input: JournalEntriesInput): VerifierResult {
  const checks: OracleCheck[] = [];

  // Build a Set for O(1) membership; the chart is the source of truth.
  const chartSet = new Set(input.chart);

  input.entries.forEach((entry, ei) => {
    let debitTotal = 0;
    let creditTotal = 0;

    entry.lines.forEach((line, li) => {
      debitTotal += line.debit;
      creditTotal += line.credit;

      // Invariant 2: the referenced account exists in the chart of accounts.
      checks.push({
        name: `accounts_exist[entry ${ei}][line ${li}]`,
        passed: chartSet.has(line.accountId),
        detail: chartSet.has(line.accountId)
          ? `account "${line.accountId}" exists in chart`
          : `account "${line.accountId}" NOT in chart of accounts`,
      });

      // Invariant 3: no negative amounts (debit or credit). A value below the
      // negative half-cent floor is a real negative; float noise near zero passes.
      const debitNegative = line.debit < -CENTS_TOLERANCE;
      const creditNegative = line.credit < -CENTS_TOLERANCE;
      const noNegative = !debitNegative && !creditNegative;
      checks.push({
        name: `no_negative[entry ${ei}][line ${li}]`,
        passed: noNegative,
        detail: noNegative
          ? `amounts non-negative (debit ${toCents(line.debit)}, credit ${toCents(line.credit)})`
          : `negative amount on account "${line.accountId}" (debit ${toCents(line.debit)}, credit ${toCents(line.credit)})`,
      });
    });

    // Invariant 1: the entry balances — debits == credits within tolerance.
    const delta = Math.abs(debitTotal - creditTotal);
    const balanced = delta <= CENTS_TOLERANCE;
    checks.push({
      name: `balances[entry ${ei}]`,
      passed: balanced,
      detail: balanced
        ? `debits ${toCents(debitTotal)} == credits ${toCents(creditTotal)} (delta ${toCents(delta)} <= ${CENTS_TOLERANCE})`
        : `debits ${toCents(debitTotal)} != credits ${toCents(creditTotal)} (delta ${toCents(delta)} > ${CENTS_TOLERANCE})`,
    });
  });

  return summarize("journalEntry", checks);
}
