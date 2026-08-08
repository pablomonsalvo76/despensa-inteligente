// Service worker mínimo: cachea el shell de la app para que abra offline
// (los agentes y la memoria en localStorage funcionan sin conexión;
// sólo el escaneo por GTIN y el OCR remoto de librerías requieren red).
const CACHE = 'despensa-inteligente-v36';
const ASSETS = [
  './', './index.html', './css/styles.css',
  './js/db.js', './js/recipes.js', './js/illustrations.js', './js/main.js',
  './js/agents/aiProvider.js',
  './js/agents/inventario.js', './js/agents/vencimientos.js', './js/agents/cocinero.js',
  './js/agents/evaluador.js', './js/agents/aprendizaje.js', './js/agents/captura.js',
  './js/agents/conversacional.js', './js/agents/orquestador.js', './js/agents/impacto.js',
  './js/agents/hogar.js', './js/agents/compras.js', './js/agents/generador.js',
  './js/agents/ppocr.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

// La página pregunta qué versión está sirviendo este service worker. Es la
// única forma de saber, desde el teléfono, si se está corriendo el código
// nuevo o uno cacheado: sin esto uno puede pasar media hora reportando un
// bug que ya está arreglado, simplemente porque el dispositivo sirvió una
// versión vieja.
self.addEventListener('message', (event) => {
  if (event.data === 'version' && event.source) {
    event.source.postMessage({ tipo: 'version', cache: CACHE });
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Estrategia "red primero, cache como respaldo": si hay conexión siempre se
// sirve la última versión de los archivos (evita quedar pegado a una versión
// vieja tras un cambio de CSS/JS); sin conexión, responde el cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
