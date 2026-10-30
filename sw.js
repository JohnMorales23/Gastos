// Guarda la app en el teléfono: abre al instante y también sin internet. Los gastos viajan por otra vía (cola local).
const V = 'jk-compras-20261029-3';
const SHELL = ['compras-model.js?v=20261029-3', './', 'index.html', 'manifest.json?v=3', 'logo.png?v=3', 'icon.png?v=2', 'icon-192.png?v=2', 'icon-512.png?v=3'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return; // Google Apps Script y demás: directo a internet
  if (r.mode === 'navigate') { // la app: red primero (siempre la versión nueva); si tarda o no hay internet, la guardada
    e.respondWith((async () => {
      const c = await caches.open(V);
      try {
        const res = await Promise.race([fetch(r), new Promise((_, no) => setTimeout(no, 3500))]);
        if (res && res.ok) c.put('index.html', res.clone());
        return res;
      } catch (_) { return (await c.match('index.html')) || (await c.match('./')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => { // imágenes y demás: lo guardado al instante y se actualiza por detrás
    const c = await caches.open(V), hit = await c.match(r);
    const red = fetch(r).then(res => { if (res && res.ok) c.put(r, res.clone()); return res; }).catch(() => null);
    return hit || (await red) || Response.error();
  })());
});
