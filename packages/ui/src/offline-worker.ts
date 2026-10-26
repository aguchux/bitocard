/**
 * The service worker of BitoCard's installable sites, served by each at its own address (a route handler): it makes the
 * site installable and shows a page of its own when there is no connection. It caches nothing: every page, image and
 * API answer still comes from the network, with navigation preload so pages are no slower, and only a page load that
 * fails gets the offline page, written here. SHQ appends it to its push worker. Plain JavaScript for the browser's
 * service worker scope, never bundled.
 */
export function offlineWorker(appName: string): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  const page = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#070f4c"><title>You are offline | ${escape(appName)}</title></head><body style="margin:0;font-family:Inter,system-ui,sans-serif;background:#fcfdff;color:#070f4c"><main style="max-width:28rem;margin:0 auto;padding:4rem 1rem;text-align:center"><h1 style="font-size:1.5rem">You are offline</h1><p style="color:#414f77">${escape(appName)} needs a connection. Check your data or Wi-Fi, then try again.</p><button type="button" onclick="location.reload()" style="margin-top:1rem;padding:0.875rem 1.5rem;border:0;background:#070f4c;color:#fff;font:inherit;font-weight:700;cursor:pointer">Try again</button></main></body></html>`;
  return `'use strict';
var offlinePage = ${JSON.stringify(page)};

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.resolve(self.registration.navigationPreload && self.registration.navigationPreload.enable())
      .catch(function () {})
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener('fetch', function (event) {
  // Only page loads; everything else goes straight to the network.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    Promise.resolve(event.preloadResponse)
      .then(function (preloaded) {
        return preloaded || fetch(event.request);
      })
      .catch(function () {
        return new Response(offlinePage, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }),
  );
});
`;
}

/** Headers for serving a service worker: always fetched fresh, so a new version reaches visitors on their next visit. */
export const workerHeaders = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate" };
