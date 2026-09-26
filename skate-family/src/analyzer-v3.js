import { analyzeVideo as baseAnalyzeVideo, estimateElement as baseEstimateElement } from '/skate-family/src/analyzer.js?v=9';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,n=2)=>{const p=10**n;return Math.round(v*p)/p};

const EXPECTED={
  auto:null,'1J':1,'2J':2,'3J':3,'4J':4,
  '1T':1,'1S':1,'1Lo':1,'1F':1,'1Lz':1,'1A':1.5,
  '2T':2,'2S':2,'2Lo':2,'2F':2,'2Lz':2,'2A':2.5,
  '3T':3,'3S':3,'3Lo':3,'3F':3,'3Lz':3,'3A':3.5
};

export async function analyzeVideo(video,onProgress=()=>{}){
  const metrics=await baseAnalyzeVideo(video,onProgress);
  return {
    ...metrics,
    version:3,
    trackingConfidence:metrics.confidence,
    confidence:Math.min(metrics.confidence,76)
  };
}

export function estimateElement(rotation,selected='auto'){
  return baseEstimateElement(rotation,selected);
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

  const strongHeight=metrics.height>=target.h;
  const enoughLength=metrics.lengthBodies>=target.l*.85;
  const strongLength=metrics.lengthBodies>=target.l;
  const enoughHeight=metrics.height>=target.h*.88;
  if((strongHeight&&enoughLength)||(strongLength&&enoughHeight)){
    positives.push('heightLength');
    reasons.push(['pos','Хороші висота та довжина для цього стрибка']);
  }else if(strongHeight||strongLength||metrics.height>=target.h*.80||metrics.lengthBodies>=target.l*.75){
    reasons.push(['neu','Висота/довжина виглядають достатніми, але без сильного бонусу']);
  }else{
    reasons.push(['neu','Висота або довжина скромні; не штрафую автоматично через перспективу камери']);
  }

  if(metrics.takeoffQuality>=64&&metrics.landingStability>=68){
    positives.push('takeoffLanding');
    reasons.push(['pos','Контрольований take-off і landing']);
  }else if(metrics.landingStability>=42&&metrics.flow>=55){
    reasons.push(['neu','Landing виглядає без явної грубої помилки; низький pose-score не перетворюю на штраф']);
  }else{
    reasons.push(['neu','Take-off / landing не дають автоматичного бонусу']);
  }

  if(metrics.flow>=74&&metrics.smoothness>=68){
    positives.push('effortless');
    reasons.push(['pos','Хороший flow та безперервність руху']);
  }else if(metrics.flow>=55){
    reasons.push(['neu','Flow збережений на прийнятному рівні']);
  }else{
    reasons.push(['neu','Flow важко надійно оцінити з цього ракурсу; автоматичного штрафу немає']);
  }

  if(metrics.bodyControl>=72&&metrics.axisVariation<=8.5){
    positives.push('bodyPosition');
    reasons.push(['pos','Стабільне положення тіла в польоті']);
  }else if(metrics.bodyControl>=58){
    reasons.push(['neu','Положення тіла прийнятне, але без окремого +GOE критерію']);
  }else{
    reasons.push(['neu','Pose-модель бачить нестабільність корпусу, але не штрафую без явної помилки']);
  }

  const deficit=expected-(metrics.rotation||0);
  let rotationCall='uncertain';
  if(manual){
    reasons.push(['neu',`Pose rotation ≈${round(metrics.rotation||0,2)} об. — лише діагностика; q / < / << з неї не визначаю`]);
  }else{
    reasons.push(['neu','Авто-rotation є орієнтовним і не використовується для технічного штрафу']);
  }

  if(flags.hand){reductions.push(1);reasons.push(['neg','Дотик рукою підтверджено'])}
  if(flags.twoFoot){reductions.push(2);reasons.push(['neg','Landing на дві ноги підтверджено'])}
  if(flags.stepOut){reductions.push(3);reasons.push(['neg','Step-out підтверджено'])}
  if(flags.fall){reductions.push(5);reasons.push(['neg','Fall підтверджено'])}

  let goe=positives.length-reductions.reduce((a,b)=>a+b,0);
  goe=clamp(Math.round(goe),-5,3);

  const effectiveConfidence=Math.min(metrics.confidence??60,manual?76:66);
  const rangePad=effectiveConfidence>=72?1:2;
  const goeLow=clamp(goe-rangePad,-5,5);
  const goeHigh=clamp(goe+rangePad,-5,5);

  if(!manual)reasons.unshift(['neu','Для точнішого GOE вибери конкретний елемент у списку']);

  return {
    goe,goeLow,goeHigh,reasons,
    deficit:round(deficit,2),expected,
    positives:positives.length,
    reductions:reductions.reduce((a,b)=>a+b,0),
    rotationCall,
    confidence:effectiveConfidence,
    unmeasured:[
      'q / < / << — поки не визначаю лише з MediaPipe pose rotation',
      'Складність/оригінальність входу та виходу',
      'Відповідність елемента музиці',
      'Ребро Flip/Lutz без спеціального ракурсу'
    ]
  };
}
