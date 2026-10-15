/*
 * Service Worker (wird beim Build aus dieser Vorlage erzeugt, siehe vite.config.ts).
 *
 *  - App-Dateien: beim Installieren vorab gecacht (Liste unten), danach „Cache zuerst“.
 *  - Modelle und WASM (jsDelivr, storage.googleapis.com): beim ersten Laden gecacht, danach nur noch aus dem Cache.
 *  - Alles andere im selben Ursprung: aus dem Netz, bei Erfolg im Cache abgelegt (Rückfall offline).
 */
const VERSION = '__VERSION__';
const APP_CACHE = `passbild-app-${VERSION}`;
const MODEL_CACHE = 'passbild-modelle-v1'; // bleibt über App-Versionen hinweg bestehen (16 MB WASM + Modelle)
const PRECACHE = __PRECACHE__;
const MODEL_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      // einzeln statt addAll: eine fehlende Datei soll nicht die ganze Installation kippen
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((e) => console.warn('Nicht gecacht:', url, e)),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('passbild-app-') && k !== APP_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (MODEL_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, MODEL_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put('./', fresh.clone());
          return fresh;
        } catch {
          return (await cache.match('./')) || (await cache.match('index.html')) || Response.error();
        }
      })(),
    );
    return;
  }
  event.respondWith(cacheFirst(req, APP_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // undurchsichtige Antworten (no-cors-Skripte) werden ebenfalls abgelegt
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => undefined);
  return res;
}
