let FilesetResolver, PoseLandmarker;

let landmarker;
const G=9.80665;
const MP_VERSION='0.10.21';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

async function loadVisionModule(){
  const sources=[
    `${MP_CDN}/vision_bundle.mjs?skate=9`,
    `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs?skate=9`
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

function resetPose(){
  if(!landmarker)return;
  try{landmarker.close?.()}catch(err){console.warn('PoseLandmarker close failed',err)}
  landmarker=null;
}

export async function initPose(){
  if(landmarker)return landmarker;
  if(!FilesetResolver){
    const mod=await loadVisionModule();
    FilesetResolver=mod.FilesetResolver;
    PoseLandmarker=mod.PoseLandmarker;
  }
  const vision=await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const model='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const options={
    baseOptions:{modelAssetPath:model,delegate:'GPU'},
    runningMode:'VIDEO',
    numPoses:1,
    minPoseDetectionConfidence:.42,
    minPosePresenceConfidence:.42,
    minTrackingConfidence:.42
  };
  try{
    landmarker=await PoseLandmarker.createFromOptions(vision,options);
  }catch(err){
    console.warn('GPU PoseLandmarker unavailable, falling back to CPU',err);
    landmarker=await PoseLandmarker.createFromOptions(vision,{
      ...options,
      baseOptions:{modelAssetPath:model}
    });
  }
  return landmarker;
}

const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,n=2)=>{const p=10**n;return Math.round(v*p)/p};
const med=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const mad=a=>{if(!a.length)return 0;const m=med(a);return med(a.map(v=>Math.abs(v-m)))};
const std=a=>{if(!a.length)return 0;const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))};
const smooth=(a,w=2)=>a.map((_,i)=>avg(a.slice(Math.max(0,i-w),Math.min(a.length,i+w+1))));
const wrapAngle=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};
const unwrap=angles=>{
  if(!angles.length)return[];
  const out=[angles[0]];
  for(let i=1;i<angles.length;i++)out.push(out[i-1]+wrapAngle(angles[i]-angles[i-1]));
  return out;
};
const deg=r=>r*180/Math.PI;
const angle2d=(a,b,c)=>{
  const ab=[a.x-b.x,a.y-b.y],cb=[c.x-b.x,c.y-b.y];
  const dot=ab[0]*cb[0]+ab[1]*cb[1];
  const den=Math.hypot(...ab)*Math.hypot(...cb)||1;
  return deg(Math.acos(clamp(dot/den,-1,1)));
};
const linRegResidual=(times,values)=>{
  if(values.length<2)return values.map(()=>0);
  const mt=avg(times),mv=avg(values);
  let num=0,den=0;
  for(let i=0;i<values.length;i++){num+=(times[i]-mt)*(values[i]-mv);den+=(times[i]-mt)**2}
  const slope=den?num/den:0,intercept=mv-slope*mt;
  return values.map((v,i)=>v-(intercept+slope*times[i]));
};
const safeMedian=a=>med(a.filter(Number.isFinite));

