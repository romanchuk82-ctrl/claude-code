const G=9.80665;
const MP_VERSION='0.10.21';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const std=a=>{if(!a.length)return 0;const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)**2)))};
const median=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const mad=a=>{if(!a.length)return 0;const m=median(a);return median(a.map(v=>Math.abs(v-m)))};
const round=(v,n=2)=>{const p=10**n;return Math.round(v*p)/p};
const deg=r=>r*180/Math.PI;
const wrapAngle=a=>{while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a};
const angleDiff=(a,b)=>wrapAngle(a-b);

let FilesetResolver,PoseLandmarker,pose=null,detectionClock=0;

export const PROGRAM_TYPES={
  training:{label:'Тренування · без ISU factor',factor:1,bonusCount:0},
  womenSP:{label:'ISU Women / Girls · Short Program',factor:1.33,bonusCount:1},
  womenFS:{label:'ISU Women / Girls · Free Skating',factor:2.67,bonusCount:3}
};

export const ELEMENT_VALUES={
  '1T':0.40,'1S':0.40,'1Lo':0.50,'1F':0.50,'1Lz':0.60,'1A':1.10,
  '2T':1.30,'2S':1.30,'2Lo':1.70,'2F':1.80,'2Lz':2.10,'2A':3.30,
  '3T':4.20,'3S':4.30,'3Lo':4.90,'3F':5.30,'3Lz':5.90,'3A':8.00,
  '4T':9.50,'4S':9.70,'4Lo':10.50,'4F':11.00,'4Lz':11.50,'4A':12.50,
  'CCoSpB':2.00,'CCoSp1':2.40,'CCoSp2':3.00,'CCoSp3':3.60,'CCoSp4':4.20,
  'FCSp1':2.30,'FCSp2':2.80,'FCSp3':3.30,'FCSp4':3.80,
  'FSSp1':2.30,'FSSp2':2.70,'FSSp3':3.10,'FSSp4':3.60,
  'SSp1':1.60,'SSp2':1.90,'SSp3':2.50,'SSp4':3.00,
  'StSqB':1.60,'StSq1':1.90,'StSq2':2.70,'StSq3':3.50,'StSq4':4.10,
  'ChSq1':3.50,'ChSp1':3.50
};

export const ELEMENT_OPTIONS=[
  ['','— підтвердити елемент —'],
  ['1T','1T'],['1S','1S'],['1Lo','1Lo'],['1F','1F'],['1Lz','1Lz'],['1A','1A'],
  ['2T','2T'],['2S','2S'],['2Lo','2Lo'],['2F','2F'],['2Lz','2Lz'],['2A','2A'],
  ['3T','3T'],['3S','3S'],['3Lo','3Lo'],['3F','3F'],['3Lz','3Lz'],['3A','3A'],
  ['4T','4T'],['4S','4S'],['4Lo','4Lo'],['4F','4F'],['4Lz','4Lz'],['4A','4A'],
  ['CCoSpB','CCoSpB'],['CCoSp1','CCoSp1'],['CCoSp2','CCoSp2'],['CCoSp3','CCoSp3'],['CCoSp4','CCoSp4'],
  ['FCSp1','FCSp1'],['FCSp2','FCSp2'],['FCSp3','FCSp3'],['FCSp4','FCSp4'],
  ['FSSp1','FSSp1'],['FSSp2','FSSp2'],['FSSp3','FSSp3'],['FSSp4','FSSp4'],
  ['SSp1','SSp1'],['SSp2','SSp2'],['SSp3','SSp3'],['SSp4','SSp4'],
  ['StSqB','StSqB'],['StSq1','StSq1'],['StSq2','StSq2'],['StSq3','StSq3'],['StSq4','StSq4'],
  ['ChSq1','ChSq1'],['ChSp1','ChSp1']
];

async function loadVision(){
  if(FilesetResolver&&PoseLandmarker)return;
  let last;
  for(const src of [`${MP_CDN}/vision_bundle.mjs?program=4`,`https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?program=4`]){
    try{const m=await import(src);if(m?.FilesetResolver&&m?.PoseLandmarker){FilesetResolver=m.FilesetResolver;PoseLandmarker=m.PoseLandmarker;return}}catch(e){last=e}
  }
  throw last||new Error('Не вдалося завантажити модуль аналізу');
}

