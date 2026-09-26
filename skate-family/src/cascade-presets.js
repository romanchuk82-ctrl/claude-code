import { detectJumpCandidates } from './jump-detector.js?v=18';

const PRESETS=[
  {label:'2S + 2T',parts:['2S','2T']},{label:'2S + 2Lo',parts:['2S','2Lo']},{label:'2T + 2T',parts:['2T','2T']},{label:'2Lo + 2T',parts:['2Lo','2T']},{label:'2F + 2T',parts:['2F','2T']},{label:'2F + 2Lo',parts:['2F','2Lo']},{label:'2Lz + 2T',parts:['2Lz','2T']},{label:'2Lz + 2Lo',parts:['2Lz','2Lo']},{label:'2A + 2T',parts:['2A','2T']},{label:'2A + 2Lo',parts:['2A','2Lo']},
  {label:'3S + 2T',parts:['3S','2T']},{label:'3T + 2T',parts:['3T','2T']},{label:'3Lo + 2T',parts:['3Lo','2T']},{label:'3F + 2T',parts:['3F','2T']},{label:'3Lz + 2T',parts:['3Lz','2T']},{label:'3A + 2T',parts:['3A','2T']},
  {label:'2S + 1Eu + 2S',parts:['2S','1Eu','2S']},{label:'2S + 1Eu + 2F',parts:['2S','1Eu','2F']},{label:'2F + 1Eu + 2S',parts:['2F','1Eu','2S']},{label:'2Lz + 1Eu + 2S',parts:['2Lz','1Eu','2S']},{label:'2A + 1Eu + 2S',parts:['2A','1Eu','2S']},{label:'3S + 1Eu + 2S',parts:['3S','1Eu','2S']},{label:'3T + 1Eu + 2S',parts:['3T','1Eu','2S']},{label:'3Lo + 1Eu + 2S',parts:['3Lo','1Eu','2S']},{label:'3F + 1Eu + 2S',parts:['3F','1Eu','2S']},{label:'3Lz + 1Eu + 2S',parts:['3Lz','1Eu','2S']},
  {label:'2Lz + 2T + 2Lo',parts:['2Lz','2T','2Lo']},{label:'2F + 2T + 2Lo',parts:['2F','2T','2Lo']},{label:'2A + 2T + 2Lo',parts:['2A','2T','2Lo']},{label:'3S + 2T + 2Lo',parts:['3S','2T','2Lo']},{label:'3T + 2T + 2Lo',parts:['3T','2T','2Lo']},{label:'3Lz + 2T + 2Lo',parts:['3Lz','2T','2Lo']}
];

const LEARN_KEY='skate-jump-corrections-v1';
let selectedPreset='';
let detecting=false;
let scheduled=false;
let lastFound=[];

function toast(text){
  document.querySelector('.toast')?.remove();
  const d=document.createElement('div');d.className='toast';d.textContent=text;document.body.appendChild(d);setTimeout(()=>d.remove(),3400);
}

function ensureEulerOption(select){
  if([...select.options].some(o=>o.value==='1Eu'))return;
  const opt=document.createElement('option');opt.value='1Eu';opt.textContent='1Eu';
  const auto=[...select.options].findIndex(o=>o.value==='auto');
  if(auto>=0&&select.options[auto+1])select.insertBefore(opt,select.options[auto+1]);else select.appendChild(opt);
}

function presetOptions(){
  const group=(label,list)=>`<optgroup label="${label}">${list.map(x=>`<option value="${x.parts.join('|')}">${x.label}</option>`).join('')}</optgroup>`;
  return `<option value="">Авто — знайти й запропонувати</option><optgroup label="Знаю лише кількість"><option value="count:2">Каскад із 2 стрибків</option><option value="count:3">Каскад із 3 стрибків</option></optgroup>${group('Готові каскади — 2 стрибки',PRESETS.filter(x=>x.parts.length===2))}${group('Готові каскади — 3 стрибки',PRESETS.filter(x=>x.parts.length===3))}`;
}

function selection(){
  if(!selectedPreset)return {parts:null,expectedCount:null};
  if(selectedPreset.startsWith('count:'))return {parts:null,expectedCount:Number(selectedPreset.split(':')[1])||null};
  const parts=selectedPreset.split('|').filter(Boolean);return {parts,expectedCount:parts.length||null};
}

function wait(ms=35){return new Promise(r=>setTimeout(r,ms))}

