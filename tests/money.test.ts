import { describe, expect, it } from 'vitest';
import {
  balances,
  convertMinor,
  formatMoney,
  rateForExpense,
  splitAmount,
  summarizeBudget,
  toMinor,
} from '@/lib/money';
import type { FxRate, Member, Settlement, TripBudget } from '@/lib/types';
import { expense } from './fixtures';

const latest: FxRate = { rateDate: '2030-12-20', base: 'AUD', quote: 'KRW', rate: 900, source: 'test' };
const members: Member[] = [
  { id: 'm-eren', tripId: 't1', profileKey: 'eren', displayName: 'Eren' },
  { id: 'm-amy', tripId: 't1', profileKey: 'amy', displayName: 'Amy' },
];

describe('minor units', () => {
  it('parses and rounds', () => {
    expect(toMinor('12.5', 'AUD')).toBe(1250);
    expect(toMinor('1,234.567', 'AUD')).toBe(123457);
    expect(toMinor('1.005', 'AUD')).toBe(101);
    expect(toMinor('A$3', 'AUD')).toBe(300);
    expect(toMinor('₩9,124', 'KRW')).toBe(9124);
    expect(toMinor('9124.5', 'KRW')).toBe(9125);
    expect(() => toMinor('abc', 'AUD')).toThrow();
  });
  it('formats', () => {
    expect(formatMoney(123456, 'AUD')).toBe('A$1,234.56');
    expect(formatMoney(-5, 'AUD')).toBe('-A$0.05');
    expect(formatMoney(5474000, 'KRW', { approx: true })).toBe('≈ ₩5,474,000');
  });
  it('converts once, rounding to the target unit', () => {
    expect(convertMinor(1001, 'AUD', 'KRW', 912.4)).toBe(9133);
    expect(convertMinor(10000, 'KRW', 'AUD', 912.4)).toBe(1096);
    expect(convertMinor(500, 'AUD', 'AUD', 912.4)).toBe(500);
  });
});

describe('splitAmount', () => {
  it('equal split gives the odd unit to Eren', () => {
    expect(splitAmount(1001, 'equal')).toEqual({ eren: 501, amy: 500 });
    expect(splitAmount(1000, 'equal')).toEqual({ eren: 500, amy: 500 });
  });
  it('single payer and custom', () => {
    expect(splitAmount(700, 'amy')).toEqual({ eren: 0, amy: 700 });
    expect(splitAmount(700, 'custom', { eren: 200, amy: 500 })).toEqual({ eren: 200, amy: 500 });
    expect(() => splitAmount(700, 'custom', { eren: 200, amy: 400 })).toThrow();
  });
});

describe('rateForExpense', () => {
  it('locked paid rows keep their own rate; planned rows use the latest as an estimate', () => {
    expect(rateForExpense(expense('a', { fxRate: 850, fxRateDate: '2030-12-27', fxLocked: true }), latest)).toEqual({
      rate: 850,
      approx: false,
      rateDate: '2030-12-27',
    });
    expect(rateForExpense(expense('b', { status: 'planned', fxRate: 850 }), latest)).toEqual({
      rate: 900,
      approx: true,
      rateDate: '2030-12-20',
    });
    expect(rateForExpense(expense('c', { status: 'planned', fxRate: 880, fxManual: true }), latest).rate).toBe(880);
  });
});

describe('summarizeBudget', () => {
  const budgets: TripBudget[] = [
    { tripId: 't1', scope: 'shared', amountMinor: 100000, currency: 'AUD' },
    { tripId: 't1', scope: 'amy', amountMinor: 900000, currency: 'KRW' },
  ];
  it('spent, planned, remaining, after planned in both currencies', () => {
    const s = summarizeBudget({
      budgets,
      latest,
      scope: 'shared',
      expenses: [
        expense('paid', { amountMinor: 20000, fxRate: 800, fxLocked: true }),
        expense('card', { amountMinor: 10000, fxRate: 800, fxLocked: true, krwChargedMinor: 83000 }),
        expense('plan', { status: 'planned', amountMinor: 30000 }),
        expense('cx', { status: 'cancelled', amountMinor: 99999 }),
        expense('refund', { kind: 'refund', amountMinor: 5000, refundOfId: 'paid' }),
        expense('amyOnly', { budgetScope: 'amy', amountMinor: 1 }),
      ],
    });
    expect(s.budget).toEqual({ aud: 100000, krw: 900000 });
    expect(s.spent).toEqual({ aud: 25000, krw: 120000 + 83000 });
    expect(s.planned).toEqual({ aud: 30000, krw: 270000 });
    expect(s.remaining).toEqual({ aud: 75000, krw: 900000 - 203000 });
    expect(s.afterPlanned).toEqual({ aud: 45000, krw: 900000 - 203000 - 270000 });
    expect(s.approx).toBe(true);
    expect(s.overBy).toBeNull();
  });
  it('all scope sums every budget; KRW budget converted with latest', () => {
    const s = summarizeBudget({ budgets, latest, scope: 'all', expenses: [] });
    expect(s.budget).toEqual({ aud: 100000 + 100000, krw: 900000 + 900000 });
  });
  it('over budget', () => {
    const s = summarizeBudget({
      budgets: [budgets[0]],
      latest,
      scope: 'shared',
      expenses: [expense('big', { amountMinor: 132000, fxRate: 900, fxLocked: true })],
    });
    expect(s.overBy).toEqual({ aud: 32000, krw: 288000 });
  });
  it('flags a missing rate instead of inventing one', () => {
    const s = summarizeBudget({ budgets: [budgets[1]], latest: null, scope: 'amy', expenses: [] });
    expect(s.missingRate).toBe(true);
    expect(s.budget.krw).toBe(900000);
  });
});

describe('balances', () => {
  it('nets payer shares, refunds and settlements in AUD', () => {
    const settlement: Settlement = {
      id: 's1',
      tripId: 't1',
      createdBy: null,
      updatedBy: null,
      createdAt: '',
      updatedAt: '',
      version: 1,
      deletedAt: null,
      fromMember: 'm-eren',
      toMember: 'm-amy',
      amountMinor: 900000,
      currency: 'KRW',
      date: '2031-01-03',
      fxRate: 900,
      note: '',
    };
    const r = balances(
      [
        expense('amyPaid', { payerId: 'm-amy', amountMinor: 20000, splitEren: 10000, splitAmy: 10000 }),
        expense('erenPaid', { payerId: 'm-eren', amountMinor: 6000, splitEren: 3000, splitAmy: 3000 }),
        expense('planned', { status: 'planned', payerId: 'm-amy', splitEren: 99999 }),
        expense('refund', { kind: 'refund', payerId: 'm-amy', amountMinor: 2000, splitEren: 1000, splitAmy: 1000 }),
      ],
      [settlement],
      members,
      latest,
    );
    expect(r.erenOwesAmyAud).toBe(10000 - 3000 - 1000 - 100000);
  });
});
