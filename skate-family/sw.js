const CACHE='skate-v20';
const ASSETS=[
  '/',
  '/manifest.webmanifest?v=6',
  '/icons/skate-180-v6.png',
  '/icons/skate-192-v6.png',
  '/icons/skate-512-v6.png',
  '/src/main-v11.js?v=15',
  '/src/cascade-presets.js?v=19',
  '/src/jump-detector.js?v=18',
  '/src/style.css?v=5',
  '/src/analyzer.js?v=14',
  '/skate-family/src/analyzer.js?v=9',
  '/src/multi-analyzer.js?v=15',
  '/src/fall-model.js?v=15',
  '/src/cascade-score.js?v=14',
  '/skate-family/models/fall_detection_transformer.tflite',
  '/src/db.js'
];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
])));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;

  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).catch(()=>caches.match('/')));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(r=>{
        if(r.ok){
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(e.request,copy));
        }
        return r;
      })
      .catch(()=>caches.match(e.request).then(r=>r||Response.error()))
  );
});