function getMetrics(frame){
  const l=frame.landmarks?.[0],w=frame.worldLandmarks?.[0];
  if(!l||!w)return null;
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z||0)+(b.z||0))/2});
  const sh=mid(l[11],l[12]),hp=mid(l[23],l[24]),an=mid(l[27],l[28]),wr=mid(l[15],l[16]);
  const bodyHeight=Math.max(.08,Math.hypot(an.x-sh.x,an.y-sh.y));
  const torsoAxis=Math.abs(deg(Math.atan2(sh.x-hp.x,hp.y-sh.y)));
  const shoulderYaw=Math.atan2(w[12].z-w[11].z,w[12].x-w[11].x);
  const hipYaw=Math.atan2(w[24].z-w[23].z,w[24].x-w[23].x);
  const yaw=shoulderYaw+wrapAngle(hipYaw-shoulderYaw)/2;
  const yawAgreement=Math.abs(wrapAngle(shoulderYaw-hipYaw));
  const leftKnee=angle2d(l[23],l[25],l[27]);
  const rightKnee=angle2d(l[24],l[26],l[28]);
  const kneeAngle=(leftKnee+rightKnee)/2;
  const shoulderWidth=Math.hypot(l[12].x-l[11].x,l[12].y-l[11].y);
  const hipWidth=Math.hypot(l[24].x-l[23].x,l[24].y-l[23].y);
  const wristHip=Math.hypot(wr.x-hp.x,wr.y-hp.y)/bodyHeight;
  const conf=avg([11,12,23,24,25,26,27,28].map(i=>l[i].visibility??0));
  return {
    hipX:hp.x,hipY:hp.y,ankleX:an.x,ankleY:an.y,shoulderX:sh.x,shoulderY:sh.y,
    bodyHeight,torsoAxis,yaw,shoulderYaw,hipYaw,yawAgreement,kneeAngle,
    shoulderWidth,hipWidth,wristHip,conf
  };
}

function detectFlight(samples){
  const times=samples.map(s=>s.t);
  const hip=smooth(samples.map(s=>s.hipY),2);
  const ankle=smooth(samples.map(s=>s.ankleY),2);
  const hipRes=linRegResidual(times,hip);
  const ankleRes=linRegResidual(times,ankle);
  const signal=smooth(hipRes.map((v,i)=>v*.72+ankleRes[i]*.28),1);
  let peak=0;
  for(let i=1;i<signal.length;i++)if(signal[i]<signal[peak])peak=i;
  const body=safeMedian(samples.map(s=>s.bodyHeight))||.3;
  const amp=Math.max(0,-signal[peak]);
  const noise=Math.max(.001,mad(signal));
  const phaseConfidence=clamp((amp/(body*.055))*55+(amp/(noise*4))*25+20,18,98);
  const threshold=-Math.max(body*.010,amp*.30,noise*1.8);
  let start=peak,end=peak;
  while(start>1&&signal[start]<threshold)start--;
  while(end<signal.length-2&&signal[end]<threshold)end++;
  if(end-start<3){
    start=Math.max(1,peak-2);
    end=Math.min(signal.length-2,peak+3);
  }
  const airtime=Math.max(.08,samples[end].t-samples[start].t);
  return {start,end,peak,airtime,amp,body,phaseConfidence,signal};
}

function medianSpeed(samples,from,to,bodyHeight){
  const speeds=[];
  for(let i=Math.max(1,from);i<=Math.min(samples.length-1,to);i++){
    const dt=samples[i].t-samples[i-1].t;
    if(dt<=0)continue;
    speeds.push(Math.abs((samples[i].hipX-samples[i-1].hipX)/(dt*Math.max(.08,bodyHeight))));
  }
  return safeMedian(speeds);
}

