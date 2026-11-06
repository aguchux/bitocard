/**
 * udozo.com's push handlers, added to its service worker (`/sw.js`, after the offline page): each push shows as a
 * system notification titled as Udozo sent it, and a click opens its page on udozo.com (never another site), or the
 * inbox. Plain JavaScript for the browser's service worker scope, never bundled.
 */
export const udozoPushWorker = `
function udozoTarget(data) {
  var url = new URL(data.link || '/account/notifications', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/account/notifications', self.location.origin);
  return url.href;
}

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Udozo', {
      body: data.body || '',
      tag: data.id || undefined,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      requireInteraction: data.severity === 'critical',
      data: { url: udozoTarget(data) },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.location.origin + '/account/notifications';
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