async function resetPose(){
  if(pose){try{pose.close?.()}catch{}}
  pose=null;detectionClock=0;
  await loadVision();
  const vision=await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const model='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const opts={baseOptions:{modelAssetPath:model,delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.40,minPosePresenceConfidence:.40,minTrackingConfidence:.40};
  try{pose=await PoseLandmarker.createFromOptions(vision,opts)}catch{pose=await PoseLandmarker.createFromOptions(vision,{...opts,baseOptions:{modelAssetPath:model}})}
  return pose;
}

function frameMetrics(res,t){
  const l=res.landmarks?.[0],w=res.worldLandmarks?.[0];
  if(!l||!w)return null;
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z||0)+(b.z||0))/2});
  const sh=mid(l[11],l[12]),hp=mid(l[23],l[24]),an=mid(l[27],l[28]);
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y);
  const body=Math.max(.08,Math.hypot(an.x-sh.x,an.y-sh.y));
  const shoulderYaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const hipYaw=Math.atan2(w[24].z-w[23].z,w[24].x-w[23].x);
  const yaw=shoulderYaw+angleDiff(hipYaw,shoulderYaw)/2;
  const axis=Math.abs(deg(Math.atan2(sh.x-hp.x,hp.y-sh.y)));
  const conf=avg([11,12,23,24,25,26,27,28,31,32].map(i=>l[i]?.visibility||0));
  const armSpread=Math.hypot(l[16].x-l[15].x,l[16].y-l[15].y)/(shoulderWidth||.1);
  const ankleSep=Math.hypot(l[27].x-l[28].x,l[27].y-l[28].y)/body;
  const ankleYDiff=Math.abs(l[27].y-l[28].y)/body;
  const toeYDiff=Math.abs(l[31].y-l[32].y)/body;
  const leftFoot=Math.hypot(l[31].x-l[27].x,l[31].y-l[27].y)/body;
  const rightFoot=Math.hypot(l[32].x-l[28].x,l[32].y-l[28].y)/body;
  return {t,hipX:hp.x,hipY:hp.y,axis,yaw,shoulderWidth,body,conf,armSpread,ankleSep,ankleYDiff,toeYDiff,footAsym:Math.abs(leftFoot-rightFoot),kneeYDiff:Math.abs(l[25].y-l[26].y)/body};
}

function seek(video,t){return new Promise((resolve,reject)=>{
  if(Math.abs(video.currentTime-t)<.012)return resolve();
  let timer;const clean=()=>{clearTimeout(timer);video.removeEventListener('seeked',ok);video.removeEventListener('error',bad)};
  const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося прочитати кадр відео'))};
  video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',bad,{once:true});timer=setTimeout(()=>{clean();resolve()},1800);
  try{video.currentTime=t}catch(e){clean();reject(e)}
})}

async function sample(video,times,onProgress,startP,endP){
  const out=[];
  for(let i=0;i<times.length;i++){
    const t=times[i];await seek(video,t);detectionClock+=40;
    const r=pose.detectForVideo(video,detectionClock),m=frameMetrics(r,t);if(m)out.push(m);
    onProgress(Math.round(startP+(endP-startP)*(i+1)/Math.max(1,times.length)));
  }
  return out;
}

function yawRotation(frames){let total=0;for(let i=1;i<frames.length;i++)total+=angleDiff(frames[i].yaw,frames[i-1].yaw);return Math.abs(total)/(Math.PI*2)}
function localLift(frames,i,window=4){const around=[];for(let j=Math.max(0,i-window);j<=Math.min(frames.length-1,i+window);j++)if(Math.abs(j-i)>1)around.push(frames[j].hipY);return median(around)-frames[i].hipY}

