import { detectJumpCandidates } from './jump-detector.js?v=16';

const PRESETS=[
  {label:'2S + 2T',parts:['2S','2T']},{label:'2S + 2Lo',parts:['2S','2Lo']},{label:'2T + 2T',parts:['2T','2T']},{label:'2Lo + 2T',parts:['2Lo','2T']},{label:'2F + 2T',parts:['2F','2T']},{label:'2F + 2Lo',parts:['2F','2Lo']},{label:'2Lz + 2T',parts:['2Lz','2T']},{label:'2Lz + 2Lo',parts:['2Lz','2Lo']},{label:'2A + 2T',parts:['2A','2T']},{label:'2A + 2Lo',parts:['2A','2Lo']},
  {label:'3S + 2T',parts:['3S','2T']},{label:'3T + 2T',parts:['3T','2T']},{label:'3Lo + 2T',parts:['3Lo','2T']},{label:'3F + 2T',parts:['3F','2T']},{label:'3Lz + 2T',parts:['3Lz','2T']},{label:'3A + 2T',parts:['3A','2T']},
  {label:'2S + 1Eu + 2S',parts:['2S','1Eu','2S']},{label:'2S + 1Eu + 2F',parts:['2S','1Eu','2F']},{label:'2F + 1Eu + 2S',parts:['2F','1Eu','2S']},{label:'2Lz + 1Eu + 2S',parts:['2Lz','1Eu','2S']},{label:'2A + 1Eu + 2S',parts:['2A','1Eu','2S']},{label:'3S + 1Eu + 2S',parts:['3S','1Eu','2S']},{label:'3T + 1Eu + 2S',parts:['3T','1Eu','2S']},{label:'3Lo + 1Eu + 2S',parts:['3Lo','1Eu','2S']},{label:'3F + 1Eu + 2S',parts:['3F','1Eu','2S']},{label:'3Lz + 1Eu + 2S',parts:['3Lz','1Eu','2S']},
  {label:'2Lz + 2T + 2Lo',parts:['2Lz','2T','2Lo']},{label:'2F + 2T + 2Lo',parts:['2F','2T','2Lo']},{label:'2A + 2T + 2Lo',parts:['2A','2T','2Lo']},{label:'3S + 2T + 2Lo',parts:['3S','2T','2Lo']},{label:'3T + 2T + 2Lo',parts:['3T','2T','2Lo']},{label:'3Lz + 2T + 2Lo',parts:['3Lz','2T','2Lo']}
];

let selectedPreset='';
let detecting=false;

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
  return `<option value="">Авто — шукаю 2+ стрибки</option><optgroup label="Знаю лише кількість"><option value="count:2">Каскад із 2 стрибків</option><option value="count:3">Каскад із 3 стрибків</option></optgroup>${group('Готові каскади — 2 стрибки',PRESETS.filter(x=>x.parts.length===2))}${group('Готові каскади — 3 стрибки',PRESETS.filter(x=>x.parts.length===3))}`;
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

function syncRunGuard(){
  const run=document.querySelector('#run'),add=document.querySelector('#addMarker');
  if(!run||!add)return;
  const selects=[...document.querySelectorAll('.markerElement')];
  selects.forEach(s=>{
    ensureEulerOption(s);
    if(!s.dataset.skateGuardBound){s.dataset.skateGuardBound='1';s.addEventListener('change',()=>setTimeout(syncRunGuard,0))}
  });
  if(selects.length<2)return;
  const unknown=selects.filter(s=>s.value==='auto').length;
  if(unknown){
    run.dataset.structureGuard='1';run.disabled=true;
    run.textContent=`Вибери типи ${selects.length} стрибків`;
    let note=document.querySelector('[data-structure-guard-note]');
    if(!note){note=document.createElement('div');note.dataset.structureGuardNote='1';note.style.cssText='font-size:11px;line-height:1.4;margin-top:8px;padding:9px 10px;border-radius:11px;background:#fff6dd;color:#70510d;font-weight:750';run.insertAdjacentElement('beforebegin',note)}
    note.textContent='GOE не рахується, поки тип кожного знайденого стрибка не підтверджений.';
  }else{
    if(run.dataset.structureGuard==='1'){run.disabled=false;run.textContent=`Аналізувати ${selects.length} стрибки`;delete run.dataset.structureGuard}
    document.querySelector('[data-structure-guard-note]')?.remove();
  }
}

function applyPreset(parts){
  if(!parts?.length)return false;
  const selects=[...document.querySelectorAll('.markerElement')];selects.forEach(ensureEulerOption);
  if(selects.length!==parts.length)return false;
  parts.forEach((part,i)=>{selects[i].value=part;selects[i].dispatchEvent(new Event('change',{bubbles:true}))});
  setTimeout(syncRunGuard,0);return true;
}

