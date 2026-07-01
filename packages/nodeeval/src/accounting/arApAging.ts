// Deterministic AR/AP aging oracle — the official scorer for the accounting
// proofloop's aging-schedule task.
//
// This is a PURE function of its inputs:
//   - NO Date.now / new Date / Math.random / clocks / IO / LLM calls.
//   - Dates arrive as YYYY-MM-DD strings and are converted to an integer day
//     count with a fixed proleptic-Gregorian day-number formula (no `Date`),
//     so the same input ALWAYS produces the same VerifierResult.
//
// What it verifies about an aging schedule ({ asOf, invoices, buckets }):
//   1. bucket_partition   — every invoice lands in EXACTLY ONE bucket by its
//                           daysOverdue = asOf - dueDate (0-30 / 31-60 / 61-90 / 90+).
//                           No invoice is dropped; no invoice is double-counted.
//   2. bucket_sums_total  — sum of the per-bucket amounts == total outstanding
//                           (the sum of every invoice amount), to the cent.
//   3. reserve_monotonic  — the suggested reserve RATE per bucket is monotonic
//                           non-decreasing in age (older money is never reserved
//                           at a lower rate than newer money).
//
// Tolerance: money is compared with a half-cent tolerance so that float noise
// (100.00 vs 100.004999…) is treated as equal. daysOverdue is INTEGER arithmetic
// on day-numbers, so bucket boundaries are exact (no float tolerance there).

import { summarize, type OracleCheck, type VerifierResult } from "./oracleTypes";

/** Half a cent: money within this delta is considered equal. Documented tie-break. */
export const CENT_TOLERANCE = 0.005;

/** One invoice line in the aging input. `amount` is outstanding balance (money). */
export interface AgingInvoice {
  /** Outstanding amount (money, same currency for all lines). May be 0. */
  amount: number;
  /** Due date as an ISO calendar date, "YYYY-MM-DD". */
  dueDate: string;
}

/** A single aging bucket definition + the schedule's claimed placement for it. */
export interface AgingBucket {
  /** Human label, e.g. "0-30". */
  label: string;
  /** Inclusive lower bound of daysOverdue for this bucket. */
  minDays: number;
  /**
   * Inclusive upper bound of daysOverdue for this bucket, or null for the
   * open-ended tail (e.g. "90+"). null means "no upper bound".
   */
  maxDays: number | null;
  /** Suggested reserve rate for this bucket, in [0,1] (e.g. 0.25 = 25%). */
  reserveRate: number;
  /** The schedule's claimed sum of invoice amounts falling in this bucket. */
  amount: number;
}

/** The full aging-schedule input to verify. */
export interface AgingInput {
  /** As-of date, "YYYY-MM-DD". daysOverdue is measured relative to this. */
  asOf: string;
  invoices: AgingInvoice[];
  /** Bucket definitions, expected in ascending age order (min 0..oldest tail). */
  buckets: AgingBucket[];
}

/**
 * Convert a "YYYY-MM-DD" calendar date to an integer day-number using a fixed
 * proleptic-Gregorian formula. Pure integer math — NO `Date`, NO timezone, NO
 * clock. Two dates parsed this way subtract to an exact day count.
 *
 * Algorithm: days since a fixed epoch (0000-03-01) via the standard
 * "shift March to start of year" trick, which makes the leap-day the last day
 * of the shifted year and removes month-length branching.
 */
