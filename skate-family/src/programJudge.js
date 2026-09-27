import { initPose } from './analyzer.js';
import {
  PROGRAM_TYPES,ELEMENT_VALUES,scoreProgramShared,estimateGOE as sharedEstimateGOE,
  scoreElement,round
} from './scoringEngine.js';

export { PROGRAM_TYPES, ELEMENT_VALUES };

const G=9.80665;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const std=a=>{if(!a.length)return 0;const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)**2)))};
const median=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
const deg=r=>r*180/Math.PI;
const angleDiff=(a,b)=>{let d=a-b;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d};

export const ELEMENT_OPTIONS=[
  ['','— підтвердити елемент —'],
  ['2S+1A+SEQ','2S+1A+SEQ'],['1Lz+1Lo','1Lz+1Lo'],
  ['1T','1T'],['1S','1S'],['1Lo','1Lo'],['1F','1F'],['1Lz','1Lz'],['1A','1A'],
  ['2T','2T'],['2S','2S'],['2Lo','2Lo'],['2F','2F'],['2Lz','2Lz'],['2A','2A'],
  ['3T','3T'],['3S','3S'],['3Lo','3Lo'],['3F','3F'],['3Lz','3Lz'],['3A','3A'],
  ['4T','4T'],['4S','4S'],['4Lo','4Lo'],['4F','4F'],['4Lz','4Lz'],['4A','4A'],
  ['CCSpB','CCSpB'],['CCSp1','CCSp1'],['CCSp2','CCSp2'],['CCSp3','CCSp3'],['CCSp4','CCSp4'],
  ['CCoSpB','CCoSpB'],['CCoSp1','CCoSp1'],['CCoSp2','CCoSp2'],['CCoSp3','CCoSp3'],['CCoSp4','CCoSp4'],
  ['FCSp1','FCSp1'],['FCSp2','FCSp2'],['FCSp3','FCSp3'],['FCSp4','FCSp4'],
  ['FSSp1','FSSp1'],['FSSp2','FSSp2'],['FSSp3','FSSp3'],['FSSp4','FSSp4'],
  ['SSp1','SSp1'],['SSp2','SSp2'],['SSp3','SSp3'],['SSp4','SSp4'],
  ['StSqB','StSqB'],['StSq1','StSq1'],['StSq2','StSq2'],['StSq3','StSq3'],['StSq4','StSq4'],
  ['ChSq1','ChSq1'],['ChSp1','ChSp1']
];

function frameMetrics(res,t){
  const l=res.landmarks?.[0],w=res.worldLandmarks?.[0];
  if(!l||!w)return null;
  const hipX=(l[23].x+l[24].x)/2,hipY=(l[23].y+l[24].y)/2;
  const shoulderX=(l[11].x+l[12].x)/2,shoulderY=(l[11].y+l[12].y)/2;
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y);
  const hipWidth=Math.hypot(l[24].x-l[23].x,l[24].y-l[23].y);
  const axis=Math.abs(deg(Math.atan2(shoulderX-hipX,hipY-shoulderY)));
  const yaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const conf=avg([l[0],l[11],l[12],l[23],l[24],l[27],l[28],l[31],l[32]].map(p=>p?.visibility||0));
  const armSpread=Math.hypot(l[16].x-l[15].x,l[16].y-l[15].y)/(shoulderWidth||.1);
  const kneeBend=avg([Math.abs(l[25].y-l[23].y),Math.abs(l[26].y-l[24].y)]);
  const leftAnkleX=l[27].x,leftAnkleY=l[27].y,rightAnkleX=l[28].x,rightAnkleY=l[28].y;
  const leftToeX=l[31].x,leftToeY=l[31].y,rightToeX=l[32].x,rightToeY=l[32].y;
  const legHeightDiff=Math.abs(leftAnkleY-rightAnkleY)/(Math.abs(hipY-shoulderY)||.15);
  return {t,hipX,hipY,shoulderX,shoulderY,noseX:l[0].x,axis,yaw,shoulderWidth,hipWidth,conf,armSpread,kneeBend,
    leftAnkleX,leftAnkleY,rightAnkleX,rightAnkleY,leftToeX,leftToeY,rightToeX,rightToeY,legHeightDiff};
}

