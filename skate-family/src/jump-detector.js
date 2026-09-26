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
    `${MP_CDN}/vision_bundle.mjs?skate=17`,
    `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=17`
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
  const opts={baseOptions:{modelAssetPath:model,delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.38,minPosePresenceConfidence:.38,minTrackingConfidence:.38};
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
  const sh=mid(l[11],l[12]),hp=mid(l[23],l[24]);
  const left=l[27],right=l[28];
  const supportAnkleY=Math.max(left.y,right.y);
  const ankleMidX=(left.x+right.x)/2;
  const ankleSpread=Math.abs(left.y-right.y);
  const body=Math.max(.08,Math.hypot(ankleMidX-sh.x,supportAnkleY-sh.y));
  const conf=avg([11,12,23,24,25,26,27,28].map(i=>l[i].visibility??0));
  return {hipY:hp.y,supportAnkleY,ankleSpread,body,conf};
}

function chooseSeparated(candidates,minGap=.40,maxCount=8){
  const picked=[];
  for(const c of [...candidates].sort((a,b)=>b.score-a.score)){
    if(picked.every(x=>Math.abs(x.time-c.time)>=minGap))picked.push(c);
    if(picked.length>=maxCount)break;
  }
  return picked.sort((a,b)=>a.time-b.time);
}

function suppressMiddleFalsePositives(candidates){
  if(candidates.length<3)return candidates;
  const sorted=[...candidates].sort((a,b)=>a.time-b.time),keep=[];
  for(let i=0;i<sorted.length;i++){
    const c=sorted[i],p=sorted[i-1],n=sorted[i+1];
    const betweenStrong=p&&n&&(c.time-p.time)<1.05&&(n.time-c.time)<1.05;
    const muchWeaker=betweenStrong&&c.score<Math.min(p.score,n.score)*.66&&c.support<Math.min(p.support,n.support)*.80;
    if(!muchWeaker)keep.push(c);
  }
  return keep;
}

function addBest(base,pool,{minGap=.24,maxGap=Infinity,maxCount=3,preferAfter=false}={}){
  const merged=[...base];
  const anchor=base[0]?.time??null;
  const ranked=[...pool].sort((a,b)=>{
    if(preferAfter&&anchor!=null){
      const aa=a.time>anchor?0:1,bb=b.time>anchor?0:1;
      if(aa!==bb)return aa-bb;
    }
    return b.score-a.score;
  });
  for(const c of ranked){
    if(merged.some(x=>Math.abs(x.time-c.time)<minGap))continue;
    if(merged.length&&Number.isFinite(maxGap)&&!merged.some(x=>Math.abs(x.time-c.time)<=maxGap))continue;
    merged.push(c);
    if(merged.length>=maxCount)break;
  }
  return merged.sort((a,b)=>a.time-b.time);
}

