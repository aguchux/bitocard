/**
 * The push service worker shared by SHQ and the admin app, served by each app at `/push-sw.js` (a route handler) so
 * it runs on that app's own origin. It shows each push as a system notification and opens its page when clicked:
 * the link, plus the reseller account (`account`) and mode (`mode=test` or `live`) it belongs to, so SHQ opens the
 * right account in the right mode. Storefronts can serve it too once customers exist: customer pushes carry their
 * store's logo, never BitoCard's. Plain JavaScript: it runs in the browser's service worker scope, not through the app bundle.
 */
export const pushServiceWorker = `'use strict';

function target(data) {
  var url = new URL(data.link || '/notifications', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/notifications', self.location.origin);
  if (data.account) url.searchParams.set('account', data.account);
  if (data.mode === 'test' || data.mode === 'live') url.searchParams.set('mode', data.mode);
  return url.href;
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'BitoCard', {
      body: data.body || '',
      tag: data.id || undefined,
      // The API sends the icon: BitoCard's for staff, the store's logo (or none) for customers.
      icon: data.icon === undefined ? '/bitocard-logo.png' : data.icon || undefined,
      badge: data.icon === undefined ? '/bitocard-logo.png' : data.icon || undefined,
      requireInteraction: data.severity === 'critical',
      data: { url: target(data) },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.location.origin + '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i += 1) {
        var client = windows[i];
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.focus().then(function (focused) {
            return (focused || client).navigate(url).catch(function () {
              return self.clients.openWindow(url);
            });
          });
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
`;
