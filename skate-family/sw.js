const CACHE='skate-v5';
const ASSETS=['/','/manifest.webmanifest?v=5','/icons/skate-180-v5.png?v=5','/icons/skate-192-v5.png?v=5','/icons/skate-512-v5.png?v=5','/src/main.js?v=5','/src/style.css?v=5','/src/analyzer.js','/src/db.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});
