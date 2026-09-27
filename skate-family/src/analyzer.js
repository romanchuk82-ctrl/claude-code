import { refineJumpType } from './jumpClassifier.js';
import { estimateGOE as sharedEstimateGOE } from './scoringEngine.js';

let FilesetResolver, PoseLandmarker;

let landmarker;
const G=9.80665;
const MP_VERSION='0.10.22';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

async function loadVisionModule(){
  const sources=[
    `${MP_CDN}/vision_bundle.mjs?skate=8`,
    `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=8`
  ];
  let lastError;
  for(const source of sources){
    try{
      const mod=await import(source);
      if(mod?.FilesetResolver&&mod?.PoseLandmarker)return mod;
    }catch(err){
      lastError=err;
      console.warn('MediaPipe module source failed',source,err);
    }
  }
  console.error('MediaPipe module load failed',lastError);
  throw new Error('Не вдалося завантажити модуль аналізу. Перевір інтернет і спробуй ще раз.');
}

export async function initPose(){
  if(landmarker) return landmarker;
  if(!FilesetResolver){
    const mod=await loadVisionModule();
    FilesetResolver=mod.FilesetResolver; PoseLandmarker=mod.PoseLandmarker;
  }
  const vision=await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const options={
    baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'GPU'},
    runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45
  };
  try{
    landmarker=await PoseLandmarker.createFromOptions(vision,options);
  }catch(err){
    console.warn('GPU PoseLandmarker unavailable, falling back to CPU',err);
    const cpu={...options,baseOptions:{modelAssetPath:options.baseOptions.modelAssetPath}};
    landmarker=await PoseLandmarker.createFromOptions(vision,cpu);
  }
  return landmarker;
}
const avg=(a)=>a.reduce((s,v)=>s+v,0)/(a.length||1);
const med=(a)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,w=2)=>a.map((_,i)=>avg(a.slice(Math.max(0,i-w),Math.min(a.length,i+w+1))));
const unwrap=(angles)=>{if(!angles.length)return[];const out=[angles[0]];for(let i=1;i<angles.length;i++){let d=angles[i]-angles[i-1];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;out.push(out[i-1]+d)}return out};
const deg=r=>r*180/Math.PI;

function getMetrics(frame){
  const l=frame.landmarks?.[0], w=frame.worldLandmarks?.[0]; if(!l||!w)return null;
  const hipX=(l[23].x+l[24].x)/2;
  const hipY=(l[23].y+l[24].y)/2;
  const ankleY=(l[27].y+l[28].y)/2;
  const shX=(l[11].x+l[12].x)/2, shY=(l[11].y+l[12].y)/2;
  const hpX=(l[23].x+l[24].x)/2, hpY=(l[23].y+l[24].y)/2;
  const axis=Math.abs(deg(Math.atan2(shX-hpX, hpY-shY)));
  const dx=w[12].x-w[11].x, dz=w[12].z-w[11].z;
  const yaw=Math.atan2(dz,dx);
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y);
  const hipWidth=Math.hypot(l[24].x-l[23].x,l[24].y-l[23].y);
  const conf=avg([l[11].visibility||0,l[12].visibility||0,l[23].visibility||0,l[24].visibility||0,l[27].visibility||0,l[28].visibility||0]);
  const lat={x:w[12].x-w[11].x,y:w[12].y-w[11].y,z:w[12].z-w[11].z};
  const sm={x:(w[11].x+w[12].x)/2,y:(w[11].y+w[12].y)/2,z:(w[11].z+w[12].z)/2};
  const hm={x:(w[23].x+w[24].x)/2,y:(w[23].y+w[24].y)/2,z:(w[23].z+w[24].z)/2};
  const vert={x:sm.x-hm.x,y:sm.y-hm.y,z:sm.z-hm.z};
  const frontX=lat.y*vert.z-lat.z*vert.y;
  return {hipX,hipY,ankleY,axis,yaw,shoulderWidth,hipWidth,frontX,conf};
}

