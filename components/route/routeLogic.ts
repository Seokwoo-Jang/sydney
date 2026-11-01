// Route map derivations (plan §7.2.7). Pure: no React, no Leaflet, no network. Unit-tested.
// Lines are order lines between stops, never road geometry.
import { matchesFilter, type PeopleFilter } from '@/components/itinerary/logic';
import { formatWallTime, S } from '@/lib/strings';
import { zonedToInstant } from '@/lib/time/zone';
import type { ItineraryItem, TravelMode, TripDay } from '@/lib/types';

export type Lane = 'together' | 'eren' | 'amy';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteStop {
  item: ItineraryItem;
  /** 1-based order among the visible stops of its day. */
  n: number;
  lat: number;
  lng: number;
  lane: Lane;
  /** Untimed stops get a pin but no line (they have no place in the order). */
  timed: boolean;
  /** Eren and Amy rejoin here after going separately. */
  meetUp: boolean;
}

export interface RouteSegment {
  id: string;
  from: RouteStop;
  to: RouteStop;
  lane: Lane;
  mode: TravelMode;
  idea: boolean;
}

/** A flight drawn from airport to airport (its item sits at the departure airport). */
export interface FlightLeg {
  id: string;
  item: ItineraryItem;
  lane: Lane;
  from: LatLng & { code: string };
  to: LatLng & { code: string };
}

export interface DayRoute {
  date: string;
  stops: RouteStop[];
  segments: RouteSegment[];
  flights: FlightLeg[];
  /** Live items of the day without coordinates (same people filter). */
  notOnMap: ItineraryItem[];
}

// Token mirrors (styles/tokens.css): Leaflet paints SVG strokes from options.
export const LANE_COLOR: Record<Lane, string> = { together: '#172F3B', eren: '#286A82', amy: '#A98248' };

export const hasCoords = (i: Pick<ItineraryItem, 'mapLat' | 'mapLng'>): boolean =>
  i.mapLat != null &&
  i.mapLng != null &&
  Number.isFinite(i.mapLat) &&
  Number.isFinite(i.mapLng) &&
  Math.abs(i.mapLat) <= 90 &&
  Math.abs(i.mapLng) <= 180;

/**
 * Items that belong on the map: live and not cancelled, in any time zone. Day 1 starts
 * at home (Korea time) and its flight is drawn to Sydney (owner, 2026-11-01).
 */
export const onRouteMap = (i: ItineraryItem): boolean => !i.deletedAt && i.status !== 'cancelled';

const isTimed = (i: ItineraryItem) => i.timeKind === 'timed' && !!i.startTime;
/** Real start instant, so a day mixing Korea and Sydney times still runs in order. */
const startsAt = (i: ItineraryItem) => zonedToInstant(i.date, i.startTime!, i.timezone).getTime();

/** Timed by start (instant) then sortOrder; untimed after, by sortOrder. */
export function orderForRoute(items: ItineraryItem[]): ItineraryItem[] {
  const timed = items.filter(isTimed).sort((a, b) => startsAt(a) - startsAt(b) || a.sortOrder - b.sortOrder);
  const untimed = items.filter((i) => !isTimed(i)).sort((a, b) => a.sortOrder - b.sortOrder);
  return [...timed, ...untimed];
}

const laneOf = (i: ItineraryItem): Lane => i.participants;
const laneVisible = (lane: Lane, filter: PeopleFilter) => lane === 'together' || filter === 'together' || lane === filter;

// ── flights ───────────────────────────────────────────────────────
/** Airports a flight's place can name ('ICN T1 → SYD T1'); a terminal when it is known. */
const AIRPORTS: Record<string, LatLng> = {
  ICN: { lat: 37.4602, lng: 126.4407 },
  'ICN T1': { lat: 37.4492, lng: 126.4508 },
  'ICN T2': { lat: 37.4687, lng: 126.4334 },
  GMP: { lat: 37.5587, lng: 126.7945 },
  SYD: { lat: -33.9399, lng: 151.1753 },
  'SYD T1': { lat: -33.9361, lng: 151.1661 },
  'SYD T2': { lat: -33.9331, lng: 151.1799 },
  'SYD T3': { lat: -33.931, lng: 151.1825 },
  MEL: { lat: -37.669, lng: 144.841 },
  BNE: { lat: -27.3842, lng: 153.1175 },
};
const AIRPORT_PAIR = /^\s*([A-Z]{3})(?:\s+(T\d))?\s*(?:→|->)\s*([A-Z]{3})(?:\s+(T\d))?\s*$/;
const airport = (code: string, terminal: string | undefined) => {
  const name = terminal ? `${code} ${terminal}` : code;
  const at = AIRPORTS[name] ?? AIRPORTS[code];
  return at ? { ...at, code: name } : null;
};

