import { refineJumpType } from './jumpClassifier.js';
import { estimateGOE as sharedEstimateGOE } from './scoringEngine.js';

let FilesetResolver, PoseLandmarker;
let landmarker;
const G=9.80665;
const MP_VERSION='0.10.22';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

async function loadVisionModule(){
  const sources=[`${MP_CDN}/vision_bundle.mjs?skate=10`,`https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=10`];
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

function crossingTime(samples,ys,a,b,thr){
  const y0=ys[a],y1=ys[b],t0=samples[a].t,t1=samples[b].t,d=y1-y0;
  if(Math.abs(d)<1e-6)return(t0+t1)/2;
  const f=clamp((thr-y0)/d,0,1);return t0+(t1-t0)*f;
}
function nearestTimeIndex(samples,target){
  let best=0,d=Infinity;for(let i=0;i<samples.length;i++){const x=Math.abs(samples[i].t-target);if(x<d){d=x;best=i}}return best;
}
function detrendedStd(a){
  if(!a.length)return 0;if(a.length<3)return std(a);
  const n=a.length,mx=(n-1)/2,my=avg(a);let num=0,den=0;
  for(let i=0;i<n;i++){num+=(i-mx)*(a[i]-my);den+=(i-mx)**2}
  const slope=den?num/den:0,intercept=my-slope*mx;
  return std(a.map((v,i)=>v-(intercept+slope*i)));
}
function detectFlight(samples){
  const ys=smooth(samples.map(s=>s.hipY),2),n=ys.length,edge=Math.max(3,Math.floor(n*.18));
  const baseline=med([...ys.slice(0,edge),...ys.slice(-edge)]);let peak=0;for(let i=1;i<n;i++)if(ys[i]<ys[peak])peak=i;
  const amp=Math.max(0,baseline-ys[peak]),rise=Math.max(.010,amp*.28),thr=baseline-rise;
  let left=peak,right=peak;
  while(left>0&&ys[left]<thr)left--;while(right<n-1&&ys[right]<thr)right++;
  let firstInside=ys[left]<thr?left:Math.min(peak,left+1),lastInside=ys[right]<thr?right:Math.max(peak,right-1);
  if(lastInside-firstInside<2){firstInside=Math.max(0,peak-2);lastInside=Math.min(n-1,peak+2)}
  const coreStart=firstInside>0?crossingTime(samples,ys,firstInside-1,firstInside,thr):samples[firstInside].t;
  const coreEnd=lastInside<n-1?crossingTime(samples,ys,lastInside,lastInside+1,thr):samples[lastInside].t;
  const ratio=amp>.0001?clamp(rise/amp,.12,.60):.28;
  const coreDuration=Math.max(.06,coreEnd-coreStart);
  // Crossing a fraction of a ballistic parabola is shorter than true blade-off/blade-on
  // time. Reconstruct the full airtime instead of adding one whole sample at each side.
  const airtime=clamp(coreDuration/Math.sqrt(Math.max(.20,1-ratio)),.10,.90);
  const peakT=samples[peak].t;
  const takeoffT=clamp(peakT-airtime/2,samples[0].t,peakT);
  const landingT=clamp(peakT+airtime/2,peakT,samples.at(-1).t);
  const start=nearestTimeIndex(samples,takeoffT),end=Math.max(start+1,nearestTimeIndex(samples,landingT));
  return {start,end:Math.min(end,n-1),peak,airtime:Math.max(.08,landingT-takeoffT),amp,baseline,takeoffT,landingT,coreDuration};
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
function rotationReliability(segment,yaws){
  if(segment.length<3||yaws.length<3)return 30;
  let travelled=0;for(let i=1;i<yaws.length;i++)travelled+=Math.abs(yaws[i]-yaws[i-1]);
  const net=Math.abs(yaws.at(-1)-yaws[0]),consistency=travelled>.001?clamp(net/travelled,0,1):0;
  const visibility=avg(segment.map(s=>s.conf))*100;
  const widthNoise=detrendedStd(segment.map(s=>s.shoulderWidth));
  return clamp(Math.round(visibility*.48+consistency*44-widthNoise*450+4),20,97);
}

export async function analyzeVideo(video,onProgress=()=>{}){
  const pose=await initPose(),duration=Math.min(video.duration||0,15);if(!duration||duration<.4)throw new Error('Відео занадто коротке');
  // 25 fps sampling on short clips materially improves take-off/landing timing.
  const step=duration<=6?.04:duration<=10?.06:.08,times=[];for(let t=0;t<=duration;t+=step)times.push(Math.min(t,duration-.001));
  const raw=[];for(let i=0;i<times.length;i++){const t=times[i];await seek(video,t);const res=pose.detectForVideo(video,Math.round(t*1000)),m=getMetrics(res);if(m)raw.push({t,...m});onProgress(Math.round((i+1)/times.length*88))}
  if(raw.length<8)throw new Error('Не вдалося стабільно побачити фігуру. Спробуй відео, де все тіло в кадрі.');
  const flight=detectFlight(raw),segment=raw.slice(flight.start,flight.end+1),yaws=unwrap(segment.map(s=>s.yaw));
  const signedRotation=(yaws.at(-1)-yaws[0])/(2*Math.PI),rotation=Math.abs(signedRotation),axis=avg(segment.map(s=>s.axis));
  const landingWindow=raw.filter(s=>s.t>=flight.landingT&&s.t<=flight.landingT+.50);
  const lw=landingWindow.length>=3?landingWindow:raw.slice(flight.end,Math.min(raw.length,flight.end+Math.max(4,Math.round(.5/step))));
  const axisLanding=avg(lw.map(s=>s.axis));
  // Do not treat a normal knee bend, camera approach, or changing shoulder width as a
  // landing error. Penalise only lean and residual wobble after removing the travel trend.
  const leanPenalty=Math.max(0,axisLanding-14)*1.15;
  const hipNoise=detrendedStd(lw.map(s=>s.hipY)),pathNoise=detrendedStd(lw.map(s=>s.hipX)),axisNoise=std(lw.map(s=>s.axis));
  const stability=clamp(100-(leanPenalty+hipNoise*850+pathNoise*650+axisNoise*.55),0,100);
  const height=G*flight.airtime*flight.airtime/8;
  const rotReliability=rotationReliability(segment,yaws);
  const conf=clamp(avg(raw.map(s=>s.conf))*100-(flight.amp<.012?20:0)-(rotation<.2?15:0),15,98),quality=clamp(Math.round(50+height*60+stability*.22-axis*.7),0,100);
  const takeoff=takeoffFeatures(raw,flight.start,signedRotation);onProgress(95);
  return {airtime:round(flight.airtime,2),height:round(height,2),rotation:round(rotation,2),rotationSigned:round(signedRotation,2),rotationReliability:rotReliability,axis:round(axis,1),stability:Math.round(stability),confidence:Math.round(conf),quality,takeoff:round(flight.takeoffT,2),landing:round(flight.landingT,2),flightSignal:round(flight.amp,3),...takeoff};
}
function std(a){const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))}
function round(v,n){const p=10**n;return Math.round(v*p)/p}
function seek(video,t){return new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-t)<.01)return resolve();const done=()=>{cleanup();resolve()},err=()=>{cleanup();reject(new Error('Не вдалося прочитати кадр'))},cleanup=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',err)};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',err,{once:true});video.currentTime=t})}

export function estimateElement(rotationOrMetrics,selected='auto',context={}){const metrics=typeof rotationOrMetrics==='number'?{rotation:rotationOrMetrics}:rotationOrMetrics;return refineJumpType(metrics,selected,context).code}
export function estimateGOE(metrics,element,flags={}){return sharedEstimateGOE(metrics,element,flags)}
