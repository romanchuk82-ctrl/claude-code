import * as core from './analyzer-core.js?v=25';
import { refineJumpType } from './jumpClassifier.js?v=25';
import { estimateGOE as sharedEstimateGOE } from './scoringEngine.js?v=25';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const round=(v,n=2)=>{const p=10**n;return Math.round((Number(v)||0)*p)/p};
let enrichClock=0;
const recent=[];
let emergencyLandmarker=null;
let emergencyClock=0;

export const initPose=core.initPose;

function remember(metrics){
  recent.push(metrics);
  while(recent.length>24)recent.shift();
  return metrics;
}

function seek(video,t){
  return new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-t)<.008)return resolve();
    const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося прочитати кадр'))};
    const clean=()=>{video.removeEventListener('seeked',ok);video.removeEventListener('error',bad)};
    video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',bad,{once:true});
    try{video.currentTime=t}catch(e){clean();reject(e)}
  });
}

function takeoffFeatures(res){
  const l=res.landmarks?.[0],w=res.worldLandmarks?.[0];if(!l||!w)return null;
  const hipX=(l[23].x+l[24].x)/2,hipY=(l[23].y+l[24].y)/2;
  const shoulderX=(l[11].x+l[12].x)/2;
  const noseX=l[0]?.x??shoulderX;
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y)||.1;
  const ankleGap=Math.abs(l[27].x-l[28].x)/shoulderWidth;
  const backFoot=Math.max(Math.abs(l[31].x-hipX),Math.abs(l[32].x-hipX));
  const toeVertical=Math.max(l[31].y-l[27].y,l[32].y-l[28].y);
  const dx=w[12].x-w[11].x,dz=w[12].z-w[11].z;
  const yaw=Math.atan2(dz,dx);
  const conf=avg([0,11,12,23,24,27,28,31,32].map(i=>l[i]?.visibility||0));
  return {hipX,hipY,shoulderX,noseX,ankleGap,backFoot,toeVertical,yaw,conf};
}

export async function enrichJumpMetrics(video,metrics,onProgress=()=>{}){
  if(!metrics||!Number.isFinite(Number(metrics.takeoff)))return remember(metrics||{});
  try{
    const pose=await core.initPose();
    const take=Number(metrics.takeoff),start=Math.max(0,take-.38),end=Math.max(start+.08,Math.min(video.duration||take+.05,take+.035));
    const times=[];for(let t=start;t<=end+.001;t+=.045)times.push(t);
    const frames=[];
    for(let i=0;i<times.length;i++){
      await seek(video,times[i]);enrichClock+=40;
      const f=takeoffFeatures(pose.detectForVideo(video,enrichClock));if(f)frames.push({t:times[i],...f});
      onProgress(Math.round((i+1)/Math.max(1,times.length)*100));
    }
    if(frames.length<3)return remember(metrics);
    const a=frames[0],b=frames.at(-1),travelDx=b.hipX-a.hipX;
    const faceDx=b.noseX-b.shoulderX;
    let forwardScore=.48;
    if(Math.abs(travelDx)>.004&&Math.abs(faceDx)>.008)forwardScore=Math.sign(travelDx)===Math.sign(faceDx)?.82:.18;
    const toeAssist=clamp((b.backFoot-.075)*5.5+Math.max(0,b.toeVertical-.015)*4,0,1);
    const crossed=clamp(1-(b.ankleGap-.18)/.7,0,1);
    const yaws=frames.map(x=>x.yaw);let preTurn=0;
    for(let i=1;i<yaws.length;i++){let d=yaws[i]-yaws[i-1];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;preTurn+=d}
    return remember({...metrics,forwardScore:round(forwardScore,2),axelLikelihood:round(forwardScore,2),toeAssist:round(toeAssist,2),crossed:round(crossed,2),preTurn:round(preTurn/(2*Math.PI),2),takeoffFeatureConfidence:Math.round(avg(frames.map(x=>x.conf))*100)});
  }catch(e){console.warn('Take-off enrichment skipped',e);return remember(metrics)}
}

