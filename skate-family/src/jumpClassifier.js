import { expectedRotations } from './scoringEngine.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=a=>a?.length?a.reduce((s,v)=>s+v,0)/a.length:0;

export function classifyJump(metrics={},context={}){
  const r=Number(metrics.rotation)||0;
  const axel=clamp(Number(metrics.axelLikelihood??context.axelLikelihood??.5),0,1);
  const gap=Number(context.afterJumpGap);
  const inSequence=Number.isFinite(gap)&&gap>=.35&&gap<=2.8&&r>=1.15&&r<=2.25;

  // In an Axel sequence the second jump is the main ambiguity that used to be
  // called 2T from air rotation alone. Prefer 1A when the timing is compatible.
  if(inSequence){
    const d=Math.abs(r-1.5);
    return {code:'1A',distance:d,confidence:clamp(Math.round(82-d*26),48,91),reason:'sequence-axel'};
  }

  const candidates=axel>=.66
    ? [['1A',1.5],['2A',2.5],['3A',3.5],['4A',4.5]]
    : [['1T',1],['1A',1.5],['2T',2],['2A',2.5],['3T',3],['3A',3.5],['4T',4],['4A',4.5]];
  let best=candidates[0],dist=99;
  for(const c of candidates){const d=Math.abs(r-c[1]);if(d<dist){best=c;dist=d}}
  const ambiguous=axel>.38&&axel<.66&&r>1.25&&r<2.25;
  return {
    code:best[0],distance:dist,ambiguous,
    confidence:clamp(Math.round(90-dist*32-(ambiguous?20:0)),30,95),
    reason:ambiguous?'takeoff-ambiguous':'rotation+takeoff'
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
    let goe=Math.min(...group.map(x=>Number(x.goe)||0));
    if(seq&&group.some(x=>(x.metrics?.stability||100)<78))goe=Math.min(goe,0);
    out.push({
      id:first.id,kind:'jump-pass',time:first.time,code,suggestion:`${code}?`,goe,
      confidence:Math.round(avg(group.map(x=>x.confidence||50))),needsConfirm:true,
      metrics:{children:group,takeoff:first.metrics?.takeoff,landing:group.at(-1).metrics?.landing}
    });
  }
  return out;
}

export function expectedForElement(code){return expectedRotations(String(code||'').split('+')[0])}
