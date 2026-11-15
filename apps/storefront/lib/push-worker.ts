/**
 * The store's push handlers, added to its service worker (`/sw.js`, after the offline page): each push shows as a
 * system notification titled as the store sent it (its logo as the icon where it has one), and a click opens its page
 * on this store's own address (never another site), or the notifications screen. Plain JavaScript for the browser's
 * service worker scope, never bundled. Reseller stores never get BitoCard's icon: the API sends the icon to use.
 */
export const storePushWorker = `
function storeTarget(data) {
  var url = new URL(data.link || '/account/profile/notifications', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/account/profile/notifications', self.location.origin);
  return url.href;
}

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  var options = { body: data.body || '', tag: data.id || undefined, requireInteraction: data.severity === 'critical', data: { url: storeTarget(data) } };
  if (data.icon) options.icon = data.icon;
  event.waitUntil(self.registration.showNotification(data.title || 'Notification', options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.location.origin + '/account/profile/notifications';
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
