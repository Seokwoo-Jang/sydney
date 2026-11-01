import { describe, expect, it } from 'vitest';
import {
  activityPatchesForItem,
  buildDayRows,
  defaultDay,
  isPassed,
  linkedActivityStatus,
  matchesFilter,
  mixLabel,
  overviewWindow,
  shownStatus,
  timeLabel,
} from '@/components/itinerary/logic';
import { sortActivities, whenLine } from '@/components/prelude/logic';
import { SEOUL_TZ, SYDNEY_TZ, zonedToInstant } from '@/lib/time/zone';
import type { PreludeActivity, TripDay } from '@/lib/types';
import { item } from './fixtures';

const syd = (date: string, time: string) => zonedToInstant(date, time, SYDNEY_TZ);

function activity(id: string, p: Partial<PreludeActivity> = {}): PreludeActivity {
  return {
    id,
    tripId: 't1',
    createdBy: null,
    updatedBy: null,
    createdAt: '2030-01-01T00:00:00Z',
    updatedAt: '2030-01-01T00:00:00Z',
    version: 1,
    deletedAt: null,
    kind: 'performance',
    title: id,
    notes: '',
    peopleNote: '',
    status: 'idea',
    itineraryItemId: null,
    resourceId: null,
    sortOrder: 0,
    isExample: true,
    ...p,
  };
}

const flight = item('flight', {
  date: '2030-12-26',
  startTime: '21:50',
  endTime: '08:05',
  endDate: '2030-12-27',
  timezone: SEOUL_TZ,
  status: 'confirmed',
});

describe('filter', () => {
  it('Together shows all; a person sees together + their own', () => {
    const t = item('t', { participants: 'together' });
    const a = item('a', { participants: 'amy' });
    const e = item('e', { participants: 'eren' });
    expect([t, a, e].filter((i) => matchesFilter(i, 'together')).map((i) => i.id)).toEqual(['t', 'a', 'e']);
    expect([t, a, e].filter((i) => matchesFilter(i, 'amy')).map((i) => i.id)).toEqual(['t', 'a']);
    expect([t, a, e].filter((i) => matchesFilter(i, 'eren')).map((i) => i.id)).toEqual(['t', 'e']);
  });
});

describe('day rows', () => {
  it('overnight item continues on the next Sydney day as the same record', () => {
    const arrive = item('arrive', { date: '2030-12-27', startTime: '10:05', endTime: '11:30' });
    const d2 = buildDayRows([flight, arrive], '2030-12-27');
    expect(d2.timed.map((r) => [r.item.id, r.continuation])).toEqual([
      ['flight', true],
      ['arrive', false],
    ]);
    expect(d2.timed[0].item).toBe(flight);
    expect(buildDayRows([flight, arrive], '2030-12-28').timed).toEqual([]);
  });

  it('sorts timed rows by instant across zones and groups untimed rows', () => {
    const late = item('late', { startTime: '21:00' });
    const kst = item('kst', { startTime: '18:00', timezone: SEOUL_TZ }); // 20:00 AEDT
    const allDay = item('all', { timeKind: 'all_day', startTime: null });
    const tbd = item('tbd', { timeKind: 'unscheduled', startTime: null, sortOrder: -1 });
    const rows = buildDayRows([late, tbd, kst, allDay], '2030-12-28');
    expect(rows.timed.map((r) => r.item.id)).toEqual(['kst', 'late']);
    expect(rows.untimed.map((r) => r.item.id)).toEqual(['all', 'tbd']);
  });

  it('skips deleted rows', () => {
    expect(buildDayRows([item('x', { deletedAt: '2030-01-02T00:00:00Z' })], '2030-12-28').timed).toEqual([]);
  });
});

describe('time labels', () => {
  it('board range shares am/pm; tabs stacks', () => {
    const i = item('i', { startTime: '13:00', endTime: '15:00' });
    expect(timeLabel({ item: i, continuation: false }, SYDNEY_TZ, 'board').lines).toEqual(['1:00 – 3:00 pm']);
    expect(timeLabel({ item: i, continuation: false }, SYDNEY_TZ, 'tabs').lines).toEqual(['1:00 pm', '3:00 pm']);
    const j = item('j', { startTime: '11:30', endTime: '12:30' });
    expect(timeLabel({ item: j, continuation: false }, SYDNEY_TZ, 'board').lines).toEqual(['11:30 am –', '12:30 pm']);
  });

  it('labels another zone and the next day; continuation shows Sydney end', () => {
    const own = timeLabel({ item: flight, continuation: false }, SYDNEY_TZ, 'board');
    expect(own.lines).toEqual(['9:50 pm –', '8:05 am']);
    expect(own.note).toBe('KST · next day');
    expect(timeLabel({ item: flight, continuation: true }, SYDNEY_TZ, 'board').lines).toEqual(['until 10:05 am']);
  });
});

