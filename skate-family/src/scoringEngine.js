const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const round=(v,n=2)=>{const p=10**n;return Math.round((Number(v)||0)*p)/p};

// Shared IJS scoring core. Values used by the May-2026 benchmark correspond to the
// Scale of Values in force for 2025/26. Keep all menus on this engine so the same
// element can never receive different BV/GOE math in single, pass, and program modes.
export const ELEMENT_VALUES={
  '1T':0.40,'1S':0.40,'1Lo':0.50,'1F':0.50,'1Lz':0.60,'1A':1.10,'1Eu':0.50,
  '2T':1.30,'2S':1.30,'2Lo':1.70,'2F':1.80,'2Lz':2.10,'2A':3.30,
  '3T':4.20,'3S':4.30,'3Lo':4.90,'3F':5.30,'3Lz':5.90,'3A':8.00,
  '4T':9.50,'4S':9.70,'4Lo':10.50,'4F':11.00,'4Lz':11.50,'4A':12.50,
  'CCSpB':1.70,'CCSp1':2.00,'CCSp2':2.30,'CCSp3':2.80,'CCSp4':3.20,
  'CCoSpB':1.70,'CCoSp1':2.00,'CCoSp2':2.50,'CCoSp3':3.00,'CCoSp4':3.50,
  'FCSpB':1.60,'FCSp1':1.90,'FCSp2':2.30,'FCSp3':2.80,'FCSp4':3.20,
  'FSSpB':1.70,'FSSp1':2.00,'FSSp2':2.30,'FSSp3':2.60,'FSSp4':3.00,
  'CSpB':1.10,'CSp1':1.40,'CSp2':1.80,'CSp3':2.30,'CSp4':2.60,
  'SSpB':1.10,'SSp1':1.30,'SSp2':1.60,'SSp3':2.10,'SSp4':2.50,
  'LSpB':1.20,'LSp1':1.50,'LSp2':1.90,'LSp3':2.40,'LSp4':2.70,
  'StSqB':1.50,'StSq1':1.80,'StSq2':2.60,'StSq3':3.30,'StSq4':3.90,
  'ChSq1':3.00,'ChSp1':3.00
};

export const PROGRAM_TYPES={
  training:{label:'Тренування · без PCS factor',factor:1,bonusCount:0,ruleset:'2526',level:'training'},
  girlsB2526:{label:'Women B / Girls B · 2025/26 · factor 1.67',factor:1.67,bonusCount:0,ruleset:'2526',level:'development'},
  womenSP:{label:'ISU Women / Girls · Short Program',factor:1.33,bonusCount:1,ruleset:'2526',level:'isu'},
  womenFS:{label:'ISU Women / Girls · Free Skating',factor:2.67,bonusCount:3,ruleset:'2526',level:'isu'}
};

const JUMP_RE=/^(\d)(T|S|Lo|F|Lz|A|Eu)/;
export const isJump=code=>JUMP_RE.test(String(code||'').replace(/^\s+/,''));

function normalizeToken(raw=''){
  return String(raw).trim().replace(/\s+/g,'').replace(/x$/i,'');
}

function downgradeJump(code){
  const m=String(code).match(JUMP_RE);if(!m)return code;
  const n=Number(m[1]);if(n<=1)return '';
  return `${n-1}${m[2]}`;
}

export function tokenBase(raw){
  let token=normalizeToken(raw);
  if(!token||token==='SEQ'||token==='COMBO')return 0;
  if(token.includes('*'))return 0;
  if(ELEMENT_VALUES[token]!=null)return ELEMENT_VALUES[token];
  const under=token.includes('<<')?'<<':token.includes('<')?'<':'';
  const edge=/Lze|Fe/i.test(token);
  token=token.replace(/<<|<|q|!|e|\*/gi,'');
  let base=ELEMENT_VALUES[token];
  if(base==null&&under==='<<')base=ELEMENT_VALUES[downgradeJump(token)]||0;
  if(base==null)return 0;
  if(under==='<<')return round(ELEMENT_VALUES[downgradeJump(token)]||0,2);
  if(under==='<')base*=0.8;
  if(edge&&isJump(token))base*=0.8;
  return round(base,2);
}

