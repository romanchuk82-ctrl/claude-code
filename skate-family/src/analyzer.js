import { refineJumpType } from './jumpClassifier.js';
import { estimateGOE as sharedEstimateGOE } from './scoringEngine.js';

let FilesetResolver, PoseLandmarker;
let landmarker;
const G=9.80665;
const MP_VERSION='0.10.22';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

async function loadVisionModule(){
  const sources=[`${MP_CDN}/vision_bundle.mjs?skate=9`,`https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=9`];
  let lastError;
  for(const source of sources){try{const mod=await import(source);if(mod?.FilesetResolver&&mod?.PoseLandmarker)return mod}catch(err){lastError=err;console.warn('MediaPipe module source failed',source,err)}}
  console.error('MediaPipe module load failed',lastError);throw new Error('Не вдалося завантажити модуль аналізу. Перевір інтернет і спробуй ще раз.');
}
export async function initPose(){
  if(landmarker)return landmarker;
  if(!FilesetResolver){const mod=await loadVisionModule();FilesetResolver=mod.FilesetResolver;PoseLandmarker=mod.PoseLandmarker}
  const vision=await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const options={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45};
  try{landmarker=await PoseLandmarker.createFromOptions(vision,options)}catch(err){console.warn('GPU PoseLandmarker unavailable, falling back to CPU',err);landmarker=await PoseLandmarker.createFromOptions(vision,{...options,baseOptions:{modelAssetPath:options.baseOptions.modelAssetPath}})}
  return landmarker;
}
const avg=a=>a.reduce((s,v)=>s+v,0)/(a.length||1);
const med=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,w=2)=>a.map((_,i)=>avg(a.slice(Math.max(0,i-w),Math.min(a.length,i+w+1))));
const unwrap=angles=>{if(!angles.length)return[];const out=[angles[0]];for(let i=1;i<angles.length;i++){let d=angles[i]-angles[i-1];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;out.push(out[i-1]+d)}return out};
const deg=r=>r*180/Math.PI;

function getMetrics(frame){
  const l=frame.landmarks?.[0],w=frame.worldLandmarks?.[0];if(!l||!w)return null;
  const hipX=(l[23].x+l[24].x)/2,hipY=(l[23].y+l[24].y)/2;
  const shoulderX=(l[11].x+l[12].x)/2,shoulderY=(l[11].y+l[12].y)/2;
  const axis=Math.abs(deg(Math.atan2(shoulderX-hipX,hipY-shoulderY)));
  const yaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y),hipWidth=Math.hypot(l[24].x-l[23].x,l[24].y-l[23].y);
  const conf=avg([l[0],l[11],l[12],l[23],l[24],l[27],l[28],l[31],l[32]].map(p=>p?.visibility||0));
  return {hipX,hipY,shoulderX,shoulderY,noseX:l[0].x,axis,yaw,shoulderWidth,hipWidth,conf,
    leftAnkleX:l[27].x,leftAnkleY:l[27].y,rightAnkleX:l[28].x,rightAnkleY:l[28].y,
    leftToeX:l[31].x,leftToeY:l[31].y,rightToeX:l[32].x,rightToeY:l[32].y};
}
function detectFlight(samples){
  const ys=smooth(samples.map(s=>s.hipY),2),n=ys.length,edge=Math.max(3,Math.floor(n*.18));
  const baseline=med([...ys.slice(0,edge),...ys.slice(-edge)]);let peak=0;for(let i=1;i<n;i++)if(ys[i]<ys[peak])peak=i;
  const amp=baseline-ys[peak],thr=baseline-Math.max(.010,amp*.28);let start=peak,end=peak;
  while(start>1&&ys[start]<thr)start--;while(end<n-2&&ys[end]<thr)end++;
  if(end-start<2){start=Math.max(0,peak-2);end=Math.min(n-1,peak+3)}
  return {start,end,peak,airtime:Math.max(.08,samples[end].t-samples[start].t),amp,baseline};
}
function takeoffFeatures(raw,start,signedRotation){
  const pre=raw.slice(Math.max(0,start-6),start+1),take=raw[start],pre0=pre[0]||take;
  const travelDx=take.hipX-pre0.hipX,faceDx=take.noseX-take.shoulderX;
  const forwardScore=Math.abs(travelDx)>.004&&Math.abs(faceDx)>.008?(Math.sign(travelDx)===Math.sign(faceDx)?.82:.18):.48;
  const backFoot=Math.max(Math.abs(take.leftToeX-take.hipX),Math.abs(take.rightToeX-take.hipX));
  const toeVertical=Math.max(take.leftToeY-take.leftAnkleY,take.rightToeY-take.rightAnkleY);
  const toeAssist=clamp((backFoot-.075)*5.5+Math.max(0,toeVertical-.015)*4,0,1);
  const ankleGap=Math.abs(take.leftAnkleX-take.rightAnkleX)/(take.shoulderWidth||.1);
  const crossed=clamp(1-(ankleGap-.18)/.7,0,1);
  const preYaw=unwrap(pre.map(x=>x.yaw));const preTurn=preYaw.length>1?(preYaw.at(-1)-preYaw[0])/(Math.PI*2):0;
  const counterRotation=Math.abs(preTurn)>.025&&Math.abs(signedRotation)>.05&&Math.sign(preTurn)!==Math.sign(signedRotation)?1:0;
  return {forwardScore:round(forwardScore,2),axelLikelihood:round(forwardScore,2),toeAssist:round(toeAssist,2),crossed:round(crossed,2),counterRotation};
}

