import { expectedRotations } from './scoringEngine.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a?.length?a.reduce((s,v)=>s+v,0)/a.length:0;

function nearestTurn(rotation,axel=false){
  const arr=axel?[1,2,3,4].map(n=>[`${n}A`,n+.5]):[1,2,3,4].map(n=>[n,n]);
  let best=arr[0],d=99;for(const c of arr){const x=Math.abs(rotation-c[1]);if(x<d){d=x;best=c}}
  return {value:best[0],expected:best[1],distance:d};
}

export function classifyJump(metrics={},context={}){
  const r=Number(metrics.rotation)||0;
  const gap=Number(context.afterJumpGap);
  const inSequence=Number.isFinite(gap)&&gap>=.35&&gap<=2.8&&r>=1.15&&r<=2.25;

  // Main real-world ambiguity from the Sofia benchmark: 1A after another jump
  // used to look like 2T when only air rotation was considered.
  if(inSequence){
    const d=Math.abs(r-1.5);
    return {code:'1A',distance:d,confidence:clamp(Math.round(84-d*26),50,92),reason:'sequence-axel'};
  }

  const forwardScore=clamp(Number(metrics.forwardScore??metrics.axelLikelihood??context.axelLikelihood??.48),0,1);
  const toeAssist=clamp(Number(metrics.toeAssist??0),0,1);
  const crossed=clamp(Number(metrics.crossed??0),0,1);
  const counterRotation=Boolean(metrics.counterRotation);
  const ax=nearestTurn(r,true),plain=nearestTurn(r,false);
  const axelLikely=forwardScore>=.66&&ax.distance<=plain.distance+.28;

  if(axelLikely){
    return {code:ax.value,distance:ax.distance,confidence:clamp(Math.round(60+forwardScore*32-ax.distance*16),42,95),family:'Axel',reason:'forward-takeoff'};
  }

  const n=plain.value;
  let family='S',familyConfidence=55;
  if(toeAssist>=.58){
    if(counterRotation){family='Lz';familyConfidence=Math.round(62+toeAssist*25)}
    else {family='T';familyConfidence=Math.round(58+toeAssist*28)}
  }else if(crossed>=.72){family='Lo';familyConfidence=Math.round(58+crossed*25)}
  else {family='S';familyConfidence=Math.round(55+(1-toeAssist)*24)}

  const ambiguous=(forwardScore>.38&&forwardScore<.66&&r>1.25&&r<2.25)||(toeAssist>.42&&toeAssist<.62);
  return {
    code:`${n}${family}`,distance:plain.distance,family,
    confidence:clamp(Math.round(familyConfidence-plain.distance*16-(ambiguous?10:0)),30,95),
    ambiguous,reason:ambiguous?'takeoff-ambiguous':'rotation+takeoff-family'
  };
}

export function refineJumpType(metrics={},selected='auto',context={}){
  if(selected&&selected!=='auto')return {code:selected,confidence:100,reason:'manual'};
  return classifyJump(metrics,context);
}

export function groupJumpPasses(jumps=[]){
  const src=[...jumps].sort((a,b)=>(a.time||0)-(b.time||0));
  const out=[];
  for(let i=0;i<src.length;i++){
    const first={...src[i]};
    const group=[first];let seq=false;
    while(i+1<src.length){
      const next={...src[i+1]};
      const prev=group.at(-1);
      const prevLanding=Number(prev.metrics?.landing??prev.time);
      const nextTakeoff=Number(next.metrics?.takeoff??next.time);
      const gap=nextTakeoff-prevLanding;
      if(gap<=.95){group.push(next);i++;continue}
      if(gap>=.35&&gap<=2.8&&Number(next.metrics?.rotation)>=1.15&&Number(next.metrics?.rotation)<=2.25){
        const call=classifyJump(next.metrics,{afterJumpGap:gap});
        next.code=call.code;next.suggestion=`${call.code}?`;next.confidence=Math.min(next.confidence||99,call.confidence);next.needsConfirm=true;
        group.push(next);seq=true;i++;continue
      }
      break;
    }
    if(group.length===1){out.push(first);continue}
    const code=group.map(x=>x.code).join('+')+(seq?'+SEQ':'');
    let goe=Math.min(...group.map(x=>Number(x.goeGrade??x.goe)||0));
    if(seq&&group.some(x=>(x.metrics?.stability||100)<78))goe=Math.min(goe,0);
    out.push({
      id:first.id,kind:'jump-pass',time:first.time,code,suggestion:`${code}?`,goe,goeGrade:goe,
      confidence:Math.round(avg(group.map(x=>x.confidence||50))),needsConfirm:true,
      metrics:{children:group,takeoff:first.metrics?.takeoff,landing:group.at(-1).metrics?.landing}
    });
  }
  return out;
}

export function expectedForElement(code){return expectedRotations(String(code||'').split('+')[0])}