function seek(video,t){
  return new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-t)<.012)return resolve();
    let timer;
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',ok);video.removeEventListener('error',bad)};
    const ok=()=>{cleanup();resolve()};
    const bad=()=>{cleanup();reject(new Error('Не вдалося прочитати кадр відео'))};
    video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',bad,{once:true});
    timer=setTimeout(()=>{cleanup();resolve()},2200);
    try{video.currentTime=t}catch(e){cleanup();reject(e)}
  });
}

async function sample(video,times,pose,onProgress,startP,endP){
  const out=[];
  for(let i=0;i<times.length;i++){
    const t=times[i];await seek(video,t);
    const r=pose.detectForVideo(video,Math.round(t*1000));const m=frameMetrics(r,t);if(m)out.push(m);
    onProgress(Math.round(startP+(endP-startP)*(i+1)/Math.max(1,times.length)));
  }
  return out;
}

function yawRotationSigned(frames){
  if(frames.length<2)return 0;let total=0;
  for(let i=1;i<frames.length;i++)total+=angleDiff(frames[i].yaw,frames[i-1].yaw);
  return total/(Math.PI*2);
}
const yawRotation=frames=>Math.abs(yawRotationSigned(frames));

function localLift(frames,i,window=4){
  const around=[];
  for(let j=Math.max(0,i-window);j<=Math.min(frames.length-1,i+window);j++)if(Math.abs(j-i)>1)around.push(frames[j].hipY);
  return median(around)-frames[i].hipY;
}

function coarseJumpCenters(frames){
  const cand=[];
  for(let i=2;i<frames.length-2;i++){
    const lift=localLift(frames,i,4);if(lift<.0055)continue;
    if(frames[i].hipY>frames[i-1].hipY||frames[i].hipY>frames[i+1].hipY)continue;
    const seg=frames.slice(Math.max(0,i-2),Math.min(frames.length,i+3));
    const rot=yawRotation(seg);if(rot<.12)continue;
    const scaleVar=std(seg.map(x=>x.shoulderWidth))/(avg(seg.map(x=>x.shoulderWidth))||1);if(scaleVar>.42)continue;
    cand.push({t:frames[i].t,score:lift*95+rot});
  }
  cand.sort((a,b)=>b.score-a.score);const keep=[];
  for(const c of cand)if(keep.every(k=>Math.abs(k.t-c.t)>.42))keep.push(c);
  return keep.sort((a,b)=>a.t-b.t).slice(0,22);
}