export function elementParts(code=''){
  const clean=String(code).replace(/\s+/g,'');
  const sequence=/\+SEQ\b/i.test(clean);
  const combo=/\+COMBO\b/i.test(clean);
  const parts=clean.split('+').filter(x=>x&&x!=='SEQ'&&x!=='COMBO');
  return {clean,parts,sequence,combo,jumpParts:parts.filter(isJump)};
}

export function elementBase(code,{bonus=false}={}){
  const {parts}=elementParts(code);
  let base=round(parts.reduce((s,p)=>s+tokenBase(p),0),2);
  if(bonus&&parts.some(isJump))base=round(base*1.1,2);
  return base;
}

export function goeUnit(code){
  const {parts,jumpParts}=elementParts(code);
  if(/^Ch(Sq|Sp)1/.test(String(code||'')))return 0.50;
  if(jumpParts.length>1)return round(Math.max(...jumpParts.map(tokenBase))*0.1,3);
  if(jumpParts.length===1&&parts.length===1)return round(tokenBase(jumpParts[0])*0.1,3);
  return round(elementBase(code)*0.1,3);
}

export function scoreElement(code,goeGrade=0,{bonus=false}={}){
  const base=elementBase(code,{bonus});
  const unit=goeUnit(code);
  const grade=clamp(Number(goeGrade)||0,-5,5);
  const goePoints=round(unit*grade,2);
  return {code,base,goeGrade:round(grade,2),goeUnit:unit,goePoints,score:round(Math.max(0,base+goePoints),2)};
}

export function panelMean(grades=[]){
  let xs=grades.map(Number).filter(Number.isFinite).map(x=>clamp(x,-5,5));
  if(!xs.length)return 0;
  if(xs.length>=5){xs=[...xs].sort((a,b)=>a-b);xs=xs.slice(1,-1)}
  return round(xs.reduce((s,x)=>s+x,0)/xs.length,3);
}

export function scorePanelElement(code,grades,{bonus=false}={}){
  return scoreElement(code,panelMean(grades),{bonus});
}

export function expectedRotations(code=''){
  const m=String(code).match(/^(\d)(T|S|Lo|F|Lz|A)/);if(!m)return 1;
  return Number(m[1])+(m[2]==='A'?0.5:0);
}

// IMPORTANT: a MediaPipe shoulder-yaw count is not the same thing as the Technical
// Panel's blade-at-contact rotation call. It often under-counts because shoulders
// close before take-off and open immediately after landing. Therefore uncertain
// torso rotation must never create a q / < / << penalty by itself.
export function rotationTechnicalCall(metrics={},code='',override=''){
  const expected=expectedRotations(code);
  const measured=Math.max(0,Number(metrics.rotation)||0);
  const reliability=clamp(Number(metrics.rotationReliability??metrics.rotationConfidence??55),0,100);
  const isAxel=/A(?:q|<|$)/.test(String(code||''));
  const proxyBias=Number.isFinite(Number(metrics.rotationProxyBias))?Number(metrics.rotationProxyBias):(isAxel?.20:.34);
  const rawDeficit=expected-measured;
  const torsoDeficit=Math.max(0,rawDeficit-proxyBias);
  const bladeAlignment=Number(metrics.landingBladeDeficit);
  const bladeConfidence=clamp(Number(metrics.landingBladeConfidence)||0,0,100);
  const manual=String(override||metrics.rotationCallOverride||'').trim();

  if(['clean','q','<','<<'].includes(manual)){
    return {call:manual,label:`Rotation: ${manual}`,source:'confirmed',expected,measured:round(measured,2),rawDeficit:round(rawDeficit,2),deficit:round(torsoDeficit,2),torsoDeficit:round(torsoDeficit,2),bladeDeficit:Number.isFinite(bladeAlignment)?round(bladeAlignment,2):null,bladeConfidence,reliability,proxyBias};
  }

  if(!Number.isFinite(measured)||measured<=0||reliability<45){
    return {call:'review',suggestedCall:'review',label:'Rotation потребує перевірки',source:'proxy',expected,measured:round(measured,2),rawDeficit:round(rawDeficit,2),deficit:round(torsoDeficit,2),torsoDeficit:round(torsoDeficit,2),bladeDeficit:Number.isFinite(bladeAlignment)?round(bladeAlignment,2):null,bladeConfidence,reliability,proxyBias};
  }

  // A clearly complete torso proxy is useful evidence for a clean call.
  if(torsoDeficit<=.14){
    return {call:'clean',suggestedCall:'clean',label:'Rotation: clean',source:'proxy',expected,measured:round(measured,2),rawDeficit:round(rawDeficit,2),deficit:round(torsoDeficit,2),torsoDeficit:round(torsoDeficit,2),bladeDeficit:Number.isFinite(bladeAlignment)?round(bladeAlignment,2):null,bladeConfidence,reliability,proxyBias};
  }

  // For anything near the ISU quarter/half-turn boundaries, this camera proxy is
  // advisory only. We can suggest what to inspect, but do not apply a deduction.
  let suggestedCall='q';
  if(torsoDeficit>.50)suggestedCall='<<';
  else if(torsoDeficit>.30)suggestedCall='<';
  return {call:'review',suggestedCall,label:`Rotation: перевірити ${suggestedCall}`,source:'proxy',expected,measured:round(measured,2),rawDeficit:round(rawDeficit,2),deficit:round(torsoDeficit,2),torsoDeficit:round(torsoDeficit,2),bladeDeficit:Number.isFinite(bladeAlignment)?round(bladeAlignment,2):null,bladeConfidence,reliability,proxyBias};
}

