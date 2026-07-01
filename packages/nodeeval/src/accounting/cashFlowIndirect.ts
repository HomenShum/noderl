// Deterministic accounting oracle: cash-flow statement (INDIRECT method).
//
// This is a DETERMINISTIC accounting oracle — part of the official scorer for the
// accounting proofloop. It is a PURE function of its inputs:
//   - NO Date.now / new Date / Math.random / clocks / IO / LLM calls.
//   - Same input => byte-identical VerifierResult (determinism is asserted in the test).
//
// The indirect-method cash-flow statement reconciles the change in cash across the
// three sections and ties that change to the balance-sheet cash movement:
//
//   netChangeInCash = operating + investing + financing
//   netChangeInCash must equal (endingCash - beginningCash)
//
// Under the INDIRECT method the operating section is built by starting from net
// income and then adding back non-cash items / working-capital changes. So the
// FIRST line of the operating section MUST be net income (the reconciling anchor).
//
// TOLERANCE: all money values are treated as dollars-with-cents. Float comparisons
// use a half-cent tolerance so that e.g. 100.00 and 100.004999… are treated as
// equal. This is the domain tolerance; the aggregator (summarize) is exact/boolean.
import { summarize, type OracleCheck, type VerifierResult } from "./oracleTypes";

/** Half a cent. Two money amounts within this are considered equal to the cent. */
export const CASH_FLOW_TOLERANCE = 0.005;

/** A single line in a cash-flow section: a labeled signed dollar amount. */
export interface CashFlowLine {
  label: string;
  amount: number;
}

/** One cash-flow section is an ordered list of lines (order matters for operating). */
export type CashFlowSection = CashFlowLine[];

/** Input to the indirect-method cash-flow verifier. */
export interface CashFlowIndirectInput {
  /** Net income for the period (the anchor of the indirect operating section). */
  netIncome: number;
  sections: {
    /** Operating activities. Under indirect method, line[0] MUST be net income. */
    operating: CashFlowSection;
    /** Investing activities. */
    investing: CashFlowSection;
    /** Financing activities. */
    financing: CashFlowSection;
  };
  /** Cash balance at the start of the period (from the prior balance sheet). */
  beginningCash: number;
  /** Cash balance at the end of the period (from the current balance sheet). */
  endingCash: number;
}

/** Sum of all line amounts in a section. Empty section sums to 0. */
function sumSection(section: CashFlowSection): number {
  let total = 0;
  for (const line of section) total += line.amount;
  return total;
}

/** True iff two money amounts are equal to within the documented half-cent tolerance. */
function equalToTheCent(a: number, b: number): boolean {
  return Math.abs(a - b) <= CASH_FLOW_TOLERANCE;
}

/** Format a number with 2 decimals for deterministic, human-readable details. */
function money(n: number): string {
  return n.toFixed(2);
}

/**
 * Verify an indirect-method cash-flow statement.
 *
 * Checks (in a fixed, deterministic order):
 *  1. operating_starts_from_net_income — the first operating line is net income
 *     (the reconciling anchor of the indirect method).
 *  2. net_change_ties_to_cash_balances — operating + investing + financing equals
 *     (endingCash - beginningCash), within the half-cent tolerance.
 *
 * Returns summarize("cashFlowIndirect", checks): passed iff EVERY check passed.
 */
export function verifyCashFlowIndirect(input: CashFlowIndirectInput): VerifierResult {
  const { netIncome, sections, beginningCash, endingCash } = input;
  const { operating, investing, financing } = sections;

  const checks: OracleCheck[] = [];

  // --- Check 1: indirect operating section is anchored on net income ---
  const firstOperating = operating.length > 0 ? operating[0] : undefined;
  const startsFromNetIncome =
    firstOperating !== undefined && equalToTheCent(firstOperating.amount, netIncome);
  checks.push({
    name: "operating_starts_from_net_income",
    passed: startsFromNetIncome,
    detail:
      firstOperating === undefined
        ? `operating section is empty; indirect method requires net income (${money(
            netIncome,
          )}) as the first line`
        : startsFromNetIncome
        ? `operating[0] "${firstOperating.label}" = ${money(
            firstOperating.amount,
          )} matches net income ${money(netIncome)} (within ${CASH_FLOW_TOLERANCE})`
        : `operating[0] "${firstOperating.label}" = ${money(
            firstOperating.amount,
          )} != net income ${money(netIncome)} (delta ${money(
            Math.abs(firstOperating.amount - netIncome),
          )} > ${CASH_FLOW_TOLERANCE})`,
  });

  // --- Check 2: net change in cash ties out to the balance-sheet cash movement ---
  const operatingTotal = sumSection(operating);
  const investingTotal = sumSection(investing);
  const financingTotal = sumSection(financing);
  const netChangeInCash = operatingTotal + investingTotal + financingTotal;
  const balanceDelta = endingCash - beginningCash;
  const tiesOut = equalToTheCent(netChangeInCash, balanceDelta);
  checks.push({
    name: "net_change_ties_to_cash_balances",
    passed: tiesOut,
    detail: tiesOut
      ? `operating ${money(operatingTotal)} + investing ${money(
          investingTotal,
        )} + financing ${money(financingTotal)} = ${money(
          netChangeInCash,
        )} == endingCash ${money(endingCash)} - beginningCash ${money(
          beginningCash,
        )} = ${money(balanceDelta)} (within ${CASH_FLOW_TOLERANCE})`
      : `net change ${money(netChangeInCash)} (op ${money(operatingTotal)} + inv ${money(
          investingTotal,
        )} + fin ${money(financingTotal)}) != cash delta ${money(
          balanceDelta,
        )} (endingCash ${money(endingCash)} - beginningCash ${money(
          beginningCash,
        )}); delta ${money(Math.abs(netChangeInCash - balanceDelta))} > ${CASH_FLOW_TOLERANCE}`,
  });

  return summarize("cashFlowIndirect", checks);
}
