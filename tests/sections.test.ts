// Checklist due dates, Budget view helpers, Library rules, Journal collage.
// Fictional data only (trip year 2030).
import { describe, expect, it } from 'vitest';
import { approxFlags, categoryTotals, rateForDate, scopeForSplit, splitForParticipants, visibleExpenses } from '@/components/budget/budgetCalc';
import { countDue, dueState, progress, upcomingTasks, type DueContext } from '@/components/checklist/due';
import { collageLayout, maxOverlapShare } from '@/components/journal/collageLayout';
import { findDuplicate, hostOf, isHttpUrl, nextPinSlot, urlKey } from '@/components/library/libraryLogic';
import type { ChecklistItem, FxRate, Resource, RowMeta, TripBudget } from '@/lib/types';
import { expense } from './fixtures';

const meta = (id: string): RowMeta => ({
  id,
  tripId: 't1',
  createdBy: null,
  updatedBy: null,
  createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z',
  version: 1,
  deletedAt: null,
});

const task = (id: string, p: Partial<ChecklistItem> = {}): ChecklistItem => ({
  ...meta(id),
  kind: 'task',
  category: 'bookings_documents',
  title: id,
  assignee: 'both',
  quantity: null,
  dueDate: null,
  priority: 'normal',
  checked: false,
  isApplicable: true,
  notes: '',
  bookingId: null,
  documentId: null,
  resourceId: null,
  sortOrder: 0,
  ...p,
});

describe('checklist due dates', () => {
  const before: DueContext = { today: '2030-12-20', tripStart: '2030-12-26', underway: false };
  const during: DueContext = { today: '2030-12-28', tripStart: '2030-12-26', underway: true };

  it('separates overdue from due within 7 days', () => {
    expect(dueState(task('a', { dueDate: '2030-12-19' }), before)).toBe('overdue');
    expect(dueState(task('b', { dueDate: '2030-12-20' }), before)).toBe('soon');
    expect(dueState(task('c', { dueDate: '2030-12-27' }), before)).toBe('soon');
    expect(dueState(task('d', { dueDate: '2030-12-28' }), before)).toBe('later');
    expect(dueState(task('e'), before)).toBe('none');
  });

  it('ignores finished, not-needed and packing rows', () => {
    expect(dueState(task('a', { dueDate: '2030-12-19', checked: true }), before)).toBe('none');
    expect(dueState(task('b', { dueDate: '2030-12-19', isApplicable: false }), before)).toBe('none');
    expect(dueState(task('c', { dueDate: '2030-12-19', kind: 'packing' }), before)).toBe('none');
  });

  it('drops pre-trip deadlines once the trip is under way', () => {
    const items = [
      task('eta', { dueDate: '2030-12-12' }),
      task('home', { dueDate: '2030-12-26' }),
      task('checkin', { dueDate: '2031-01-02' }),
      task('late', { dueDate: '2030-12-27' }),
    ];
    expect(countDue(items, during)).toEqual({ overdue: 2, soon: 1 });
    expect(countDue(items, before)).toEqual({ overdue: 1, soon: 2 });
    expect(upcomingTasks(items, during).map((i) => i.id)).toEqual(['home', 'late', 'checkin']);
  });

  it('computes progress over applicable rows only', () => {
    const items = [
      task('a', { kind: 'packing', checked: true }),
      task('b', { kind: 'packing' }),
      task('c', { kind: 'packing', isApplicable: false }),
      task('d', { checked: true }),
    ];
    expect(progress(items, 'packing')).toEqual({ done: 1, total: 2 });
    expect(progress(items, 'task')).toEqual({ done: 1, total: 1 });
  });
});