export async function analyzeVideo(video,onProgress=()=>{}){
  const pose=await initPose(),duration=Math.min(video.duration||0,15);if(!duration||duration<.4)throw new Error('Відео занадто коротке');
  const step=duration<=6?.06:duration<=10?.08:.1,times=[];for(let t=0;t<=duration;t+=step)times.push(Math.min(t,duration-.001));
  const raw=[];for(let i=0;i<times.length;i++){const t=times[i];await seek(video,t);const res=pose.detectForVideo(video,Math.round(t*1000)),m=getMetrics(res);if(m)raw.push({t,...m});onProgress(Math.round((i+1)/times.length*88))}
  if(raw.length<8)throw new Error('Не вдалося стабільно побачити фігуру. Спробуй відео, де все тіло в кадрі.');
  const flight=detectFlight(raw),segment=raw.slice(flight.start,flight.end+1),yaws=unwrap(segment.map(s=>s.yaw));
  const signedRotation=(yaws.at(-1)-yaws[0])/(2*Math.PI),rotation=Math.abs(signedRotation),axis=avg(segment.map(s=>s.axis));
  const landingWindow=raw.slice(flight.end,Math.min(raw.length,flight.end+Math.max(3,Math.round(.45/step))));
  const axisLanding=avg(landingWindow.map(s=>s.axis)),hipJitter=std(landingWindow.map(s=>s.hipY)),widthJitter=std(landingWindow.map(s=>s.shoulderWidth));
  const stability=clamp(100-(axisLanding*1.15+hipJitter*1200+widthJitter*900),0,100),height=G*flight.airtime*flight.airtime/8;
  const conf=clamp(avg(raw.map(s=>s.conf))*100-(flight.amp<.012?20:0)-(rotation<.2?15:0),15,98),quality=clamp(Math.round(50+height*60+stability*.22-axis*.7),0,100);
  const takeoff=takeoffFeatures(raw,flight.start,signedRotation);onProgress(95);
  return {airtime:round(flight.airtime,2),height:round(height,2),rotation:round(rotation,2),rotationSigned:round(signedRotation,2),axis:round(axis,1),stability:Math.round(stability),confidence:Math.round(conf),quality,takeoff:round(raw[flight.start].t,2),landing:round(raw[flight.end].t,2),...takeoff};
}
function std(a){const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))}
function round(v,n){const p=10**n;return Math.round(v*p)/p}
function seek(video,t){return new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-t)<.01)return resolve();const done=()=>{cleanup();resolve()},err=()=>{cleanup();reject(new Error('Не вдалося прочитати кадр'))},cleanup=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',err)};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',err,{once:true});video.currentTime=t})}

export function estimateElement(rotationOrMetrics,selected='auto',context={}){const metrics=typeof rotationOrMetrics==='number'?{rotation:rotationOrMetrics}:rotationOrMetrics;return refineJumpType(metrics,selected,context).code}
export function estimateGOE(metrics,element,flags={}){return sharedEstimateGOE(metrics,element,flags)}
