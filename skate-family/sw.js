const CACHE='skate-v36';
const ASSETS=[
  '/',
  '/manifest.webmanifest?v=6',
  '/icons/skate-180-v6.png',
  '/icons/skate-192-v6.png',
  '/icons/skate-512-v6.png',
  '/src/main-v11.js?v=15',
  '/src/cascade-presets.js?v=21',
  '/src/suggestion-calibration.js?v=27',
  '/src/iphone-file-picker.js?v=1',
  '/src/scoringEngine.js?v=25',
  '/src/jumpClassifier.js?v=25',
  '/src/programJudge.js?v=2',
  '/src/programJudge-core.js?v=25',
  '/src/jump-detector.js?v=18',
  '/src/style.css?v=5',
  '/src/analyzer.js?v=14',
  '/src/analyzer-core.js?v=25',
  '/src/multi-analyzer.js?v=15',
  '/src/multi-analyzer-core.js?v=25',
  '/src/fall-model.js?v=15',
  '/src/cascade-score.js?v=14',
  '/skate-family/models/fall_detection_transformer.tflite',
  '/src/db.js'
];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>e.waitUntil((async()=>{
  await self.clients.claim();
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  await Promise.all(clients.map(c=>c.navigate(c.url).catch(()=>null)));
})()));

async function navigationResponse(request){
  try{
    const r=await fetch(request,{cache:'no-store'});
    const type=r.headers.get('content-type')||'';
    if(!type.includes('text/html'))return r;
    let html=await r.text();
    if(!html.includes('/src/iphone-file-picker.js')){
      html=html.replace('</body>','<script type="module" src="/src/iphone-file-picker.js?v=1"></script></body>');
    }
    return new Response(html,{status:r.status,statusText:r.statusText,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }catch{
    return caches.match('/');
  }
}

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;

  if(e.request.mode==='navigate'){
    e.respondWith(navigationResponse(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request,{cache:'no-store'})
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