async function autoDetect(button,status){
  if(detecting)return;
  const video=document.querySelector('#video');if(!video)return;
  detecting=true;button.disabled=true;
  const original=button.textContent;
  try{
    const sel=selection();
    status.textContent='SKATE переглядає відео. Для каскаду окремо перевіряю слабший другий відрив…';
    const found=await detectJumpCandidates(video,{expectedCount:sel.expectedCount,seriesMode:true,onProgress:p=>{button.textContent=`Шукаю стрибки… ${p}%`}});
    if(!found.length)throw new Error('Не вдалося впевнено знайти стрибки автоматично');

    clearMarkers();await wait(60);
    for(let i=0;i<found.length;i++){
      await seekLive(found[i].time);
      const add=document.querySelector('#addMarker');if(!add)throw new Error('Не вдалося додати знайдений стрибок');
      add.click();await wait(70);
    }

    const applied=sel.parts?applyPreset(sel.parts):false;
    const avgConfidence=Math.round(found.reduce((s,x)=>s+(x.confidence||55),0)/found.length);
    if(sel.expectedCount&&found.length!==sel.expectedCount){
      status.textContent=`Знайдено ${found.length}, очікувалось ${sel.expectedCount}. Перевір мітки нижче або додай пропущений вручну.`;
    }else if(applied){
      status.textContent=`Готово: знайдено ${found.length}. ${sel.parts.join(' + ')} підставлено автоматично · довіра пошуку ${avgConfidence}%.`;
    }else if(found.length===1){
      status.textContent='SKATE бачить лише один достатньо надійний відрив. Другий можна додати вручну, але GOE не буде вигаданий автоматично.';
    }else{
      status.textContent=`Готово: знайдено ${found.length} ${found.length<5?'стрибки':'стрибків'} · довіра пошуку ${avgConfidence}%. Тепер підтвердь тип кожного.`;
    }
    syncRunGuard();
    toast(`Знайдено ${found.length} ${found.length===1?'стрибок':'стрибки'}`);
  }catch(e){
    status.textContent='Автопошук не змінив твої мітки. Можна спробувати ще раз або додати лише пропущений стрибок вручну.';
    toast(e.message||'Не вдалося знайти стрибки');
  }finally{
    detecting=false;button.disabled=false;button.textContent=original;syncRunGuard();
  }
}

function enhance(){
  const add=document.querySelector('#addMarker');if(!add)return;
  document.querySelectorAll('.markerElement').forEach(ensureEulerOption);
  syncRunGuard();
  const parent=add.parentElement;if(!parent||parent.querySelector('[data-cascade-presets]'))return;

  add.textContent='＋ Додати пропущений стрибок вручну';
  add.style.marginTop='8px';

  const wrap=document.createElement('div');wrap.dataset.cascadePresets='1';wrap.style.cssText='margin-bottom:10px;border:1px solid var(--line);border-radius:16px;padding:12px;background:#f8fbfd';
  wrap.innerHTML=`<label style="display:block;font-size:11px;font-weight:900;color:var(--muted);letter-spacing:.04em;margin-bottom:6px">КАСКАД / СЕРІЯ</label><select id="cascadePreset" style="width:100%;border:1px solid var(--line);border-radius:11px;padding:11px;background:white;font-weight:800;color:#102231">${presetOptions()}</select><button id="autoFindJumps" class="primary" style="margin-top:10px">✨ Знайти стрибки автоматично</button><div id="autoFindStatus" style="font-size:11px;color:var(--muted);margin-top:7px;line-height:1.4">У режимі «Кілька стрибків» SKATE шукає не лише сильний перший відрив, а й слабший наступний у каскаді.</div>`;
  parent.insertBefore(wrap,add);

  const select=wrap.querySelector('#cascadePreset');select.value=selectedPreset;
  select.addEventListener('change',e=>{
    selectedPreset=e.target.value;
    const sel=selection();
    if(sel.parts&&applyPreset(sel.parts))toast(`Обрано ${sel.parts.join(' + ')}`);
    const status=wrap.querySelector('#autoFindStatus');
    if(sel.parts&&!document.querySelectorAll('.markerElement').length)status.textContent=`Обрано ${sel.parts.join(' + ')}. Натисни «Знайти стрибки автоматично».`;
    else if(sel.expectedCount&&!sel.parts)status.textContent=`SKATE шукатиме рівно ${sel.expectedCount} стрибки. Після пошуку залишиться вибрати їх типи.`;
    else if(!sel.expectedCount)status.textContent='Авто-режим шукає 2+ стрибки та робить окремий повторний пошук слабшого другого відриву.';
    syncRunGuard();
  });
  const button=wrap.querySelector('#autoFindJumps'),status=wrap.querySelector('#autoFindStatus');button.addEventListener('click',()=>autoDetect(button,status));
}

const observer=new MutationObserver(()=>enhance());observer.observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('DOMContentLoaded',enhance);setTimeout(enhance,0);
