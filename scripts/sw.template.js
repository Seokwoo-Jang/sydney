/* Service worker (plan §11.3, §8.5). Generated into public/sw.js by
 * scripts/build-sw.mjs, which stamps __VERSION__ so every deploy is a new worker.
 *
 * Caches only the app shell: the page HTML (network first) and hashed static
 * files, fonts, images and icons (cache first). Trip data, Supabase responses,
 * signed file links, locations and map tiles are never cached: every request
 * outside this site's scope passes straight through.
 */
const VERSION = '__VERSION__';
const SCOPE = self.registration.scope; // e.g. https://host/sydney/
const SCOPE_PATH = new URL(SCOPE).pathname;
const SHELL = `sbs-shell-${VERSION}`;
const STATIC = 'sbs-static-v1';
const STATIC_PREFIXES = ['_next/static/', 'fonts/', 'images/', 'icons/'];

const OFFLINE_HTML = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light"><title>Sydney, Side by Side</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F4EE;color:#172F3B;
font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box;text-align:center}
h1{font:500 28px/1.1 Georgia,serif;margin:0 0 8px}p{margin:0;color:#536570}</style></head>
<body><main><h1>Sydney, Side by Side</h1><p>You’re offline. Changes can’t be saved right now.</p></main></body></html>`;

self.addEventListener('install', (event) => {
  // Warm the shell; a failure here must not block installing the worker.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add(new Request(SCOPE, { cache: 'reload' })))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('sbs-shell-') && k !== SHELL).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// The page asks the waiting worker to take over only after the user taps Refresh.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function pageFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(SCOPE, res.clone()).catch(() => undefined);
    return res;
  } catch {
    return (
      (await cache.match(SCOPE)) ||
      new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Supabase, map tiles, Google and every other origin: never touched.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  if (request.mode === 'navigate') {
    event.respondWith(pageFirst(request));
    return;
  }
  const rest = url.pathname.slice(SCOPE_PATH.length);
  if (STATIC_PREFIXES.some((p) => rest.startsWith(p))) event.respondWith(cacheFirst(request));
});

// ── push (plan §8.5) ────────────────────────────────────────────
// Payload: { title, body, url, tag }. Text only: no booking numbers, places'
// coordinates, notes or amounts are ever sent.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Side by Side';
  const url = new URL(data.url || '', SCOPE).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focused = windows.find((w) => w.focused && w.visibilityState === 'visible');
      // iOS requires a visible notification for every push; elsewhere an open app shows its own notice.
      const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
      if (focused && !ios) {
        focused.postMessage({ type: 'push', title, body: data.body || '', url });
        return;
      }
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || undefined,
        data: { url },
        icon: new URL('icons/icon-192.png', SCOPE).href,
        badge: new URL('icons/favicon-32.png', SCOPE).href,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || SCOPE;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(SCOPE));
      if (open) {
        await open.focus();
        return open.navigate ? open.navigate(url) : undefined;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
