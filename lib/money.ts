// Money in integer minor units: AUD cents, KRW won (plan §7.5).
// Rates are KRW per 1 AUD.
import type { BudgetScope, Currency, Expense, FxRate, Member, Settlement, SplitMode, TripBudget } from './types';

export function toMinor(amount: string | number, c: Currency): number {
  const s = String(amount).replace(/[,\s]/g, '').replace(/^(A\$|\$|₩)/, '').replace(/₩$/, '');
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: ${amount}`);
  const sign = m[1] ? -1 : 1;
  const whole = Number(m[2]);
  const frac = m[3] ?? '';
  if (c === 'KRW') return sign * (whole + (frac && Number(frac[0]) >= 5 ? 1 : 0));
  const cents = Number((frac + '00').slice(0, 2));
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  return sign * (whole * 100 + cents + roundUp);
}

export function fromMinor(minor: number, c: Currency): number {
  return c === 'AUD' ? minor / 100 : minor;
}

export function formatMoney(minor: number, c: Currency, opts: { approx?: boolean } = {}): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const body =
    c === 'AUD'
      ? `A$${Math.floor(abs / 100).toLocaleString('en-AU')}.${String(abs % 100).padStart(2, '0')}`
      : `${abs.toLocaleString('en-AU')}₩`; // won sign after the number (owner, 2026-11-01)
  return `${opts.approx ? '≈ ' : ''}${neg ? '-' : ''}${body}`;
}

/**
 * Equal split gives the odd minor unit to Eren (fixed rule shown in the UI).
 * Custom split must add up to the total.
 */
export function splitAmount(
  totalMinor: number,
  mode: SplitMode,
  custom?: { eren: number; amy: number },
): { eren: number; amy: number } {
  switch (mode) {
    case 'eren':
      return { eren: totalMinor, amy: 0 };
    case 'amy':
      return { eren: 0, amy: totalMinor };
    case 'equal': {
      const amy = Math.trunc(totalMinor / 2);
      return { eren: totalMinor - amy, amy };
    }
    case 'custom':
      if (!custom || !Number.isInteger(custom.eren) || !Number.isInteger(custom.amy))
        throw new Error('Custom split needs whole minor units');
      if (custom.eren + custom.amy !== totalMinor) throw new Error('Split must add up to the amount');
      return { eren: custom.eren, amy: custom.amy };
  }
}

export function convertMinor(minor: number, from: Currency, to: Currency, rateKrwPerAud: number): number {
  if (from === to) return minor;
  if (!(rateKrwPerAud > 0)) throw new Error('Invalid rate');
  return from === 'AUD' ? Math.round((minor / 100) * rateKrwPerAud) : Math.round((minor / rateKrwPerAud) * 100);
}

/** Rate that applies to one expense row. `approx` = estimate from the latest rate. */
export function rateForExpense(
  e: Expense,
  latest: FxRate | null,
): { rate: number | null; approx: boolean; rateDate: string | null } {
  if (e.fxRate && (e.fxManual || (e.status === 'paid' && e.fxLocked))) {
    return { rate: e.fxRate, approx: false, rateDate: e.fxRateDate };
  }
  if (e.fxRate && e.status === 'paid') return { rate: e.fxRate, approx: false, rateDate: e.fxRateDate };
  return { rate: latest?.rate ?? null, approx: true, rateDate: latest?.rateDate ?? null };
}

export interface Pair {
  aud: number;
  krw: number;
}

/** Sums native amounts per (currency, rate) bucket, then converts once per bucket. */
class Accumulator {
  private buckets = new Map<string, { currency: Currency; rate: number | null; minor: number; krwFixed: number | null }>();
  approx = false;
  missingRate = false;

  /** `krwFixed` = actual KRW charged for an AUD row; it replaces the conversion. */
  add(minor: number, currency: Currency, rate: number | null, approx: boolean, krwFixed: number | null = null) {
    if (approx && krwFixed == null) this.approx = true;
    const key = `${currency}|${rate ?? ''}|${krwFixed != null ? 'fixed' : ''}`;
    const b = this.buckets.get(key) ?? { currency, rate, minor: 0, krwFixed: krwFixed != null ? 0 : null };
    b.minor += minor;
    if (b.krwFixed != null && krwFixed != null) b.krwFixed += krwFixed;
    this.buckets.set(key, b);
  }

  total(): Pair {
    let aud = 0;
    let krw = 0;
    for (const b of this.buckets.values()) {
      if (b.currency === 'AUD') {
        aud += b.minor;
        if (b.krwFixed != null) krw += b.krwFixed;
        else if (b.rate) krw += convertMinor(b.minor, 'AUD', 'KRW', b.rate);
        else if (b.minor) this.missingRate = true;
      } else {
        krw += b.minor;
        if (b.rate) aud += convertMinor(b.minor, 'KRW', 'AUD', b.rate);
        else if (b.minor) this.missingRate = true;
      }
    }
    return { aud, krw };
  }
}

const sub = (a: Pair, b: Pair): Pair => ({ aud: a.aud - b.aud, krw: a.krw - b.krw });

export interface BudgetSummary {
  budget: Pair;
  spent: Pair;
  planned: Pair;
  remaining: Pair;
  afterPlanned: Pair;
  approx: boolean;
  missingRate: boolean;
  overBy: Pair | null;
}

export function summarizeBudget(input: {
  budgets: TripBudget[];
  expenses: Expense[];
  latest: FxRate | null;
  scope: 'all' | BudgetScope;
}): BudgetSummary {
  const { latest, scope } = input;
  const inScope = (s: BudgetScope) => scope === 'all' || s === scope;
  const live = input.expenses.filter((e) => !e.deletedAt && e.status !== 'cancelled' && inScope(e.budgetScope));
  const byId = new Map(input.expenses.map((e) => [e.id, e]));

  const budget = new Accumulator();
  for (const b of input.budgets.filter((b) => inScope(b.scope))) budget.add(b.amountMinor, b.currency, latest?.rate ?? null, true);

  const spent = new Accumulator();
  const planned = new Accumulator();
  for (const e of live) {
    // Refunds use the original expense's rate so the pair stays consistent.
    const source = e.kind === 'refund' && e.refundOfId ? (byId.get(e.refundOfId) ?? e) : e;
    const r = rateForExpense({ ...source, status: e.status }, latest);
    const sign = e.kind === 'refund' ? -1 : 1;
    const target = e.status === 'paid' ? spent : planned;
    const krwFixed = e.currency === 'AUD' && e.krwChargedMinor != null ? sign * e.krwChargedMinor : null;
    target.add(sign * e.amountMinor, e.currency, r.rate, r.approx, krwFixed);
  }

  const B = budget.total();
  const S = spent.total();
  const P = planned.total();
  const remaining = sub(B, S);
  return {
    budget: B,
    spent: S,
    planned: P,
    remaining,
    afterPlanned: sub(remaining, P),
    approx: budget.approx || spent.approx || planned.approx,
    missingRate: budget.missingRate || spent.missingRate || planned.missingRate,
    overBy: remaining.aud < 0 ? { aud: -remaining.aud, krw: Math.max(0, -remaining.krw) } : null,
  };
}

/** Net position in AUD cents. Positive = Eren owes Amy. */
export function balances(
  expenses: Expense[],
  settlements: Settlement[],
  members: Member[],
  latest: FxRate | null,
): { erenOwesAmyAud: number } {
  const keyOf = new Map(members.map((m) => [m.id, m.profileKey]));
  const toAud = (minor: number, c: Currency, rate: number | null) =>
    c === 'AUD' ? minor : rate ? convertMinor(minor, 'KRW', 'AUD', rate) : 0;
  let owes = 0;
  for (const e of expenses) {
    if (e.deletedAt || e.status !== 'paid' || !e.payerId) continue;
    const payer = keyOf.get(e.payerId);
    const { rate } = rateForExpense(e, latest);
    const sign = e.kind === 'refund' ? -1 : 1; // the payer of a refund is who received it
    if (payer === 'amy') owes += sign * toAud(e.splitEren, e.currency, rate);
    if (payer === 'eren') owes -= sign * toAud(e.splitAmy, e.currency, rate);
  }
  for (const s of settlements) {
    if (s.deletedAt) continue;
    const amount = toAud(s.amountMinor, s.currency, s.fxRate ?? latest?.rate ?? null);
    const from = keyOf.get(s.fromMember);
    if (from === 'eren') owes -= amount;
    if (from === 'amy') owes += amount;
  }
  return { erenOwesAmyAud: owes };
}