describe('passed / window / default day / mix', () => {
  it('passed uses the end instant', () => {
    const i = item('i', { startTime: '09:00', endTime: '10:00' });
    expect(isPassed(i, syd('2030-12-28', '09:59'), '2030-12-28')).toBe(false);
    expect(isPassed(i, syd('2030-12-28', '10:00'), '2030-12-28')).toBe(true);
  });

  it('overview keeps Now in view', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7];
    expect(overviewWindow(rows, () => false)).toEqual([1, 2, 3, 4]);
    expect(overviewWindow(rows, (r) => r === 5)).toEqual([4, 5, 6, 7]);
    expect(overviewWindow(rows, (r) => r === 3)).toEqual([2, 3, 4, 5]);
    expect(overviewWindow([1, 2], () => true)).toEqual([1, 2]);
  });

  it('default day: today in the trip, else Day 1 before and Day 9 after', () => {
    const days = ['2030-12-26', '2030-12-27', '2031-01-03'].map((date) => ({ date }));
    expect(defaultDay(days, '2030-10-31')).toBe('2030-12-26');
    expect(defaultDay(days, '2030-12-27')).toBe('2030-12-27');
    expect(defaultDay(days, '2031-02-01')).toBe('2031-01-03');
    expect(defaultDay(days, null)).toBe('2030-12-26');
  });

  it('mix label', () => {
    expect(mixLabel([item('a'), item('b', { participants: 'amy' })])).toBe('Together & on our own');
    expect(mixLabel([item('a')])).toBe('Together');
    expect(mixLabel([])).toBeNull();
  });
});

describe('Prelude link rules (§7.3)', () => {
  it('item status drives the activity; Done is never overwritten', () => {
    expect(linkedActivityStatus('idea', 'idea')).toBe('idea');
    expect(linkedActivityStatus('planned', 'idea')).toBe('planned');
    expect(linkedActivityStatus('confirmed', 'idea')).toBe('planned');
    expect(linkedActivityStatus('idea', 'planned')).toBe('idea');
    expect(linkedActivityStatus('confirmed', 'done')).toBe('done');
  });

  it('linking, relinking and deleting', () => {
    const a = activity('a', { itineraryItemId: 'it1' });
    const b = activity('b');
    const done = activity('d', { status: 'done', itineraryItemId: 'it1' });
    // Choose b on a planned item: a unlinks to Idea, b links as Planned.
    expect(activityPatchesForItem('it1', 'planned', [a, b], 'b')).toEqual([
      { activity: a, patch: { itineraryItemId: null, status: 'idea' } },
      { activity: b, patch: { itineraryItemId: 'it1', status: 'planned' } },
    ]);
    // Same link, Idea item: nothing to write.
    expect(activityPatchesForItem('it1', 'idea', [a], 'a')).toEqual([]);
    // Item deleted: Done stays Done but loses the link.
    expect(activityPatchesForItem('it1', null, [a, done], null)).toEqual([
      { activity: a, patch: { itineraryItemId: null, status: 'idea' } },
      { activity: done, patch: { itineraryItemId: null, status: 'done' } },
    ]);
    // Server-managed status: link changes only, and deletes are left to the trigger.
    expect(activityPatchesForItem('it1', 'planned', [a, b], 'b', true)).toEqual([
      { activity: a, patch: { itineraryItemId: null } },
      { activity: b, patch: { itineraryItemId: 'it1' } },
    ]);
    expect(activityPatchesForItem('it1', 'idea', [a], 'a', true)).toEqual([]);
    expect(activityPatchesForItem('it1', null, [a, done], null, true)).toEqual([]);
  });

  it('sorts Planned by date, then Idea, Done apart; when line', () => {
    const late = item('late', { date: '2030-12-29', startTime: '11:30', endTime: '12:00' });
    const early = item('early', { date: '2030-12-27', startTime: '14:30', endTime: '15:00' });
    const items = new Map([late, early].map((i) => [i.id, i]));
    const list = [
      activity('idea', { sortOrder: 1 }),
      activity('p-late', { status: 'planned', itineraryItemId: 'late' }),
      activity('p-early', { status: 'planned', itineraryItemId: 'early' }),
      activity('done', { status: 'done' }),
    ];
    const { open, done } = sortActivities(list, items);
    expect(open.map((a) => a.id)).toEqual(['p-early', 'p-late', 'idea']);
    expect(done.map((a) => a.id)).toEqual(['done']);
    const days = [{ date: '2030-12-27', dayNumber: 2 }] as TripDay[];
    expect(whenLine(early, days, SYDNEY_TZ)).toBe('Day 2 · Fri, 27 Dec · 2:30 – 3:00 pm');
  });
});

describe('shownStatus', () => {
  it('reads passed Planned / Fixed items as Completed; Ideas stay ideas', () => {
    expect(shownStatus('planned', true)).toBe('completed');
    expect(shownStatus('confirmed', true)).toBe('completed');
    expect(shownStatus('idea', true)).toBe('idea');
    expect(shownStatus('confirmed', false)).toBe('confirmed');
  });
});