function coarseJumpCenters(frames){
  const cand=[];
  for(let i=2;i<frames.length-2;i++){
    const lift=localLift(frames,i,4);if(lift<.006)continue;
    if(frames[i].hipY>frames[i-1].hipY||frames[i].hipY>frames[i+1].hipY)continue;
    const seg=frames.slice(Math.max(0,i-2),Math.min(frames.length,i+3));
    const rot=yawRotation(seg);if(rot<.14)continue;
    const scaleVar=std(seg.map(x=>x.shoulderWidth))/(avg(seg.map(x=>x.shoulderWidth))||1);if(scaleVar>.40)continue;
    cand.push({t:frames[i].t,score:lift*95+rot,idx:i});
  }
  cand.sort((a,b)=>b.score-a.score);
  const keep=[];
  for(const c of cand)if(keep.every(k=>Math.abs(k.t-c.t)>.34))keep.push(c);
  return keep.sort((a,b)=>a.t-b.t).slice(0,24);
}

function takeoffFeatures(frames,s,peak){
  const pre=frames.slice(Math.max(0,s-5),Math.min(frames.length,s+2)),body=median(pre.map(x=>x.body))||.4;
  return {ankleSep:round(median(pre.map(x=>x.ankleSep)),3),ankleYDiff:round(median(pre.map(x=>x.ankleYDiff)),3),toeYDiff:round(median(pre.map(x=>x.toeYDiff)),3),footAsym:round(median(pre.map(x=>x.footAsym)),3),kneeYDiff:round(median(pre.map(x=>x.kneeYDiff)),3),toeAssist:round(clamp(Math.max(median(pre.map(x=>x.ankleYDiff))*.9,median(pre.map(x=>x.toeYDiff))*.9,median(pre.map(x=>x.footAsym))*1.5),0,1),3),body};
}

function flightFromFine(frames){
  if(frames.length<7)return null;
  const ys=frames.map(f=>f.hipY),edge=Math.max(2,Math.floor(frames.length*.18));
  let peak=0;for(let i=1;i<ys.length;i++)if(ys[i]<ys[peak])peak=i;
  const base=median([...ys.slice(0,edge),...ys.slice(-edge)]),amp=base-ys[peak];if(amp<.0045)return null;
  const thr=base-Math.max(.0035,amp*.30);let s=peak,e=peak;
  while(s>1&&ys[s]<thr)s--;while(e<ys.length-2&&ys[e]<thr)e++;
  if(e-s<2){s=Math.max(0,peak-2);e=Math.min(ys.length-1,peak+3)}
  const segment=frames.slice(s,e+1),airtime=frames[e].t-frames[s].t;if(airtime<.10)return null;
  const rotation=yawRotation(segment),axis=avg(segment.map(x=>x.axis)),landing=frames.slice(e,Math.min(frames.length,e+6));
  const stability=clamp(100-(avg(landing.map(x=>x.axis))*1.05+mad(landing.map(x=>x.hipY))*1350+mad(landing.map(x=>x.shoulderWidth))*900),0,100);
  const height=G*airtime*airtime/8,takeoff=takeoffFeatures(frames,s,peak);
  return {time:round(frames[peak].t,2),takeoffTime:round(frames[s].t,2),landingTime:round(frames[e].t,2),airtime:round(airtime,2),height:round(height,2),rotation:round(rotation,2),axis:round(axis,1),stability:Math.round(stability),takeoff,confidence:Math.round(clamp(avg(segment.map(x=>x.conf))*100+(amp>.014?6:0)-(rotation<.32?12:0),20,96))};
}

function rotationClass(m){
  const measured=m.rotation||0,air=m.airtime||0;let revolutions=air>=.62?4:air>=.46?3:air>=.25?2:1;
  const integer=clamp(Math.round(measured),1,4);if(measured>=.65&&Math.abs(measured-integer)<.24&&Math.abs(integer-revolutions)<=1)revolutions=integer;
  const halves=[1.5,2.5,3.5,4.5];let half=1.5,halfDist=99;for(const h of halves){const d=Math.abs(measured-h);if(d<halfDist){half=h;halfDist=d}}
  const intDist=Math.abs(measured-Math.round(measured)),axel=measured>=1.12&&halfDist<.31&&halfDist+.05<intDist&&Math.abs(Math.floor(half)-revolutions)<=1;
  if(axel)revolutions=clamp(Math.floor(half),1,4);return {revolutions,axel,distance:axel?halfDist:Math.abs(measured-revolutions)};
}

