import { describe, expect, it } from 'vitest';
import { countdown, formatCountdown } from '@/lib/time/countdown';
import { coverPhase, formatSydneyClock, nextCoverBoundary } from '@/lib/time/cover';
import { computeNow } from '@/lib/time/now';
import { SEOUL_TZ, SYDNEY_TZ, addDays, diffDays, formatDayLabel, zonedDate, zonedToInstant } from '@/lib/time/zone';
import { item } from './fixtures';

const syd = (date: string, time: string) => zonedToInstant(date, time, SYDNEY_TZ);
const kst = (date: string, time: string) => zonedToInstant(date, time, SEOUL_TZ);

describe('zone', () => {
  it('converts wall clock to instants in AEDT and AEST', () => {
    expect(syd('2030-12-28', '10:00').toISOString()).toBe('2030-12-27T23:00:00.000Z');
    expect(syd('2030-07-01', '10:00').toISOString()).toBe('2030-07-01T00:00:00.000Z');
    expect(kst('2030-12-26', '21:50').toISOString()).toBe('2030-12-26T12:50:00.000Z');
  });
  it('handles a DST gap deterministically', () => {
    // Sydney springs forward 2030-10-06 02:00 → 03:00.
    expect(syd('2030-10-06', '02:30').toISOString()).toBe('2030-10-05T16:30:00.000Z');
  });
  it('calendar helpers', () => {
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(diffDays('2030-12-26', '2030-10-31')).toBe(56);
    expect(formatDayLabel('2030-12-28')).toBe('Sat, 28 Dec');
    expect(zonedDate(new Date('2030-12-27T14:00:00Z'), SYDNEY_TZ)).toBe('2030-12-28');
  });
});

describe('cover phase', () => {
  const cases: Array<[string, string, string]> = [
    ['05:59', 'night', '2030-12-28'],
    ['06:00', 'day', '2030-12-28'],
    ['17:59', 'day', '2030-12-28'],
    ['18:00', 'evening', '2030-12-28'],
    ['20:59', 'evening', '2030-12-28'],
    ['21:00', 'night', '2030-12-28'],
    ['05:59', 'night', '2030-07-01'],
    ['06:00', 'day', '2030-07-01'],
    ['21:00', 'night', '2030-07-01'],
  ];
  it.each(cases)('%s Sydney → %s (%s)', (time, phase, date) => {
    expect(coverPhase(syd(date, time))).toBe(phase);
  });
  it('next boundary', () => {
    expect(nextCoverBoundary(syd('2030-12-28', '17:59'))).toEqual(syd('2030-12-28', '18:00'));
    expect(nextCoverBoundary(syd('2030-12-28', '18:00'))).toEqual(syd('2030-12-28', '21:00'));
    expect(nextCoverBoundary(syd('2030-12-28', '23:00'))).toEqual(syd('2030-12-29', '06:00'));
  });
  it('clock label', () => {
    expect(formatSydneyClock(syd('2030-12-28', '19:42'))).toBe('7:42 pm');
    expect(formatSydneyClock(syd('2030-12-28', '00:05'))).toBe('12:05 am');
  });
});

describe('countdown (Korean calendar)', () => {
  const input = {
    startDate: '2030-12-26',
    endDate: '2031-01-03',
    homeTimezone: SEOUL_TZ,
    departureAt: kst('2030-12-26', '21:50'),
    airportBy: kst('2030-12-26', '18:50'),
  };
  const at = (d: string, t: string) => formatCountdown(countdown(kst(d, t), input));
  it('before departure day', () => {
    expect(at('2030-10-31', '09:00')).toBe('D-56 · Until Sydney');
    expect(at('2030-10-31', '23:59')).toBe('D-56 · Until Sydney');
    expect(at('2030-12-25', '23:59')).toBe('D-1 · Until Sydney');
  });
  it('departure day', () => {
    expect(at('2030-12-26', '00:00')).toBe('D-Day · Departs in 21h 50m');
    expect(at('2030-12-26', '16:38')).toBe('D-Day · Departs in 5h 12m');
    expect(at('2030-12-26', '18:50')).toBe('D-Day · Time to be at the airport');
  });
  it('during and after', () => {
    expect(at('2030-12-26', '21:50')).toBe('Day 1 of 9');
    expect(at('2030-12-28', '12:00')).toBe('Day 3 of 9');
    expect(at('2031-01-03', '23:00')).toBe('Day 9 of 9');
    expect(at('2031-01-04', '00:00')).toBe('Welcome home');
  });
});