async function loadEmergencyVision(){
  if(emergencyLandmarker)return emergencyLandmarker;
  const sources=[
    'https://esm.sh/@mediapipe/tasks-vision@0.10.21?bundle',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs'
  ];
  let mod,last;
  for(const source of sources){
    try{
      const candidate=await import(source);
      if(candidate?.FilesetResolver&&candidate?.PoseLandmarker){mod=candidate;break}
    }catch(e){last=e;console.warn('Emergency MediaPipe source failed',source,e)}
  }
  if(!mod)throw last||new Error('Модуль аналізу тимчасово недоступний');
  const wasmSources=[
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/wasm'
  ];
  let vision=null;
  for(const wasm of wasmSources){try{vision=await mod.FilesetResolver.forVisionTasks(wasm);break}catch(e){last=e}}
  if(!vision)throw last||new Error('Не вдалося запустити модуль аналізу');
  const model='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  try{
    emergencyLandmarker=await mod.PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:model,delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.38,minPosePresenceConfidence:.38,minTrackingConfidence:.38});
  }catch{
    emergencyLandmarker=await mod.PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:model},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.38,minPosePresenceConfidence:.38,minTrackingConfidence:.38});
  }
  return emergencyLandmarker;
}

function unwrapYaw(values){
  if(!values.length)return[];
  const out=[values[0]];
  for(let i=1;i<values.length;i++){
    let d=values[i]-values[i-1];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
    out.push(out[i-1]+d);
  }
  return out;
}

function emergencyFrame(res,t){
  const l=res.landmarks?.[0],w=res.worldLandmarks?.[0];if(!l||!w)return null;
  const hipX=(l[23].x+l[24].x)/2,hipY=(l[23].y+l[24].y)/2;
  const shoulderX=(l[11].x+l[12].x)/2,shoulderY=(l[11].y+l[12].y)/2;
  const ankleY=(l[27].y+l[28].y)/2;
  const body=Math.max(.08,Math.hypot(hipX-shoulderX,hipY-shoulderY)+Math.abs(ankleY-hipY));
  const axis=Math.abs(Math.atan2(shoulderX-hipX,hipY-shoulderY)*180/Math.PI);
  const yaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const conf=avg([11,12,23,24,27,28].map(i=>l[i]?.visibility||0));
  return {t,hipX,hipY,body,axis,yaw,conf};
}

