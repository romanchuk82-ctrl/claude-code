import { expectedRotations } from './scoringEngine.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a?.length?a.reduce((s,v)=>s+v,0)/a.length:0;

function nearestTurn(rotation,axel=false){
  const arr=axel?[1,2,3,4].map(n=>[`${n}A`,n+.5]):[1,2,3,4].map(n=>[n,n]);
  let best=arr[0],d=99;for(const c of arr){const x=Math.abs(rotation-c[1]);if(x<d){d=x;best=c}}
  return {value:best[0],expected:best[1],distance:d};
}

// MediaPipe shoulder yaw systematically loses part of the rotation: shoulders close
// before take-off and open immediately after landing. For classification only we use
// a conservative proxy correction. Technical q/< calls are still handled separately
// in scoringEngine and are never invented from this correction.
function classificationRotation(metrics={},context={}){
  const raw=Math.max(0,Number(metrics.rotation)||0);
  const airtime=Math.max(0,Number(metrics.airtime)||0);
  const reliability=clamp(Number(metrics.rotationReliability??metrics.confidence??55),20,100);
  const mode=context.mode||'auto';
  let bias=Number(metrics.classificationRotationBias);
  if(!Number.isFinite(bias)){
    bias=(mode==='program'||mode==='pass')?.27:.17;
    if(airtime>=.42)bias+=.05;
    if(airtime>=.50)bias+=.05;
    if(reliability<45)bias-=.05;
    if(raw<.70)bias*=.45;
  }
  bias=clamp(bias,0,.40);
  let used=raw+bias;
  // A short low-rotation hop must not be promoted to a double just because of bias.
  if(airtime>0&&airtime<.34&&raw<1.30)used=Math.min(used,1.34);
  return {raw,used,airtime,reliability,bias};
}

export function classifyJump(metrics={},context={}){
  const rot=classificationRotation(metrics,context),r=rot.used;
  const forwardScore=clamp(Number(metrics.forwardScore??metrics.axelLikelihood??context.axelLikelihood??.48),0,1);
  const toeAssist=clamp(Number(metrics.toeAssist??0),0,1);
  const crossed=clamp(Number(metrics.crossed??0),0,1);
  const counterRotation=Boolean(metrics.counterRotation);
  const gap=Number(context.afterJumpGap);
  const inSequence=Number.isFinite(gap)&&gap>=.28&&gap<=2.6&&r>=1.20&&r<=2.10&&forwardScore>=.50;

  // Axel after another jump is the main source of false 2T/2S calls in sequences.
  // Sequence context + a forward take-off is stronger evidence than torso yaw alone.
  if(inSequence){
    const d=Math.abs(r-1.5);
    return {code:'1A',distance:d,confidence:clamp(Math.round(88-d*22+(forwardScore-.50)*16-(rot.bias>.34?4:0)),52,94),family:'Axel',reason:'sequence-forward-axel',rotationRaw:rot.raw,rotationUsed:r,rotationBias:rot.bias};
  }

  const ax=nearestTurn(r,true),plain=nearestTurn(r,false);
  const axelThreshold=(context.mode==='program'||context.mode==='pass')?.60:.66;
  const axelLikely=forwardScore>=axelThreshold&&ax.distance<=plain.distance+.30;
  if(axelLikely){
    return {code:ax.value,distance:ax.distance,confidence:clamp(Math.round(61+forwardScore*30-ax.distance*16-(rot.bias>.34?4:0)),42,95),family:'Axel',reason:'forward-takeoff',rotationRaw:rot.raw,rotationUsed:r,rotationBias:rot.bias};
  }

  const n=plain.value;
  let family='S',familyConfidence=57;
  if(toeAssist>=.54){
    if(counterRotation){family='Lz';familyConfidence=Math.round(63+toeAssist*24)}
    else {family='T';familyConfidence=Math.round(60+toeAssist*26)}
  }else if(crossed>=.66){family='Lo';familyConfidence=Math.round(60+crossed*23)}
  else {family='S';familyConfidence=Math.round(57+(1-toeAssist)*22)}

  const ambiguous=(forwardScore>.38&&forwardScore<axelThreshold&&r>1.25&&r<2.25)||(toeAssist>.43&&toeAssist<.58)||(Math.abs(r-1.5)<.12&&forwardScore<.55);
  const correctionPenalty=Math.max(0,(rot.bias-.22)*18);
  return {code:`${n}${family}`,distance:plain.distance,family,confidence:clamp(Math.round(familyConfidence-plain.distance*16-(ambiguous?8:0)-correctionPenalty),30,95),ambiguous,reason:ambiguous?'takeoff-ambiguous':'rotation+takeoff-family',rotationRaw:rot.raw,rotationUsed:r,rotationBias:rot.bias};
}

export function refineJumpType(metrics={},selected='auto',context={}){
  if(selected&&selected!=='auto')return {code:selected,confidence:100,reason:'manual'};
  return classifyJump(metrics,context);
}

export function groupJumpPasses(jumps=[],context={}){
  const src=[...jumps].sort((a,b)=>(a.time||0)-(b.time||0));
  const out=[];
  for(let i=0;i<src.length;i++){
    const first={...src[i]};
    const group=[first];let seq=false;
    while(i+1<src.length&&group.length<3){
      const next={...src[i+1]};
      const prev=group.at(-1);
      const prevLanding=Number(prev.metrics?.landing??prev.time);
      const nextTakeoff=Number(next.metrics?.takeoff??next.time);
      const gap=nextTakeoff-prevLanding;
      const peakGap=(next.time||0)-(prev.time||0);
      const seqCall=classifyJump(next.metrics,{...context,afterJumpGap:gap});
      const isAxelSequence=gap>=.28&&gap<=2.6&&peakGap<=3.3&&seqCall.reason==='sequence-forward-axel';
      if(isAxelSequence){
        next.code=seqCall.code;next.suggestion=`${seqCall.code}?`;next.confidence=Math.min(next.confidence||99,seqCall.confidence);next.needsConfirm=true;
        group.push(next);seq=true;i++;continue;
      }
      if(gap<=1.08&&peakGap<=1.70){group.push(next);i++;continue}
      break;
    }
    if(group.length===1){out.push(first);continue}
    const code=group.map(x=>x.code).join('+')+(seq?'+SEQ':'');
    let goe=Math.min(...group.map(x=>Number(x.goeGrade??x.goe)||0));
    if(seq&&group.some(x=>(x.metrics?.stability||100)<78))goe=Math.min(goe,0);
    out.push({id:first.id,kind:'jump-pass',time:first.time,code,suggestion:`${code}?`,goe,goeGrade:goe,confidence:Math.round(avg(group.map(x=>x.confidence||50))),needsConfirm:true,metrics:{children:group,takeoff:first.metrics?.takeoff,landing:group.at(-1).metrics?.landing}});
  }
  return out;
}

export function expectedForElement(code){return expectedRotations(String(code||'').split('+')[0])}
