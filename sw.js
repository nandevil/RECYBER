/* =====================================================
   SERVICE WORKER — cache do "app shell" (HTML/CSS/JS estáticos) pra
   instalação como PWA e carregamento instantâneo. Nunca intercepta
   /api/* (worker.js) nem chamadas de outra origem (Supabase, ViaCEP,
   InfinitePay, Resend) — essas sempre precisam de dado fresco da rede.
===================================================== */
const CACHE_NAME = "recyber-shell-v2";
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

/* Rede primeiro, cache só como reserva pra quando estiver offline.
   Já usamos stale-while-revalidate antes, mas isso servia a versão
   antiga do JS/CSS na primeira visita depois de CADA deploy (só
   atualizava em segundo plano, pra próxima vez) — péssimo pra um site
   que muda de código toda hora. Como o admin quase sempre está online,
   rede primeiro garante código sempre atualizado; cache entra só se a
   rede falhar de verdade. */
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