function flightFromFine(frames,targetTime=null){
  if(frames.length<8)return null;
  const candidates=frames.map((f,i)=>({f,i})).filter(x=>targetTime==null||Math.abs(x.f.t-targetTime)<=.34);
  if(!candidates.length)return null;
  let peak=candidates[0].i;for(const x of candidates)if(frames[x.i].hipY<frames[peak].hipY)peak=x.i;
  const ys=frames.map(f=>f.hipY),edge=Math.max(3,Math.floor(frames.length*.18));
  const before=ys.slice(0,Math.min(edge,peak)),after=ys.slice(Math.max(peak+1,ys.length-edge));
  const base=median([...before,...after].length?[...before,...after]:ys);
  const amp=base-ys[peak];if(amp<.0038)return null;
  const thr=base-Math.max(.0028,amp*.26);let s=peak,e=peak;
  while(s>1&&ys[s]<thr)s--;while(e<ys.length-2&&ys[e]<thr)e++;
  if(e-s<2){s=Math.max(0,peak-2);e=Math.min(ys.length-1,peak+3)}
  const segment=frames.slice(s,e+1),airtime=frames[e].t-frames[s].t;if(airtime<.10)return null;
  const signed=yawRotationSigned(segment),rotation=Math.abs(signed);
  const axis=avg(segment.map(x=>x.axis)),landing=frames.slice(e,Math.min(frames.length,e+7));
  const stability=clamp(100-(avg(landing.map(x=>x.axis))*1.05+std(landing.map(x=>x.hipY))*950+std(landing.map(x=>x.shoulderWidth))*650),0,100);
  const height=G*airtime*airtime/8;
  const pre=frames.slice(Math.max(0,s-6),s+1),take=frames[s],pre0=pre[0]||take;
  const travelDx=take.hipX-pre0.hipX,faceDx=take.noseX-take.shoulderX;
  const forwardScore=Math.abs(travelDx)>.004&&Math.abs(faceDx)>.008?(Math.sign(travelDx)===Math.sign(faceDx)?.82:.18):.48;
  const backFoot=Math.max(Math.abs(take.leftToeX-take.hipX),Math.abs(take.rightToeX-take.hipX));
  const toeVertical=Math.max(take.leftToeY-take.leftAnkleY,take.rightToeY-take.rightAnkleY);
  const toeAssist=clamp((backFoot-.075)*5.5+Math.max(0,toeVertical-.015)*4,0,1);
  const ankleGap=Math.abs(take.leftAnkleX-take.rightAnkleX)/(take.shoulderWidth||.1);
  const crossed=clamp(1-(ankleGap-.18)/.7,0,1);
  const preTurn=yawRotationSigned(pre),counterRotation=Math.abs(preTurn)>.025&&Math.abs(signed)>.05&&Math.sign(preTurn)!==Math.sign(signed)?1:0;
  const conf=Math.round(clamp(avg(segment.map(x=>x.conf))*100+(amp>.016?6:0)-(rotation<.35?12:0),20,97));
  return {time:round(frames[peak].t,2),takeoff:round(frames[s].t,2),landing:round(frames[e].t,2),airtime:round(airtime,2),height:round(height,2),rotation:round(rotation,2),rotationSigned:round(signed,2),axis:round(axis,1),stability:Math.round(stability),confidence:conf,
    forwardScore:round(forwardScore,2),toeAssist:round(toeAssist,2),crossed:round(crossed,2),counterRotation};
}

function nearestTurn(rotation,axel=false){
  const arr=axel?[1,2,3,4].map(n=>[`${n}A`,n+.5]):[1,2,3,4].map(n=>[n,n]);
  let best=arr[0],d=99;for(const c of arr){const x=Math.abs(rotation-c[1]);if(x<d){d=x;best=c}}
  return {value:best[0],expected:best[1],distance:d};
}

function suggestJump(m){
  const ax=nearestTurn(m.rotation,true),plain=nearestTurn(m.rotation,false);
  const axelLikely=m.forwardScore>=.66&&ax.distance<=plain.distance+.28;
  if(axelLikely)return {code:ax.value,distance:ax.distance,familyConfidence:Math.round(60+m.forwardScore*32),family:'Axel'};
  const n=plain.value;
  let family='S',familyConfidence=55;
  if(m.toeAssist>=.58){
    if(m.counterRotation){family='Lz';familyConfidence=Math.round(62+m.toeAssist*25)}
    else {family='T';familyConfidence=Math.round(58+m.toeAssist*28)}
  }else if(m.crossed>=.72){family='Lo';familyConfidence=Math.round(58+m.crossed*25)}
  else {family='S';familyConfidence=Math.round(55+(1-m.toeAssist)*24)}
  return {code:`${n}${family}`,distance:plain.distance,familyConfidence,family};
}

function autoGrade(m,code){return sharedEstimateGOE(m,code,{}).goe}
function panelizeGrade(g){
  g=clamp(Math.round(g),-5,5);if(g===0)return 0;
  if(g===1)return .667;if(g===-1)return -.333;
  if(g>1)return round(g-.333,3);return round(g+.667,3);
}

