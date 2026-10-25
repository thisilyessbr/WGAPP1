self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Relayqo', {
    body: data.body || 'You have new inbox activity.',
    icon: '/portal-assets/app-icon-192.png',
    badge: '/portal-assets/app-icon-192.png',
    tag: data.tag || 'relayqo-inbox',
    renotify: true,
    data: { url: data.url || '/app/inbox' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app/inbox', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    return existing ? existing.focus().then(() => existing.navigate(target)) : clients.openWindow(target);
  }));
});
