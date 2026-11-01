// Resolves a Google Maps link to coordinates (plan §7.2.5, §7.2.7).
// Short share links (maps.app.goo.gl) and search links carry no coordinates the
// browser can read, so this follows the redirects server-side and, when the final
// address still has none, reads the place centre Google puts in the page.
//
// Only entered trip members may call it (my_member() under the caller's JWT), and
// only Google Maps addresses are ever fetched: every redirect hop is re-checked,
// so it cannot be used as a general proxy.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAX_HOPS = 5;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Google Maps addresses this function may fetch. */
function allowed(u: URL): boolean {
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl') return u.pathname.length > 1;
  if (host === 'goo.gl') return u.pathname.startsWith('/maps/');
  if (host === 'maps.google.com') return true;
  if (host === 'google.com' || host === 'www.google.com') return u.pathname === '/maps' || u.pathname.startsWith('/maps/');
  return false;
}

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Same rules as lib/maps.ts extractCoords (pin first, then explicit coordinates, then the view centre). */
function coordsFromUrl(u: URL): { lat: number; lng: number; precision: 'pin' | 'view' } | null {
  const s = safeDecode(u.pathname + u.search);
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s);
  if (pin && valid(+pin[1], +pin[2])) return { lat: +pin[1], lng: +pin[2], precision: 'pin' };
  for (const key of ['q', 'query', 'll', 'destination', 'center']) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(u.searchParams.get(key) ?? '');
    if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2], precision: 'pin' };
  }
  const path = /\/maps\/(?:place|search)\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)(?:[/?#]|$)/.exec(s);
  if (path && valid(+path[1], +path[2])) return { lat: +path[1], lng: +path[2], precision: 'pin' };
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s);
  if (at && valid(+at[1], +at[2])) return { lat: +at[1], lng: +at[2], precision: 'view' };
  return null;
}

/** Place centre from the page: the preview image centre, else the initial map view. */
function coordsFromHtml(html: string): { lat: number; lng: number; precision: 'pin' | 'view' } | null {
  const centre = /staticmap\?[^"'<>]*?center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i.exec(html);
  if (centre && valid(+centre[1], +centre[2])) return { lat: +centre[1], lng: +centre[2], precision: 'pin' };
  // window.APP_INITIALIZATION_STATE=[[[scale, lng, lat] ...
  const view = /APP_INITIALIZATION_STATE=\[\[\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/.exec(html);
  if (view && valid(+view[3], +view[2])) return { lat: +view[3], lng: +view[2], precision: 'view' };
  return null;
}

function nameFromUrl(u: URL): string | null {
  const m = /\/maps\/place\/([^/@]+)/.exec(u.pathname);
  if (!m) return null;
  const name = safeDecode(m[1].replace(/\+/g, ' ')).trim();
  return name && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(name) ? name.slice(0, 200) : null;
}

async function get(u: URL, signal: AbortSignal): Promise<Response> {
  return await fetch(u, {
    redirect: 'manual',
    signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; trip-planner-link-resolver)', 'Accept-Language': 'en-AU,en;q=0.8' },
  });
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c.subarray(0, Math.min(c.length, size - at)), at);
    at += c.length;
    if (at >= size) break;
  }
  return new TextDecoder().decode(all);
}

async function resolve(start: URL) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const fromUrl = coordsFromUrl(current);
    const isShort = current.hostname === 'maps.app.goo.gl' || current.hostname === 'goo.gl';
    if (fromUrl && !isShort) return { url: current.toString(), name: nameFromUrl(current), ...fromUrl };

    const res = await get(current, signal);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      let next = new URL(location, current);
      // EU-style consent interstitial: continue to the wrapped Maps address.
      if (next.hostname === 'consent.google.com' && next.searchParams.get('continue')) {
        next = new URL(next.searchParams.get('continue')!);
      }
      if (!allowed(next)) return null;
      current = next;
      continue;
    }
    // Only a place page's HTML names its location. A search page without JavaScript
    // shows a default view, so its HTML must never be read as a result.
    const isPlacePage = /^\/maps\/place\//.test(current.pathname);
    if (!res.ok || !isPlacePage) {
      await res.body?.cancel().catch(() => undefined);
      return fromUrl ? { url: current.toString(), name: nameFromUrl(current), ...fromUrl } : null;
    }
    const fromHtml = coordsFromHtml(await readCapped(res));
    const found = fromHtml ?? fromUrl;
    return found ? { url: current.toString(), name: nameFromUrl(current), ...found } : null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const me = await supabase.rpc('my_member');
  if (me.error || !me.data) return json({ error: 'not_entered' }, 403);

  let input: URL;
  try {
    const body = await req.json();
    input = new URL(String(body?.url ?? '').trim());
  } catch {
    return json({ error: 'invalid_url' }, 400);
  }
  if (!allowed(input)) return json({ error: 'not_a_map_link' }, 400);

  try {
    const found = await resolve(input);
    if (!found) return json({ found: false });
    return json({ found: true, lat: found.lat, lng: found.lng, precision: found.precision, name: found.name, resolvedUrl: found.url });
  } catch {
    return json({ found: false });
  }
});
