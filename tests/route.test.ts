// Route map helpers (plan §7.2.7). Fictional data only (trip year 2030).
import { describe, expect, it } from 'vitest';
import {
  apartOvernight,
  startsApart,
  boundsOf,
  buildDayRoute,
  buildTripRoutes,
  directionsUrl,
  flightAirports,
  groupLane,
  groupStops,
  incomingSegment,
  isFocusLane,
  lineStyle,
  meetUpIds,
  metresBetween,
  narrowRoute,
  numberText,
  offsetSegment,
  orderForRoute,
  pinText,
  placeLabel,
  placeRuns,
  stopLabel,
  timeBlocks,
} from '@/components/route/routeLogic';
import { placeAround, stackLabels } from '@/lib/mapLabels';
import { SEOUL_TZ, SYDNEY_TZ } from '@/lib/time/zone';
import type { Booking, ItineraryItem } from '@/lib/types';
import { item } from './fixtures';

const D = '2030-12-29';
let k = 0;
/** Placed item at a fictional spot (each call nudges the coordinates). */
const at = (id: string, startTime: string | null, p: Partial<ItineraryItem> = {}) =>
  item(id, { date: D, startTime, timeKind: startTime ? 'timed' : 'unscheduled', mapLat: -33.8 - ++k / 100, mapLng: 151.2, ...p });

const ids = (xs: Array<{ item: { id: string } }>) => xs.map((x) => x.item.id);
const segs = (r: ReturnType<typeof buildDayRoute>) => r.segments.map((s) => `${s.from.item.id}>${s.to.item.id}:${s.lane}`);

describe('orderForRoute', () => {
  it('orders timed by start then sortOrder, untimed last by sortOrder', () => {
    const xs = [
      at('u2', null, { sortOrder: 2 }),
      at('b', '10:00', { sortOrder: 5 }),
      at('a2', '09:00', { sortOrder: 2 }),
      at('u1', null, { sortOrder: 1, timeKind: 'all_day' }),
      at('a1', '09:00', { sortOrder: 1 }),
    ];
    expect(orderForRoute(xs).map((i) => i.id)).toEqual(['a1', 'a2', 'b', 'u1', 'u2']);
  });
});