async function detectJumps(video,pose,frames,centers,duration,onProgress,p0=62,p1=88,fineStep=.045){
  const jumps=[];
  for(let i=0;i<centers.length;i++){
    const c=centers[i],start=Math.max(.01,c.t-.62),end=Math.min(duration-.02,c.t+.62),fineTimes=[];
    for(let t=start;t<=end;t+=fineStep)fineTimes.push(t);
    const fine=await sample(video,fineTimes,pose,onProgress,p0,p1);
    const m=flightFromFine(fine,c.t);if(!m||m.rotation<.28)continue;
    if(jumps.some(j=>Math.abs(j.time-m.time)<.34))continue;
    const s=suggestJump(m),rawGrade=autoGrade(m,s.code),goeGrade=panelizeGrade(rawGrade);
    jumps.push({id:crypto.randomUUID(),kind:'jump',time:m.time,code:s.code,suggestion:`${s.code}?`,goe:goeGrade,goeGrade,confidence:Math.round(clamp((m.confidence+s.familyConfidence)/2-s.distance*16,25,96)),needsConfirm:true,metrics:m});
    onProgress(Math.round(p0+(p1-p0)*(i+1)/Math.max(1,centers.length)));
  }
  return jumps.sort((a,b)=>a.time-b.time);
}

function groupJumpPasses(jumps){
  const out=[];let i=0;
  while(i<jumps.length){
    const members=[jumps[i]];let j=i+1;
    while(j<jumps.length&&members.length<3){
      const prev=members.at(-1),next=jumps[j];
      const gap=(next.metrics?.takeoff??next.time)-(prev.metrics?.landing??prev.time);
      const peakGap=next.time-prev.time;
      if(gap<=1.05&&peakGap<=1.55){members.push(next);j++}else break;
    }
    if(members.length===1){out.push(members[0]);i++;continue}
    const hasAxelAfter=members.slice(1).some(x=>/A(?:[q<!e*]*)?$/.test(x.code));
    const code=members.map(x=>x.code).join('+')+(hasAxelAfter?'+SEQ':'');
    let grade=Math.min(...members.map(x=>Number(x.goeGrade)||0));
    const maxGap=Math.max(...members.slice(1).map((x,k)=>(x.metrics?.takeoff??x.time)-(members[k].metrics?.landing??members[k].time)));
    if(!hasAxelAfter&&maxGap>.55)grade-=.67;
    if(hasAxelAfter&&maxGap>.85)grade-=.33;
    grade=round(clamp(grade,-5,5),3);
    out.push({id:crypto.randomUUID(),kind:'jump-pass',time:members[0].time,code,suggestion:`${code}?`,goe:grade,goeGrade:grade,confidence:Math.round(Math.min(...members.map(x=>x.confidence))*.96),needsConfirm:true,
      metrics:{members:members.map(x=>x.metrics),gap:round(maxGap,2)}});
    i=j;
  }
  return out;
}

