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
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function extractCoords(u: URL): [number, number] | null {
  const s = decodeURIComponent(u.pathname + u.search);
  const patterns = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m && validCoords(Number(m[1]), Number(m[2]))) return [Number(m[1]), Number(m[2])];
  }
  for (const key of ['q', 'query', 'll']) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(u.searchParams.get(key) ?? '');
    if (m && validCoords(Number(m[1]), Number(m[2]))) return [Number(m[1]), Number(m[2])];
  }
  return null;
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
