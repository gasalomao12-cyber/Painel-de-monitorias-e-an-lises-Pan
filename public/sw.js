// Service worker: permite instalar como app e acelera o carregamento da interface.
// Nunca guarda chamadas ao Supabase — os dados vêm sempre ao vivo.
const CACHE = 'px-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Rede primeiro (sempre a versão mais nova); o cache só serve se estiver offline
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && /\.(js|css|png|svg|ico|html|webmanifest)$|\/$/.test(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('./'))));
});
