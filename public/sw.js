/* RainLine service worker — v0.6.0
   Estratégia: REDE PRIMEIRO para os arquivos do app.
   O cache só entra em ação quando não há internet. Assim, toda vez que você
   publica uma versão nova, o celular pega a nova na hora — sem precisar
   limpar dados do site. */
const CACHE = 'rainline-v0.37.0';
const SHELL = [
  './', './index.html', './css/app.css', './js/app.js', './js/materials.js', './js/api.js', './js/i18n.js',
  './manifest.json', './sign.html', './privacidade.html', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;      // tiles e CDN: direto da rede
  if (url.pathname.startsWith('/api/')) return;    // API nunca entra em cache
  if (url.pathname.startsWith('/.well-known/')) return;   // verificação do Android: sempre da rede

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit => hit || caches.match('./index.html'))
      )
  );
});

// permite que a página force a troca imediata
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
