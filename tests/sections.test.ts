// Checklist due dates, Budget view helpers, Library rules, Journal photo layout.
// Fictional data only (trip year 2030).
import { describe, expect, it } from 'vitest';
import { approxFlags, categoryTotals, rateForDate, scopeForSplit, splitForParticipants, visibleExpenses, splitForScope } from '@/components/budget/budgetCalc';
import { countDue, dueState, progress, upcomingTasks, type DueContext } from '@/components/checklist/due';
import { MAX_TILT, isPortrait, photoLayout, type PhotoRow } from '@/components/journal/photoLayout';
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
    expect(categoryTotals(rows, rates[0], 'all')).toEqual([{ category: 'food', aud: 20000, krw: 180000, approx: { aud: false, krw: false } }]);
    // A planned row at the latest rate is an estimate in the other currency.
    const planned = [expense('d', { amountMinor: 10000, category: 'stays', status: 'planned' })];
    expect(categoryTotals(planned, rates[0], 'all')[0].approx).toEqual({ aud: false, krw: true });
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

describe('journal photo layout', () => {
  const P = (id: string, caption = '') => ({ id, width: 900, height: 1200, caption });
  const L = (id: string, caption = '') => ({ id, width: 1200, height: 800, caption });
  const ids = (rows: PhotoRow[]) => rows.flatMap((r) => (r.kind === 'pair' ? r.photos.map((p) => p.id) : [r.photo.id]));

  it('puts portraits beside their note, alternating sides; landscapes go wide', () => {
    const rows = photoLayout([P('a', 'one'), L('b', 'two'), P('c', 'three'), P('d', 'four')]);
    expect(rows.map((r) => (r.kind === 'pair' ? 'pair' : `${r.kind}:${r.side}`))).toEqual(['side:left', 'wide:right', 'side:right', 'side:left']);
    expect(rows.map((r) => (r.kind === 'pair' ? null : r.photo.shape))).toEqual(['portrait', 'landscape', 'portrait', 'portrait']);
  });

  it('counts squares, near-squares and unknown sizes as portrait', () => {
    expect(isPortrait({ id: 's', width: 1000, height: 1000, caption: '' })).toBe(true);
    expect(isPortrait({ id: 'n', width: 1000, height: 920, caption: '' })).toBe(true);
    expect(isPortrait({ id: 'w', width: 1000, height: 880, caption: '' })).toBe(false);
    expect(isPortrait({ id: 'u', width: null, height: null, caption: '' })).toBe(true);
    expect(photoLayout([{ id: 'u', width: null, height: null, caption: 'x' }])[0]).toMatchObject({ kind: 'side', photo: { ratio: 0.75 } });
  });

  it('pairs consecutive portraits that have no note', () => {
    const rows = photoLayout([P('a'), P('b'), P('c'), P('d', '  '), P('e', 'note')]);
    expect(rows.map((r) => r.kind)).toEqual(['pair', 'pair', 'side']);
    // A lone note-less portrait, or one next to a noted / landscape photo, stays single.
    expect(photoLayout([P('a'), P('b', 'note')]).map((r) => r.kind)).toEqual(['side', 'side']);
    expect(photoLayout([P('a'), L('b'), P('c')]).map((r) => r.kind)).toEqual(['side', 'wide', 'side']);
  });

  it('keeps every photo once, in order', () => {
    const photos = [P('a'), L('b', 'x'), P('c'), P('d'), P('e', 'y'), L('f'), P('g')];
    expect(ids(photoLayout(photos))).toEqual(photos.map((p) => p.id));
    expect(photoLayout([])).toEqual([]);
  });

  it('is deterministic, tilts within ±2.5° and tapes most photos', () => {
    const photos = Array.from({ length: 60 }, (_, i) => (i % 3 ? P(`photo-${i}`, 'n') : L(`photo-${i}`)));
    const a = photoLayout(photos);
    expect(a).toEqual(photoLayout(photos.map((p) => ({ ...p }))));
    const placed = a.flatMap((r) => (r.kind === 'pair' ? r.photos : [r.photo]));
    for (const p of placed) {
      expect(Math.abs(p.tilt)).toBeLessThanOrEqual(MAX_TILT);
      expect(Math.abs(p.tilt)).toBeGreaterThan(0.5);
    }
    expect(new Set(placed.map((p) => Math.sign(p.tilt))).size).toBe(2);
    const taped = placed.filter((p) => p.tape).length / placed.length;
    expect(taped).toBeGreaterThan(0.5);
    expect(taped).toBeLessThan(1);
  });
});

describe('splitForScope', () => {
  it('follows the budget: Shared halves, Eren / Amy pays all', () => {
    expect(splitForScope('shared')).toBe('equal');
    expect(splitForScope('eren')).toBe('eren');
    expect(splitForScope('amy')).toBe('amy');
  });
});
