import { makeFallFeatures, inferFallProbability } from './fall-model.js?v=15';

let FilesetResolver, PoseLandmarker;
let pose=null;
let lastTimestamp=-1;
const G=9.80665;
const MP_VERSION='0.10.21';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,n=2)=>{const p=10**n;return Math.round(v*p)/p};
const med=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const mad=a=>{if(!a.length)return 0;const m=med(a);return med(a.map(v=>Math.abs(v-m)))};
const std=a=>{if(!a.length)return 0;const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))};
const smooth=(a,w=2)=>a.map((_,i)=>avg(a.slice(Math.max(0,i-w),Math.min(a.length,i+w+1))));
const wrapAngle=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};
const unwrap=angles=>{if(!angles.length)return[];const out=[angles[0]];for(let i=1;i<angles.length;i++)out.push(out[i-1]+wrapAngle(angles[i]-angles[i-1]));return out};
const deg=r=>r*180/Math.PI;
const safeMedian=a=>med(a.filter(Number.isFinite));
const linRegResidual=(times,values)=>{if(values.length<2)return values.map(()=>0);const mt=avg(times),mv=avg(values);let num=0,den=0;for(let i=0;i<values.length;i++){num+=(times[i]-mt)*(values[i]-mv);den+=(times[i]-mt)**2}const slope=den?num/den:0,intercept=mv-slope*mt;return values.map((v,i)=>v-(intercept+slope*times[i]))};
const angle2d=(a,b,c)=>{const ab=[a.x-b.x,a.y-b.y],cb=[c.x-b.x,c.y-b.y];const dot=ab[0]*cb[0]+ab[1]*cb[1];const den=Math.hypot(...ab)*Math.hypot(...cb)||1;return deg(Math.acos(clamp(dot/den,-1,1)))};

async function loadVisionModule(){
  const sources=[`${MP_CDN}/vision_bundle.mjs?skate=15`,`https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=15`];
  let lastError;
  for(const source of sources){
    try{const mod=await import(source);if(mod?.FilesetResolver&&mod?.PoseLandmarker)return mod}catch(err){lastError=err}
  }
  throw lastError||new Error('Не вдалося завантажити модуль аналізу');
}

function resetPose(){
  if(pose){try{pose.close?.()}catch{}}
  pose=null;lastTimestamp=-1;
}

async function initPose(){
  if(pose)return pose;
  if(!FilesetResolver){const mod=await loadVisionModule();FilesetResolver=mod.FilesetResolver;PoseLandmarker=mod.PoseLandmarker}
  const vision=await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const model='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const options={baseOptions:{modelAssetPath:model,delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.42,minPosePresenceConfidence:.42,minTrackingConfidence:.42};
  try{pose=await PoseLandmarker.createFromOptions(vision,options)}catch{pose=await PoseLandmarker.createFromOptions(vision,{...options,baseOptions:{modelAssetPath:model}})}
  return pose;
}

export async function beginMultiSession(){resetPose();await initPose()}
export function endMultiSession(){resetPose()}

function getMetrics(frame){
  const l=frame.landmarks?.[0],w=frame.worldLandmarks?.[0];if(!l||!w)return null;
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z||0)+(b.z||0))/2});
  const sh=mid(l[11],l[12]),hp=mid(l[23],l[24]);
  const leftAnkle=l[27],rightAnkle=l[28],supportAnkleY=Math.max(leftAnkle.y,rightAnkle.y),ankleMidX=(leftAnkle.x+rightAnkle.x)/2;
  const bodyHeight=Math.max(.08,Math.hypot(ankleMidX-sh.x,supportAnkleY-sh.y));
  const torsoAxis=Math.abs(deg(Math.atan2(sh.x-hp.x,hp.y-sh.y)));
  const shoulderYaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const hipYaw=Math.atan2(w[24].z-w[23].z,w[24].x-w[23].x);
  const yaw=shoulderYaw+wrapAngle(hipYaw-shoulderYaw)/2;
  const yawAgreement=Math.abs(wrapAngle(shoulderYaw-hipYaw));
  const kneeAngle=(angle2d(l[23],l[25],l[27])+angle2d(l[24],l[26],l[28]))/2;
  const lowWristY=Math.max(l[15].y,l[16].y),wristLow=(lowWristY-hp.y)/bodyHeight;
  const ankleSpread=Math.abs(leftAnkle.y-rightAnkle.y)/bodyHeight;
  const conf=avg([11,12,15,16,23,24,25,26,27,28].map(i=>l[i].visibility??0));
  return {hipX:hp.x,hipY:hp.y,ankleY:supportAnkleY,ankleSpread,bodyHeight,torsoAxis,shoulderYaw,hipYaw,yaw,yawAgreement,kneeAngle,wristLow,conf,fallFeatures:makeFallFeatures(l)};
}