function suggestJump(m){
  const r=rotationClass(m);if(r.axel){const code=`${r.revolutions}A`;return {code,alternatives:[code],distance:r.distance,confidence:Math.round(clamp(72-r.distance*70+(m.confidence-60)*.15,46,88))}}
  const f=m.takeoff||{},sep=Number(f.ankleSep||0),toe=Number(f.toeAssist||0),asym=Number(f.footAsym||0);
  const ranked=[['Lo',clamp((.30-sep)*4.2,0,1.4)+clamp((.16-toe)*3,0,.7)],['T',clamp((toe-.13)*4.8,0,1.5)+clamp((asym-.08)*3.5,0,.7)],['S',clamp((sep-.16)*3,0,1.2)+clamp((.24-toe)*1.8,0,.7)+.18]].sort((a,b)=>b[1]-a[1]);
  const family=ranked[0][0],margin=ranked[0][1]-ranked[1][1],code=`${r.revolutions}${family}`,same=x=>`${r.revolutions}${x}`;
  let alternatives=ranked.map(x=>same(x[0]));if(family==='T')alternatives=[code,same('F'),same('Lz'),...alternatives.filter(x=>x!==code)];
  return {code,alternatives:[...new Set(alternatives)].slice(0,4),distance:r.distance,confidence:Math.round(clamp(43+margin*20+(m.confidence-55)*.14-r.distance*18,32,78))};
}

function autoGOE(m,code){
  const expected=code.endsWith('A')?(parseInt(code)||1)+.5:(parseInt(code)||1),deficit=expected-(m.rotation||0);let goe=0;
  if(m.height>=.30)goe++;else if(m.height<.15)goe--;
  if(m.axis<=9)goe++;else if(m.axis>18)goe--;
  if(m.stability>=80)goe++;else if(m.stability<52)goe-=2;else if(m.stability<66)goe--;
  if(deficit<=.10)goe++;else if(deficit<=.28)goe--;else if(deficit<=.52)goe-=2;else goe-=4;
  return clamp(Math.round(goe),-5,5);
}

function spinCandidates(frames,jumps){
  const blocked=t=>jumps.some(j=>Math.abs(j.time-t)<1.15),hot=[];
  for(let i=1;i<frames.length;i++){const dt=frames[i].t-frames[i-1].t||.3;hot.push({i,t:frames[i].t,speed:Math.abs(angleDiff(frames[i].yaw,frames[i-1].yaw))/dt,blocked:blocked(frames[i].t)})}
  const groups=[];let cur=[];for(const h of hot){if(!h.blocked&&h.speed>1.8)cur.push(h);else{if(cur.length)groups.push(cur);cur=[]}}if(cur.length)groups.push(cur);
  const out=[];for(const g of groups){const start=Math.max(0,g[0].i-1),end=Math.min(frames.length-1,g.at(-1).i),seg=frames.slice(start,end+1),dur=seg.at(-1).t-seg[0].t,rot=yawRotation(seg);if(dur<1.1||rot<1.4)continue;if(std(seg.map(x=>x.hipX))>.12||std(seg.map(x=>x.hipY))>.08)continue;out.push({id:crypto.randomUUID(),kind:'spin',time:round((seg[0].t+seg.at(-1).t)/2,2),code:'',suggestion:'Spin? · підтверди тип/level',goe:0,confidence:Math.round(clamp(avg(seg.map(x=>x.conf))*75+rot*4,32,86)),needsConfirm:true,metrics:{rotations:round(rot,1),duration:round(dur,1)}})}
  const dedup=[];for(const x of out)if(dedup.every(y=>Math.abs(y.time-x.time)>2.1))dedup.push(x);return dedup.slice(0,5);
}

function groupCascades(jumps){
  const sorted=[...jumps].sort((a,b)=>a.time-b.time);let group=0;
  for(let i=0;i<sorted.length;i++){
    const chain=[sorted[i]];while(i+1<sorted.length&&(sorted[i+1].metrics?.takeoffTime??sorted[i+1].time)-(sorted[i].metrics?.landingTime??sorted[i].time)<=1.35){chain.push(sorted[++i]);if(chain.length===3)break}
    if(chain.length>1){group++;const label=chain.map(x=>x.code).join(' + '),shared=Math.min(...chain.map(x=>Number(x.goe)||0));for(let k=0;k<chain.length;k++){chain[k].cascadeGroup=`C${group}`;chain[k].cascadeIndex=k+1;chain[k].cascadeSize=chain.length;chain[k].cascadeLabel=label;chain[k].goe=shared;chain[k].suggestion=`${label}? · каскад`;}}
  }
  return sorted;
}

