import { initPose } from './analyzer.js';

const G=9.80665;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const std=a=>{if(!a.length)return 0;const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)**2)))};
const median=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
const round=(v,n=2)=>{const p=10**n;return Math.round(v*p)/p};
const deg=r=>r*180/Math.PI;
const angleDiff=(a,b)=>{let d=a-b;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d};

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

function frameMetrics(res,t){
  const l=res.landmarks?.[0],w=res.worldLandmarks?.[0];
  if(!l||!w)return null;
  const hipX=(l[23].x+l[24].x)/2, hipY=(l[23].y+l[24].y)/2;
  const shoulderX=(l[11].x+l[12].x)/2, shoulderY=(l[11].y+l[12].y)/2;
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y);
  const hipWidth=Math.hypot(l[24].x-l[23].x,l[24].y-l[23].y);
  const axis=Math.abs(deg(Math.atan2(shoulderX-hipX,hipY-shoulderY)));
  const yaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const conf=avg([l[11],l[12],l[23],l[24],l[27],l[28]].map(p=>p.visibility||0));
  const armSpread=Math.hypot(l[16].x-l[15].x,l[16].y-l[15].y)/(shoulderWidth||.1);
  const kneeBend=avg([Math.abs(l[25].y-l[23].y),Math.abs(l[26].y-l[24].y)]);
  return {t,hipX,hipY,axis,yaw,shoulderWidth,hipWidth,conf,armSpread,kneeBend};
}

function seek(video,t){
  return new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-t)<.015)return resolve();
    let timer;
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',ok);video.removeEventListener('error',bad)};
    const ok=()=>{cleanup();resolve()};
    const bad=()=>{cleanup();reject(new Error('Не вдалося прочитати кадр відео'))};
    video.addEventListener('seeked',ok,{once:true});
    video.addEventListener('error',bad,{once:true});
    timer=setTimeout(()=>{cleanup();resolve()},2200);
    try{video.currentTime=t}catch(e){cleanup();reject(e)}
  });
}

async function sample(video,times,pose,onProgress,startP,endP){
  const out=[];
  for(let i=0;i<times.length;i++){
    const t=times[i];
    await seek(video,t);
    const r=pose.detectForVideo(video,Math.round(t*1000));
    const m=frameMetrics(r,t);
    if(m)out.push(m);
    onProgress(Math.round(startP+(endP-startP)*(i+1)/times.length));
  }
  return out;
}

function yawRotation(frames){
  if(frames.length<2)return 0;
  let total=0;
  for(let i=1;i<frames.length;i++)total+=angleDiff(frames[i].yaw,frames[i-1].yaw);
  return Math.abs(total)/(Math.PI*2);
}

function localLift(frames,i,window=5){
  const around=[];
  for(let j=Math.max(0,i-window);j<=Math.min(frames.length-1,i+window);j++)if(Math.abs(j-i)>1)around.push(frames[j].hipY);
  return median(around)-frames[i].hipY;
}

function coarseJumpCenters(frames){
  const cand=[];
  for(let i=2;i<frames.length-2;i++){
    const lift=localLift(frames,i,5);
    if(lift<.009)continue;
    if(frames[i].hipY>frames[i-1].hipY||frames[i].hipY>frames[i+1].hipY)continue;
    const seg=frames.slice(Math.max(0,i-2),Math.min(frames.length,i+3));
    const rot=yawRotation(seg);
    if(rot<.22)continue;
    const scaleVar=std(seg.map(x=>x.shoulderWidth))/(avg(seg.map(x=>x.shoulderWidth))||1);
    if(scaleVar>.35)continue;
    const score=lift*80+rot;
    cand.push({t:frames[i].t,score});
  }
  cand.sort((a,b)=>b.score-a.score);
  const keep=[];
  for(const c of cand){if(keep.every(k=>Math.abs(k.t-c.t)>.9))keep.push(c)}
  return keep.sort((a,b)=>a.t-b.t).slice(0,16);
}