export async function detectJumpCandidates(video,{expectedCount=null,seriesMode=false,onProgress=()=>{}}={}){
  await waitMeta(video);
  const pose=await makePose();
  try{
    const duration=Math.min(video.duration||0,30);
    if(duration<1)throw new Error('Відео занадто коротке');
    const step=duration<=8?.045:duration<=16?.06:.075;
    const times=[];for(let t=0;t<duration-.001;t+=step)times.push(t);if(times.at(-1)<duration-.08)times.push(Math.max(0,duration-.002));
    const raw=[];let lastTs=-1;
    for(let i=0;i<times.length;i++){
      const t=times[i];await seek(video,t);let ts=Math.round(t*1000);if(ts<=lastTs)ts=lastTs+1;lastTs=ts;
      const m=frameMetrics(pose.detectForVideo(video,ts));if(m&&m.conf>.27)raw.push({t,...m});
      onProgress(Math.round((i+1)/times.length*80));
    }
    if(raw.length<12)throw new Error('Не вдалося стабільно побачити фігуриста');

    const hip=smooth(raw.map(s=>s.hipY),1),foot=smooth(raw.map(s=>s.supportAnkleY),1),body=raw.map(s=>s.body);
    const half=Math.max(6,Math.round(.64/step));
    const hipLift=[],footLift=[],combined=[],spreadNorm=[];
    for(let i=0;i<raw.length;i++){
      const lo=Math.max(0,i-half),hi=Math.min(raw.length,i+half+1),localBody=median(body.slice(lo,hi))||body[i]||.25;
      const h=(median(hip.slice(lo,hi))-hip[i])/Math.max(.08,localBody);
      const f=(median(foot.slice(lo,hi))-foot[i])/Math.max(.08,localBody);
      const sp=raw[i].ankleSpread/Math.max(.08,localBody);
      hipLift.push(h);footLift.push(f);spreadNorm.push(sp);
      combined.push(h*.82+f*.18-Math.max(0,sp-.50)*.006);
    }
    const s=smooth(combined,1),noise=Math.max(.003,mad(s));
    const primary=Math.max(.020,noise*2.25),secondary=Math.max(.0085,noise*1.25);

    const collect=(threshold,relaxed=false)=>{
      const out=[];
      for(let i=2;i<s.length-2;i++){
        if(s[i]<threshold||s[i]<s[i-1]||s[i]<s[i+1]||s[i]<s[i-2]||s[i]<s[i+2])continue;
        const edge=Math.max(.0038,s[i]*(relaxed?.14:.20));
        let a=i,b=i;while(a>0&&s[a]>edge)a--;while(b<s.length-1&&s[b]>edge)b++;
        const air=raw[b].t-raw[a].t;
        if(air<(relaxed?.07:.10)||air>.95)continue;
        const conf=avg(raw.slice(a,b+1).map(x=>x.conf));if(conf<(relaxed?.29:.36))continue;
        const hPeak=Math.max(...hipLift.slice(Math.max(0,a),Math.min(hipLift.length,b+1)));
        const fPeak=Math.max(...footLift.slice(Math.max(0,a),Math.min(footLift.length,b+1)));
        const freeLeg=median(spreadNorm.slice(Math.max(0,a),Math.min(spreadNorm.length,b+1)));
        if(hPeak<(relaxed?.0045:.011))continue;
        if(fPeak<(relaxed?-.024:-.008))continue;
        if(freeLeg>(relaxed?.90:.68)&&fPeak<(relaxed?-.003:.008))continue;
        const prominence=s[i]-Math.max(s[Math.max(0,a)],s[Math.min(s.length-1,b)]);
        const support=clamp(.13+hPeak*9.2+Math.max(0,fPeak)*4.5+prominence*5.0+conf*.18-Math.max(0,freeLeg-.52)*.08,0,1);
        const score=s[i]*112+prominence*46+clamp(air,.09,.62)*7+conf*4+support*8;
        const confidence=Math.round(clamp(24+support*54+Math.min(17,prominence/Math.max(noise,.001)*3)-Math.max(0,freeLeg-.70)*12,15,97));
        out.push({time:raw[i].t,airtime:air,lift:s[i],score,support,confidence,hipLift:hPeak,footLift:fPeak,freeLeg,relaxed});
      }
      return out;
    };

    const primaryPool=collect(primary,false).filter(c=>c.support>=.30);
    const secondaryPool=collect(secondary,true).filter(c=>c.support>=.13&&c.confidence>=24);
    let candidates=suppressMiddleFalsePositives(chooseSeparated(primaryPool,.38,10));

    if(expectedCount&&candidates.length<expectedCount){
      candidates=addBest(candidates,secondaryPool,{minGap:.22,maxGap:3.2,maxCount:expectedCount,preferAfter:true});
      candidates=chooseSeparated(candidates,.26,expectedCount);
    }

    if(!expectedCount&&seriesMode){
      if(candidates.length===0&&secondaryPool.length){
        candidates=chooseSeparated(secondaryPool,.26,4);
      }
      if(candidates.length===1){
        // Multi-jump mode explicitly means there is more than one element. Search the
        // whole remaining clip for the strongest second take-off instead of requiring
        // it to be within 1.5 s of the first. This fixes cascades with a long setup or
        // a fall after the second jump.
        const anchor=candidates[0];
        const secondPool=secondaryPool.filter(c=>Math.abs(c.time-anchor.time)>=.22&&Math.abs(c.time-anchor.time)<=3.5);
        candidates=addBest(candidates,secondPool,{minGap:.22,maxGap:3.5,maxCount:2,preferAfter:true});
      }
      if(candidates.length>1){
        const top=Math.max(...candidates.map(c=>c.score));
        candidates=candidates.filter(c=>c.score>=top*.11&&c.confidence>=22);
        candidates=chooseSeparated(candidates,.25,4);
        candidates=suppressMiddleFalsePositives(candidates);
      }
    }else if(!expectedCount&&candidates.length>1){
      const top=Math.max(...candidates.map(c=>c.score));
      candidates=candidates.filter(c=>c.score>=top*.32&&c.confidence>=42);
      candidates=suppressMiddleFalsePositives(candidates);
    }

    if(expectedCount&&candidates.length>expectedCount)candidates=chooseSeparated(candidates,.26,expectedCount);

    onProgress(100);
    return candidates.map(c=>({
      ...c,
      time:Math.round(c.time*100)/100,
      airtime:Math.round(c.airtime*100)/100,
      confidence:Math.round(c.confidence)
    }));
  }finally{
    try{pose.close?.()}catch{}
  }
}