function stepCandidate(frames,elements,duration){
  if(duration<70||frames.length<80)return null;
  const blocked=t=>elements.some(e=>Math.abs((e.time||0)-t)<2.5),changes=[];
  for(let i=2;i<frames.length-2;i++){if(blocked(frames[i].t))continue;const a=frames[i].hipX-frames[i-2].hipX,b=frames[i+2].hipX-frames[i].hipX;if(a*b<0&&Math.abs(a)+Math.abs(b)>.025)changes.push(frames[i].t)}
  if(changes.length<6)return null;
  let best=[];for(const t of changes){const win=changes.filter(x=>x>=t&&x<=t+14);if(win.length>best.length)best=win}
  if(best.length<6)return null;const time=round((best[0]+best.at(-1))/2,2);
  return {id:crypto.randomUUID(),kind:'step',time,code:'',suggestion:'StSq? · підтверди level',goe:0,confidence:Math.round(clamp(38+best.length*3,40,68)),needsConfirm:true,metrics:{directionChanges:best.length,duration:round(best.at(-1)-best[0],1)}};
}

function componentScores(frames,elements,duration){
  if(!frames.length)return {composition:5,presentation:5,skatingSkills:5};
  const conf=avg(frames.map(x=>x.conf)),axis=avg(frames.map(x=>x.axis)),coverage=clamp(std(frames.map(x=>x.hipX))*17+4.2,3.5,8.8),posture=clamp(8.6-axis*.13,3.4,9.1),armVar=std(frames.map(x=>x.armSpread));
  const presentation=clamp(4.6+armVar*1.8+(conf-.55)*2+(posture-5)*.18,3,9.2),speeds=[];for(let i=1;i<frames.length;i++){const dt=frames[i].t-frames[i-1].t||.3;speeds.push(Math.abs(frames[i].hipX-frames[i-1].hipX)/dt)}
  const flow=clamp(7.8-std(speeds)*9+avg(speeds)*1.5,3.4,9.1),skatingSkills=clamp(posture*.46+coverage*.22+flow*.32,3,9.3),times=elements.map(x=>x.time).filter(Number.isFinite).sort((a,b)=>a-b);let spread=5;
  if(times.length>=2){const gaps=[times[0],...times.slice(1).map((t,i)=>t-times[i]),duration-times.at(-1)],cv=std(gaps)/(avg(gaps)||1);spread=clamp(8.2-cv*3.2,3.3,8.8)}
  return {composition:round(clamp(spread*.48+coverage*.30+presentation*.22,3,9.2),2),presentation:round(presentation,2),skatingSkills:round(skatingSkills,2)};
}