export function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    throw new Error(`dayNumber: expected YYYY-MM-DD, got ${JSON.stringify(iso)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]); // 1..12
  const day = Number(m[3]); // 1..31
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`dayNumber: out-of-range date ${JSON.stringify(iso)}`);
  }
  // Shift so March = month 0; Jan/Feb belong to the previous year.
  const a = Math.floor((14 - month) / 12); // 1 for Jan/Feb, else 0
  const y = year + 4800 - a;
  const mo = month + 12 * a - 3;
  // Julian Day Number (integer), fixed proleptic-Gregorian.
  return (
    day +
    Math.floor((153 * mo + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Money equality to the half-cent (documented tolerance for float ties). */
function equalToTheCent(a: number, b: number): boolean {
  return Math.abs(a - b) <= CENT_TOLERANCE;
}

/**
 * Does `days` fall in `bucket`? Inclusive on both ends; maxDays null = open tail.
 * Pure integer comparison — exact, no tolerance.
 */
function inBucket(days: number, bucket: AgingBucket): boolean {
  if (days < bucket.minDays) return false;
  if (bucket.maxDays !== null && days > bucket.maxDays) return false;
  return true;
}

/**
 * Verify an AR/AP aging schedule. Deterministic and pure.
 * Returns summarize("arApAging", checks).
 */
export function verifyAging(input: AgingInput): VerifierResult {
  const checks: OracleCheck[] = [];
  const asOfDay = dayNumber(input.asOf);

  // --- Precompute daysOverdue per invoice (integer, exact). ---
  const overdue: number[] = input.invoices.map((inv) => asOfDay - dayNumber(inv.dueDate));

  // --- Check 1: partition — each invoice lands in EXACTLY ONE bucket. ---
  let partitionOk = true;
  const partitionProblems: string[] = [];
  for (let i = 0; i < input.invoices.length; i += 1) {
    const days = overdue[i];
    let hits = 0;
    for (const b of input.buckets) {
      if (inBucket(days, b)) hits += 1;
    }
    if (hits !== 1) {
      partitionOk = false;
      partitionProblems.push(`invoice#${i} (daysOverdue=${days}) matched ${hits} buckets`);
    }
  }
  checks.push({
    name: "bucket_partition",
    passed: partitionOk,
    detail: partitionOk
      ? `all ${input.invoices.length} invoice(s) land in exactly one bucket by daysOverdue`
      : `partition violated: ${partitionProblems.join("; ")}`,
  });

  // --- Check 2: bucket sums == total outstanding (to the cent). ---
  // Recompute what each bucket SHOULD sum to from the invoices, and compare the
  // recomputed grand total against both the invoice total and the claimed
  // bucket-amount total. All three must agree to the cent.
  const recomputedByBucket: number[] = input.buckets.map(() => 0);
  for (let i = 0; i < input.invoices.length; i += 1) {
    const days = overdue[i];
    for (let bi = 0; bi < input.buckets.length; bi += 1) {
      if (inBucket(days, input.buckets[bi])) {
        recomputedByBucket[bi] += input.invoices[i].amount;
      }
    }
  }
  const totalOutstanding = input.invoices.reduce((s, inv) => s + inv.amount, 0);
  const claimedBucketTotal = input.buckets.reduce((s, b) => s + b.amount, 0);
  const recomputedTotal = recomputedByBucket.reduce((s, v) => s + v, 0);

  // Per-bucket agreement: each claimed bucket.amount matches the recomputed sum.
  const perBucketMismatches: string[] = [];
  for (let bi = 0; bi < input.buckets.length; bi += 1) {
    if (!equalToTheCent(input.buckets[bi].amount, recomputedByBucket[bi])) {
      perBucketMismatches.push(
        `bucket "${input.buckets[bi].label}" claimed ${input.buckets[bi].amount.toFixed(2)} != recomputed ${recomputedByBucket[bi].toFixed(2)}`,
      );
    }
  }
  const totalsAgree =
    equalToTheCent(claimedBucketTotal, totalOutstanding) &&
    equalToTheCent(recomputedTotal, totalOutstanding) &&
    perBucketMismatches.length === 0;
  checks.push({
    name: "bucket_sums_total",
    passed: totalsAgree,
    detail: totalsAgree
      ? `bucket amounts reconcile to total outstanding ${totalOutstanding.toFixed(2)} (tol ${CENT_TOLERANCE})`
      : `sums off: claimedBucketTotal=${claimedBucketTotal.toFixed(2)}, recomputedTotal=${recomputedTotal.toFixed(2)}, totalOutstanding=${totalOutstanding.toFixed(2)}${perBucketMismatches.length ? "; " + perBucketMismatches.join("; ") : ""}`,
  });

  // --- Check 3: reserve rate monotonic non-decreasing in age. ---
  // Buckets are expected in ascending age order; older buckets must reserve at a
  // rate >= younger ones. (Exact numeric compare; rates are ratios, not money.)
  let monotonicOk = true;
  const monoProblems: string[] = [];
  for (let bi = 1; bi < input.buckets.length; bi += 1) {
    const prev = input.buckets[bi - 1];
    const cur = input.buckets[bi];
    if (cur.reserveRate < prev.reserveRate) {
      monotonicOk = false;
      monoProblems.push(
        `bucket "${cur.label}" rate ${cur.reserveRate} < older-money floor "${prev.label}" rate ${prev.reserveRate}`,
      );
    }
  }
  checks.push({
    name: "reserve_monotonic",
    passed: monotonicOk,
    detail: monotonicOk
      ? `reserve rates are monotonic non-decreasing across ${input.buckets.length} bucket(s)`
      : `reserve monotonicity violated: ${monoProblems.join("; ")}`,
  });

  return summarize("arApAging", checks);
}