describe('buildDayRoute', () => {
  it('numbers placed stops in order; collects items without coordinates', () => {
    const r = buildDayRoute(
      [at('b', '11:00'), at('a', '09:00'), item('x', { date: D, startTime: '10:00' }), at('u', null)],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.stops.map((s) => [s.item.id, s.n])).toEqual([
      ['a', 1],
      ['b', 2],
      ['u', 3],
    ]);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['x']);
    // Untimed stops get a pin but no line.
    expect(segs(r)).toEqual(['a>b:together']);
  });

  it('drops cancelled, deleted and other days; keeps home-zone legs in real time order', () => {
    const r = buildDayRoute(
      [
        at('ok', '09:00'),
        at('cx', '10:00', { status: 'cancelled' }),
        at('del', '11:00', { deletedAt: '2030-12-01T00:00:00Z' }),
        at('other', '12:00', { date: '2030-12-30' }),
        at('home', '08:00', { timezone: SEOUL_TZ }),
        item('home-nocoords', { date: D, timezone: SEOUL_TZ }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    // 09:00 in Sydney is 07:00 in Seoul, so it comes before 08:00 Seoul time.
    expect(ids(r.stops)).toEqual(['ok', 'home']);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['home-nocoords']);
  });

  it('splits into E and A lines and marks the next Together stop as Meet up', () => {
    const xs = [
      at('t1', '09:00'),
      at('e1', '10:00', { participants: 'eren' }),
      at('a1', '10:00', { participants: 'amy' }),
      at('a2', '11:00', { participants: 'amy' }),
      at('t2', '12:00'),
      at('t3', '13:00'),
    ];
    const r = buildDayRoute(xs, D, 'together', SYDNEY_TZ);
    expect(segs(r)).toEqual(['t1>e1:eren', 't1>a1:amy', 'a1>a2:amy', 'e1>t2:eren', 'a2>t2:amy', 't2>t3:together']);
    expect(r.stops.filter((s) => s.meetUp).map((s) => s.item.id)).toEqual(['t2']);
    expect(r.stops.find((s) => s.item.id === 'e1')?.lane).toBe('eren');
  });

  it('a person without solo stops still walks their own line into the meet-up', () => {
    const r = buildDayRoute([at('t1', '09:00'), at('a1', '10:00', { participants: 'amy' }), at('t2', '11:00')], D, 'together', SYDNEY_TZ);
    expect(segs(r)).toEqual(['t1>a1:amy', 't1>t2:eren', 'a1>t2:amy']);
    expect(r.stops.find((s) => s.item.id === 't2')?.meetUp).toBe(true);
  });

  it('a day that starts apart meets up at the first Together stop', () => {
    const r = buildDayRoute(
      [at('e1', '08:00', { participants: 'eren' }), at('a1', '09:00', { participants: 'amy' }), at('t1', '18:00')],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(segs(r)).toEqual(['e1>t1:eren', 'a1>t1:amy']);
    expect(r.stops.find((s) => s.item.id === 't1')?.meetUp).toBe(true);
  });

  it('Eren filter keeps Together + Eren stops and lines; each route numbered on its own; meet-up still known', () => {
    const xs = [
      at('t1', '09:00'),
      at('e1', '10:00', { participants: 'eren' }),
      at('a1', '10:30', { participants: 'amy' }),
      at('t2', '12:00'),
      item('a-nocoords', { date: D, participants: 'amy' }),
      item('e-nocoords', { date: D, participants: 'eren' }),
    ];
    const r = buildDayRoute(xs, D, 'eren', SYDNEY_TZ);
    // Where we split (t1) is numbered; where we meet (t2) is M on every route.
    expect(r.stops.map((s) => [s.item.id, numberText(s.n)])).toEqual([
      ['t1', '1'],
      ['e1', '2'],
      ['t2', 'M'],
    ]);
    expect(r.stops.map((s) => numberText(s.routes.eren!))).toEqual(['1', '2', 'M']);
    expect(segs(r)).toEqual(['t1>e1:eren', 'e1>t2:eren']);
    expect(r.stops[2].meetUp).toBe(true);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['e-nocoords']);
  });

  it('marks lines into ideas; how we travel is not part of a line', () => {
    const r = buildDayRoute(
      [at('a', '09:00'), at('b', '10:00', { travelMode: 'transit' }), at('c', '11:00', { status: 'idea' })],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.segments.map((s) => s.idea)).toEqual([false, true]);
    expect(r.segments.every((s) => !('mode' in s))).toBe(true);
  });

  it('numbers places, not plans: the same Google Maps link in a row shares the first one’s number', () => {
    const P = { mapUrl: 'https://maps.app.goo.gl/place-p', mapLat: -33.86, mapLng: 151.2 };
    const Q = { mapUrl: 'https://maps.app.goo.gl/place-q', mapLat: -33.865, mapLng: 151.2 };
    const r = buildDayRoute(
      [at('a', '09:00', P), at('b', '10:00', P), at('c', '11:00', P), at('d', '12:00', Q), at('e', '13:00', P)],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.stops.map((s) => [s.item.id, s.n])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
      ['d', 2],
      ['e', 3], // back to P later: a new number
    ]);
    expect(placeRuns(r.stops).map((p) => [p.n, ids(p.stops)])).toEqual([
      [1, ['a', 'b', 'c']],
      [2, ['d']],
      [3, ['e']],
    ]);
    expect(segs(r)).toEqual(['c>d:together', 'd>e:together']);
    expect(groupStops(r.stops).map((g) => pinText(g.stops.map((x) => x.n)))).toEqual(['1·3', '2']);
  });

  it('skips zero-length lines between stops at the same spot', () => {
    const r = buildDayRoute([at('a', '09:00', { mapLat: -33.9, mapLng: 151.2 }), at('b', '10:00', { mapLat: -33.9, mapLng: 151.2 })], D, 'together', SYDNEY_TZ);
    expect(r.segments).toEqual([]);
    expect(groupStops(r.stops)).toHaveLength(1);
  });

  it('buildTripRoutes returns one route per day, in day order', () => {
    const days = [{ date: '2030-12-28' }, { date: D }];
    const r = buildTripRoutes([at('x', '09:00'), at('y', '09:00', { date: '2030-12-28' })], days, 'together', SYDNEY_TZ);
    expect(r.map((d) => [d.date, ids(d.stops)])).toEqual([
      ['2030-12-28', ['y']],
      [D, ['x']],
    ]);
  });
});

