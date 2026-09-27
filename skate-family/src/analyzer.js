import * as core from './analyzer-core.js?v=25';
import { refineJumpType } from './jumpClassifier.js?v=25';
import { estimateGOE as sharedEstimateGOE } from './scoringEngine.js?v=25';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const round=(v,n=2)=>{const p=10**n;return Math.round((Number(v)||0)*p)/p};
let enrichClock=0;
const recent=[];

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

export async function analyzeVideo(video,onProgress=()=>{}){
  const m=await core.analyzeVideo(video,p=>onProgress(Math.round(p*.93)));
  return enrichJumpMetrics(video,m,p=>onProgress(93+Math.round(p*.07)));
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