async function waitMeta(video){
  if(video.readyState>=1&&Number.isFinite(video.duration))return;
  await new Promise((resolve,reject)=>{const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося відкрити відео'))},clean=()=>{video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',bad)};video.addEventListener('loadedmetadata',ok,{once:true});video.addEventListener('error',bad,{once:true})});
}

async function seekLive(t){
  const video=document.querySelector('#video');if(!video)throw new Error('Відео не знайдено');
  await waitMeta(video);
  if(Math.abs(video.currentTime-t)<.02)return;
  await new Promise((resolve,reject)=>{const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося перейти до стрибка'))},clean=()=>{video.removeEventListener('seeked',ok);video.removeEventListener('error',bad)};video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',bad,{once:true});video.currentTime=Math.min(Math.max(0,t),Math.max(0,video.duration-.03))});
}

function clearMarkers(){
  let guard=0;
  while(document.querySelector('.removeMarker')&&guard<12){document.querySelector('.removeMarker').click();guard++}
}

function setText(node,text){if(node&&node.textContent!==text)node.textContent=text}

function loadCorrections(){
  try{const v=JSON.parse(localStorage.getItem(LEARN_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return[]}
}
function saveCorrection(row){
  try{
    const list=loadCorrections();list.push(row);localStorage.setItem(LEARN_KEY,JSON.stringify(list.slice(-40)));
  }catch{}
}
function feature(c,index){
  return [Number(c?.airtime||0),Number(c?.freeLeg||0),Number(c?.footLift||0),Number(c?.hipLift||0),Number(c?.support||0),index===0?0:1];
}
function distance(a,b){
  const scale=[.20,.35,.055,.045,.35,1];
  let s=0;
  for(let i=0;i<scale.length;i++)s+=((Number(a[i]||0)-Number(b[i]||0))/scale[i])**2;
  return Math.sqrt(s/scale.length);
}
function learnedSuggestion(c,index,rotation){
  const f=feature(c,index),rows=loadCorrections().filter(r=>Array.isArray(r.f)&&r.element&&String(r.element).startsWith(String(rotation))&&(r.indexClass===(index===0?'first':'later')));
  if(!rows.length)return null;
  let best=null;
  for(const r of rows){const d=distance(f,r.f);if(!best||d<best.d)best={...r,d}}
  if(!best||best.d>.48)return null;
  return {element:best.element,confidence:Math.round(Math.max(72,94-best.d*42)),learned:true};
}

function bindCorrectionLearning(select,index){
  if(select.dataset.skateLearnBound)return;
  select.dataset.skateLearnBound='1';
  select.addEventListener('change',()=>{
    const original=select.dataset.skateOriginal;
    if(select.dataset.skateSuggested==='1'&&original&&select.value!==original&&select.value!=='auto'&&lastFound[index]){
      saveCorrection({f:feature(lastFound[index],index),element:select.value,from:original,indexClass:index===0?'first':'later',ts:Date.now()});
      select.dataset.skateSuggested='0';
      toast(`Запам'ятала: стрибок ${index+1} — ${select.value}`);
      const status=document.querySelector('#autoFindStatus');
      if(status)setText(status,`Виправлення ${select.value} збережене локально на цьому iPhone. Наступного разу SKATE врахує його для схожого стрибка.`);
    }
  });
}

function syncRunGuard(){
  const run=document.querySelector('#run'),add=document.querySelector('#addMarker');
  if(!run||!add)return;
  const selects=[...document.querySelectorAll('.markerElement')];
  selects.forEach((s,i)=>{
    ensureEulerOption(s);bindCorrectionLearning(s,i);
    if(!s.dataset.skateGuardBound){s.dataset.skateGuardBound='1';s.addEventListener('change',scheduleEnhance,{passive:true})}
  });
  if(selects.length<2){document.querySelector('[data-structure-guard-note]')?.remove();return}
  const unknown=selects.filter(s=>s.value==='auto').length;
  if(unknown){
    run.dataset.structureGuard='1';if(!run.disabled)run.disabled=true;setText(run,`Вибери типи ${selects.length} стрибків`);
    let note=document.querySelector('[data-structure-guard-note]');
    if(!note){note=document.createElement('div');note.dataset.structureGuardNote='1';note.style.cssText='font-size:11px;line-height:1.4;margin-top:8px;padding:9px 10px;border-radius:11px;background:#fff6dd;color:#70510d;font-weight:750';run.insertAdjacentElement('beforebegin',note)}
    setText(note,'SKATE не зміг запропонувати тип для одного зі стрибків. Обери його вручну.');
  }else{
    if(run.dataset.structureGuard==='1'){if(run.disabled)run.disabled=false;setText(run,`Аналізувати ${selects.length} стрибки`);delete run.dataset.structureGuard}
    document.querySelector('[data-structure-guard-note]')?.remove();
  }
}

function applyPreset(parts){
  if(!parts?.length)return false;
  const selects=[...document.querySelectorAll('.markerElement')];selects.forEach(ensureEulerOption);
  if(selects.length!==parts.length)return false;
  parts.forEach((part,i)=>{if(selects[i].value!==part){selects[i].value=part;selects[i].dispatchEvent(new Event('change',{bubbles:true}))}});
  scheduleEnhance();return true;
}

function inferRotation(found,index){
  const c=found[index]||{},firstAir=found[0]?.airtime||0,air=c.airtime||0;
  if(index===1&&found.length===3&&air<.22)return 1;
  if(index===0){if(air>=.47)return 3;if(air>=.255)return 2;return 1}
  if(firstAir>=.47)return air>=.13?2:1;
  if(firstAir>=.255)return air>=.115?2:1;
  if(air>=.40)return 3;if(air>=.225)return 2;return 1;
}

function inferType(found,index,rotation){
  const c=found[index]||{};
  const freeLeg=Number.isFinite(c.freeLeg)?c.freeLeg:.45;
  const footLift=Number.isFinite(c.footLift)?c.footLift:0;
  const hipLift=Number.isFinite(c.hipLift)?c.hipLift:0;
  if(found.length===3&&index===1&&rotation===1&&(c.airtime||0)<.22)return 'Eu';

  if(index>0){
    if(freeLeg<.21&&footLift<.020&&hipLift>.020)return 'Lo';
    return 'T';
  }

  // First jump: Salchow is the safe edge-jump default unless pose gives a very strong
  // toe-loop or loop cue. Previous thresholds over-called Toe Loop on Salchow take-offs.
  if(freeLeg<.16&&footLift<.018&&hipLift>.022)return 'Lo';
  if(footLift>.090&&freeLeg<.42&&hipLift>.012)return 'T';
  return 'S';
}

function suggestElements(found){
  return found.map((c,i)=>{
    const rotation=inferRotation(found,i);
    const learned=learnedSuggestion(c,i,rotation);
    if(learned)return learned;
    const type=inferType(found,i,rotation);
    const element=type==='Eu'?'1Eu':`${rotation}${type}`;
    const confidence=Math.max(34,Math.min(i===0?62:72,Math.round((c.confidence||50)*.52+(i===0?12:18))));
    return {element,confidence,learned:false};
  });
}

function applySuggestions(found){
  const selects=[...document.querySelectorAll('.markerElement')];selects.forEach(ensureEulerOption);
  if(selects.length!==found.length||!found.length)return null;
  const suggestions=suggestElements(found);
  suggestions.forEach((suggestion,i)=>{
    const select=selects[i];if(![...select.options].some(o=>o.value===suggestion.element))return;
    select.value=suggestion.element;select.dataset.skateSuggested='1';select.dataset.skateOriginal=suggestion.element;select.dataset.skateLearned=suggestion.learned?'1':'0';
    bindCorrectionLearning(select,i);select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  scheduleEnhance();return suggestions;
}

async function autoDetect(button,status){
  if(detecting)return;
  const video=document.querySelector('#video');if(!video)return;
  detecting=true;button.disabled=true;const original=button.textContent;
  try{
    const sel=selection();
    setText(status,sel.expectedCount===3?'SKATE шукає три відриви й потім запропонує тип кожного…':'SKATE шукає два відриви й потім сам запропонує, які це стрибки…');
    const found=await detectJumpCandidates(video,{expectedCount:sel.expectedCount,seriesMode:true,onProgress:p=>setText(button,`Шукаю стрибки… ${p}%`)});
    if(!found.length)throw new Error('Не вдалося впевнено знайти стрибки автоматично');
    lastFound=found;

    clearMarkers();await wait(40);
    for(let i=0;i<found.length;i++){
      await seekLive(found[i].time);const add=document.querySelector('#addMarker');if(!add)throw new Error('Не вдалося додати знайдений стрибок');add.click();await wait(45);
    }

    const applied=sel.parts?applyPreset(sel.parts):false;
    const suggestions=!applied?applySuggestions(found):null;
    const avgConfidence=Math.round(found.reduce((s,x)=>s+(x.confidence||55),0)/found.length);

    if(sel.expectedCount&&found.length!==sel.expectedCount){
      setText(status,`Знайдено ${found.length}, очікувалось ${sel.expectedCount}. Перевір кількість і типи нижче.`);
    }else if(applied){
      setText(status,`Готово: знайдено ${found.length}. ${sel.parts.join(' + ')} підставлено автоматично · довіра пошуку ${avgConfidence}%.`);
    }else if(suggestions?.length){
      const label=suggestions.map(x=>x.element).join(' + '),learned=suggestions.some(x=>x.learned);
      setText(status,`SKATE пропонує: ${label}.${learned?' Враховано твої попередні виправлення.':''} Якщо не згоден — зміни список біля стрибка. Я запам'ятаю виправлення на цьому iPhone.`);
    }else if(found.length===1){
      setText(status,'SKATE бачить лише один надійний відрив. Тип можна змінити у списку нижче.');
    }else setText(status,`Готово: знайдено ${found.length}. Обери типи вручну.`);
    syncRunGuard();
    toast(suggestions?.length?`Пропозиція: ${suggestions.map(x=>x.element).join(' + ')}`:`Знайдено ${found.length} стрибки`);
  }catch(e){
    setText(status,'Автопошук не змінив твої мітки. Можна спробувати ще раз або додати лише пропущений стрибок вручну.');toast(e.message||'Не вдалося знайти стрибки');
  }finally{detecting=false;button.disabled=false;setText(button,original);syncRunGuard()}
}

function enhance(){
  const add=document.querySelector('#addMarker');if(!add)return;
  document.querySelectorAll('.markerElement').forEach((s,i)=>{ensureEulerOption(s);bindCorrectionLearning(s,i)});
  syncRunGuard();
  const parent=add.parentElement;if(!parent||parent.querySelector('[data-cascade-presets]'))return;
  setText(add,'＋ Додати пропущений стрибок вручну');add.style.marginTop='8px';add.style.touchAction='manipulation';

  const wrap=document.createElement('div');wrap.dataset.cascadePresets='1';wrap.style.cssText='margin-bottom:10px;border:1px solid var(--line);border-radius:16px;padding:12px;background:#f8fbfd';
  wrap.innerHTML=`<label style="display:block;font-size:11px;font-weight:900;color:var(--muted);letter-spacing:.04em;margin-bottom:6px">КАСКАД / СЕРІЯ</label><select id="cascadePreset" style="width:100%;border:1px solid var(--line);border-radius:11px;padding:11px;background:white;font-weight:800;color:#102231;touch-action:manipulation">${presetOptions()}</select><button id="autoFindJumps" class="primary" style="margin-top:10px;touch-action:manipulation">✨ Знайти й визначити стрибки</button><div id="autoFindStatus" style="font-size:11px;color:var(--muted);margin-top:7px;line-height:1.4">SKATE знайде відриви і запропонує типи. Якщо виправиш тип — програма запам'ятає це локально на iPhone і використає для схожих стрибків.</div>`;
  parent.insertBefore(wrap,add);

  const select=wrap.querySelector('#cascadePreset');select.value=selectedPreset;
  select.addEventListener('change',e=>{
    selectedPreset=e.target.value;const sel=selection();if(sel.parts&&applyPreset(sel.parts))toast(`Обрано ${sel.parts.join(' + ')}`);
    const status=wrap.querySelector('#autoFindStatus');
    if(sel.parts&&!document.querySelectorAll('.markerElement').length)setText(status,`Обрано ${sel.parts.join(' + ')}. Натисни «Знайти й визначити стрибки».`);
    else if(sel.expectedCount&&!sel.parts)setText(status,`SKATE шукатиме рівно ${sel.expectedCount} стрибки і запропонує тип кожного.`);
    else if(!sel.expectedCount)setText(status,'SKATE знайде два найімовірніші відриви й запропонує типи. Якщо виправиш — запам’ятає твоє рішення локально.');
    syncRunGuard();
  },{passive:true});
  const button=wrap.querySelector('#autoFindJumps'),status=wrap.querySelector('#autoFindStatus');button.addEventListener('click',()=>autoDetect(button,status));
}

function scheduleEnhance(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance()})}
const app=document.querySelector('#app')||document.documentElement;
const observer=new MutationObserver(mutations=>{if(mutations.some(m=>m.addedNodes.length||m.removedNodes.length))scheduleEnhance()});
observer.observe(app,{subtree:true,childList:true});
window.addEventListener('DOMContentLoaded',scheduleEnhance,{once:true});
scheduleEnhance();