export async function analyzeProgram(video,onProgress=()=>{}){
  const duration=Math.min(video.duration||0,330);if(!duration||duration<8)throw new Error('Для оцінки виступу потрібне відео довше 8 секунд');
  await resetPose();onProgress(2);
  try{
    const coarseStep=duration<=90?.22:duration<=180?.25:.28,times=[];for(let t=.04;t<duration;t+=coarseStep)times.push(Math.min(t,duration-.02));
    const frames=await sample(video,times,onProgress,3,55);if(frames.length<25)throw new Error('Не вдалося стабільно бачити фігуристку. Потрібне відео, де тіло переважно в кадрі.');
    const centers=coarseJumpCenters(frames),jumps=[];
    for(let i=0;i<centers.length;i++){
      const c=centers[i],prev=centers[i-1]?.t,next=centers[i+1]?.t;
      let start=Math.max(.01,c.t-.72),end=Math.min(duration-.02,c.t+.72);
      if(prev!=null)start=Math.max(start,(prev+c.t)/2+.015);if(next!=null)end=Math.min(end,(c.t+next)/2-.015);
      if(end-start<.42){start=Math.max(.01,c.t-.28);end=Math.min(duration-.02,c.t+.28)}
      const fineTimes=[];for(let t=start;t<=end;t+=.045)fineTimes.push(t);
      const fine=await sample(video,fineTimes,onProgress,55,88),m=flightFromFine(fine);if(!m||m.rotation<.28||m.airtime<.10)continue;
      const s=suggestJump(m);if(jumps.some(j=>Math.abs(j.time-m.time)<.24))continue;
      jumps.push({id:crypto.randomUUID(),kind:'jump',time:m.time,code:s.code,suggestion:`${s.code}?`,alternatives:s.alternatives,goe:autoGOE(m,s.code),confidence:Math.round(clamp(s.confidence*.58+m.confidence*.42,24,94)),needsConfirm:true,metrics:m});
      onProgress(Math.round(55+33*(i+1)/Math.max(1,centers.length)));
    }
    const grouped=groupCascades(jumps),spins=spinCandidates(frames,grouped),base=[...grouped,...spins].sort((a,b)=>a.time-b.time),step=stepCandidate(frames,base,duration),elements=[...base,...(step?[step]:[])].sort((a,b)=>a.time-b.time),pcs=componentScores(frames,elements,duration);
    const coverage=frames.length/Math.max(1,times.length),confidence=Math.round(clamp(avg(frames.map(x=>x.conf))*82+coverage*18-(elements.length===0?18:0),25,94));
    onProgress(98);return {duration:round(duration,1),elements,pcs,fallCount:0,confidence,framesSeen:frames.length,cascadeCount:new Set(grouped.filter(x=>x.cascadeGroup).map(x=>x.cascadeGroup)).size,version:'local-isu-v4'};
  }finally{if(pose){try{pose.close?.()}catch{}pose=null}}
}

const isJump=code=>/^\d[TSLoFzA]/.test(code||'');
function elementBase(code){return ELEMENT_VALUES[code]||0}
function goePoints(code,base,goe){if(code==='ChSq1'||code==='ChSp1')return round(.5*goe,2);return round(base*.1*goe,2)}

export function scoreProgram(program,type='womenFS'){
  const rule=PROGRAM_TYPES[type]||PROGRAM_TYPES.womenFS,rows=(program.elements||[]).map(x=>({...x,x:false})).sort((a,b)=>(a.time||0)-(b.time||0));
  const jumpGroups=[];for(const row of rows.filter(x=>isJump(x.code))){const key=row.cascadeGroup||row.id;let g=jumpGroups.find(x=>x.key===key);if(!g){g={key,time:row.time,rows:[]};jumpGroups.push(g)}g.rows.push(row)}
  if(rule.bonusCount>0)jumpGroups.filter(g=>g.time>program.duration/2).slice(-rule.bonusCount).forEach(g=>g.rows.forEach(x=>x.x=true));
  let tes=0;const cascadeProcessed=new Set();
  const scored=rows.map(x=>{
    let base=elementBase(x.code);if(x.x)base=round(base*1.1,2);let adj=0,score=base;
    if(x.cascadeGroup){
      const group=rows.filter(r=>r.cascadeGroup===x.cascadeGroup&&isJump(r.code));
      if(!cascadeProcessed.has(x.cascadeGroup)){
        const bases=group.map(r=>{let b=elementBase(r.code);if(r.x)b=round(b*1.1,2);return b}),maxBase=Math.max(0,...bases),shared=Number(group[0]?.goe)||0,comboAdj=round(maxBase*.1*shared,2),comboTotal=round(Math.max(0,bases.reduce((a,b)=>a+b,0)+comboAdj),2);
        cascadeProcessed.add(x.cascadeGroup);tes+=comboTotal;adj=comboAdj;score=comboTotal;
      }else{score=0;adj=0}
    }else{adj=goePoints(x.code,base,Number(x.goe)||0);score=round(Math.max(0,base+adj),2);tes+=score}
    return {...x,base,goePoints:adj,score};
  });
  tes=round(tes,2);const p=program.pcs||{composition:0,presentation:0,skatingSkills:0},pcs=round((p.composition+p.presentation+p.skatingSkills)*rule.factor,2),deductions=round((program.fallCount||0)*1,2);
  return {elements:scored,tes,pcs,deductions,total:round(tes+pcs-deductions,2),factor:rule.factor};
}

export function formatTime(sec){const m=Math.floor(sec/60),s=Math.floor(sec%60).toString().padStart(2,'0');return `${m}:${s}`}
