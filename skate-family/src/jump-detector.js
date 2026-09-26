let FilesetResolver, PoseLandmarker;
const MP_VERSION='0.10.21';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const median=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const mad=a=>{if(!a.length)return 0;const m=median(a);return median(a.map(v=>Math.abs(v-m)))};
const smooth=(a,w=1)=>a.map((_,i)=>avg(a.slice(Math.max(0,i-w),Math.min(a.length,i+w+1))));

async function loadVision(){
  const sources=[
    `${MP_CDN}/vision_bundle.mjs?skate=13`,
    `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=13`
  ];
  let last;
  for(const src of sources){
    try{const m=await import(src);if(m?.FilesetResolver&&m?.PoseLandmarker)return m}catch(e){last=e}
  }
  throw last||new Error('Не вдалося завантажити модуль пошуку стрибків');
}

async function makePose(){
  if(!FilesetResolver){const m=await loadVision();FilesetResolver=m.FilesetResolver;PoseLandmarker=m.PoseLandmarker}
  const vision=await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const model='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const opts={baseOptions:{modelAssetPath:model,delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.40,minPosePresenceConfidence:.40,minTrackingConfidence:.40};
  try{return await PoseLandmarker.createFromOptions(vision,opts)}catch{return await PoseLandmarker.createFromOptions(vision,{...opts,baseOptions:{modelAssetPath:model}})}
}

function waitMeta(video){
  return new Promise((resolve,reject)=>{
    if(video.readyState>=1&&Number.isFinite(video.duration))return resolve();
    const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося відкрити відео'))},clean=()=>{video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',bad)};
    video.addEventListener('loadedmetadata',ok,{once:true});video.addEventListener('error',bad,{once:true});
  });
}

function seek(video,t){
  return new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-t)<.006)return resolve();
    const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося прочитати кадр'))},clean=()=>{video.removeEventListener('seeked',ok);video.removeEventListener('error',bad)};
    video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',bad,{once:true});video.currentTime=t;
  });
}

function frameMetrics(res){
  const l=res.landmarks?.[0];if(!l)return null;
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const sh=mid(l[11],l[12]),hp=mid(l[23],l[24]),an=mid(l[27],l[28]);
  const body=Math.max(.08,Math.hypot(an.x-sh.x,an.y-sh.y));
  const conf=avg([11,12,23,24,25,26,27,28].map(i=>l[i].visibility??0));
  return {hipY:hp.y,ankleY:an.y,body,conf};
}

function chooseSeparated(candidates,minGap=.42,maxCount=8){
  const picked=[];
  for(const c of [...candidates].sort((a,b)=>b.score-a.score)){
    if(picked.every(x=>Math.abs(x.time-c.time)>=minGap))picked.push(c);
    if(picked.length>=maxCount)break;
  }
  return picked.sort((a,b)=>a.time-b.time);
}

export async function detectJumpCandidates(video,{expectedCount=null,onProgress=()=>{}}={}){
  await waitMeta(video);
  const pose=await makePose();
  try{
    const duration=Math.min(video.duration||0,30);
    if(duration<1)throw new Error('Відео занадто коротке');
    const step=duration<=8?.065:duration<=16?.075:.09;
    const times=[];for(let t=0;t<duration-.001;t+=step)times.push(t);if(times.at(-1)<duration-.08)times.push(Math.max(0,duration-.002));
    const raw=[];let lastTs=-1;
    for(let i=0;i<times.length;i++){
      const t=times[i];await seek(video,t);let ts=Math.round(t*1000);if(ts<=lastTs)ts=lastTs+1;lastTs=ts;
      const m=frameMetrics(pose.detectForVideo(video,ts));if(m&&m.conf>.30)raw.push({t,...m});
      onProgress(Math.round((i+1)/times.length*82));
    }
    if(raw.length<12)throw new Error('Не вдалося стабільно побачити фігуриста');

    const y=smooth(raw.map(s=>s.hipY*.72+s.ankleY*.28),1);
    const body=raw.map(s=>s.body);
    const half=Math.max(5,Math.round(.62/step));
    const lift=[];
    for(let i=0;i<raw.length;i++){
      const lo=Math.max(0,i-half),hi=Math.min(raw.length,i+half+1);
      const base=median(y.slice(lo,hi));
      const localBody=median(body.slice(lo,hi))||body[i]||.25;
      lift.push((base-y[i])/Math.max(.08,localBody));
    }
    const s=smooth(lift,1),noise=Math.max(.004,mad(s));
    const primary=Math.max(.028,noise*2.6);
    const secondary=Math.max(.018,noise*1.9);

    const collect=threshold=>{
      const out=[];
      for(let i=2;i<s.length-2;i++){
        if(s[i]<threshold||s[i]<s[i-1]||s[i]<s[i+1]||s[i]<s[i-2]||s[i]<s[i+2])continue;
        const edge=Math.max(.006,s[i]*.24);
        let a=i,b=i;while(a>0&&s[a]>edge)a--;while(b<s.length-1&&s[b]>edge)b++;
        const air=raw[b].t-raw[a].t;
        if(air<.12||air>.95)continue;
        const conf=avg(raw.slice(a,b+1).map(x=>x.conf));
        if(conf<.38)continue;
        const prominence=s[i]-Math.max(s[Math.max(0,a)],s[Math.min(s.length-1,b)]);
        const score=s[i]*100+prominence*35+clamp(air,.15,.65)*8+conf*4;
        out.push({time:raw[i].t,airtime:air,lift:s[i],score});
      }
      return out;
    };

    let candidates=chooseSeparated(collect(primary),.42,10);
    if(expectedCount&&candidates.length<expectedCount){
      const looser=chooseSeparated(collect(secondary),.34,10);
      const merged=[...candidates];
      for(const c of looser)if(merged.every(x=>Math.abs(x.time-c.time)>=.30))merged.push(c);
      candidates=chooseSeparated(merged,.34,10);
    }
    if(expectedCount&&candidates.length>expectedCount){
      candidates=chooseSeparated(candidates,.34,expectedCount);
    }
    onProgress(100);
    return candidates.map(c=>({...c,time:Math.round(c.time*100)/100,airtime:Math.round(c.airtime*100)/100}));
  }finally{
    try{pose.close?.()}catch{}
  }
}
