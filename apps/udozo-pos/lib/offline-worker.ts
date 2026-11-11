/**
 * Udozo POS's own service worker (docs/UDOZO_POS_PLAN.md, Where the web app lives on the device): it keeps the offline
 * till (`/offline`, its scripts and styles) in Cache Storage so it opens with no internet, and sends any page that
 * cannot load while offline to it. Everything else goes to the network as usual; nothing private is cached (the till's
 * data lives in IndexedDB, sealed). A new version caches beside the old and takes over once installed.
 */
export function offlineWorker(version: string) {
  return `/* Udozo POS offline worker ${version} */
const CACHE = "udozo-pos-${version.replace(/[^\w.-]/g, "")}";
const SHELL = ["/offline", "/icon-192.png", "/udozo-mark.png"];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  // The offline till's own scripts and styles, read from its page.
  const page = await (await cache.match("/offline")).text();
  const assets = [...new Set([...page.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map(m => m[1]))];
  await Promise.all(assets.map(url => cache.add(url).catch(() => undefined)));
}

self.addEventListener("install", event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("udozo-pos-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline")) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        hit =>
          hit ||
          fetch(request).then(response => {
            if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});
`;
}