function detectFlight(samples){
  const times=samples.map(s=>s.t),hip=smooth(samples.map(s=>s.hipY),2),ankle=smooth(samples.map(s=>s.ankleY),2);
  const hipRes=linRegResidual(times,hip),ankleRes=linRegResidual(times,ankle);
  const signal=smooth(hipRes.map((v,i)=>v*.78+ankleRes[i]*.22),1);
  let peak=0;for(let i=1;i<signal.length;i++)if(signal[i]<signal[peak])peak=i;
  const body=safeMedian(samples.map(s=>s.bodyHeight))||.3,amp=Math.max(0,-signal[peak]),noise=Math.max(.001,mad(signal));
  const phaseConfidence=clamp((amp/(body*.050))*58+(amp/(noise*4))*24+18,18,98);
  const threshold=-Math.max(body*.009,amp*.28,noise*1.75);
  let start=peak,end=peak;while(start>1&&signal[start]<threshold)start--;while(end<signal.length-2&&signal[end]<threshold)end++;
  if(end-start<3){start=Math.max(1,peak-2);end=Math.min(signal.length-2,peak+3)}
  return {start,end,peak,airtime:Math.max(.08,samples[end].t-samples[start].t),body,phaseConfidence};
}

function medianSpeed(samples,from,to,body){
  const speeds=[];for(let i=Math.max(1,from);i<=Math.min(samples.length-1,to);i++){const dt=samples[i].t-samples[i-1].t;if(dt>0)speeds.push(Math.abs((samples[i].hipX-samples[i-1].hipX)/(dt*Math.max(.08,body))))}return safeMedian(speeds);
}

function scorePhases(raw,flight){
  const n=raw.length,body=flight.body,preStart=Math.max(0,flight.start-7);
  const pre=raw.slice(preStart,flight.start+1),air=raw.slice(flight.start,flight.end+1),post=raw.slice(flight.end,Math.min(n,flight.end+10));
  const preSpeed=medianSpeed(raw,preStart,flight.start,body),postSpeed=medianSpeed(raw,flight.end+1,Math.min(n-1,flight.end+8),body);
  let flowRatio=null,flow=72;if(preSpeed>.07){flowRatio=postSpeed/preSpeed;flow=clamp(48+52*clamp(flowRatio,0,1.05),30,100)}
  const airAxis=air.map(s=>s.torsoAxis),preAxis=pre.map(s=>s.torsoAxis),postAxis=post.map(s=>s.torsoAxis);
  const airAxisVar=mad(airAxis),preAxisVar=mad(preAxis),postAxisVar=mad(postAxis);
  const postVertical=linRegResidual(post.map(s=>s.t),post.map(s=>s.hipY)),postJitter=mad(postVertical)/Math.max(.08,body);
  const bodyControl=clamp(96-airAxisVar*5-Math.max(0,safeMedian(airAxis)-24)*1.05-avg(air.map(s=>s.yawAgreement))*13,35,98);
  const takeoffQuality=clamp(92-preAxisVar*5-Math.max(0,safeMedian(preAxis)-26)*.9-Math.max(0,60-flight.phaseConfidence)*.18,40,98);
  const landingStability=clamp(98-postAxisVar*6-postJitter*1050-Math.max(0,70-flow)*.24-Math.max(0,safeMedian(postAxis)-28)*.55,28,99);
  const smoothness=clamp(bodyControl*.48+landingStability*.30+flow*.22,30,99);
  const lengthBodies=Math.abs(raw[flight.end].hipX-raw[flight.start].hipX)/Math.max(.08,body);
  return {flow,flowRatio,bodyControl,takeoffQuality,landingStability,smoothness,lengthBodies,airAxis:safeMedian(airAxis),airAxisVar,landingKnee:safeMedian(post.map(s=>s.kneeAngle))};
}

function scoreRotation(raw,flight){
  const air=raw.slice(flight.start,flight.end+1),shoulder=unwrap(air.map(s=>s.shoulderYaw)),hip=unwrap(air.map(s=>s.hipYaw)),blended=unwrap(air.map(s=>s.yaw));
  const turns=a=>a.length>1?Math.abs(a.at(-1)-a[0])/(2*Math.PI):0,est=[turns(shoulder),turns(hip),turns(blended)];
  const rotation=safeMedian(est),agreement=std(est),poseConf=avg(air.map(s=>s.conf))*100;
  return {rotation,rotationConfidence:clamp(poseConf*.56+flight.phaseConfidence*.24+Math.max(0,100-agreement*145)*.20,18,98)};
}

