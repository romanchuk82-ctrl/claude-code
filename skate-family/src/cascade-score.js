import { estimateElement, estimateGOE } from '/src/analyzer.js?v=25';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,n=2)=>{const p=10**n;return Math.round((Number(v)||0)*p)/p};
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);

export function resolvedFall(metrics,index,overrides={}){
  if(hasOwn(overrides,index))return !!overrides[index];
  return !!metrics?.fallDetected;
}

export function estimateCascadeGOE(multiResults,markers,fallOverrides={}){
  const jumps=(multiResults||[]).map((r,i)=>{
    const metrics=r.metrics||r;
    const prev=i>0?(multiResults[i-1]?.metrics||multiResults[i-1]):null;
    const gap=prev?Number(metrics.takeoff)-Number(prev.landing):NaN;
    const selected=markers?.[i]?.element||'auto';
    const element=estimateElement(metrics,selected,Number.isFinite(gap)?{afterJumpGap:gap}:{});
    const fall=resolvedFall(metrics,i,fallOverrides);
    const diagnostic=estimateGOE(metrics,element,{fall});
    return {metrics,element,fall,diagnostic,index:i,gap};
  });
  if(!jumps.length)return {goe:0,goeLow:-2,goeHigh:2,reasons:[],label:'Серія',confidence:30,jumps:[]};

  const sequence=jumps.some((j,i)=>i>0&&/A$/.test(j.element)&&Number.isFinite(j.gap)&&j.gap>=.30&&j.gap<=2.5);
  const connected=jumps.length>1&&jumps.slice(1).every(j=>Number.isFinite(j.gap)&&j.gap<=1.05);
  const separator=connected||sequence?' + ':' · ';
  const label=jumps.map(j=>j.element).join(separator)+(sequence?' + SEQ':'');
  const reasons=[];

  let goe=Math.min(...jumps.map(j=>Number(j.diagnostic.goe)||0));
  const falls=jumps.filter(j=>j.fall);
  if(falls.length)goe=-5;
  if(sequence&&jumps.some(j=>(j.metrics?.landingStability??j.metrics?.stability??100)<78))goe=Math.min(goe,0);
  goe=clamp(Math.round(goe),-5,5);

  if(sequence)reasons.push(['neu','Стрибки визначені як jump sequence: після першого приземлення виконується Axel-type jump. GOE виставляється один на весь елемент.']);
  else if(connected)reasons.push(['neu','Стрибки утворюють один зв’язаний jump element. GOE оцінюється для всього елемента, а не окремо для кожного стрибка.']);
  else if(jumps.length>1)reasons.push(['neu','Між стрибками є помітне розділення, тому SKATE показує їх як серію окремих стрибків.']);

  const worst=jumps.reduce((a,b)=>(Number(a.diagnostic.goe)||0)<=(Number(b.diagnostic.goe)||0)?a:b);
  if(goe<0)reasons.push(['neg',`Головне зниження походить від ${worst.element}: ${worst.diagnostic.reasons.filter(x=>x[0]==='neg').map(x=>x[1]).join(', ')||'якість виконання'}.`]);
  else if(goe===0)reasons.push(['neu','Немає достатньо сильних ознак ані для плюсового GOE, ані для обов’язкового зниження. Нейтральний GOE 0 є базовою оцінкою.']);
  else reasons.push(['pos','Усі стрибки елемента мають достатньо сильні позитивні ознаки для плюсового GOE.']);
  if(falls.length)reasons.push(['neg','Падіння застосоване до GOE всього jump element.']);

  const confidences=jumps.map(j=>Number(j.metrics?.confidence)||50),mean=confidences.reduce((a,b)=>a+b,0)/confidences.length;
  const pad=mean>=82?0:mean>=62?1:2;
  const uncertainFall=jumps.some(j=>j.metrics?.fallPossible&&!hasOwn(fallOverrides,j.index)&&!j.metrics?.fallDetected);
  return {
    goe,goeLow:clamp(goe-Math.max(pad,uncertainFall?2:0),-5,5),goeHigh:clamp(goe+Math.max(pad,uncertainFall?2:0),-5,5),
    label,reasons,positives:jumps.filter(j=>(j.diagnostic.goe||0)>0).length,reduction:jumps.filter(j=>(j.diagnostic.goe||0)<0).length,
    fallCount:falls.length,fallDetected:falls.length>0,uncertainFall,sequence,connected,confidence:Math.round(mean),jumps
  };
}
