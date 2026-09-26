import { detectJumpCandidates } from './jump-detector.js?v=13';

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
  return `<option value="">Не знаю / окремі стрибки</option>${group('Каскади — 2 стрибки',PRESETS.filter(x=>x.parts.length===2))}${group('Каскади — 3 стрибки',PRESETS.filter(x=>x.parts.length===3))}`;
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

function applyPreset(parts){
  if(!parts?.length)return false;
  const selects=[...document.querySelectorAll('.markerElement')];selects.forEach(ensureEulerOption);
  if(selects.length!==parts.length)return false;
  parts.forEach((part,i)=>{selects[i].value=part;selects[i].dispatchEvent(new Event('change',{bubbles:true}))});
  return true;
}

async function autoDetect(button,status){
  if(detecting)return;
  const video=document.querySelector('#video');if(!video)return;
  detecting=true;button.disabled=true;
  const original=button.textContent;
  try{
    const parts=selectedPreset?selectedPreset.split('|'):null;
    status.textContent='SKATE переглядає відео і шукає моменти відриву…';
    const found=await detectJumpCandidates(video,{expectedCount:parts?.length||null,onProgress:p=>{button.textContent=`Шукаю стрибки… ${p}%`}});
    if(!found.length)throw new Error('Не вдалося впевнено знайти стрибки автоматично');

    clearMarkers();await wait(60);
    for(let i=0;i<found.length;i++){
      await seekLive(found[i].time);
      const add=document.querySelector('#addMarker');if(!add)throw new Error('Не вдалося додати знайдений стрибок');
      add.click();await wait(70);
    }

    const applied=parts?applyPreset(parts):false;
    const expected=parts?.length;
    status.textContent=expected&&found.length!==expected
      ?`Знайдено ${found.length}, а у вибраному каскаді ${expected}. Можеш видалити зайве або додати пропущений вручну.`
      :`Готово: автоматично знайдено ${found.length} ${found.length===2?'стрибки':'стрибків'}. ${applied?'Типи каскаду вже підставлені.':'Перевір типи та натисни «Аналізувати».'}`;
    toast(`Автоматично знайдено ${found.length} стрибки`);
  }catch(e){
    status.textContent='Автопошук не змінив твої мітки. Можна спробувати ще раз або додати лише пропущений стрибок вручну.';
    toast(e.message||'Не вдалося знайти стрибки');
  }finally{
    detecting=false;button.disabled=false;button.textContent=original;
  }
}

function enhance(){
  const add=document.querySelector('#addMarker');if(!add)return;
  const parent=add.parentElement;if(!parent||parent.querySelector('[data-cascade-presets]'))return;
  document.querySelectorAll('.markerElement').forEach(ensureEulerOption);

  add.textContent='＋ Додати пропущений стрибок вручну';
  add.style.marginTop='8px';

  const wrap=document.createElement('div');wrap.dataset.cascadePresets='1';wrap.style.cssText='margin-bottom:10px;border:1px solid var(--line);border-radius:16px;padding:12px;background:#f8fbfd';
  wrap.innerHTML=`<label style="display:block;font-size:11px;font-weight:900;color:var(--muted);letter-spacing:.04em;margin-bottom:6px">КАСКАД / СЕРІЯ</label><select id="cascadePreset" style="width:100%;border:1px solid var(--line);border-radius:11px;padding:11px;background:white;font-weight:800;color:#102231">${presetOptions()}</select><button id="autoFindJumps" class="primary" style="margin-top:10px">✨ Знайти стрибки автоматично</button><div id="autoFindStatus" style="font-size:11px;color:var(--muted);margin-top:7px;line-height:1.4">Не треба перемотувати відео вручну. SKATE сам знайде моменти стрибків, а ти лише перевіриш результат.</div>`;
  parent.insertBefore(wrap,add);

  const select=wrap.querySelector('#cascadePreset');select.value=selectedPreset;
  select.addEventListener('change',e=>{
    selectedPreset=e.target.value;
    if(!selectedPreset)return;
    const parts=selectedPreset.split('|');
    if(applyPreset(parts))toast(`Обрано ${parts.join(' + ')}`);
    else wrap.querySelector('#autoFindStatus').textContent=`Обрано ${parts.join(' + ')}. Натисни «Знайти стрибки автоматично» — SKATE шукатиме ${parts.length} відриви.`;
  });
  const button=wrap.querySelector('#autoFindJumps'),status=wrap.querySelector('#autoFindStatus');button.addEventListener('click',()=>autoDetect(button,status));
}

const observer=new MutationObserver(()=>enhance());observer.observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('DOMContentLoaded',enhance);setTimeout(enhance,0);