export function estimateGOE(metrics={},code='',flags={}){
  const height=Number(metrics.height)||0,axis=Number(metrics.axis)||0,stability=Number(metrics.stability)||0;
  const rot=rotationTechnicalCall(metrics,code,flags.rotationCall);
  const reasons=[];
  let positive=0;

  if(height>=.28){positive++;reasons.push(['pos','Добра висота / амплітуда'])}
  else if(height<.13)reasons.push(['neg','Низька амплітуда']);
  else reasons.push(['neu','Звичайна амплітуда']);

  if(axis<=9){positive++;reasons.push(['pos','Контрольована вісь'])}
  else if(axis>28)reasons.push(['neg','Сильний нахил осі']);
  else if(axis>18)reasons.push(['neg','Помітний нахил осі']);
  else reasons.push(['neu','Вісь у робочому діапазоні']);

  if(stability>=82){positive++;reasons.push(['pos','Контрольований виїзд'])}
  else if(stability<30)reasons.push(['neg','Нестабільний виїзд'])
  else if(stability<58)reasons.push(['neg','Виїзд потребує контролю'])
  else reasons.push(['neu','Приземлення без великої помилки']);

  if(rot.call==='clean')reasons.push(['neu','Rotation близька до повної']);
  else if(rot.call==='q')reasons.push(['neg','q: близько ¼ недокруту']);
  else if(rot.call==='<')reasons.push(['neg','<: більше ¼, менше ½']);
  else if(rot.call==='<<')reasons.push(['neg','<<: близько ½ або більше']);
  else reasons.push(['neu',`Rotation не штрафую автоматично — ${rot.suggestedCall==='review'?'потрібен чіткіший кадр леза':`перевірити ${rot.suggestedCall}`}`]);

  let grade=positive>=3?1:0;
  if(positive>=3&&height>=.36&&stability>=90&&axis<=5)grade=2;

  if(height<.13)grade-=1;
  if(axis>28)grade-=2;else if(axis>18)grade-=1;
  const hasExplicitLanding=flags.hand||flags.twoFoot||flags.stepOut||flags.fall;
  if(!hasExplicitLanding){if(stability<30)grade-=2;else if(stability<58)grade-=1}
  if(rot.call==='q')grade-=2;
  else if(rot.call==='<')grade-=rot.deficit>=.40?3:2;
  else if(rot.call==='<<')grade-=rot.deficit>=.65?4:3;

  if(flags.hand){grade-=1;reasons.push(['neg','Дотик рукою / вільною ногою'])}
  if(flags.twoFoot){grade-=2;reasons.push(['neg','Приземлення на дві ноги'])}
  if(flags.stepOut){grade-=3;reasons.push(['neg','Step-out'])}
  if(flags.fall){grade-=5;reasons.push(['neg','Fall'])}

  // A fully automatic camera estimate must not invent an extreme -5 from proxy
  // metrics alone. -5 remains available for confirmed technical/landing errors.
  if(rot.source!=='confirmed'&&!hasExplicitLanding)grade=Math.max(grade,-3);
  grade=clamp(Math.round(grade),-5,5);
  const suffix=rot.call==='q'?'q':rot.call==='<'?'<':rot.call==='<<'?'<<':'';
  const technicalCode=suffix?`${code}${suffix}`:code;
  return {goe:grade,goeGrade:grade,reasons,deficit:rot.deficit,rawDeficit:rot.rawDeficit,expected:rot.expected,rotationCall:rot.call,rotationSuggestedCall:rot.suggestedCall||rot.call,rotationReliability:rot.reliability,technicalCode,scoring:scoreElement(technicalCode,grade)};
}

