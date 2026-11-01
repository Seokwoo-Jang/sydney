// Route map derivations (plan §7.2.7). Pure: no React, no Leaflet, no network. Unit-tested.
// Lines are order lines between stops, never road geometry.
import { matchesFilter, type PeopleFilter } from '@/components/itinerary/logic';
import { formatWallTime, S } from '@/lib/strings';
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

export interface DayRoute {
  date: string;
  stops: RouteStop[];
  segments: RouteSegment[];
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
 * Items that belong on the trip map: live, not cancelled, and in the trip's time zone.
 * Legs at home (Korea time, e.g. the departure airport) stay off the map, so the
 * international flight never draws a line across the ocean.
 */
export const onRouteMap = (i: ItineraryItem, tripTz: string): boolean =>
  !i.deletedAt && i.status !== 'cancelled' && i.timezone === tripTz;

const isTimed = (i: ItineraryItem) => i.timeKind === 'timed' && !!i.startTime;

/** Timed by start time then sortOrder; untimed after, by sortOrder. Same day, same zone: 'HH:mm' compares as text. */
export function orderForRoute(items: ItineraryItem[]): ItineraryItem[] {
  const timed = items.filter(isTimed).sort((a, b) => a.startTime!.localeCompare(b.startTime!) || a.sortOrder - b.sortOrder);
  const untimed = items.filter((i) => !isTimed(i)).sort((a, b) => a.sortOrder - b.sortOrder);
  return [...timed, ...untimed];
}

const laneOf = (i: ItineraryItem): Lane => i.participants;
const laneVisible = (lane: Lane, filter: PeopleFilter) => lane === 'together' || filter === 'together' || lane === filter;
const sameSpot = (a: ItineraryItem, b: ItineraryItem) => a.mapLat === b.mapLat && a.mapLng === b.mapLng;

/**
 * One day's stops and order lines. Paths are walked per person over every placed stop
 * (so meet-ups are known even when one person is filtered out), then trimmed to the filter:
 * - Together → Together: one Together line.
 * - Together → solo: Eren's and Amy's paths split into E and A lines.
 * - solo → Together: both paths run into that stop, which is marked Meet up.
 */
export function buildDayRoute(items: ItineraryItem[], date: string, filter: PeopleFilter, tripTz: string): DayRoute {
  const ordered = orderForRoute(items.filter((i) => i.date === date && onRouteMap(i, tripTz)));
  const placed = ordered.filter(hasCoords);
  const notOnMap = ordered.filter((i) => !hasCoords(i) && matchesFilter(i, filter));

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
      lat: item.mapLat!,
      lng: item.mapLng!,
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
  return { date, stops, segments, notOnMap };
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

/** Stops sharing a spot share one pin. */
export interface PinGroup {
  key: string;
  lat: number;
  lng: number;
  stops: RouteStop[];
}

export function groupStops(stops: RouteStop[]): PinGroup[] {
  const map = new Map<string, PinGroup>();
  for (const s of stops) {
    const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    const g = map.get(key);
    if (g) g.stops.push(s);
    else map.set(key, { key, lat: s.lat, lng: s.lng, stops: [s] });
  }
  return [...map.values()];
}

/** '3', '3·4', '3–5' (consecutive), '3+' otherwise. */
export function pinText(ns: number[]): string {
  if (!ns.length) return '';
  if (ns.length === 1) return String(ns[0]);
  if (ns.length === 2) return `${ns[0]}·${ns[1]}`;
  const consecutive = ns.every((n, k) => k === 0 || n === ns[k - 1] + 1);
  return consecutive ? `${ns[0]}–${ns[ns.length - 1]}` : `${ns[0]}+`;
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

// ── place search (Nominatim, plan §7.2.7) ────────────────────────
export const NOMINATIM_COUNTRY = 'au';

export function nominatimUrl(query: string): string {
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=${NOMINATIM_COUNTRY}&q=${encodeURIComponent(query.trim())}`;
}

export interface PlaceCandidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** Keeps well-formed results only; never trusts the shape of a remote response. */
export function parseNominatim(json: unknown): PlaceCandidate[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceCandidate[] = [];
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const lat = Number(o.lat);
    const lng = Number(o.lon);
    const address = typeof o.display_name === 'string' ? o.display_name : '';
    if (!hasCoords({ mapLat: lat, mapLng: lng }) || !address) continue;
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : address.split(',')[0].trim();
    out.push({ id: String(o.place_id ?? `${lat},${lng}`), name, address, lat, lng });
  }
  return out.slice(0, 5);
}

/**
 * Global request spacing (Nominatim policy: ≤ 1 request/second).
 * `reserve()` books the next slot and returns how long to wait before sending.
 */
export function createRateGate(intervalMs = 1000, clock: () => number = () => Date.now()) {
  let next = 0;
  return {
    reserve(): number {
      const now = clock();
      const at = Math.max(now, next);
      next = at + intervalMs;
      return at - now;
    },
  };
}