function scorePhases(raw,flight){
  const n=raw.length,body=flight.body;
  const preStart=Math.max(0,flight.start-7);
  const pre=raw.slice(preStart,flight.start+1);
  const air=raw.slice(flight.start,flight.end+1);
  const post=raw.slice(flight.end,Math.min(n,flight.end+10));
  const preSpeed=medianSpeed(raw,preStart,flight.start,body);
  const postSpeed=medianSpeed(raw,flight.end+1,Math.min(n-1,flight.end+8),body);
  let flowRatio=null,flow=72;
  if(preSpeed>.07){
    flowRatio=postSpeed/preSpeed;
    flow=clamp(48+52*clamp(flowRatio,0,1.05),30,100);
  }
  const airAxis=air.map(s=>s.torsoAxis);
  const preAxis=pre.map(s=>s.torsoAxis);
  const postAxis=post.map(s=>s.torsoAxis);
  const airAxisVar=mad(airAxis);
  const preAxisVar=mad(preAxis);
  const postAxisVar=mad(postAxis);
  const postVertical=linRegResidual(post.map(s=>s.t),post.map(s=>s.hipY));
  const postJitter=mad(postVertical)/Math.max(.08,body);
  const bodyControl=clamp(
    96-airAxisVar*5-Math.max(0,safeMedian(airAxis)-24)*1.05-avg(air.map(s=>s.yawAgreement))*13,
    35,98
  );
  const takeoffQuality=clamp(
    92-preAxisVar*5-Math.max(0,safeMedian(preAxis)-26)*.9-Math.max(0,60-flight.phaseConfidence)*.18,
    40,98
  );
  const landingStability=clamp(
    98-postAxisVar*6-postJitter*1050-Math.max(0,70-flow)*.24-Math.max(0,safeMedian(postAxis)-28)*.55,
    28,99
  );
  const smoothness=clamp((bodyControl*.48+landingStability*.30+flow*.22),30,99);
  const dx=Math.abs(raw[flight.end].hipX-raw[flight.start].hipX);
  const lengthBodies=dx/Math.max(.08,body);
  const landingKnee=safeMedian(post.map(s=>s.kneeAngle));
  return {
    preSpeed,postSpeed,flowRatio,flow,bodyControl,takeoffQuality,landingStability,smoothness,
    lengthBodies,landingKnee,airAxis:safeMedian(airAxis),airAxisVar,postAxisVar,postJitter
  };
}

function scoreRotation(raw,flight){
  const air=raw.slice(flight.start,flight.end+1);
  const shoulder=unwrap(air.map(s=>s.shoulderYaw));
  const hip=unwrap(air.map(s=>s.hipYaw));
  const blended=unwrap(air.map(s=>s.yaw));
  const turns=a=>a.length>1?Math.abs(a[a.length-1]-a[0])/(2*Math.PI):0;
  const estimates=[turns(shoulder),turns(hip),turns(blended)];
  const rotation=safeMedian(estimates);
  const agreement=std(estimates);
  const pose=avg(air.map(s=>s.conf))*100;
  const confidence=clamp(pose*.56+flight.phaseConfidence*.24+Math.max(0,100-agreement*145)*.20,18,98);
  return {rotation,rotationConfidence:confidence,rotationSpread:agreement,rotationEstimates:estimates};
}

function qualityScore(m){
  return Math.round(clamp(
    m.landingStability*.30+m.bodyControl*.23+m.takeoffQuality*.20+m.flow*.12+
    clamp(m.height/0.35*100,0,100)*.08+clamp(m.lengthBodies/0.8*100,0,100)*.07,
    0,100
  ));
}

function friendlyError(err){
  const msg=String(err?.message||err||'');
  if(/timestamp mismatch|monotonically increasing|CalculatorGraph|WaitUntilIdle|INVALID_ARGUMENT/i.test(msg))
    return new Error('Аналізатор перезапущено після помилки відеопотоку. Натисни «Аналізувати відео» ще раз.');
  if(/memory|out of bounds|abort/i.test(msg))
    return new Error('iPhone не зміг обробити відео за один прохід. Спробуй коротший фрагмент 3–10 секунд.');
  if(err instanceof Error && msg && msg.length<180)return err;
  return new Error('Не вдалося завершити аналіз цього відео. Спробуй ще раз або обери коротший фрагмент.');
}

