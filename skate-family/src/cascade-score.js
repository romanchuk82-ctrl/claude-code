import { estimateElement, estimateGOE } from '/src/analyzer.js?v=14';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TARGETS={1:{h:.17,l:.38},2:{h:.24,l:.50},3:{h:.31,l:.58},4:{h:.36,l:.64}};
const expectedTurns=element=>{
  if(!element||element==='auto')return 2;
  if(element.endsWith('A'))return (parseInt(element,10)||1)+.5;
  return parseInt(element,10)||1;
};
const targetFor=element=>TARGETS[Math.min(4,Math.max(1,Math.floor(expectedTurns(element))))]||TARGETS[2];
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);

export function resolvedFall(metrics,index,overrides={}){
  if(hasOwn(overrides,index))return !!overrides[index];
  return !!metrics?.fallDetected;
}

export function estimateCascadeGOE(multiResults,markers,fallOverrides={}){
  const jumps=(multiResults||[]).map((r,i)=>{
    const metrics=r.metrics||r;
    const selected=markers?.[i]?.element||'auto';
    const element=estimateElement(metrics.rotation,selected);
    const fall=resolvedFall(metrics,i,fallOverrides);
    const diagnostic=estimateGOE(metrics,element,{fall});
    return {metrics,element,fall,diagnostic,index:i};
  });
  if(!jumps.length)return {goe:0,goeLow:-2,goeHigh:2,reasons:[],label:'Каскад'};

  const label=jumps.map(j=>j.element).join(' + ');
  const reasons=[];
  let positives=0;

  const allHeightLength=jumps.every(({metrics,element})=>{
    const t=targetFor(element);
    return (metrics.height>=t.h&&metrics.lengthBodies>=t.l*.82)||(metrics.height>=t.h*.88&&metrics.lengthBodies>=t.l);
  });
  if(allHeightLength){positives++;reasons.push(['pos','Хороші висота та довжина всіх стрибків каскаду'])}
  else reasons.push(['neu','Не всі стрибки мають достатньо надійний бонус за висоту/довжину']);

  const allTakeLanding=jumps.every(j=>j.metrics.takeoffQuality>=62&&j.metrics.landingStability>=58&&!j.fall);
  if(allTakeLanding){positives++;reasons.push(['pos','Контрольовані take-off та landing у всьому каскаді'])}
  else reasons.push(['neu','Take-off / landing не дають повного позитивного критерію для всього каскаду']);

  const gaps=(markers||[]).slice(1).map((m,i)=>m.time-(markers[i]?.time??m.time));
  const rhythmOK=!gaps.length||Math.max(...gaps)<=2.35;
  const effortless=jumps.every(j=>j.metrics.flow>=68&&j.metrics.smoothness>=62)&&rhythmOK;
  if(effortless){positives++;reasons.push(['pos','Збережені flow, легкість і ритм між стрибками'])}
  else reasons.push(['neu','Flow/ритм каскаду не дають окремого позитивного критерію']);

  const bodyOK=jumps.every(j=>j.metrics.bodyControl>=68&&(j.metrics.axisVariation??99)<=10.5);
  if(bodyOK){positives++;reasons.push(['pos','Хороше положення тіла в усіх стрибках'])}
  else reasons.push(['neu','Положення тіла не дає позитивний критерій для всього каскаду']);

  const falls=jumps.filter(j=>j.fall);
  let reduction=0;
  if(falls.length){
    reduction+=5;
    reasons.push(['neg',falls.length===1?`Падіння після ${falls[0].element}: зниження −5`:`Зафіксовано падіння в каскаді: зниження −5`]);
  }

  // Only apply rhythm reduction when there is clear separation and no fall already explaining the break.
  if(!falls.length&&gaps.length&&Math.max(...gaps)>2.8){
    reduction+=2;
    reasons.push(['neg','Велика пауза / втрата ритму між стрибками: орієнтовне зниження −2']);
  }

  // With the camera-only criteria we can verify at most four positive bullets.
  let goe=clamp(positives-reduction,-5,4);
  if(goe>=4&&!(allHeightLength&&allTakeLanding))goe=3;

  const confidences=jumps.map(j=>j.metrics.confidence??55);
  const fallModelCoverage=jumps.filter(j=>j.metrics.fallModelAvailable).length/jumps.length;
  const meanConfidence=confidences.reduce((a,b)=>a+b,0)/confidences.length;
  const uncertainFall=jumps.some(j=>j.metrics.fallPossible&&!hasOwn(fallOverrides,j.index)&&!j.metrics.fallDetected);
  let pad=meanConfidence>=68&&fallModelCoverage>=.5?1:2;
  if(uncertainFall)pad=Math.max(pad,2);
  const goeLow=clamp(goe-pad,-5,5),goeHigh=clamp(goe+pad,-5,5);

  return {
    goe,goeLow,goeHigh,label,reasons,positives,reduction,
    fallCount:falls.length,
    fallDetected:falls.length>0,
    uncertainFall,
    confidence:Math.round(Math.min(82,meanConfidence*.82+fallModelCoverage*18)),
    jumps
  };
}
