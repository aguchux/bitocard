/*
 * BitoCard Shop's service worker. It makes the site installable as an app and shows a page of its own when there is no
 * connection. It keeps nothing else: every page, listing, photo and API answer still comes from the network, so nothing
 * can go stale and nothing about the visitor is stored. Registered by `InstallSupport` (components/install-app.tsx).
 */
const cacheName = "bc-shop-offline-v1";
const offlinePage = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then(cache => cache.add(new Request(offlinePage, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      // Navigation preload: the page request starts while the worker wakes, so pages are no slower with it.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      const names = await caches.keys();
      await Promise.all(names.filter(name => name !== cacheName).map(name => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", event => {
  // Only page loads; everything else goes straight to the network without the worker.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return (await caches.match(offlinePage)) || Response.error();
      }
    })(),
  );
});