function spinCandidates(frames,jumpPasses){
  const blocked=t=>jumpPasses.some(j=>Math.abs(j.time-t)<1.2||j.metrics?.members?.some(m=>Math.abs((m.time||j.time)-t)<1.2));
  const hot=[];
  for(let i=1;i<frames.length;i++){
    const dt=frames[i].t-frames[i-1].t||.2,speed=Math.abs(angleDiff(frames[i].yaw,frames[i-1].yaw))/dt;
    hot.push({i,t:frames[i].t,speed,blocked:blocked(frames[i].t)});
  }
  const groups=[];let cur=[];for(const h of hot){if(!h.blocked&&h.speed>1.75)cur.push(h);else{if(cur.length)groups.push(cur);cur=[]}}if(cur.length)groups.push(cur);
  const out=[];
  for(const g of groups){
    const start=Math.max(0,g[0].i-1),end=g.at(-1).i,seg=frames.slice(start,Math.min(frames.length,end+1));
    if(seg.length<4)continue;const dur=seg.at(-1).t-seg[0].t,rotations=yawRotation(seg);if(dur<1.1||rotations<1.5)continue;
    if(std(seg.map(x=>x.hipX))>.12||std(seg.map(x=>x.hipY))>.09)continue;
    const legLift=avg(seg.map(x=>x.legHeightDiff)),poseVar=std(seg.map(x=>x.armSpread))+std(seg.map(x=>x.kneeBend))*4;
    const camel=legLift>.42&&poseVar<1.15;
    const level=camel?(rotations>=4.5?2:1):(rotations>=5.5?2:1);
    const code=camel?`CCSp${level}`:`CCoSp${level}`;
    const quality=clamp((rotations-2)*.18+(dur-2)*.08-(std(seg.map(x=>x.axis))*.02),-.5,1.2);
    const goeGrade=quality>.55?.667:quality<-.1?-.333:0;
    out.push({id:crypto.randomUUID(),kind:'spin',time:round((seg[0].t+seg.at(-1).t)/2,2),code,suggestion:`${code}?`,goe:goeGrade,goeGrade,confidence:Math.round(clamp(avg(seg.map(x=>x.conf))*78+rotations*3,38,90)),needsConfirm:true,metrics:{rotations:round(rotations,1),duration:round(dur,1),camelScore:round(legLift,2)}});
  }
  const dedup=[];for(const x of out)if(dedup.every(y=>Math.abs(y.time-x.time)>2.2))dedup.push(x);
  return dedup.slice(0,5);
}

function stepSequenceCandidate(frames,blockedElements,duration){
  if(duration<45||frames.length<30)return null;
  const blocked=t=>blockedElements.some(x=>Math.abs((x.time||0)-t)<2.1);
  let best=null;const win=14;
  for(let i=0;i<frames.length;i+=3){
    const start=frames[i].t,end=start+win;if(end>duration-5)break;
    const seg=frames.filter(x=>x.t>=start&&x.t<=end&&!blocked(x.t));if(seg.length<12)continue;
    let turn=0;for(let k=1;k<seg.length;k++)turn+=Math.abs(angleDiff(seg[k].yaw,seg[k-1].yaw));
    const path=std(seg.map(x=>x.hipX)),arms=std(seg.map(x=>x.armSpread)),speedChanges=std(seg.slice(1).map((x,k)=>Math.abs(x.hipX-seg[k].hipX)/(x.t-seg[k].t||.2)));
    const score=turn/win+path*5+arms*.18+speedChanges*.5;
    if(!best||score>best.score)best={start,end,seg,score};
  }
  if(!best)return null;
  const goeGrade=best.score>1.15?.333:0;
  return {id:crypto.randomUUID(),kind:'step',time:round((best.start+best.end)/2,2),code:'StSq1',suggestion:'StSq1?',goe:goeGrade,goeGrade,confidence:Math.round(clamp(42+best.score*22,40,82)),needsConfirm:true,metrics:{duration:win,complexity:round(best.score,2)}};
}

