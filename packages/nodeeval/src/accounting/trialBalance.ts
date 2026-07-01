// Deterministic accounting oracle: trialBalance.
//
// This is a DETERMINISTIC accounting oracle — part of the official scorer for the
// accounting proofloop. verifyTrialBalance is a PURE function of its input:
//   - NO Date.now / new Date / Math.random / clocks / IO / LLM calls.
//   - Given the same input, it always returns the identical VerifierResult.
//
// What it checks (double-entry + accounting-equation invariants):
//   1. debits_equal_credits  — sum(debit) across all accounts == sum(credit).
//   2. net_income_links       — derived net income (revenue - expense) equals the
//                               retained-earnings movement carried into equity, i.e.
//                               closing equity already reflects net income. We verify
//                               this via the balance-sheet identity below rather than
//                               requiring a separate retained-earnings row: if the
//                               books balance AND debits==credits, net income has been
//                               closed into equity consistently. We surface the derived
//                               net income as an explicit named check so the linkage is
//                               auditable, and fail it if the equation cannot hold with
//                               the reported net income.
//   3. balance_sheet_balances — assets == liabilities + equity (within tolerance).
//
// TOLERANCE (documented): all comparisons use a half-cent absolute tolerance,
//   EPS = 0.005, i.e. |a - b| <= 0.005 counts as equal. This absorbs binary
//   floating-point representation error on cent-scale money (e.g. 100.00 vs
//   100.004999...) without ever masking a real >= 1 cent discrepancy.
import { summarize, type OracleCheck, type VerifierResult } from "./oracleTypes";

/** Half-a-cent absolute tolerance for money comparisons. Documented above. */
export const EPS = 0.005;

/** Account types recognized by the trial-balance oracle. */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  name: string;
  type: AccountType;
  /** Debit-side amount (>= 0 by convention). */
  debit: number;
  /** Credit-side amount (>= 0 by convention). */
  credit: number;
}

export interface TrialBalanceInput {
  accounts: Account[];
}

/** True iff a and b are equal to within the documented half-cent tolerance. */
function equalToTheCent(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

/** Format a number to 2 decimals for stable, human-auditable check details. */
function money(n: number): string {
  // toFixed is deterministic for finite numbers; guard non-finite for honesty.
  return Number.isFinite(n) ? n.toFixed(2) : String(n);
}

/**
 * Verify a trial balance.
 *
 * Normal balances by type (used to derive signed net balances and the
 * accounting-equation terms):
 *   - asset, expense   -> normal DEBIT balance   (balance = debit - credit)
 *   - liability, equity, revenue -> normal CREDIT balance (balance = credit - debit)
 *
 * From these we derive:
 *   assets      = sum over asset accounts of (debit - credit)
 *   liabilities = sum over liability accounts of (credit - debit)
 *   equity(pre) = sum over equity accounts of (credit - debit)   // contributed + prior RE
 *   revenue     = sum over revenue accounts of (credit - debit)
 *   expense     = sum over expense accounts of (debit - credit)
 *   net_income  = revenue - expense
 *
 * The balance-sheet identity that must hold after closing net income into equity:
 *   assets == liabilities + equity(pre) + net_income
 *
 * This single identity encodes BOTH the balance-sheet balance AND the linkage of
 * derived net income into retained earnings/equity. We also independently check
 * that total debits == total credits (the raw double-entry invariant).
 */
export function verifyTrialBalance(input: TrialBalanceInput): VerifierResult {
  const checks: OracleCheck[] = [];
  const accounts = input?.accounts ?? [];

  // --- Check 0: input well-formedness (finite, non-negative sides) ---
  let wellFormed = true;
  const badRows: string[] = [];
  for (const a of accounts) {
    const okFinite = Number.isFinite(a.debit) && Number.isFinite(a.credit);
    const okSign = a.debit >= 0 && a.credit >= 0;
    if (!okFinite || !okSign) {
      wellFormed = false;
      badRows.push(`${a.name}(debit=${a.debit},credit=${a.credit})`);
    }
  }
  checks.push({
    name: "input_well_formed",
    passed: wellFormed,
    detail: wellFormed
      ? `all ${accounts.length} account rows have finite, non-negative debit/credit`
      : `malformed rows: ${badRows.join(", ")}`,
  });

  // --- Check 1: total debits == total credits (raw double-entry) ---
  let totalDebit = 0;
  let totalCredit = 0;
  for (const a of accounts) {
    totalDebit += a.debit;
    totalCredit += a.credit;
  }
  const debitsEqCredits = equalToTheCent(totalDebit, totalCredit);
  checks.push({
    name: "debits_equal_credits",
    passed: debitsEqCredits,
    detail: debitsEqCredits
      ? `debits ${money(totalDebit)} == credits ${money(totalCredit)} (|delta| <= ${EPS})`
      : `debits ${money(totalDebit)} != credits ${money(totalCredit)} (delta ${money(
          totalDebit - totalCredit,
        )} > ${EPS})`,
  });

  // --- Derive equation terms by normal balance ---
  let assets = 0;
  let liabilities = 0;
  let equityPre = 0;
  let revenue = 0;
  let expense = 0;
  for (const a of accounts) {
    switch (a.type) {
      case "asset":
        assets += a.debit - a.credit;
        break;
      case "liability":
        liabilities += a.credit - a.debit;
        break;
      case "equity":
        equityPre += a.credit - a.debit;
        break;
      case "revenue":
        revenue += a.credit - a.debit;
        break;
      case "expense":
        expense += a.debit - a.credit;
        break;
      default:
        // Unknown type: record as a failed check so it can never silently pass.
        checks.push({
          name: "unknown_account_type",
          passed: false,
          detail: `account "${a.name}" has unrecognized type "${(a as Account).type}"`,
        });
    }
  }

  const netIncome = revenue - expense;

  // --- Check 2: net income links into equity via the balance-sheet identity ---
  // assets == liabilities + equity(pre) + net_income
  const rhs = liabilities + equityPre + netIncome;
  const netIncomeLinks = equalToTheCent(assets, rhs);
  checks.push({
    name: "net_income_links_to_equity",
    passed: netIncomeLinks,
    detail: netIncomeLinks
      ? `net income ${money(netIncome)} (revenue ${money(revenue)} - expense ${money(
          expense,
        )}) closes into equity: assets ${money(assets)} == liab ${money(
          liabilities,
        )} + equity ${money(equityPre)} + NI ${money(netIncome)}`
      : `net income ${money(netIncome)} does not reconcile: assets ${money(
          assets,
        )} != liab ${money(liabilities)} + equity ${money(equityPre)} + NI ${money(
          netIncome,
        )} = ${money(rhs)} (delta ${money(assets - rhs)} > ${EPS})`,
  });

  // --- Check 3: balance sheet balances (assets == liabilities + closing equity) ---
  const closingEquity = equityPre + netIncome;
  const balanceSheetBalances = equalToTheCent(assets, liabilities + closingEquity);
  checks.push({
    name: "balance_sheet_balances",
    passed: balanceSheetBalances,
    detail: balanceSheetBalances
      ? `assets ${money(assets)} == liabilities ${money(liabilities)} + equity ${money(
          closingEquity,
        )} (|delta| <= ${EPS})`
      : `assets ${money(assets)} != liabilities ${money(liabilities)} + equity ${money(
          closingEquity,
        )} (delta ${money(assets - (liabilities + closingEquity))} > ${EPS})`,
  });

  return summarize("trialBalance", checks);
}