function detectFlight(samples){
  const ys=smooth(samples.map(s=>s.hipY),2);
  const n=ys.length;
  const edge=Math.max(3,Math.floor(n*.18));
  const baseline=med([...ys.slice(0,edge),...ys.slice(-edge)]);
  let peak=0; for(let i=1;i<n;i++) if(ys[i]<ys[peak])peak=i;
  const amp=baseline-ys[peak];
  const thr=baseline-Math.max(.010,amp*.28);
  let start=peak,end=peak;
  while(start>1&&ys[start]<thr)start--;
  while(end<n-2&&ys[end]<thr)end++;
  if(end-start<2){start=Math.max(0,peak-2);end=Math.min(n-1,peak+3)}
  const airtime=Math.max(.08,samples[end].t-samples[start].t);
  return {start,end,peak,airtime,amp,baseline};
}

function takeoffDirection(raw,start){
  const pre=raw.slice(Math.max(0,start-5),start+1);
  if(pre.length<3)return .5;
  const a=pre[0],b=pre.at(-1),dt=Math.max(.05,b.t-a.t);
  const vx=(b.hipX-a.hipX)/dt;
  const front=avg(pre.map(x=>x.frontX||0));
  if(Math.abs(vx)<.018||Math.abs(front)<.015)return .5;
  return vx*front>0?.72:.28;
}

export async function analyzeVideo(video,onProgress=()=>{}){
  const pose=await initPose();
  const duration=Math.min(video.duration||0,15);
  if(!duration||duration<.4)throw new Error('Відео занадто коротке');
  const step=duration<=6?.06:duration<=10?.08:.1;
  const times=[]; for(let t=0;t<=duration;t+=step)times.push(Math.min(t,duration-.001));
  const raw=[];
  for(let i=0;i<times.length;i++){
    const t=times[i];
    await seek(video,t);
    const res=pose.detectForVideo(video,Math.round(t*1000));
    const m=getMetrics(res);
    if(m)raw.push({t,...m});
    onProgress(Math.round((i+1)/times.length*88));
  }
  if(raw.length<8)throw new Error('Не вдалося стабільно побачити фігуру. Спробуй відео, де все тіло в кадрі.');
  const flight=detectFlight(raw);
  const segment=raw.slice(flight.start,flight.end+1);
  const yaws=unwrap(segment.map(s=>s.yaw));
  const rotation=Math.abs((yaws.at(-1)-yaws[0])/(2*Math.PI));
  const axis=avg(segment.map(s=>s.axis));
  const landingWindow=raw.slice(flight.end,Math.min(raw.length,flight.end+Math.max(3,Math.round(.45/step))));
  const axisLanding=avg(landingWindow.map(s=>s.axis));
  const hipJitter=std(landingWindow.map(s=>s.hipY));
  const widthJitter=std(landingWindow.map(s=>s.shoulderWidth));
  const stability=clamp(100-(axisLanding*1.15+hipJitter*1200+widthJitter*900),0,100);
  const height=G*flight.airtime*flight.airtime/8;
  const conf=clamp(avg(raw.map(s=>s.conf))*100 - (flight.amp<.012?20:0) - (rotation<.2?15:0),15,98);
  const quality=clamp(Math.round(50+height*60+stability*.22-axis*.7),0,100);
  const axelLikelihood=takeoffDirection(raw,flight.start);
  onProgress(95);
  return {airtime:round(flight.airtime,2),height:round(height,2),rotation:round(rotation,2),axis:round(axis,1),stability:Math.round(stability),confidence:Math.round(conf),quality,takeoff:round(raw[flight.start].t,2),landing:round(raw[flight.end].t,2),axelLikelihood:round(axelLikelihood,2)};
}
function std(a){const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))}
function round(v,n){const p=10**n;return Math.round(v*p)/p}
function seek(video,t){return new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-t)<.01)return resolve();const done=()=>{cleanup();resolve()};const err=()=>{cleanup();reject(new Error('Не вдалося прочитати кадр'))};const cleanup=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',err)};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',err,{once:true});video.currentTime=t})}

export function estimateElement(rotationOrMetrics,selected='auto',context={}){
  const metrics=typeof rotationOrMetrics==='number'?{rotation:rotationOrMetrics}:rotationOrMetrics;
  return refineJumpType(metrics,selected,context).code;
}
export function estimateGOE(metrics,element,flags={}){return sharedEstimateGOE(metrics,element,flags)}