export function scoreProgramShared(program,type='womenFS'){
  const rule=PROGRAM_TYPES[type]||PROGRAM_TYPES.womenFS;
  const rows=(program.elements||[]).map(x=>({...x,x:false})).sort((a,b)=>(a.time||0)-(b.time||0));
  if(rule.bonusCount>0){
    const eligible=rows.filter(x=>elementParts(x.code).jumpParts.length&&(x.time||0)>(program.duration||0)/2);
    eligible.slice(-rule.bonusCount).forEach(x=>x.x=true);
  }
  let tes=0;
  const elements=rows.map(x=>{
    const grade=Number.isFinite(Number(x.goeGrade))?Number(x.goeGrade):Number(x.goe)||0;
    const s=scoreElement(x.code,grade,{bonus:x.x});tes+=s.score;
    return {...x,...s,goe:grade,goeGrade:grade};
  });
  tes=round(tes,2);
  const p=program.pcs||{composition:0,presentation:0,skatingSkills:0};
  const pcs=round(((Number(p.composition)||0)+(Number(p.presentation)||0)+(Number(p.skatingSkills)||0))*rule.factor,2);
  const deductions=round((Number(program.fallCount)||0)*1,2);
  return {elements,tes,pcs,deductions,total:round(tes+pcs-deductions,2),factor:rule.factor,type};
}

export const SONYA_MAY_2026_BENCHMARK={
  label:'Open Championship Kyiv 07-09.05.2026 · Sofia Romanchuk',
  type:'girlsB2526',
  elements:[
    {code:'2S+1A+SEQ',judges:[0,0,0]},
    {code:'2T',judges:[0,0,0]},
    {code:'2S',judges:[-1,0,0]},
    {code:'CCSp2',judges:[0,1,1]},
    {code:'StSq1',judges:[0,0,1]},
    {code:'1A',judges:[0,0,0]},
    {code:'1Lz+1Lo',judges:[-1,-1,-1]},
    {code:'CCoSp1',judges:[0,0,0]}
  ],
  pcs:{composition:3.75,presentation:3.42,skatingSkills:3.50},
  expected:{base:13.30,tes:13.41,pcs:17.82,total:31.23}
};

export function runScoringBenchmark(){
  const b=SONYA_MAY_2026_BENCHMARK;
  const elements=b.elements.map((x,i)=>({id:String(i+1),time:i*10,code:x.code,goeGrade:panelMean(x.judges)}));
  const base=round(elements.reduce((s,x)=>s+elementBase(x.code),0),2);
  const result=scoreProgramShared({duration:200,elements,pcs:b.pcs,fallCount:0},b.type);
  const ok=base===b.expected.base&&result.tes===b.expected.tes&&result.pcs===b.expected.pcs&&result.total===b.expected.total;
  return {ok,base,...result,expected:b.expected};
}