/** A flight item ('ICN T1 → SYD T1' in its place): both airports, or null. */
export function flightAirports(i: Pick<ItineraryItem, 'place'>): { from: LatLng & { code: string }; to: LatLng & { code: string } } | null {
  const m = AIRPORT_PAIR.exec(i.place);
  if (!m) return null;
  const from = airport(m[1], m[2]);
  const to = airport(m[3], m[4]);
  return from && to ? { from, to } : null;
}

/** Where an item sits on the map: its own spot, else (a flight) its departure airport. */
function spotOf(i: ItineraryItem): LatLng | null {
  if (hasCoords(i)) return { lat: i.mapLat!, lng: i.mapLng! };
  return flightAirports(i)?.from ?? null;
}
const sameSpot = (a: ItineraryItem, b: ItineraryItem) => {
  const p = spotOf(a);
  const q = spotOf(b);
  return !!p && !!q && p.lat === q.lat && p.lng === q.lng;
};

/**
 * One day's stops and order lines. Paths are walked per person over every placed stop
 * (so meet-ups are known even when one person is filtered out), then trimmed to the filter:
 * - Together → Together: one Together line.
 * - Together → solo: Eren's and Amy's paths split into E and A lines.
 * - solo → Together: both paths run into that stop, which is marked Meet up.
 */
export function buildDayRoute(items: ItineraryItem[], date: string, filter: PeopleFilter, tripTz: string): DayRoute {
  void tripTz; // every zone is drawn now; kept for callers
  const ordered = orderForRoute(items.filter((i) => i.date === date && onRouteMap(i)));
  const placed = ordered.filter((i) => spotOf(i));
  const notOnMap = ordered.filter((i) => !spotOf(i) && matchesFilter(i, filter));

  const raw: Array<{ from: ItineraryItem; to: ItineraryItem; lane: Lane }> = [];
  const meetUps = new Set<string>();
  let lastE: ItineraryItem | null = null;
  let lastA: ItineraryItem | null = null;
  let apart = false;
  for (const it of placed.filter(isTimed)) {
    const lane = laneOf(it);
    if (lane === 'together') {
      if (lastE && lastE === lastA) raw.push({ from: lastE, to: it, lane: 'together' });
      else {
        if (lastE) raw.push({ from: lastE, to: it, lane: 'eren' });
        if (lastA) raw.push({ from: lastA, to: it, lane: 'amy' });
      }
      if (apart) meetUps.add(it.id);
      lastE = lastA = it;
      apart = false;
    } else if (lane === 'eren') {
      if (lastE) raw.push({ from: lastE, to: it, lane });
      lastE = it;
      apart = true;
    } else {
      if (lastA) raw.push({ from: lastA, to: it, lane });
      lastA = it;
      apart = true;
    }
  }

  const stops: RouteStop[] = placed
    .filter((i) => matchesFilter(i, filter))
    .map((item, k) => ({
      item,
      n: k + 1,
      lat: spotOf(item)!.lat,
      lng: spotOf(item)!.lng,
      lane: laneOf(item),
      timed: isTimed(item),
      meetUp: meetUps.has(item.id),
    }));
  const stopById = new Map(stops.map((s) => [s.item.id, s]));
  const segments: RouteSegment[] = [];
  for (const r of raw) {
    const from = stopById.get(r.from.id);
    const to = stopById.get(r.to.id);
    if (!from || !to || !laneVisible(r.lane, filter) || sameSpot(r.from, r.to)) continue;
    segments.push({
      id: `${r.from.id}>${r.to.id}:${r.lane}`,
      from,
      to,
      lane: r.lane,
      mode: r.to.travelMode ?? 'walk',
      idea: r.from.status === 'idea' || r.to.status === 'idea',
    });
  }
  const flights: FlightLeg[] = [];
  for (const s of stops) {
    const air = flightAirports(s.item);
    if (air) flights.push({ id: `${s.item.id}:flight`, item: s.item, lane: s.lane, from: air.from, to: air.to });
  }
  return { date, stops, segments, flights, notOnMap };
}

export function buildTripRoutes(items: ItineraryItem[], days: Pick<TripDay, 'date'>[], filter: PeopleFilter, tripTz: string): DayRoute[] {
  return days.map((d) => buildDayRoute(items, d.date, filter, tripTz));
}

/**
 * One person's view of an everyone route (the map keeps drawing everyone and only
 * fades the other person): their stops and lines with the SAME numbers as the map,
 * and their unplaced items.
 */
export function narrowRoute(route: DayRoute, filter: PeopleFilter): DayRoute {
  return {
    ...route,
    stops: route.stops.filter((s) => s.lane === filter),
    segments: route.segments.filter((s) => s.lane === filter),
    flights: route.flights.filter((f) => f.lane === filter),
    notOnMap: route.notOnMap.filter((i) => i.participants === filter),
  };
}

/**
 * The Route chooses one lane exactly (owner, 2026-11-01): Together = the plans we do
 * together, Eren / Amy = that person's own plans. That lane is drawn at full strength
 * and framed; the other lanes stay on the map, faded.
 */
export const isFocusLane = (lane: Lane, filter: PeopleFilter): boolean => lane === filter;

