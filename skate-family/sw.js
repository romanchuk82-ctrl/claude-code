const CACHE='skate-v14';
const ASSETS=[
  '/',
  '/manifest.webmanifest?v=7',
  '/icons/skate-180-v7.png',
  '/icons/skate-192-v7.png',
  '/icons/skate-512-v6.png',
  '/src/main.js?v=10',
  '/src/style.css?v=5',
  '/src/program.css?v=1',
  '/src/analyzer.js?v=13',
  '/src/programJudge.js?base=1',
  '/src/programJudgeUnified.js',
  '/src/scoringEngine.js?v=13',
  '/src/jumpClassifier.js',
  '/src/db.js'
];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
]));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>r).catch(()=>caches.match('/')));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
    return r;
  }).catch(()=>caches.match(e.request).then(r=>r||Response.error())));
});