describe('lineStyle', () => {
  it('tells people apart only: solid, one look for every way of travelling', () => {
    expect(lineStyle('eren')).toEqual({ color: '#286A82', weight: 3.5, opacity: 0.9, dashArray: null });
    expect(lineStyle('amy').color).toBe('#A98248');
    expect(lineStyle('together')).toMatchObject({ color: '#172F3B', weight: 4, dashArray: null });
  });
});

describe('directionsUrl', () => {
  it('builds a Google Maps directions link by coordinates; Google picks the way', () => {
    expect(directionsUrl({ lat: -33.86, lng: 151.21 }, { lat: -33.8731, lng: 151.2065 })).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-33.8731,151.2065&destination=-33.86,151.21',
    );
    expect(directionsUrl({ lat: -33.86, lng: 151.21 }, null)).toBe('https://www.google.com/maps/dir/?api=1&destination=-33.86,151.21');
    expect(directionsUrl({ lat: 12.345678912, lng: 45.6 }, null)).toContain('destination=12.345679,45.6');
  });

  it('incomingSegment prefers the viewer’s lane at a meet-up', () => {
    const r = buildDayRoute(
      [at('t1', '09:00'), at('e1', '10:00', { participants: 'eren' }), at('a1', '10:00', { participants: 'amy' }), at('t2', '12:00')],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(incomingSegment(r, 't2', 'amy')?.from.item.id).toBe('a1');
    expect(incomingSegment(r, 't2', 'eren')?.from.item.id).toBe('e1');
    expect(incomingSegment(r, 't1', 'eren')).toBeNull();
  });
});