describe('budget helpers', () => {
  const rates: FxRate[] = [
    { rateDate: '2030-12-20', base: 'AUD', quote: 'KRW', rate: 912.4, source: 'test' },
    { rateDate: '2030-11-20', base: 'AUD', quote: 'KRW', rate: 910, source: 'test' },
  ];

  it('defaults scope from split and split from participants', () => {
    expect(scopeForSplit('equal')).toBe('shared');
    expect(scopeForSplit('custom')).toBe('shared');
    expect(scopeForSplit('amy')).toBe('amy');
    expect(splitForParticipants('together')).toBe('equal');
    expect(splitForParticipants('eren')).toBe('eren');
    expect(splitForParticipants(null)).toBe('equal');
  });

  it('locks the payment-day rate, else falls back to the latest earlier rate', () => {
    expect(rateForDate(rates, '2030-11-20')).toEqual({ rate: 910, rateDate: '2030-11-20', exact: true });
    expect(rateForDate(rates, '2030-12-01')).toEqual({ rate: 910, rateDate: '2030-11-20', exact: false });
    expect(rateForDate(rates, '2030-10-01')).toEqual({ rate: 912.4, rateDate: '2030-12-20', exact: false });
    expect(rateForDate([], '2030-10-01')).toBeNull();
  });

  it('filters by scope and status', () => {
    const rows = [expense('a'), expense('b', { status: 'planned', budgetScope: 'amy' }), expense('c', { deletedAt: '2030-01-02T00:00:00Z' })];
    expect(visibleExpenses(rows, 'all', 'all').map((e) => e.id)).toEqual(['a', 'b']);
    expect(visibleExpenses(rows, 'amy', 'all').map((e) => e.id)).toEqual(['b']);
    expect(visibleExpenses(rows, 'all', 'paid').map((e) => e.id)).toEqual(['a']);
  });

  it('marks only estimated values with ≈', () => {
    const budgets: TripBudget[] = [{ tripId: 't1', scope: 'shared', amountMinor: 500000, currency: 'AUD' }];
    const rows = [
      expense('paid', { fxRate: 905, fxRateDate: '2030-10-31', fxLocked: true }),
      expense('plan', { status: 'planned' }),
    ];
    const aud = approxFlags({ budgets, expenses: rows, latest: rates[0], scope: 'all', display: 'AUD' });
    expect(aud).toEqual({ budget: false, spent: false, planned: false, remaining: false, afterPlanned: false });
    const krw = approxFlags({ budgets, expenses: rows, latest: rates[0], scope: 'all', display: 'KRW' });
    expect(krw).toEqual({ budget: true, spent: false, planned: true, remaining: true, afterPlanned: true });
  });

  it('totals categories in both currencies, skipping cancelled rows', () => {
    const rows = [
      expense('a', { amountMinor: 10000, category: 'food', fxRate: 900, fxLocked: true }),
      expense('b', { amountMinor: 90000, currency: 'KRW', category: 'food', fxRate: 900, fxLocked: true }),
      expense('c', { amountMinor: 5000, category: 'transport', status: 'cancelled' }),
    ];
    expect(categoryTotals(rows, rates[0], 'all')).toEqual([{ category: 'food', aud: 20000, krw: 180000 }]);
  });
});

describe('library rules', () => {
  const res = (id: string, url: string, pinnedOrder: number | null = null): Resource => ({
    ...meta(id),
    title: id,
    url,
    category: 'other',
    note: '',
    pinnedOrder,
  });

  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://example.com/a')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
  });

  it('finds duplicates without dropping query parameters', () => {
    const list = [res('a', 'https://Example.com/trip/'), res('b', 'https://example.com/map?q=1')];
    expect(urlKey('https://example.com/trip')).toBe(urlKey('https://EXAMPLE.com/trip/'));
    expect(findDuplicate('https://example.com/trip', list, null)?.id).toBe('a');
    expect(findDuplicate('https://example.com/trip', list, 'a')).toBeNull();
    expect(findDuplicate('https://example.com/map?q=2', list, null)).toBeNull();
    expect(hostOf('https://www.example.com/x')).toBe('example.com');
  });

  it('pins into the lowest free slot, at most four', () => {
    expect(nextPinSlot([res('a', 'https://a.test', 1), res('b', 'https://b.test', 3)])).toBe(2);
    expect(nextPinSlot([1, 2, 3, 4].map((n) => res(`r${n}`, `https://${n}.test`, n)))).toBeNull();
  });
});

describe('journal collage', () => {
  const photos = (n: number, portrait = false) =>
    Array.from({ length: n }, (_, i) => ({ id: `photo-${i}`, width: portrait ? 900 : 1200, height: portrait ? 1200 : 900 }));

  it('keeps tilt within ±3° and overlap within 10% for 1–6 photos and every variant', () => {
    for (let n = 1; n <= 6; n++) {
      for (const portrait of [false, true]) {
        for (let v = 0; v < 6; v++) {
          const layout = collageLayout(photos(n, portrait), v);
          expect(layout.slots).toHaveLength(n);
          expect(maxOverlapShare(layout)).toBeLessThanOrEqual(0.1);
          for (const s of layout.slots) {
            expect(Math.abs(s.rotate)).toBeLessThanOrEqual(3);
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.x + s.w).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('is deterministic for the same photos and variant, and keeps photo order', () => {
    expect(collageLayout(photos(4), 2)).toEqual(collageLayout(photos(4), 2));
    expect(collageLayout(photos(4), 0).slots.map((s) => s.id)).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3']);
  });

  it('changes with Shuffle layout', () => {
    const a = collageLayout(photos(4), 0);
    const b = collageLayout(photos(4), 1);
    expect(JSON.stringify(a.slots)).not.toBe(JSON.stringify(b.slots));
  });

  it('places six and counts the rest', () => {
    const layout = collageLayout(photos(9), 0);
    expect(layout.slots).toHaveLength(6);
    expect(layout.more).toBe(3);
    expect(collageLayout(photos(1)).slots[0].rotate).toBe(-1.5);
  });
});
