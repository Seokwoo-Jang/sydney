// Google Maps link rules (plan §7.2.5). No Google API is used.
import type { ItineraryItem } from './types';

/** Single source for this message; lib/strings exposes it as S.maps.notAMapLink. */
export const NOT_A_MAP_LINK = 'This doesn’t look like a Google Maps link.';

export type MapLinkResult =
  | { ok: true; url: string; name: string | null; lat: number | null; lng: number | null; source: 'link' }
  | { ok: false; error: string };

function isAllowed(u: URL): boolean {
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  if (host === 'google.com' || host === 'www.google.com') return path === '/maps' || path.startsWith('/maps/');
  if (host === 'maps.google.com') return true;
  if (host === 'maps.app.goo.gl') return path.length > 1;
  if (host === 'goo.gl') return path.startsWith('/maps/');
  return false;
}

function validCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Coordinates written in the address, most precise first: the place pin
 * (!3d…!4d…), explicit coordinates (?q= / query / ll / destination / center,
 * or /maps/place/lat,lng), then the map view (@lat,lng). Same rules as the
 * resolve-map-link Edge Function.
 */
function extractCoords(u: URL): [number, number] | null {
  const s = safeDecode(u.pathname + u.search);
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s);
  if (pin && validCoords(Number(pin[1]), Number(pin[2]))) return [Number(pin[1]), Number(pin[2])];
  for (const key of ['q', 'query', 'll', 'destination', 'center']) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(u.searchParams.get(key) ?? '');
    if (m && validCoords(Number(m[1]), Number(m[2]))) return [Number(m[1]), Number(m[2])];
  }
  const path = /\/maps\/(?:place|search)\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)(?:[/?#]|$)/.exec(s);
  if (path && validCoords(Number(path[1]), Number(path[2]))) return [Number(path[1]), Number(path[2])];
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s);
  if (at && validCoords(Number(at[1]), Number(at[2]))) return [Number(at[1]), Number(at[2])];
  return null;
}

/**
 * True when a valid link has no coordinates in its address but the server can
 * find them: short share links and place pages. Search links name no single
 * place, so they are never looked up.
 */
export function needsLookup(link: Extract<MapLinkResult, { ok: true }>): boolean {
  if (link.lat !== null) return false;
  const u = new URL(link.url);
  return u.hostname === 'maps.app.goo.gl' || u.hostname === 'goo.gl' || /\/maps\/place\//.test(u.pathname);
}

function extractName(u: URL): string | null {
  const m = /\/maps\/place\/([^/]+)/.exec(u.pathname);
  if (!m) return null;
  try {
    const name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    return name && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function parseMapUrl(raw: string): MapLinkResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: NOT_A_MAP_LINK };
  }
  if (!isAllowed(u)) return { ok: false, error: NOT_A_MAP_LINK };
  const coords = extractCoords(u);
  return {
    ok: true,
    url: u.toString(),
    name: extractName(u),
    lat: coords ? coords[0] : null,
    lng: coords ? coords[1] : null,
    source: 'link',
  };
}

export function searchMapUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

export function mapHref(
  item: Pick<ItineraryItem, 'mapUrl' | 'place' | 'mapLat' | 'mapLng'>,
): { href: string; kind: 'link' | 'search' } | null {
  if (item.mapUrl) {
    const r = parseMapUrl(item.mapUrl);
    if (r.ok) return { href: r.url, kind: 'link' };
  }
  if (item.place.trim()) return { href: searchMapUrl(item.place), kind: 'search' };
  if (item.mapLat != null && item.mapLng != null) return { href: searchMapUrl(`${item.mapLat},${item.mapLng}`), kind: 'search' };
  return null;
}