describe('computeNow', () => {
  const D = '2030-12-28';
  const now = (t: string) => syd(D, t);
  it('start ≤ now < end', () => {
    const items = [item('a', { startTime: '09:00', endTime: '10:00' })];
    expect(computeNow(items, now('09:00'), D).nowIds).toEqual(['a']);
    expect(computeNow(items, now('09:59'), D).nowIds).toEqual(['a']);
    expect(computeNow(items, now('10:00'), D).nowIds).toEqual([]);
  });
  it('no end → until next different start, else Sydney midnight', () => {
    const items = [item('a', { startTime: '09:00' }), item('b', { startTime: '12:00' })];
    expect(computeNow(items, now('11:59'), D).nowIds).toEqual(['a']);
    expect(computeNow(items, now('12:00'), D).nowIds).toEqual(['b']);
    expect(computeNow(items, now('23:59'), D).nowIds).toEqual(['b']);
    expect(computeNow(items, syd('2030-12-29', '00:00'), '2030-12-29').nowIds).toEqual([]);
  });
  it('idea/cancelled items are not boundaries; completed still is', () => {
    const items = [
      item('a', { startTime: '09:00' }),
      item('idea', { startTime: '10:00', status: 'idea' }),
      item('done', { startTime: '11:00', status: 'completed' }),
    ];
    expect(computeNow(items, now('10:30'), D).nowIds).toEqual(['a']);
    expect(computeNow(items, now('11:30'), D).nowIds).toEqual([]);
  });
  it('same start highlighted together; overlaps each judged alone', () => {
    const items = [
      item('a', { startTime: '14:00', endTime: '15:00', participants: 'eren' }),
      item('b', { startTime: '14:00', endTime: '16:00', participants: 'amy' }),
      item('c', { startTime: '14:30', endTime: '15:30' }),
    ];
    expect(computeNow(items, now('14:10'), D).nowIds).toEqual(['a', 'b']);
    expect(computeNow(items, now('15:10'), D).nowIds).toEqual(['b', 'c']);
  });
  it('exclusions', () => {
    const items = [
      item('idea', { status: 'idea', endTime: '18:00' }),
      item('cx', { status: 'cancelled', endTime: '18:00' }),
      item('done', { status: 'completed', endTime: '18:00' }),
      item('allday', { timeKind: 'all_day', startTime: null }),
      item('tbd', { timeKind: 'unscheduled', startTime: null }),
      item('gone', { endTime: '18:00', deletedAt: '2030-01-02T00:00:00Z' }),
    ];
    expect(computeNow(items, now('10:00'), D)).toEqual({ nowIds: [], upNextIds: [] });
  });
  it('other day tab never highlights', () => {
    const items = [item('x', { date: '2030-12-29', startTime: '14:00', endTime: '15:00' })];
    expect(computeNow(items, now('14:30'), '2030-12-29').nowIds).toEqual([]);
    expect(computeNow([item('y', { endTime: '18:00' })], now('10:00'), '2030-12-29').nowIds).toEqual([]);
  });
  it('Up Next in gaps and before the first item', () => {
    const items = [
      item('a', { startTime: '09:00', endTime: '10:00' }),
      item('b', { startTime: '13:00', endTime: '14:00' }),
      item('c', { startTime: '13:00', endTime: '15:00' }),
    ];
    expect(computeNow(items, now('08:00'), D)).toEqual({ nowIds: [], upNextIds: ['a'] });
    expect(computeNow(items, now('11:00'), D)).toEqual({ nowIds: [], upNextIds: ['b', 'c'] });
    expect(computeNow(items, now('16:00'), D)).toEqual({ nowIds: [], upNextIds: [] });
  });
  it('overnight item continues into the next Sydney day', () => {
    const items = [item('late', { startTime: '22:00', endTime: '01:00' })];
    expect(computeNow(items, syd('2030-12-29', '00:30'), '2030-12-29').nowIds).toEqual(['late']);
    expect(computeNow(items, syd('2030-12-29', '01:00'), '2030-12-29').nowIds).toEqual([]);
  });
  it('items timed in another zone (KST departure) compare by instant', () => {
    const items = [
      item('dep', {
        date: '2030-12-26',
        startTime: '21:50',
        endTime: '10:05',
        endDate: '2030-12-27',
        timezone: SEOUL_TZ,
      }),
    ];
    // 21:50 KST = 23:50 AEDT on the 26th.
    expect(computeNow(items, syd('2030-12-26', '23:49'), '2030-12-26').nowIds).toEqual([]);
    expect(computeNow(items, syd('2030-12-26', '23:50'), '2030-12-26').nowIds).toEqual(['dep']);
  });
});