async function emergencyAnalyze(video,onProgress=()=>{}){
  const pose=await loadEmergencyVision();
  const duration=Math.min(Number(video.duration)||0,12);if(duration<.4)throw new Error('Відео занадто коротке');
  const step=duration<=6?.065:.09,times=[];for(let t=0;t<duration-.001;t+=step)times.push(t);times.push(Math.max(0,duration-.002));
  const frames=[];
  for(let i=0;i<times.length;i++){
    await seek(video,times[i]);emergencyClock+=40;
    const f=emergencyFrame(pose.detectForVideo(video,emergencyClock),times[i]);if(f)frames.push(f);
    onProgress(Math.round((i+1)/times.length*88));
  }
  if(frames.length<8)throw new Error('Не вдалося стабільно побачити фігуриста. Потрібне відео, де все тіло в кадрі.');
  const hipMean=avg(frames.map(f=>f.hipY));let peak=0;for(let i=1;i<frames.length;i++)if(frames[i].hipY<frames[peak].hipY)peak=i;
  const body=avg(frames.map(f=>f.body))||.3,amp=Math.max(0,hipMean-frames[peak].hipY),thr=hipMean-Math.max(body*.018,amp*.30);
  let start=peak,end=peak;while(start>1&&frames[start].hipY<thr)start--;while(end<frames.length-2&&frames[end].hipY<thr)end++;
  if(end-start<3){start=Math.max(1,peak-2);end=Math.min(frames.length-2,peak+3)}
  const airtime=Math.max(.10,frames[end].t-frames[start].t),height=9.80665*airtime*airtime/8;
  const air=frames.slice(start,end+1),yaw=unwrapYaw(air.map(f=>f.yaw));const rotation=yaw.length>1?Math.abs(yaw.at(-1)-yaw[0])/(2*Math.PI):0;
  const pre=frames.slice(Math.max(0,start-5),start+1),post=frames.slice(end,Math.min(frames.length,end+7));
  const speed=a=>{const x=[];for(let i=1;i<a.length;i++){const dt=a[i].t-a[i-1].t;if(dt>0)x.push(Math.abs(a[i].hipX-a[i-1].hipX)/(dt*body))}return avg(x)};
  const preSpeed=speed(pre),postSpeed=speed(post),flow=preSpeed>.03?clamp(Math.round(52+48*clamp(postSpeed/preSpeed,0,1)),30,98):70;
  const axisMean=avg(air.map(f=>f.axis)),axisVariation=Math.sqrt(avg(air.map(f=>(f.axis-axisMean)**2)));
  const postAxis=avg(post.map(f=>f.axis)),landingStability=clamp(Math.round(96-Math.max(0,postAxis-18)*1.4-Math.max(0,68-flow)*.45),35,96);
  const bodyControl=clamp(Math.round(94-axisVariation*4-Math.max(0,axisMean-20)),35,96),takeoffQuality=clamp(Math.round(70+Math.min(22,amp/body*220)),45,94);
  const smoothness=Math.round(bodyControl*.45+landingStability*.33+flow*.22),lengthBodies=Math.abs(frames[end].hipX-frames[start].hipX)/body;
  const confidence=clamp(Math.round(avg(frames.map(f=>f.conf))*72+frames.length/times.length*28),35,88);
  const quality=Math.round(landingStability*.30+bodyControl*.25+takeoffQuality*.20+flow*.15+clamp(height/.30*100,0,100)*.10);
  onProgress(96);
  return remember({version:2,emergencyFallback:true,airtime:round(airtime,2),height:round(height,2),rotation:round(rotation,2),rotationConfidence:confidence,lengthBodies:round(lengthBodies,2),flow,landingStability,bodyControl,takeoffQuality,smoothness,axisVariation:round(axisVariation,1),takeoff:round(frames[start].t,2),landing:round(frames[end].t,2),confidence,quality,fallDetected:false,fallPossible:false});
}

export async function analyzeVideo(video,onProgress=()=>{}){
  try{
    const m=await core.analyzeVideo(video,p=>onProgress(Math.round(p*.93)));
    return enrichJumpMetrics(video,m,p=>onProgress(93+Math.round(p*.07)));
  }catch(e){
    const msg=String(e?.message||e||'');
    if(!/модуль аналізу|MediaPipe|vision|network|fetch|import/i.test(msg))throw e;
    console.warn('Primary analyzer unavailable, using resilient fallback',e);
    return emergencyAnalyze(video,onProgress);
  }
}

function recentForRotation(rotation){
  for(let i=recent.length-1;i>=0;i--)if(Math.abs((Number(recent[i]?.rotation)||0)-rotation)<.035)return recent[i];
  return null;
}

export function estimateElement(rotationOrMetrics,selected='auto',context={}){
  if(selected&&selected!=='auto')return selected;
  if(rotationOrMetrics&&typeof rotationOrMetrics==='object')return refineJumpType(rotationOrMetrics,'auto',context).code;
  const rotation=Number(rotationOrMetrics)||1,m=recentForRotation(rotation);
  if(m)return refineJumpType(m,'auto',context).code;
  return `${clamp(Math.round(rotation),1,4)}J`;
}

export function estimateGOE(metrics,element,flags={}){
  if(!element||/J$/.test(element))return core.estimateGOE(metrics,element,flags);
  const r=sharedEstimateGOE(metrics,element,flags),confidence=Number(metrics?.confidence)||55;
  const pad=confidence>=82?0:confidence>=62?1:2;
  const positives=r.reasons.filter(x=>x[0]==='pos').length;
  const reductions=r.reasons.filter(x=>x[0]==='neg').length;
  const rotationCall=r.deficit>.50?'<<':r.deficit>.27?'<':r.deficit>.10?'q':'ok';
  return {...r,goeLow:clamp(r.goe-pad,-5,5),goeHigh:clamp(r.goe+pad,-5,5),positives,reductions,rotationCall,confidence,unmeasured:['Складність/оригінальність входу та виходу','Відповідність елемента музиці','Ребро Flip/Lutz без спеціального ракурсу']};
}
