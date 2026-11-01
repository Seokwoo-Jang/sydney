// Where We Are (plan §7.8): pure helpers for sending and showing live locations.
import { formatWallTime, S } from './strings';
import { formatDayLabel, zonedDate, zonedTime } from './time/zone';
import type { LiveLocation } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A position with the instant it was measured (ms since epoch). */
export interface TimedPoint extends LatLng {
  at: number;
}

export const MIN_MOVE_M = 25;
export const MIN_INTERVAL_MS = 30_000;
/** No update for this long → the marker dims and reads "Last seen …". */
export const STALE_MS = 5 * 60_000;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Send when nothing was sent yet, or moved ≥ 25 m, or ≥ 30 s passed. Older readings never go out. */
export function shouldSend(last: TimedPoint | null, next: TimedPoint): boolean {
  if (!last) return true;
  if (next.at <= last.at) return false;
  return haversineM(last, next) >= MIN_MOVE_M || next.at - last.at >= MIN_INTERVAL_MS;
}

export type Freshness = 'live' | 'stale' | 'off';

/** live = sharing and updated in the last 5 min; stale = sharing but quiet (page closed); off = sharing turned off. */
export function freshness(loc: Pick<LiveLocation, 'isSharing' | 'measuredAt'>, nowMs: number): Freshness {
  if (!loc.isSharing) return 'off';
  return nowMs - Date.parse(loc.measuredAt) < STALE_MS ? 'live' : 'stale';
}

/** 'just now' · '12 min ago' · '9:40 pm' (within a day, trip clock) · 'Sat, 2 Jan'. */
export function seenPhrase(measuredAt: string, now: Date, tz: string): string {
  const at = new Date(measuredAt);
  const mins = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (mins < 1) return S.location.justNow;
  if (mins < 60) return S.location.minutesAgo(mins);
  if (mins < 24 * 60) return formatWallTime(zonedTime(at, tz));
  return formatDayLabel(zonedDate(at, tz));
}

/** The line under a person's name. */
export function seenLine(loc: Pick<LiveLocation, 'isSharing' | 'measuredAt'>, now: Date, tz: string): string {
  const phrase = seenPhrase(loc.measuredAt, now, tz);
  switch (freshness(loc, now.getTime())) {
    case 'live':
      return S.location.updated(phrase);
    case 'stale':
      return S.location.lastSeenAt(phrase);
    default:
      return `${S.location.sharingOff} · ${S.location.lastSeenAt(phrase)}`;
  }
}

const coord = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Maps at the coordinates (no API key, plan §7.2.5). */
export function mapsPointUrl(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord(p)}`;
}

/** Google Maps directions from one person to the other. */
export function mapsDirectionsUrl(from: LatLng, to: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${coord(from)}&destination=${coord(to)}`;
}

/** '1.2 km' / '350 m' between the two people. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