function flightFromFine(frames){
  if(frames.length<8)return null;
  const ys=frames.map(f=>f.hipY);
  let peak=0;for(let i=1;i<ys.length;i++)if(ys[i]<ys[peak])peak=i;
  const edge=Math.max(3,Math.floor(frames.length*.22));
  const base=median([...ys.slice(0,edge),...ys.slice(-edge)]);
  const amp=base-ys[peak];
  if(amp<.006)return null;
  const thr=base-Math.max(.004,amp*.28);
  let s=peak,e=peak;
  while(s>1&&ys[s]<thr)s--;
  while(e<ys.length-2&&ys[e]<thr)e++;
  if(e-s<2){s=Math.max(0,peak-2);e=Math.min(ys.length-1,peak+3)}
  const segment=frames.slice(s,e+1);
  const airtime=frames[e].t-frames[s].t;
  const rotation=yawRotation(segment);
  const axis=avg(segment.map(x=>x.axis));
  const landing=frames.slice(e,Math.min(frames.length,e+6));
  const stability=clamp(100-(avg(landing.map(x=>x.axis))*1.1+std(landing.map(x=>x.hipY))*1000+std(landing.map(x=>x.shoulderWidth))*700),0,100);
  const height=G*airtime*airtime/8;
  return {time:round(frames[peak].t,2),airtime:round(airtime,2),height:round(height,2),rotation:round(rotation,2),axis:round(axis,1),stability:Math.round(stability),confidence:Math.round(clamp(avg(segment.map(x=>x.conf))*100+(amp>.018?8:0)-(rotation<.45?15:0),20,97))};
}

function suggestJump(rotation){
  const candidates=[['1T',1],['1A',1.5],['2T',2],['2A',2.5],['3T',3],['3A',3.5],['4T',4],['4A',4.5]];
  let best=candidates[0],d=99;
  for(const c of candidates){const x=Math.abs(rotation-c[1]);if(x<d){best=c;d=x}}
  return {code:best[0],distance:d};
}

function autoGOE(m,suggested){
  const expected=suggested.endsWith('A')?parseInt(suggested)+.5:parseInt(suggested);
  const deficit=expected-m.rotation;
  let goe=0;
  if(m.height>=.32)goe++; else if(m.height<.16)goe--;
  if(m.axis<=8)goe++; else if(m.axis>17)goe--;
  if(m.stability>=80)goe++; else if(m.stability<55)goe-=2; else if(m.stability<68)goe--;
  if(deficit<=.10)goe++; else if(deficit<=.28)goe--; else if(deficit<=.52)goe-=2; else goe-=4;
  return clamp(Math.round(goe),-5,5);
}

function spinCandidates(frames,jumps){
  const blocked=t=>jumps.some(j=>Math.abs(j.time-t)<1.4);
  const hot=[];
  for(let i=1;i<frames.length;i++){
    const dt=frames[i].t-frames[i-1].t||.3;
    const speed=Math.abs(angleDiff(frames[i].yaw,frames[i-1].yaw))/dt;
    hot.push({i,t:frames[i].t,speed,blocked:blocked(frames[i].t)});
  }
  const groups=[];let cur=[];
  for(const h of hot){if(!h.blocked&&h.speed>2.0){cur.push(h)}else{if(cur.length)groups.push(cur);cur=[]}}
  if(cur.length)groups.push(cur);
  const out=[];
  for(const g of groups){
    const start=g[0].i-1,end=g.at(-1).i;
    const seg=frames.slice(Math.max(0,start),Math.min(frames.length,end+1));
    const dur=seg.at(-1).t-seg[0].t;
    const rotations=yawRotation(seg);
    if(dur<1.0||rotations<1.5)continue;
    if(std(seg.map(x=>x.hipX))>.09||std(seg.map(x=>x.hipY))>.07)continue;
    out.push({id:crypto.randomUUID(),kind:'spin',time:round((seg[0].t+seg.at(-1).t)/2,2),code:'',suggestion:'Spin?',goe:0,confidence:Math.round(clamp(avg(seg.map(x=>x.conf))*80+rotations*3,35,88)),metrics:{rotations:round(rotations,1),duration:round(dur,1)}});
  }
  const dedup=[];for(const x of out){if(dedup.every(y=>Math.abs(y.time-x.time)>2.5))dedup.push(x)}
  return dedup.slice(0,4);
}

function componentScores(frames,elements,duration){
  if(!frames.length)return {composition:5,presentation:5,skatingSkills:5};
  const conf=avg(frames.map(x=>x.conf));
  const axis=avg(frames.map(x=>x.axis));
  const coverage=clamp(std(frames.map(x=>x.hipX))*17+4.2,3.5,8.8);
  const posture=clamp(8.6-axis*.13,3.4,9.1);
  const armVar=std(frames.map(x=>x.armSpread));
  const presentation=clamp(4.6+armVar*1.8+(conf-.55)*2.0+(posture-5)*.18,3.0,9.2);
  const speeds=[];for(let i=1;i<frames.length;i++){const dt=frames[i].t-frames[i-1].t||.3;speeds.push(Math.abs(frames[i].hipX-frames[i-1].hipX)/dt)}
  const flow=clamp(7.8-std(speeds)*9+avg(speeds)*1.5,3.4,9.1);
  const skatingSkills=clamp(posture*.46+coverage*.22+flow*.32,3.0,9.3);
  const times=elements.map(x=>x.time).filter(Number.isFinite).sort((a,b)=>a-b);
  let spread=5;
  if(times.length>=2){const gaps=[times[0],...times.slice(1).map((t,i)=>t-times[i]),duration-times.at(-1)];const cv=std(gaps)/(avg(gaps)||1);spread=clamp(8.2-cv*3.2,3.3,8.8)}
  const composition=clamp(spread*.48+coverage*.30+presentation*.22,3.0,9.2);
  return {composition:round(composition,2),presentation:round(presentation,2),skatingSkills:round(skatingSkills,2)};
}

