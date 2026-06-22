// ============ SERVICE WORKER — Hanami Reads ============
// Maneja: caché offline básico + notificaciones push reales (VAPID)

const CACHE_NAME = 'hanami-cache-v1';

// ============ INSTALACIÓN ============
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

// ============ ACTIVACIÓN ============
self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

// ============ RECIBIR NOTIFICACIONES PUSH ============
self.addEventListener('push', function(event) {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: '🌸 Hanami Reads',
        body: event.data.text(),
        icon: 'icon-192.png',
        badge: 'icon-192.png'
      };
    }
  }

  const options = {
    body: data.body || 'Tienes una nueva actualización',
    icon: data.icon || 'icon-192.png',
    badge: data.badge || 'icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'open', title: '📱 Abrir' },
      { action: 'close', title: '❌ Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || '🌸 Hanami Reads',
      options
    )
  );
});

// ============ CLIC EN NOTIFICACIONES ============
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      for (let client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