function componentScores(frames,elements,duration,type='womenFS'){
  if(!frames.length)return {composition:3.5,presentation:3.5,skatingSkills:3.5};
  const conf=avg(frames.map(x=>x.conf)),axis=avg(frames.map(x=>x.axis));
  const coverage=clamp(std(frames.map(x=>x.hipX))*17+4.2,3.5,8.8),posture=clamp(8.6-axis*.13,3.4,9.1);
  const armVar=std(frames.map(x=>x.armSpread));
  const rawPresentation=clamp(4.6+armVar*1.8+(conf-.55)*2.0+(posture-5)*.18,3.0,9.2);
  const speeds=[];for(let i=1;i<frames.length;i++){const dt=frames[i].t-frames[i-1].t||.2;speeds.push(Math.abs(frames[i].hipX-frames[i-1].hipX)/dt)}
  const flow=clamp(7.8-std(speeds)*9+avg(speeds)*1.5,3.4,9.1),rawSS=clamp(posture*.46+coverage*.22+flow*.32,3.0,9.3);
  const times=elements.map(x=>x.time).filter(Number.isFinite).sort((a,b)=>a-b);let spread=5;
  if(times.length>=2){const gaps=[times[0],...times.slice(1).map((t,i)=>t-times[i]),duration-times.at(-1)];const cv=std(gaps)/(avg(gaps)||1);spread=clamp(8.2-cv*3.2,3.3,8.8)}
  const rawComp=clamp(spread*.48+coverage*.30+rawPresentation*.22,3.0,9.2);
  const level=PROGRAM_TYPES[type]?.level||'isu';
  if(level==='development'){
    return {composition:round(clamp(3.45+(rawComp-5.2)*.28,2.5,5.5),2),presentation:round(clamp(3.30+(rawPresentation-5.2)*.28,2.5,5.5),2),skatingSkills:round(clamp(3.40+(rawSS-5.2)*.28,2.5,5.5),2)};
  }
  return {composition:round(rawComp,2),presentation:round(rawPresentation,2),skatingSkills:round(rawSS,2)};
}

export async function analyzeJumpPass(video,onProgress=()=>{}){
  const pose=await initPose(),duration=Math.min(video.duration||0,25);if(!duration||duration<1.2)throw new Error('Відео занадто коротке');
  const times=[];for(let t=.02;t<duration;t+=.075)times.push(Math.min(t,duration-.01));
  const frames=await sample(video,times,pose,onProgress,3,58);if(frames.length<10)throw new Error('Не вдалося стабільно побачити фігуристку');
  const centers=coarseJumpCenters(frames),jumps=await detectJumps(video,pose,frames,centers,duration,onProgress,58,92,.032),passes=groupJumpPasses(jumps);
  onProgress(98);return {duration:round(duration,1),jumps,passes,confidence:passes.length?Math.round(avg(passes.map(x=>x.confidence))):35,version:'shared-ijs-v2'};
}

export async function analyzeProgram(video,onProgress=()=>{},type='womenFS'){
  const pose=await initPose(),duration=Math.min(video.duration||0,330);if(!duration||duration<8)throw new Error('Для оцінки виступу потрібне відео довше 8 секунд');
  const coarseStep=duration<=240?.18:.22,times=[];for(let t=.04;t<duration;t+=coarseStep)times.push(Math.min(t,duration-.02));
  const frames=await sample(video,times,pose,onProgress,2,58);if(frames.length<25)throw new Error('Не вдалося стабільно бачити фігуристку. Потрібне відео, де тіло переважно в кадрі.');
  const centers=coarseJumpCenters(frames),jumps=await detectJumps(video,pose,frames,centers,duration,onProgress,58,84,.042),jumpPasses=groupJumpPasses(jumps);
  const spins=spinCandidates(frames,jumpPasses),step=stepSequenceCandidate(frames,[...jumpPasses,...spins],duration);
  const elements=[...jumpPasses,...spins,...(step?[step]:[])].sort((a,b)=>a.time-b.time),pcs=componentScores(frames,elements,duration,type);
  const confidence=Math.round(clamp(avg(frames.map(x=>x.conf))*100-(elements.length===0?18:0)-(frames.length/times.length<.72?10:0),25,94));
  onProgress(97);return {duration:round(duration,1),elements,rawJumps:jumps,pcs,fallCount:0,confidence,framesSeen:frames.length,version:'shared-ijs-v2'};
}

export function scoreProgram(program,type='womenFS'){return scoreProgramShared(program,type)}
export function scoreJumpPass(pass){return scoreElement(pass.code,Number.isFinite(Number(pass.goeGrade))?pass.goeGrade:pass.goe||0)}
export function formatTime(sec){const m=Math.floor(sec/60),s=Math.floor(sec%60).toString().padStart(2,'0');return `${m}:${s}`}