export async function analyzeProgram(video,onProgress=()=>{}){
  const pose=await initPose();
  const duration=Math.min(video.duration||0,330);
  if(!duration||duration<8)throw new Error('Для оцінки виступу потрібне відео довше 8 секунд');
  const coarseStep=duration<=120?.28:duration<=210?.32:.36;
  const times=[];for(let t=.05;t<duration;t+=coarseStep)times.push(Math.min(t,duration-.02));
  const frames=await sample(video,times,pose,onProgress,2,62);
  if(frames.length<25)throw new Error('Не вдалося стабільно бачити фігуристку. Потрібне відео, де тіло переважно в кадрі.');
  const centers=coarseJumpCenters(frames);
  const jumps=[];
  for(let i=0;i<centers.length;i++){
    const c=centers[i];
    const start=Math.max(.01,c.t-.9),end=Math.min(duration-.02,c.t+.9);
    const fineTimes=[];for(let t=start;t<=end;t+=.07)fineTimes.push(t);
    const fine=await sample(video,fineTimes,pose,onProgress,62,88);
    const m=flightFromFine(fine);
    if(!m||m.rotation<.35||m.airtime<.12)continue;
    const s=suggestJump(m.rotation);
    if(jumps.some(j=>Math.abs(j.time-m.time)<.75))continue;
    jumps.push({id:crypto.randomUUID(),kind:'jump',time:m.time,code:s.code,suggestion:`${s.code}?`,goe:autoGOE(m,s.code),confidence:Math.round(clamp(m.confidence-s.distance*18,25,96)),needsConfirm:true,metrics:m});
    onProgress(Math.round(62+26*(i+1)/Math.max(1,centers.length)));
  }
  const spins=spinCandidates(frames,jumps);
  const elements=[...jumps,...spins].sort((a,b)=>a.time-b.time);
  const pcs=componentScores(frames,elements,duration);
  const confidence=Math.round(clamp(avg(frames.map(x=>x.conf))*100-(elements.length===0?18:0)-(frames.length/times.length<.7?12:0),25,94));
  onProgress(96);
  return {duration:round(duration,1),elements,pcs,fallCount:0,confidence,framesSeen:frames.length,version:'local-isu-v1'};
}

const isJump=code=>/^\d[TSLoFzA]/.test(code||'');
function elementBase(code){return ELEMENT_VALUES[code]||0}
function goePoints(code,base,goe){
  if(code==='ChSq1'||code==='ChSp1')return round(.5*goe,2);
  return round(base*.1*goe,2);
}

export function scoreProgram(program,type='womenFS'){
  const rule=PROGRAM_TYPES[type]||PROGRAM_TYPES.womenFS;
  const rows=(program.elements||[]).map(x=>({...x,x:false})).sort((a,b)=>(a.time||0)-(b.time||0));
  if(rule.bonusCount>0){
    const eligible=rows.filter(x=>isJump(x.code)&&(x.time||0)>program.duration/2);
    eligible.slice(-rule.bonusCount).forEach(x=>x.x=true);
  }
  let tes=0;
  const scored=rows.map(x=>{
    let base=elementBase(x.code);
    if(x.x)base=round(base*1.1,2);
    const adj=goePoints(x.code,base,Number(x.goe)||0);
    const score=round(Math.max(0,base+adj),2);
    tes+=score;
    return {...x,base,goePoints:adj,score};
  });
  tes=round(tes,2);
  const p=program.pcs||{composition:0,presentation:0,skatingSkills:0};
  const pcs=round((p.composition+p.presentation+p.skatingSkills)*rule.factor,2);
  const deductions=round((program.fallCount||0)*1,2);
  return {elements:scored,tes,pcs,deductions,total:round(tes+pcs-deductions,2),factor:rule.factor};
}

export function formatTime(sec){const m=Math.floor(sec/60);const s=Math.floor(sec%60).toString().padStart(2,'0');return `${m}:${s}`}
