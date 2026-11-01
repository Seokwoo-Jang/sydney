// Budget view helpers (plan §7.5). Pure, unit tested. Money stays in integer
// minor units; conversions go through lib/money.
import { convertMinor, rateForExpense } from '@/lib/money';
import type { BudgetScope, Currency, Expense, ExpenseCategory, FxRate, Member, Participants, SplitMode, TripBudget } from '@/lib/types';

export type ScopeView = 'all' | BudgetScope;
export type StatusView = 'all' | 'paid' | 'planned';

/** Budget scope that follows a split: shared when both pay, else that person's budget (plan §7.5.0). */
export function scopeForSplit(mode: SplitMode): BudgetScope {
  return mode === 'eren' ? 'eren' : mode === 'amy' ? 'amy' : 'shared';
}

/** Default split from the linked plan's people (plan §7.5). */
export function splitForParticipants(p: Participants | null | undefined): SplitMode {
  return p === 'eren' ? 'eren' : p === 'amy' ? 'amy' : 'equal';
}

/** Rate for a payment date: that day's ECB rate (locked), else the latest before it, else the newest. */
export function rateForDate(fxRates: FxRate[], date: string): { rate: number; rateDate: string; exact: boolean } | null {
  const sorted = fxRates.slice().sort((a, b) => b.rateDate.localeCompare(a.rateDate));
  const exact = sorted.find((r) => r.rateDate === date);
  if (exact) return { rate: exact.rate, rateDate: exact.rateDate, exact: true };
  const before = sorted.find((r) => r.rateDate < date) ?? sorted[0];
  return before ? { rate: before.rate, rateDate: before.rateDate, exact: false } : null;
}

export const inScope = (scope: ScopeView, s: BudgetScope) => scope === 'all' || s === scope;

export function visibleExpenses(expenses: Expense[], scope: ScopeView, status: StatusView): Expense[] {
  return expenses.filter((e) => !e.deletedAt && inScope(scope, e.budgetScope) && (status === 'all' || e.status === status));
}

/** The other currency for one row: KRW charged wins, else the row's rate. */
export function convertedAmount(e: Expense, latest: FxRate | null): { minor: number; currency: Currency; approx: boolean } | null {
  const to: Currency = e.currency === 'AUD' ? 'KRW' : 'AUD';
  if (e.currency === 'AUD' && e.krwChargedMinor != null) return { minor: e.krwChargedMinor, currency: 'KRW', approx: false };
  const r = rateForExpense(e, latest);
  if (!r.rate) return null;
  return { minor: convertMinor(e.amountMinor, e.currency, to, r.rate), currency: to, approx: r.approx };
}

export interface CellFlags {
  budget: boolean;
  spent: boolean;
  planned: boolean;
  remaining: boolean;
  afterPlanned: boolean;
}

/** Which summary values are estimates when shown in `display` currency (they get '≈'). */
export function approxFlags(input: {
  budgets: TripBudget[];
  expenses: Expense[];
  latest: FxRate | null;
  scope: ScopeView;
  display: Currency;
}): CellFlags {
  const { budgets, expenses, latest, scope, display } = input;
  const rowApprox = (e: Expense) =>
    e.currency !== display && !(display === 'KRW' && e.currency === 'AUD' && e.krwChargedMinor != null) && rateForExpense(e, latest).approx;
  const live = expenses.filter((e) => !e.deletedAt && e.status !== 'cancelled' && inScope(scope, e.budgetScope));
  const budget = budgets.some((b) => inScope(scope, b.scope) && b.amountMinor !== 0 && b.currency !== display);
  const spent = live.some((e) => e.status === 'paid' && rowApprox(e));
  const planned = live.some((e) => e.status === 'planned' && rowApprox(e));
  return { budget, spent, planned, remaining: budget || spent, afterPlanned: budget || spent || planned };
}

export function hasBudget(budgets: TripBudget[], scope: ScopeView): boolean {
  return budgets.some((b) => inScope(scope, b.scope) && b.amountMinor > 0);
}

/** A total in both currencies; `approx` marks a currency that includes a rate estimate (shown with '≈'). */
export interface TwoCurrencyTotal {
  aud: number;
  krw: number;
  approx: { aud: boolean; krw: boolean };
}

/** Adds rows in both currencies: each row's own amount plus its conversion (KRW charged wins). */
function addRows(rows: Expense[], latest: FxRate | null): TwoCurrencyTotal {
  const t: TwoCurrencyTotal = { aud: 0, krw: 0, approx: { aud: false, krw: false } };
  for (const e of rows) {
    const sign = e.kind === 'refund' ? -1 : 1;
    const conv = convertedAmount(e, latest);
    t.aud += sign * (e.currency === 'AUD' ? e.amountMinor : conv?.minor ?? 0);
    t.krw += sign * (e.currency === 'KRW' ? e.amountMinor : conv?.minor ?? 0);
    if (conv?.approx) t.approx[conv.currency === 'AUD' ? 'aud' : 'krw'] = true;
  }
  return t;
}

/** Paid + planned per category, in AUD cents and KRW (plan §7.5.1 category bars). */
export function categoryTotals(
  expenses: Expense[],
  latest: FxRate | null,
  scope: ScopeView,
): Array<{ category: ExpenseCategory } & TwoCurrencyTotal> {
  const map = new Map<ExpenseCategory, Expense[]>();
  for (const e of expenses) {
    if (e.deletedAt || e.status === 'cancelled' || !inScope(scope, e.budgetScope)) continue;
    map.set(e.category, [...(map.get(e.category) ?? []), e]);
  }
  return [...map.entries()]
    .map(([category, rows]) => ({ category, ...addRows(rows, latest) }))
    .filter((c) => c.aud > 0 || c.krw > 0)
    .sort((a, b) => b.aud - a.aud);
}

/** Paid amounts per payer in both currencies (paid rows only). */
export function paidByMember(expenses: Expense[], members: Member[], latest: FxRate | null): Array<{ member: Member } & TwoCurrencyTotal> {
  return members.map((m) => ({
    member: m,
    ...addRows(
      expenses.filter((e) => !e.deletedAt && e.status === 'paid' && e.payerId === m.id),
      latest,
    ),
  }));
}

/** Whole-unit display for the summary: drops '.00' only. */
export function trimCents(text: string): string {
  return text.replace(/\.00$/, '');
}

/** The split follows the budget (owner, 2026-11-01): Shared halves, Eren / Amy pays all. */
export function splitForScope(scope: BudgetScope): SplitMode {
  return scope === 'eren' ? 'eren' : scope === 'amy' ? 'amy' : 'equal';
}
