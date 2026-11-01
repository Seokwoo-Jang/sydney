// Route map helpers (plan §7.2.7). Fictional data only (trip year 2030).
import { describe, expect, it } from 'vitest';
import {
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
  metresBetween,
  metresPerPixel,
  narrowRoute,
  offsetSegment,
  orderForRoute,
  pinText,
  placeLabel,
} from '@/components/route/routeLogic';
import { stackLabels } from '@/lib/mapLabels';
import { SEOUL_TZ, SYDNEY_TZ } from '@/lib/time/zone';
import type { ItineraryItem } from '@/lib/types';
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

  it('Eren filter keeps Together + Eren stops and lines, renumbered; meet-up still known', () => {
    const xs = [
      at('t1', '09:00'),
      at('e1', '10:00', { participants: 'eren' }),
      at('a1', '10:30', { participants: 'amy' }),
      at('t2', '12:00'),
      item('a-nocoords', { date: D, participants: 'amy' }),
      item('e-nocoords', { date: D, participants: 'eren' }),
    ];
    const r = buildDayRoute(xs, D, 'eren', SYDNEY_TZ);
    expect(r.stops.map((s) => [s.item.id, s.n])).toEqual([
      ['t1', 1],
      ['e1', 2],
      ['t2', 3],
    ]);
    expect(segs(r)).toEqual(['t1>e1:eren', 'e1>t2:eren']);
    expect(r.stops[2].meetUp).toBe(true);
    expect(r.notOnMap.map((i) => i.id)).toEqual(['e-nocoords']);
  });

  it('takes the travel mode of the stop it arrives at (walk by default) and goes faint for ideas', () => {
    const r = buildDayRoute(
      [at('a', '09:00'), at('b', '10:00', { travelMode: 'transit' }), at('c', '11:00', { status: 'idea' })],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(r.segments.map((s) => [s.mode, s.idea])).toEqual([
      ['transit', false],
      ['walk', true],
    ]);
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
  it('tells people apart only: solid, same look for every mode and status', () => {
    for (const m of ['walk', 'transit', 'drive'] as const) {
      for (const idea of [true, false]) {
        expect(lineStyle('eren', m, idea)).toEqual({ color: '#286A82', weight: 3.5, opacity: 0.9, dashArray: null });
      }
    }
    expect(lineStyle('amy').color).toBe('#A98248');
    expect(lineStyle('together')).toMatchObject({ color: '#172F3B', weight: 4, dashArray: null });
  });
});

describe('directionsUrl', () => {
  it('builds a Google Maps directions link by coordinates', () => {
    expect(directionsUrl({ lat: -33.86, lng: 151.21 }, { lat: -33.8731, lng: 151.2065 }, 'walk')).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-33.8731,151.2065&destination=-33.86,151.21&travelmode=walking',
    );
    expect(directionsUrl({ lat: -33.86, lng: 151.21 }, null, 'drive')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-33.86,151.21&travelmode=driving',
    );
    expect(directionsUrl({ lat: 12.345678912, lng: 45.6 }, null, 'transit')).toContain('destination=12.345679,45.6&travelmode=transit');
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
  it('pinText shows the first number of a shared pin', () => {
    expect(pinText([3])).toBe('3');
    expect(pinText([1, 2, 3])).toBe('1');
    expect(pinText([2, 5, 6])).toBe('2');
    expect(pinText([])).toBe('');
  });

  it('groupStops: links a few metres apart share one pin, a street away do not', () => {
    const r = buildDayRoute(
      [
        at('a', '09:00', { mapLat: -33.86, mapLng: 151.2 }),
        at('b', '10:00', { mapLat: -33.8602, mapLng: 151.2003 }), // ~35 m
        at('c', '11:00', { mapLat: -33.865, mapLng: 151.2 }), // ~550 m
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(groupStops(r.stops).map((g) => ids(g.stops))).toEqual([['a', 'b'], ['c']]);
    expect(metresBetween({ lat: -33.86, lng: 151.2 }, { lat: -33.8602, lng: 151.2003 })).toBeLessThan(80);
  });

  it('groupStops with a zoom joins pins that would overlap on screen, and parts them zoomed in', () => {
    const r = buildDayRoute([at('a', '09:00', { mapLat: -33.86, mapLng: 151.2 }), at('b', '10:00', { mapLat: -33.863, mapLng: 151.2 })], D, 'together', SYDNEY_TZ); // ~330 m
    expect(groupStops(r.stops)).toHaveLength(2);
    expect(groupStops(r.stops, 12)).toHaveLength(1); // ~32 m a pixel: 30 px ≈ 950 m
    expect(groupStops(r.stops, 17)).toHaveLength(2); // ~1 m a pixel
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
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

  it('placeLabel takes the destination and the first part', () => {
    expect(placeLabel('Plaza → Hilltown', 'Train')).toBe('Hilltown');
    expect(placeLabel('Plaza Station · south concourse', 'Piano')).toBe('Plaza Station');
    expect(placeLabel('  ', 'Lunch')).toBe('Lunch');
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

  it('a flight without its own spot is a stop at the departure airport with a leg to arrival', () => {
    const r = buildDayRoute(
      [
        at('dinner', '19:30', { timezone: SEOUL_TZ, mapLat: 37.45, mapLng: 126.45 }),
        item('fly', { date: D, startTime: '21:50', timezone: SEOUL_TZ, category: 'transport', place: 'ICN T1 → SYD T1' }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(ids(r.stops)).toEqual(['dinner', 'fly']);
    expect(r.notOnMap).toEqual([]);
    expect(r.flights.map((f) => [f.item.id, f.from.code, f.to.code, f.lane])).toEqual([['fly', 'ICN T1', 'SYD T1', 'together']]);
    expect(narrowRoute(r, 'eren').flights).toEqual([]);
  });
});

describe('people filter on the map', () => {
  it('narrowRoute keeps the map numbers and only the chosen lane', () => {
    const all = buildDayRoute([at('t1', '09:00'), at('a1', '10:00', { participants: 'amy' }), at('e1', '10:30', { participants: 'eren' }), at('t2', '11:00')], D, 'together', SYDNEY_TZ);
    const eren = narrowRoute(all, 'eren');
    expect(eren.stops.map((x) => [x.item.id, x.n])).toEqual([['e1', 3]]);
    expect(segs(eren).every((id) => id.endsWith(':eren'))).toBe(true);
    const together = narrowRoute(all, 'together');
    expect(together.stops.map((x) => [x.item.id, x.n])).toEqual([['t1', 1], ['t2', 4]]);
    expect(segs(together).every((id) => id.endsWith(':together'))).toBe(true);
  });
  it('isFocusLane keeps each lane on its own (Together excludes the solo plans)', () => {
    expect(isFocusLane('together', 'eren')).toBe(false);
    expect(isFocusLane('eren', 'eren')).toBe(true);
    expect(isFocusLane('amy', 'eren')).toBe(false);
    expect(isFocusLane('amy', 'together')).toBe(false);
    expect(isFocusLane('together', 'together')).toBe(true);
  });
});