function qualityScore(m){return Math.round(clamp(m.landingStability*.30+m.bodyControl*.23+m.takeoffQuality*.20+m.flow*.12+clamp(m.height/.35*100,0,100)*.08+clamp(m.lengthBodies/.8*100,0,100)*.07,0,100))}

function seek(video,t){return new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-t)<.008)return resolve();const done=()=>{clean();resolve()},err=()=>{clean();reject(new Error('Не вдалося прочитати кадр'))},clean=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',err)};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',err,{once:true});video.currentTime=t})}

export async function analyzeVideoRange(video,start,end,onProgress=()=>{}){
  const p=await initPose();
  const full=video.duration||0;start=clamp(start,0,Math.max(0,full-.45));end=clamp(end,start+.45,full);
  const duration=end-start,step=duration<=2.5?.035:.045,times=[];for(let t=start;t<end-.001;t+=step)times.push(t);if(times.at(-1)<end-.08)times.push(end-.002);
  const raw=[];
  for(let i=0;i<times.length;i++){
    const t=times[i];await seek(video,t);let ts=Math.round(t*1000);if(ts<=lastTimestamp)ts=lastTimestamp+1;lastTimestamp=ts;
    const r=p.detectForVideo(video,ts),m=getMetrics(r);if(m)raw.push({t,...m});onProgress(Math.round((i+1)/times.length*76));
  }
  if(raw.length<9)throw new Error('Не вдалося стабільно побачити цей стрибок. Пересунь мітку ближче до моменту відриву.');
  const coverage=raw.length/times.length,flight=detectFlight(raw),phase=scorePhases(raw,flight),rot=scoreRotation(raw,flight),height=G*flight.airtime*flight.airtime/8,poseConfidence=avg(raw.map(s=>s.conf))*100;
  const post=raw.slice(flight.end),landingHip=raw[flight.end]?.hipY??0;
  const postTorsoMax=post.length?Math.max(...post.map(s=>s.torsoAxis)):0;
  const hipDropBodies=post.length?Math.max(0,...post.map(s=>(s.hipY-landingHip)/Math.max(.08,flight.body))):0;
  const postWristLow=post.length?Math.max(...post.map(s=>s.wristLow)):0;
  onProgress(80);
  const fallML=await inferFallProbability(raw.slice(Math.max(0,flight.start-5)).map(s=>s.fallFeatures));
  const fallGeometryStrong=(postTorsoMax>=55&&hipDropBodies>=.12)||hipDropBodies>=.30||(postWristLow>=.72&&postTorsoMax>=38);
  const fallGeometryMedium=postTorsoMax>=46||hipDropBodies>=.18||(postWristLow>=.64&&postTorsoMax>=30)||phase.landingStability<=28;
  const mlStrong=fallML.available&&fallML.probability>=.88;
  const geometryCertain=postTorsoMax>=68&&hipDropBodies>=.22;
  const fallDetected=!!((mlStrong&&fallGeometryStrong)||geometryCertain);
  const fallPossible=!fallDetected&&((fallML.available&&fallML.probability>=.72&&fallGeometryMedium)||fallGeometryStrong);
  const confidence=Math.min(78,clamp(poseConfidence*.46+coverage*100*.18+flight.phaseConfidence*.20+rot.rotationConfidence*.16,20,98));
  const metrics={version:5,airtime:round(flight.airtime,2),height:round(height,2),rotation:round(rot.rotation,2),rotationConfidence:Math.round(rot.rotationConfidence),lengthBodies:round(phase.lengthBodies,2),flow:Math.round(phase.flow),flowRatio:phase.flowRatio==null?null:round(phase.flowRatio,2),takeoffQuality:Math.round(phase.takeoffQuality),landingStability:Math.round(phase.landingStability),stability:Math.round(phase.landingStability),bodyControl:Math.round(phase.bodyControl),smoothness:Math.round(phase.smoothness),axis:round(phase.airAxis,1),axisVariation:round(phase.airAxisVar,1),landingKnee:round(phase.landingKnee,0),confidence:Math.round(confidence),phaseConfidence:Math.round(flight.phaseConfidence),poseConfidence:Math.round(poseConfidence),coverage:Math.round(coverage*100),takeoff:round(raw[flight.start].t,2),landing:round(raw[flight.end].t,2),fallDetected,fallPossible,fallProbability:fallML.probability==null?null:round(fallML.probability,3),fallModelAvailable:fallML.available,fallGeometry:fallGeometryStrong,postTorsoMax:round(postTorsoMax,1),hipDropBodies:round(hipDropBodies,2),postWristLow:round(postWristLow,2)};
  metrics.quality=qualityScore(metrics);onProgress(100);return metrics;
}