export async function analyzeVideo(video,onProgress=()=>{}){
  resetPose();
  let pose;
  try{
    pose=await initPose();
    const duration=Math.min(video.duration||0,15);
    if(!duration||duration<.4)throw new Error('Відео занадто коротке');
    const step=duration<=6?.05:duration<=10?.065:.08;
    const times=[];
    for(let t=0;t<duration-.001;t+=step)times.push(t);
    if(!times.length||times[times.length-1]<duration-.12)times.push(Math.max(0,duration-.002));
    const raw=[];
    let lastTs=-1;
    for(let i=0;i<times.length;i++){
      const t=times[i];
      await seek(video,t);
      let ts=Math.round(t*1000);
      if(ts<=lastTs)ts=lastTs+1;
      lastTs=ts;
      const res=pose.detectForVideo(video,ts);
      const m=getMetrics(res);
      if(m)raw.push({t,...m});
      onProgress(Math.round((i+1)/times.length*82));
    }
    if(raw.length<10)throw new Error('Не вдалося стабільно побачити фігуриста. Потрібне відео, де все тіло в кадрі.');
    const coverage=raw.length/times.length;
    const flight=detectFlight(raw);
    onProgress(86);
    const phase=scorePhases(raw,flight);
    const rot=scoreRotation(raw,flight);
    const height=G*flight.airtime*flight.airtime/8;
    const poseConfidence=avg(raw.map(s=>s.conf))*100;
    const confidence=clamp(
      poseConfidence*.46+coverage*100*.18+flight.phaseConfidence*.20+rot.rotationConfidence*.16,
      20,98
    );
    const metrics={
      version:2,
      airtime:round(flight.airtime,2),
      height:round(height,2),
      rotation:round(rot.rotation,2),
      rotationConfidence:Math.round(rot.rotationConfidence),
      lengthBodies:round(phase.lengthBodies,2),
      flow:Math.round(phase.flow),
      flowRatio:phase.flowRatio==null?null:round(phase.flowRatio,2),
      takeoffQuality:Math.round(phase.takeoffQuality),
      landingStability:Math.round(phase.landingStability),
      stability:Math.round(phase.landingStability),
      bodyControl:Math.round(phase.bodyControl),
      smoothness:Math.round(phase.smoothness),
      axis:round(phase.airAxis,1),
      axisVariation:round(phase.airAxisVar,1),
      landingKnee:round(phase.landingKnee,0),
      confidence:Math.round(confidence),
      phaseConfidence:Math.round(flight.phaseConfidence),
      poseConfidence:Math.round(poseConfidence),
      coverage:Math.round(coverage*100),
      takeoff:round(raw[flight.start].t,2),
      landing:round(raw[flight.end].t,2)
    };
    metrics.quality=qualityScore(metrics);
    onProgress(96);
    resetPose();
    return metrics;
  }catch(err){
    resetPose();
    throw friendlyError(err);
  }
}

function seek(video,t){
  return new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-t)<.008)return resolve();
    const done=()=>{cleanup();resolve()};
    const err=()=>{cleanup();reject(new Error('Не вдалося прочитати кадр відео'))};
    const cleanup=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',err)};
    video.addEventListener('seeked',done,{once:true});
    video.addEventListener('error',err,{once:true});
    video.currentTime=t;
  });
}

const EXPECTED={
  auto:null,'1J':1,'2J':2,'3J':3,'4J':4,
  '1T':1,'1S':1,'1Lo':1,'1F':1,'1Lz':1,'1A':1.5,
  '2T':2,'2S':2,'2Lo':2,'2F':2,'2Lz':2,'2A':2.5,
  '3T':3,'3S':3,'3Lo':3,'3F':3,'3Lz':3,'3A':3.5
};

export function estimateElement(rotation,selected='auto'){
  if(selected!=='auto')return selected;
  const rev=clamp(Math.round(rotation||1),1,4);
  return `${rev}J`;
}

function heightLengthTarget(expected){
  if(expected>=3)return {h:.31,l:.58};
  if(expected>=2)return {h:.24,l:.50};
  return {h:.17,l:.38};
}

