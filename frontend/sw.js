/**
 * Quiter service worker — APP SHELL ONLY.
 *
 * WHAT IT CACHES (static, identical for every visitor):
 *   - the HTML pages, CSS, JS, icons and poster images of the app shell
 *   - Google Fonts (CSS + font files)
 *
 * WHAT IT NEVER TOUCHES (it simply doesn't intercept these, the browser does its normal thing):
 *   - any non-GET request (login, check-ins, uploads …)
 *   - anything on another origin: the Quiter API, Supabase videos, Resend links …
 *   - same-origin paths containing /api/, requests with an Authorization header
 *   - video/audio and Range requests (Safari needs real range support to play video)
 *   - pages that carry secrets in the URL: checkin / verify / reset-password / admin
 * Because the API is never intercepted, no authenticated or user-specific response can end up
 * in a cache. Page URLs are stored WITHOUT their query string for the same reason.
 *
 * STRATEGY: network-first with a short timeout, falling back to the cache (so you always get the
 * newest deploy when online, and the shell still opens when offline). Navigations that can't be
 * served at all fall back to offline.html.
 *
 * Maintenance: `python tools/pwa_build.py` regenerates the two generated blocks below
 * (VERSION + PRECACHE) from the files on disk. Run it before every deploy.
 */

/* VERSION:start */
const VERSION = '99a05956f9';
/* VERSION:end */

/* PRECACHE:start */
const PRECACHE = [
  './',
  'assets/css/layout.css',
  'assets/css/tokens.css',
  'assets/js/admin.js',
  'assets/js/bg-video.js',
  'assets/js/config.js',
  'assets/js/custom-plan-athletics.js',
  'assets/js/custom-plan.js',
  'assets/js/dashboard.js',
  'assets/js/home-plans.js',
  'assets/js/modules/api-client.js',
  'assets/js/modules/auth-modal.js',
  'assets/js/modules/auth-state.js',
  'assets/js/modules/plan-form.js',
  'assets/js/modules/shell.js',
  'assets/js/plans.js',
  'assets/js/profile.js',
  'assets/js/progress-video.js',
  'assets/js/progress.js',
  'assets/js/pwa.js',
  'assets/js/reset-password.js',
  'assets/js/site-gl.js',
  'assets/js/verify.js',
  'assets/media/glass-flower-mobile-poster.jpg',
  'assets/media/glass-flower-poster.jpg',
  'assets/pwa/icons/apple-touch-icon-120.png',
  'assets/pwa/icons/apple-touch-icon-152.png',
  'assets/pwa/icons/apple-touch-icon-167.png',
  'assets/pwa/icons/apple-touch-icon-180.png',
  'assets/pwa/icons/favicon-32.png',
  'assets/pwa/icons/icon-192.png',
  'assets/pwa/icons/icon-512.png',
  'assets/pwa/icons/icon-maskable-512.png',
  'custom-plan-athletics.html',
  'custom-plan.html',
  'dashboard.html',
  'favicon.svg',
  'index.html',
  'manifest.webmanifest',
  'offline.html',
  'plans.html',
  'profile.html',
  'progress.html',
];
/* PRECACHE:end */

const SHELL_CACHE = `quiter-shell-${VERSION}`;
const FONT_CACHE = 'quiter-fonts-v1';
const OFFLINE_URL = 'offline.html';
const NEVER_CACHE_PAGES = ['checkin.html', 'verify.html', 'reset-password.html', 'admin.html'];
const NETWORK_TIMEOUT_MS = 3000;     // on a slow/flaky connection, give up on the network after this long if we have a copy

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

// ---------------------------------------------------------------- install / activate

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // One missing file must not stop the whole worker from installing.
    const results = await Promise.allSettled(
      PRECACHE.map((p) => cache.add(new Request(scopeUrl(p), { cache: 'reload' })))
    );
    results.forEach((r, i) => { if (r.status === 'rejected') console.warn('[sw] precache failed:', PRECACHE[i]); });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('quiter-shell-') && n !== SHELL_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHES') event.waitUntil(caches.keys().then((ns) => Promise.all(ns.filter((n) => n.startsWith('quiter-')).map((n) => caches.delete(n)))));
});

// ---------------------------------------------------------------- helpers

/** Only plain, successful, same-origin, non-redirected responses are stored. */
function isStorable(res) {
  if (!res || res.status !== 200 || res.type !== 'basic' || res.redirected) return false;
  const cc = res.headers.get('Cache-Control') || '';
  if (/no-store|private/i.test(cc)) return false;
  if ((res.headers.get('Vary') || '').includes('*')) return false;
  return true;
}

/** Cache key for a page: origin + path, never the query string or hash (tokens live there). */
function pageKey(url) {
  return new URL(url.pathname, url.origin).href;
}

function pageName(url) {
  const last = url.pathname.split('/').pop();
  return last === '' ? 'index.html' : last;
}

function isCacheablePage(url) {
  return !NEVER_CACHE_PAGES.includes(pageName(url));
}

/** Safari refuses a *redirected* response for a navigation. Hand it a clean copy instead. */
function cleanForNavigation(res) {
  if (!res || !res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function putInShell(key, response) {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(key, response);
}

/** Network first; if it is slow (or offline) and we have a copy, serve the copy. */
async function networkFirst(event, request, key) {
  const cached = await caches.match(key);
  // The browser already knows we're offline (airplane mode, no signal): don't make the user wait for a request that can't succeed.
  if (cached && self.navigator && self.navigator.onLine === false) return cached;
  const network = (async () => {
    const res = await fetch(request);
    if (key && isStorable(res)) await putInShell(key, res.clone());
    return res;
  })();
  event.waitUntil(network.catch(() => {}));          // let the cache refresh finish in the background
  if (!cached) return network;
  return Promise.race([
    network.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS)),
  ]);
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

// ---------------------------------------------------------------- fetch

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;                              // writes are never ours

  const url = new URL(request.url);

  // Fonts: static and shared by everyone, safe to keep.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // Everything else on another origin (the API, Supabase, Resend …): not intercepted at all.
  if (url.origin !== self.location.origin) return;

  // Same-origin API paths, credentials, media and range requests: not intercepted either.
  if (url.pathname.includes('/api/')) return;
  if (request.headers.has('authorization') || request.headers.has('range')) return;
  if (['video', 'audio'].includes(request.destination) || /\.(mp4|webm|mov|m4v|mp3)$/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        if (isCacheablePage(url)) return cleanForNavigation(await networkFirst(event, request, pageKey(url)));
        return cleanForNavigation(await fetch(request));                       // secret-bearing pages: network only
      } catch {
        return (await caches.match(scopeUrl(OFFLINE_URL))) || Response.error();
      }
    })());
    return;
  }

  // Static assets of the shell (css / js / images / manifest).
  event.respondWith((async () => {
    try { return await networkFirst(event, request, request.url); }
    catch { return (await caches.match(request.url)) || Response.error(); }
  })());
});
