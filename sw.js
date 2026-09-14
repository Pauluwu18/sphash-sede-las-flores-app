// Service Worker para sincronización en tiempo real del inventario
const CACHE_NAME = 'splash-inventory-v2';
const SYNC_TAG = 'sync-inventory';
const SYNC_INTERVAL = 5000; // Sincronizar cada 5 segundos

self.addEventListener('install', (event) => {
  console.log('✅ Service Worker instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activado');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Sincronización periódica en background
let syncInterval = setInterval(syncInventory, SYNC_INTERVAL);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLIENTS_CLAIM') {
    self.clients.claim();
  }
});

async function syncInventory() {
  try {
    const clients = await self.clients.matchAll();
    if (clients.length === 0) return; // No hay clientes, no sincronizar

    const response = await fetch('/api/inventory');
    if (!response.ok) throw new Error('HTTP error');
    
    const data = await response.json();
    
    // Notificar a todos los clientes sobre los cambios
    clients.forEach(client => {
      client.postMessage({
        type: 'INVENTORY_SYNC',
        data: data,
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('Error en sincronización de background:', error);
  }
}

// Sincronización en background (cuando el navegador lo permite)
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncInventory());
  }
});

// Solo intercepta lo relacionado al inventario; todo lo demas (index.html, app.js, etc.) pasa sin tocar,
// siempre pidiendo la red primero para reflejar cambios al instante.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes('inventory') && !url.pathname.startsWith('/api/inventory')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cache = caches.open(CACHE_NAME);
          cache.then((c) => c.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