// ── drawing ──────────────────────────────────────────────────────
export interface LineStyle {
  color: string;
  weight: number;
  opacity: number;
  dashArray: string | null;
}

/**
 * Lines differ only by person (owner, 2026-11-01): Together Ink, Eren Harbour Blue,
 * Amy Brass, all solid. Travel mode and Idea status are not drawn differently.
 */
export function lineStyle(lane: Lane, _mode?: TravelMode, _idea?: boolean): LineStyle {
  return { color: LANE_COLOR[lane], weight: lane === 'together' ? 4 : 3.5, opacity: 0.9, dashArray: null };
}

/** Side-by-side lanes: E a few pixels to one side, A to the other, so shared stretches stay visible. */
export const LANE_OFFSET_PX: Record<Lane, number> = { together: 0, eren: -3, amy: 3 };

export interface Pt {
  x: number;
  y: number;
}

/** Shifts a straight segment perpendicular to itself by `px` (screen pixels). */
export function offsetSegment(a: Pt, b: Pt, px: number): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!px || !len) return [a, b];
  const nx = (-dy / len) * px;
  const ny = (dx / len) * px;
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
  ];
}

/** Stops at one place share one pin: the same spot, or links to it a few metres apart. */
export interface PinGroup {
  key: string;
  lat: number;
  lng: number;
  stops: RouteStop[];
}

/** Two links for one place rarely give the same point; within this distance they are one pin. */
export const SAME_PLACE_M = 80;

export function metresBetween(a: LatLng, b: LatLng): number {
  const dx = (a.lng - b.lng) * 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

/** Metres one screen pixel covers at this zoom and latitude (Web Mercator tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Numbered pins closer than this on screen overlap, so they are drawn as one. */
export const PIN_OVERLAP_PX = 30;

/**
 * With a zoom, stops whose pins would overlap on screen share one pin too (owner,
 * 2026-11-01: overlapping 1, 2, 3 show as a single 1); zooming in parts them again.
 */
export function groupStops(stops: RouteStop[], zoom: number | null = null): PinGroup[] {
  const groups: PinGroup[] = [];
  for (const s of stops) {
    const near = zoom === null ? SAME_PLACE_M : Math.max(SAME_PLACE_M, PIN_OVERLAP_PX * metresPerPixel(s.lat, zoom));
    const g = groups.find((x) => metresBetween(x, s) <= near);
    if (g) g.stops.push(s);
    else groups.push({ key: `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`, lat: s.lat, lng: s.lng, stops: [s] });
  }
  return groups;
}

/** A shared pin shows its first number only ('1' for stops 1–3); the popup lists them all (owner, 2026-11-01). */
export function pinText(ns: number[]): string {
  return ns.length ? String(ns[0]) : '';
}

/** Shared pins take Together's colour when people differ. */
export const groupLane = (g: PinGroup): Lane =>
  g.stops.every((s) => s.lane === g.stops[0].lane) ? g.stops[0].lane : 'together';

/** Short label next to a pin: destination of 'A → B', first part of 'A · B'. */
export function placeLabel(place: string, title: string): string {
  const dest = place.split('→').pop() ?? '';
  const head = dest.split('·')[0].trim();
  return head || title.trim();
}

export type Bounds = [[number, number], [number, number]];

export function boundsOf(points: LatLng[]): Bounds | null {
  if (!points.length) return null;
  let s = 90;
  let w = 180;
  let n = -90;
  let e = -180;
  for (const p of points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
  }
  return [
    [s, w],
    [n, e],
  ];
}

/** '9:00 am – 10:30 am', 'All day', 'Time to be decided'. */
export function stopTime(i: Pick<ItineraryItem, 'timeKind' | 'startTime' | 'endTime'>): string {
  if (i.timeKind === 'all_day') return S.time.allDay;
  if (i.timeKind !== 'timed' || !i.startTime) return S.time.unscheduled;
  return i.endTime ? `${formatWallTime(i.startTime)} – ${formatWallTime(i.endTime)}` : formatWallTime(i.startTime);
}

// ── links ────────────────────────────────────────────────────────
const GMAPS_MODE: Record<TravelMode, string> = { walk: 'walking', transit: 'transit', drive: 'driving' };
const coord = (p: LatLng) => `${+p.lat.toFixed(6)},${+p.lng.toFixed(6)}`;

/** Google Maps directions by coordinates. Without an origin Google starts from the viewer's location. */
export function directionsUrl(to: LatLng, from: LatLng | null, mode: TravelMode): string {
  const origin = from ? `&origin=${coord(from)}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${coord(to)}&travelmode=${GMAPS_MODE[mode]}`;
}

/** The line arriving at a stop; at a meet-up, the viewer's own lane first. */
export function incomingSegment(route: DayRoute, stopId: string, prefer: Lane | null): RouteSegment | null {
  const into = route.segments.filter((s) => s.to.item.id === stopId);
  return into.find((s) => s.lane === prefer) ?? into[0] ?? null;
}