export function estimateGOE(metrics,element,flags={}){
  const expected=EXPECTED[element]||Math.max(1,Math.round(metrics.rotation||1));
  const manual=element&&!/J$/.test(element);
  const reasons=[];
  const positives=[];
  const reductions=[];
  const target=heightLengthTarget(expected);

  const heightLength=metrics.height>=target.h&&metrics.lengthBodies>=target.l;
  if(heightLength){
    positives.push('heightLength');
    reasons.push(['pos','Хороші висота та довжина стрибка']);
  }else if(metrics.height>=target.h*.82||metrics.lengthBodies>=target.l*.82){
    reasons.push(['neu','Висота/довжина достатні, але не дають сильного +GOE']);
  }else{
    reasons.push(['neu','Висота або довжина виглядають скромно для цього рівня']);
  }

  if(metrics.takeoffQuality>=72&&metrics.landingStability>=74){
    positives.push('takeoffLanding');
    reasons.push(['pos','Контрольований take-off і чистий landing']);
  }else if(metrics.landingStability<52&&metrics.confidence>=65){
    reductions.push(1);
    reasons.push(['neg','Landing виглядає нестабільним']);
  }else{
    reasons.push(['neu','Take-off / landing без вираженого бонусу']);
  }

  if(metrics.flow>=80&&metrics.smoothness>=78){
    positives.push('effortless');
    reasons.push(['pos','Хороший flow і легкість виконання']);
  }else if(metrics.flow<50&&metrics.confidence>=65){
    reductions.push(1);
    reasons.push(['neg','Помітна втрата flow після приземлення']);
  }else{
    reasons.push(['neu','Flow збережений на прийнятному рівні']);
  }

  if(metrics.bodyControl>=78&&metrics.axisVariation<=6.5){
    positives.push('bodyPosition');
    reasons.push(['pos','Стабільне положення тіла в польоті']);
  }else if(metrics.bodyControl<50&&metrics.confidence>=70){
    reductions.push(1);
    reasons.push(['neg','Контроль корпусу нестабільний']);
  }

  const deficit=expected-(metrics.rotation||0);
  let rotationCall='ok';
  if(manual&&metrics.rotationConfidence>=68){
    if(deficit>=.52){
      reductions.push(3);rotationCall='<<';
      reasons.push(['neg','Обертання схоже на downgrade (<<)']);
    }else if(deficit>=.29){
      reductions.push(2);rotationCall='<';
      reasons.push(['neg','Ймовірний under-rotation (<)']);
    }else if(deficit>=.16){
      reductions.push(1);rotationCall='q';
      reasons.push(['neg','Можливий q / близько чверті недокруту']);
    }else{
      reasons.push(['pos','Обертання близьке до повного']);
    }
  }else if(manual){
    rotationCall='uncertain';
    reasons.push(['neu','Недокрут не штрафую: камера не дала достатньої впевненості']);
  }else{
    reasons.push(['neu','Авто-режим визначає кількість обертів, але не тип стрибка']);
  }

  if(flags.hand){reductions.push(1);reasons.push(['neg','Дотик рукою підтверджено вручну'])}
  if(flags.twoFoot){reductions.push(2);reasons.push(['neg','Landing на дві ноги підтверджено вручну'])}
  if(flags.stepOut){reductions.push(3);reasons.push(['neg','Step-out підтверджено вручну'])}
  if(flags.fall){reductions.push(5);reasons.push(['neg','Fall підтверджено вручну'])}

  let goe=positives.length-reductions.reduce((a,b)=>a+b,0);
  goe=clamp(Math.round(goe),-5,5);

  const uncertainty=metrics.confidence>=82?0:metrics.confidence>=62?1:2;
  const rotExtra=manual&&metrics.rotationConfidence<68?1:0;
  const rangePad=Math.max(uncertainty,rotExtra);
  const goeLow=clamp(goe-rangePad,-5,5);
  const goeHigh=clamp(goe+rangePad,-5,5);

  if(!manual)reasons.unshift(['neu','Для точнішого GOE вибери конкретний елемент у списку']);

  return {
    goe,goeLow,goeHigh,reasons,
    deficit:round(deficit,2),expected,
    positives:positives.length,
    reductions:reductions.reduce((a,b)=>a+b,0),
    rotationCall,
    confidence:metrics.confidence,
    unmeasured:['Складність/оригінальність входу та виходу','Відповідність елемента музиці','Ребро Flip/Lutz без спеціального ракурсу']
  };
}
