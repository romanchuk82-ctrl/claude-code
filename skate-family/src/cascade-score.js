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
  if(allHeightLength){
    positives++;
    reasons.push(['pos','По висоті й прольоту всі стрибки виглядають достатньо сильними. Як сказав би тренер: стрибок не «падає вниз», а має нормальний запас часу в повітрі й рух уперед.']);
  }else{
    reasons.push(['neu','Хоча б один стрибок у каскаді виглядає трохи коротким або низьким. Простими словами: зараз краще не поспішати з відривом, а дати стрибку більше висоти й прольоту, щоб він виглядав вільніше, а не «витиснутим».']);
  }

  const allTakeLanding=jumps.every(j=>j.metrics.takeoffQuality>=62&&j.metrics.landingStability>=58&&!j.fall);
  if(allTakeLanding){
    positives++;
    reasons.push(['pos','Відриви й приземлення виглядають контрольовано. Є відчуття, що спортсмен керує стрибком від початку до виїзду, а не просто намагається втриматися після льоду.']);
  }else{
    reasons.push(['neu','У відриві або приземленні є нестабільність. Тренерською мовою: спочатку треба зробити чистіший вхід у стрибок, зібратися в повітрі й спокійніше виїхати з приземлення без зайвих рухів корпусом.']);
  }

  const gaps=(markers||[]).slice(1).map((m,i)=>m.time-(markers[i]?.time??m.time));
  const rhythmOK=!gaps.length||Math.max(...gaps)<=2.35;
  const effortless=jumps.every(j=>j.metrics.flow>=68&&j.metrics.smoothness>=62)&&rhythmOK;
  if(effortless){
    positives++;
    reasons.push(['pos','Каскад іде в одному ритмі: після першого стрибка швидкість не губиться і наступний стрибок підключається природно. Це саме той ефект, коли комбінація виглядає легкою, а не складеною з окремих шматків.']);
  }else{
    reasons.push(['neu','Між стрибками бракує легкості або ритму. Схоже, що після одного зі стрибків рух трохи гасне. Я б працював над тим, щоб після приземлення одразу зберігати швидкість і не «зависати» перед наступним відривом.']);
  }

  const bodyOK=jumps.every(j=>j.metrics.bodyControl>=68&&(j.metrics.axisVariation??99)<=10.5);
  if(bodyOK){
    positives++;
    reasons.push(['pos','Корпус і вісь у повітрі виглядають зібрано. Це допомагає не розкидати руки й плечі та робить приземлення більш передбачуваним.']);
  }else{
    reasons.push(['neu','Положення тіла ще не досить стабільне в усьому каскаді. Простими словами: варто сильніше тримати корпус, плечі й вісь разом, щоб у повітрі не «розкривало» і на виїзді не доводилося рятувати стрибок.']);
  }

  const falls=jumps.filter(j=>j.fall);
  let reduction=0;
  if(falls.length){
    reduction+=5;
    reasons.push(['neg',falls.length===1?`Після ${falls[0].element} зафіксоване падіння. Для GOE всього каскаду це найсильніший негативний фактор: орієнтовне зниження −5. Перший пріоритет тут не висота чи швидкість, а стабільне приземлення й контрольований виїзд.`:`У каскаді зафіксоване падіння. Для загального GOE це різко знижує оцінку: орієнтовно −5. Спочатку варто добитися чистого завершення каскаду, а вже потім додавати висоту, швидкість і складність.`]);
  }

  // Only apply rhythm reduction when there is clear separation and no fall already explaining the break.
  if(!falls.length&&gaps.length&&Math.max(...gaps)>2.8){
    reduction+=2;
    reasons.push(['neg','Між стрибками вийшла занадто велика пауза, тому каскад виглядає як два окремі стрибки. Орієнтовне зниження −2. Завдання тренера тут просте: скоротити паузу й зберегти один темп від першого приземлення до другого відриву.']);
  }

  // Add a plain-language coaching summary before the technical bullets.
  if(falls.length){
    reasons.unshift(['neu',`Як сказав би тренер: зараз головна задача - не гнатися за плюсом GOE, а зробити ${falls[0].element} стабільним. Коли приземлення стане чистим і каскад перестане ламатися в кінці, тоді вже є сенс добирати висоту, швидкість і легкість виконання.`]);
  }else if(positives>=3){
    reasons.unshift(['neu','Як сказав би тренер: база вже хороша. Каскад виглядає зібрано, тому наступний крок - зробити його ще легшим: менше зайвої напруги, більше швидкості на виїзді й такий самий контроль у кожній спробі.']);
  }else{
    reasons.unshift(['neu','Як сказав би тренер: тут не треба одразу «стрибати сильніше». Спочатку зроби каскад чистішим - стабільний відрив, зібране тіло, спокійне приземлення і без втрати швидкості між стрибками. Коли це стане повторюваним, GOE сам піде вгору.']);
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
