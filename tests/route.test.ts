// Route map helpers (plan §7.2.7). Fictional data only (trip year 2030).
import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  buildDayRoute,
  buildTripRoutes,
  createRateGate,
  directionsUrl,
  groupLane,
  groupStops,
  incomingSegment,
  isFocusLane,
  lineStyle,
  narrowRoute,
  nominatimUrl,
  offsetSegment,
  orderForRoute,
  parseNominatim,
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

  it('drops cancelled, deleted, other days and home-zone legs', () => {
    const r = buildDayRoute(
      [
        at('ok', '09:00'),
        at('cx', '10:00', { status: 'cancelled' }),
        at('del', '11:00', { deletedAt: '2030-12-01T00:00:00Z' }),
        at('other', '12:00', { date: '2030-12-30' }),
        at('home', '13:00', { timezone: SEOUL_TZ }),
        item('home-nocoords', { date: D, timezone: SEOUL_TZ }),
      ],
      D,
      'together',
      SYDNEY_TZ,
    );
    expect(ids(r.stops)).toEqual(['ok']);
    expect(r.notOnMap).toEqual([]);
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
  it('pinText', () => {
    expect(pinText([3])).toBe('3');
    expect(pinText([3, 4])).toBe('3·4');
    expect(pinText([3, 4, 5])).toBe('3–5');
    expect(pinText([2, 5, 6])).toBe('2+');
    expect(pinText([])).toBe('');
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

describe('place search', () => {
  it('nominatimUrl encodes the query', () => {
    expect(nominatimUrl(' Harbour Lawn & Lookout ')).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=au&q=Harbour%20Lawn%20%26%20Lookout',
    );
  });

  it('parseNominatim keeps well-formed results only', () => {
    const json = [
      { place_id: 1, lat: '12.34', lon: '45.67', name: 'Example Lookout', display_name: 'Example Lookout, Hilltown, NSW' },
      { place_id: 2, lat: 'x', lon: '150', display_name: 'Broken' },
      { place_id: 3, lat: '-33.86', lon: '151.21', name: '', display_name: 'Harbour Lawn, Sydney' },
      null,
      'nope',
    ];
    expect(parseNominatim(json)).toEqual([
      { id: '1', name: 'Example Lookout', address: 'Example Lookout, Hilltown, NSW', lat: 12.34, lng: 45.67 },
      { id: '3', name: 'Harbour Lawn', address: 'Harbour Lawn, Sydney', lat: -33.86, lng: 151.21 },
    ]);
    expect(parseNominatim({ error: 'x' })).toEqual([]);
  });

  it('rate gate spaces requests at least 1 s apart', () => {
    let t = 10_000;
    const gate = createRateGate(1000, () => t);
    expect(gate.reserve()).toBe(0);
    expect(gate.reserve()).toBe(1000); // queued right behind the first
    t += 300;
    expect(gate.reserve()).toBe(1700);
    t += 5000;
    expect(gate.reserve()).toBe(0);
  });
});

describe('people filter on the map', () => {
  it('narrowRoute keeps the map numbers and drops the other person', () => {
    const all = buildDayRoute([at('t1', '09:00'), at('a1', '10:00', { participants: 'amy' }), at('e1', '10:30', { participants: 'eren' }), at('t2', '11:00')], D, 'together', SYDNEY_TZ);
    const eren = narrowRoute(all, 'eren');
    expect(eren.stops.map((x) => [x.item.id, x.n])).toEqual([['t1', 1], ['e1', 3], ['t2', 4]]);
    expect(segs(eren).every((id) => !id.endsWith(':amy'))).toBe(true);
    expect(narrowRoute(all, 'together')).toBe(all);
  });
  it('isFocusLane fades only the other person', () => {
    expect(isFocusLane('together', 'eren')).toBe(true);
    expect(isFocusLane('eren', 'eren')).toBe(true);
    expect(isFocusLane('amy', 'eren')).toBe(false);
    expect(isFocusLane('amy', 'together')).toBe(true);
  });
});
