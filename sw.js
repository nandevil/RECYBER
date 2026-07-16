/* =====================================================
   SERVICE WORKER — cache do "app shell" (HTML/CSS/JS estáticos) pra
   instalação como PWA e carregamento instantâneo. Nunca intercepta
   /api/* (worker.js) nem chamadas de outra origem (Supabase, ViaCEP,
   InfinitePay, Resend) — essas sempre precisam de dado fresco da rede.
===================================================== */
const CACHE_NAME = "recyber-shell-v1";
const APP_SHELL = [
  "/",
  "/css/style.css",
  "/js/supabase-client.js",
  "/js/products.js",
  "/js/promo-sync.js",
  "/js/cart-discount-sync.js",
  "/js/app.js",
  "/js/checkout.js",
  "/js/admin.js",
  "/js/catalog-sync.js",
  "/js/feedback-sync.js",
  "/js/settings-sync.js",
  "/js/newsletter.js",
  "/manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/* Stale-while-revalidate: responde na hora com o que tem em cache (se
   tiver) e atualiza o cache em segundo plano pra próxima visita. */
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