describe('pins and labels', () => {
  it('pinText: one number per place, each place number once', () => {
    expect(pinText([3])).toBe('3');
    expect(pinText([1, 1, 1])).toBe('1');
    expect(pinText([3, 1, 1])).toBe('1·3');
    expect(pinText([])).toBe('');
    expect(pinText([2, -1])).toBe('M·2');
    expect(pinText([-1, -3])).toBe('M');
  });

  it('different links are different places, even a few metres apart; the same link is one', () => {
    const r = buildDayRoute(
      [
        at('a', '09:00', { mapUrl: 'https://maps.app.goo.gl/one', mapLat: -33.86, mapLng: 151.2 }),
        at('b', '10:00', { mapUrl: 'https://maps.app.goo.gl/two', mapLat: -33.8602, mapLng: 151.2003 }), // ~35 m
        at('c', '11:00', { mapUrl: 'https://maps.app.goo.gl/one', mapLat: -33.86, mapLng: 151.2 }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.stops.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(groupStops(r.stops).map((g) => ids(g.stops))).toEqual([['a', 'c'], ['b']]);
  });

  it('only a link places a plan: the same place name without one waits under Not on map', () => {
    const r = buildDayRoute(
      [
        at('a', '09:00', { place: 'Plaza', mapLat: -33.87, mapLng: 151.2 }),
        item('b', { date: D, startTime: '10:00', place: 'Plaza' }),
        at('c', '11:00', { place: 'Plaza', mapUrl: 'https://maps.app.goo.gl/other', mapLat: -33.8725, mapLng: 151.2 }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.stops.map((s) => [s.item.id, s.n])).toEqual([
      ['a', 1],
      ['c', 2], // another link's spot: another place, whatever the name
    ]);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['b']);
  });

  it('a place still to be decided ("숙소 미정") stays off the map, even with a link', () => {
    const r = buildDayRoute(
      [at('move', '14:00', { place: 'Airport area' }), at('hotel', '16:30', { place: 'Airport area · 숙소 미정' })],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(ids(r.stops)).toEqual(['move']);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['hotel']);
  });



  it('groupLane: shared pin of different people is Together', () => {
    const r = buildDayRoute(
      [at('e', '09:00', { participants: 'eren', mapLat: -33.87, mapLng: 151.2 }), at('a', '09:00', { participants: 'amy', mapLat: -33.87, mapLng: 151.2 })],
      D,
      'together',
      SYDNEY_TZ,
    );
    const [g] = groupStops(r.stops);
    expect(g.stops).toHaveLength(2);
    expect(groupLane(g)).toBe('together');
  });

  it('placeLabel takes the destination and the first part; a flight is named where it leaves', () => {
    expect(placeLabel('Plaza → Hilltown', 'Train')).toBe('Hilltown');
    expect(placeLabel('Plaza Station · south concourse', 'Piano')).toBe('Plaza Station');
    expect(placeLabel('  ', 'Lunch')).toBe('Lunch');
    expect(stopLabel({ place: 'Plaza → Hilltown', title: 'Train' })).toBe('Hilltown');
    expect(stopLabel({ place: 'ICN T1 → SYD T1', title: 'Flight' })).toBe('ICN T1');
  });

  it('stackLabels keeps every label, stepping overlapping ones down then up', () => {
    // Two labels on the same pin: the second moves one label height (+2px gap) down.
    expect(
      stackLabels([
        { x: 0, y: 0, w: 50, h: 20 },
        { x: 10, y: 0, w: 50, h: 20 },
        { x: 60, y: 0, w: 50, h: 20 },
        null,
      ]),
    ).toEqual([0, 22, 0, null]);
    // At the bottom of the map there is no room below: the label goes up instead.
    expect(
      stackLabels(
        [
          { x: 0, y: 80, w: 50, h: 20 },
          { x: 0, y: 80, w: 50, h: 20 },
        ],
        { x: 0, y: 0, w: 200, h: 100 },
      ),
    ).toEqual([0, -22]);
  });

  it('offsetSegment shifts perpendicular by px', () => {
    const [a, b] = offsetSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBe(3);
    expect(b).toEqual({ x: 10, y: 3 });
    expect(offsetSegment({ x: 1, y: 1 }, { x: 1, y: 1 }, 3)).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('boundsOf', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { lat: -33.9, lng: 151.2 },
        { lat: -33.5, lng: 151.0 },
      ]),
    ).toEqual([
      [-33.9, 151.0],
      [-33.5, 151.2],
    ]);
  });
});

describe('flights', () => {
  it('flightAirports reads airport codes and terminals from the place', () => {
    const f = flightAirports({ place: 'ICN T1 → SYD T1' });
    expect([f?.from.code, f?.to.code]).toEqual(['ICN T1', 'SYD T1']);
    expect(f!.from.lat).toBeGreaterThan(30); // Korea
    expect(f!.to.lat).toBeLessThan(-30); // Sydney
    expect(flightAirports({ place: 'SYD -> ICN' })?.to.code).toBe('ICN');
    expect(flightAirports({ place: 'SYD T9 → ICN' })?.from.code).toBe('SYD T9'); // unknown terminal: the airport's spot
    expect(flightAirports({ place: 'XXX → SYD' })).toBeNull();
    expect(flightAirports({ place: 'Harbour walk' })).toBeNull();
  });

  const fly = (id: string, startTime: string, place: string, timezone = SEOUL_TZ) =>
    item(id, { date: D, startTime, timezone, category: 'transport', place });

  it('a flight with its link on the check-in spot is the same place, and is drawn to arrival', () => {
    const r = buildDayRoute(
      [at('checkin', '19:30', { timezone: SEOUL_TZ, mapLat: 37.447, mapLng: 126.4489 }), at('fly', '21:50', { timezone: SEOUL_TZ, place: 'ICN T1 → SYD T1', mapLat: 37.447, mapLng: 126.4489 })],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.stops.map((s) => [s.item.id, s.n])).toEqual([
      ['checkin', 1],
      ['fly', 1],
    ]);
    expect(r.segments).toEqual([]);
    expect(r.flights.map((f) => [f.item.id, f.from.code, f.to.code, f.lane])).toEqual([['fly', 'ICN T1', 'SYD T1', 'together']]);
    expect(narrowRoute(r, 'eren').flights).toEqual([]);
  });

  it('a flight without a link waits under Not on map like any plan', () => {
    const r = buildDayRoute([at('hotel', '08:00'), fly('fly', '12:15', 'SYD T1 → ICN T1', SYDNEY_TZ)], D, 'together', SYDNEY_TZ);
    expect(ids(r.stops)).toEqual(['hotel']);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['fly']);
  });

  it('a stop already at the arrival airport takes the line: no second line, no second ICN label', () => {
    const r = buildDayRoute(
      [
        at('airport', '09:15', { mapLat: -33.9361, mapLng: 151.1659 }),
        at('fly', '12:15', { place: 'SYD T1 → ICN T1', mapLat: -33.9361, mapLng: 151.1659 }),
        at('home', '21:15', { timezone: SEOUL_TZ, mapLat: 37.447, mapLng: 126.4489 }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.stops.map((s) => [s.item.id, s.n])).toEqual([
      ['airport', 1],
      ['fly', 1],
      ['home', 2],
    ]);
    expect(r.flights).toEqual([]);
    expect(segs(r)).toEqual(['fly>home:together']);
  });


  it('Together keeps to its own plans; Eren’s route runs on to where we meet', () => {
    const all = buildDayRoute(
      [
        at('move', '17:00', { timezone: SEOUL_TZ, participants: 'eren', mapLat: 37.447, mapLng: 126.4489 }),
        at('checkin', '19:00', { timezone: SEOUL_TZ, mapLat: 37.447, mapLng: 126.4489 }),
        at('fly', '21:50', { timezone: SEOUL_TZ, place: 'ICN T1 → SYD T1', mapLat: 37.447, mapLng: 126.4489 }),
        at('elsewhere', '08:00', { participants: 'eren' }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    // We meet at the check-in: M, and the flight from the same spot shares it.
    expect(placeRuns(narrowRoute(all, 'together').stops).map((p) => [numberText(p.n), ids(p.stops)])).toEqual([['M', ['checkin', 'fly']]]);
    expect(placeRuns(narrowRoute(all, 'eren').stops).map((p) => [numberText(p.n), ids(p.stops)])).toEqual([
      ['1', ['elsewhere']],
      ['2', ['move']],
      ['M', ['checkin']], // the same spot as his 2, but where we meet is always M
    ]);
  });

  it('a place named nowhere else and without a link stays off the map', () => {
    const r = buildDayRoute([at('a', '09:00', { place: 'Harbour' }), item('b', { date: D, startTime: '10:00', place: 'Somewhere else' })], D, 'together', SYDNEY_TZ);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['b']);
  });

  it('a stop at the arrival airport with no time draws no line, so the flight keeps its own', () => {
    const r = buildDayRoute(
      [
        at('airport', '09:15', { mapLat: -33.9361, mapLng: 151.1659 }),
        at('fly', '12:15', { place: 'SYD T1 → ICN T1', mapLat: -33.9361, mapLng: 151.1659 }),
        at('home', null, { timezone: SEOUL_TZ, mapLat: 37.447, mapLng: 126.4489 }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.flights.map((f) => f.to.code)).toEqual(['ICN T1']);
  });

});

describe('people filter on the map', () => {
  it('narrowRoute: a person’s route starts where we split up (numbered) and ends at M where we meet: 1, 2, M', () => {
    const all = buildDayRoute([at('t1', '09:00'), at('a1', '10:00', { participants: 'amy' }), at('e1', '10:30', { participants: 'eren' }), at('t2', '11:00')], D, 'together', SYDNEY_TZ);
    const eren = narrowRoute(all, 'eren');
    expect(eren.stops.map((x) => [x.item.id, numberText(x.n)])).toEqual([
      ['t1', '1'],
      ['e1', '2'],
      ['t2', 'M'],
    ]);
    expect(segs(eren).every((id) => id.endsWith(':eren'))).toBe(true);
    const together = narrowRoute(all, 'together');
    expect(together.stops.map((x) => [x.item.id, numberText(x.n)])).toEqual([['t1', '1'], ['t2', 'M']]);
    expect(segs(together).every((id) => id.endsWith(':together'))).toBe(true);
  });
  it('isFocusLane keeps each lane on its own (Together excludes the solo plans)', () => {
    expect(isFocusLane('together', 'eren')).toBe(false);
    expect(isFocusLane('eren', 'eren')).toBe(true);
    expect(isFocusLane('amy', 'eren')).toBe(false);
    expect(isFocusLane('amy', 'together')).toBe(false);
    expect(isFocusLane('together', 'together')).toBe(true);
    expect((['together', 'eren', 'amy'] as const).every((l) => isFocusLane(l, 'all'))).toBe(true);
  });
  it('after a night in separate stays, the first Together plan of the day is a Meet up (M)', () => {
    const stay = (id: string, guests: 'eren' | 'amy' | 'both', checkInDate: string, checkOutDate: string) =>
      ({ id, deletedAt: null, status: 'booked', detail: { kind: 'stay', name: id, checkInDate, checkOutDate, guests } }) as unknown as Booking;
    const apart = [stay('e', 'eren', '2030-12-27', '2030-12-31'), stay('a', 'amy', '2030-12-27', '2030-12-31')];
    expect(apartOvernight(apart, D)).toBe(true); // the night of the 28th
    expect(apartOvernight(apart, '2030-12-27')).toBe(false); // no stay the night before
    expect(apartOvernight([...apart, stay('b', 'both', '2030-12-28', '2030-12-29')], D)).toBe(false);
    // The list's Meet ups: the same rule, also over plans without a map link.
    const noLink = item('solo', { date: D, startTime: '12:00', participants: 'amy' });
    expect([...meetUpIds([at('meet', '07:30'), at('train', '08:00'), noLink, at('dinner', '18:00')], apart, SYDNEY_TZ)].sort()).toEqual(['dinner', 'meet']);
    // An overnight flight we take together runs into the day: we did not wake up apart.
    const flight = item('fly', { date: '2030-12-28', startTime: '21:50', endTime: '10:05', endDate: D, timezone: SEOUL_TZ });
    expect(startsApart([flight], apart, D, SYDNEY_TZ)).toBe(false);
    expect(startsApart([], apart, D, SYDNEY_TZ)).toBe(true);
    const r = buildDayRoute([at('meet', '07:30'), at('train', '08:00')], D, 'all', SYDNEY_TZ, true);
    expect(r.stops.map((x) => [x.item.id, numberText(x.n), x.meetUp])).toEqual([
      ['meet', 'M', true],
      ['train', '1', false],
    ]);
  });
  it('narrowRoute All: everyone, each person numbered on their own plans only', () => {
    const all = buildDayRoute(
      [at('t1', '09:00'), at('a1', '10:00', { participants: 'amy' }), at('e1', '10:30', { participants: 'eren' }), at('e2', '10:45', { participants: 'eren' }), at('t2', '11:00')],
      D,
      'all',
      SYDNEY_TZ,
    );
    const everyone = narrowRoute(all, 'all');
    expect(everyone.stops.map((x) => [x.item.id, x.lane, numberText(x.n)])).toEqual([
      ['t1', 'together', '1'],
      ['a1', 'amy', '1'],
      ['e1', 'eren', '1'],
      ['e2', 'eren', '2'],
      ['t2', 'together', 'M'],
    ]);
    expect(everyone.segments.length).toBe(all.segments.length);
    // The All list in time order: Together → Eren / Amy → Together.
    expect(
      timeBlocks(everyone.stops).map((b) => (b.kind === 'together' ? ['together', ids(b.stops)] : ['apart', ids(b.eren), ids(b.amy)])),
    ).toEqual([
      ['together', ['t1']],
      ['apart', ['e1', 'e2'], ['a1']],
      ['together', ['t2']],
    ]);
    // Built for everyone, the solo lines are kept: t1 > a1 > t2 and t1 > e1 > e2 > t2.
    expect(segs(all).sort()).toEqual(['a1>t2:amy', 'e1>e2:eren', 'e2>t2:eren', 't1>a1:amy', 't1>e1:eren']);
  });
});

describe('names around their pins', () => {
  it('a name goes right of its pin, else left, above, below…, always inside the map and clear of other names', () => {
    const area = { x: 0, y: 0, w: 300, h: 200 };
    const pins = [{ x: 280, y: 100 }, { x: 100, y: 100 }];
    const spots = placeAround(
      [
        { w: 80, h: 20, pin: pins[0] }, // near the right edge: no room on its right
        { w: 60, h: 20, pin: pins[1] },
        { w: 60, h: 20, pin: pins[1] }, // a second name on the same pin
      ],
      pins,
      area,
    );
    expect(spots[0]!.x + 80).toBeLessThanOrEqual(298); // moved left, not cut off
    expect(spots[0]!.x).toBeLessThan(280);
    expect(spots[1]).toMatchObject({ x: 118, away: false }); // right of its pin
    expect(spots[2]!.x).toBeLessThan(100); // the next free side: left
    expect(spots.every((s) => s && s.y >= 2 && s.y + 20 <= 198)).toBe(true);
  });
});
