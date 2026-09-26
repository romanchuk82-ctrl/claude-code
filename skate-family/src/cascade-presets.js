const PRESETS=[
  {label:'2S + 2T',parts:['2S','2T']},
  {label:'2S + 2Lo',parts:['2S','2Lo']},
  {label:'2T + 2T',parts:['2T','2T']},
  {label:'2Lo + 2T',parts:['2Lo','2T']},
  {label:'2F + 2T',parts:['2F','2T']},
  {label:'2F + 2Lo',parts:['2F','2Lo']},
  {label:'2Lz + 2T',parts:['2Lz','2T']},
  {label:'2Lz + 2Lo',parts:['2Lz','2Lo']},
  {label:'2A + 2T',parts:['2A','2T']},
  {label:'2A + 2Lo',parts:['2A','2Lo']},
  {label:'3S + 2T',parts:['3S','2T']},
  {label:'3T + 2T',parts:['3T','2T']},
  {label:'3Lo + 2T',parts:['3Lo','2T']},
  {label:'3F + 2T',parts:['3F','2T']},
  {label:'3Lz + 2T',parts:['3Lz','2T']},
  {label:'3A + 2T',parts:['3A','2T']},
  {label:'2S + 1Eu + 2S',parts:['2S','1Eu','2S']},
  {label:'2S + 1Eu + 2F',parts:['2S','1Eu','2F']},
  {label:'2F + 1Eu + 2S',parts:['2F','1Eu','2S']},
  {label:'2Lz + 1Eu + 2S',parts:['2Lz','1Eu','2S']},
  {label:'2A + 1Eu + 2S',parts:['2A','1Eu','2S']},
  {label:'3S + 1Eu + 2S',parts:['3S','1Eu','2S']},
  {label:'3T + 1Eu + 2S',parts:['3T','1Eu','2S']},
  {label:'3Lo + 1Eu + 2S',parts:['3Lo','1Eu','2S']},
  {label:'3F + 1Eu + 2S',parts:['3F','1Eu','2S']},
  {label:'3Lz + 1Eu + 2S',parts:['3Lz','1Eu','2S']},
  {label:'2Lz + 2T + 2Lo',parts:['2Lz','2T','2Lo']},
  {label:'2F + 2T + 2Lo',parts:['2F','2T','2Lo']},
  {label:'2A + 2T + 2Lo',parts:['2A','2T','2Lo']},
  {label:'3S + 2T + 2Lo',parts:['3S','2T','2Lo']},
  {label:'3T + 2T + 2Lo',parts:['3T','2T','2Lo']},
  {label:'3Lz + 2T + 2Lo',parts:['3Lz','2T','2Lo']}
];

function toast(text){
  document.querySelector('.toast')?.remove();
  const d=document.createElement('div');
  d.className='toast';
  d.textContent=text;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),3200);
}

function ensureEulerOption(select){
  if([...select.options].some(o=>o.value==='1Eu'))return;
  const auto=[...select.options].findIndex(o=>o.value==='auto');
  const opt=document.createElement('option');
  opt.value='1Eu';
  opt.textContent='1Eu';
  if(auto>=0&&select.options[auto+1])select.insertBefore(opt,select.options[auto+1]);
  else select.appendChild(opt);
}

function presetOptions(){
  const two=PRESETS.filter(x=>x.parts.length===2);
  const three=PRESETS.filter(x=>x.parts.length===3);
  const group=(label,list)=>`<optgroup label="${label}">${list.map(x=>`<option value="${x.parts.join('|')}">${x.label}</option>`).join('')}</optgroup>`;
  return `<option value="">Свій каскад / вибрати вручну</option>${group('2 стрибки',two)}${group('3 стрибки',three)}`;
}

function enhance(){
  const add=document.querySelector('#addMarker');
  if(!add)return;
  const parent=add.parentElement;
  if(!parent||parent.querySelector('[data-cascade-presets]'))return;

  document.querySelectorAll('.markerElement').forEach(ensureEulerOption);

  const wrap=document.createElement('div');
  wrap.dataset.cascadePresets='1';
  wrap.style.cssText='margin-bottom:10px;border:1px solid var(--line);border-radius:14px;padding:10px;background:#f8fbfd';
  wrap.innerHTML=`<label style="display:block;font-size:11px;font-weight:900;color:var(--muted);letter-spacing:.04em;margin-bottom:6px">КАСКАД / КОМБІНАЦІЯ</label><select id="cascadePreset" style="width:100%;border:1px solid var(--line);border-radius:11px;padding:10px;background:white;font-weight:800;color:#102231">${presetOptions()}</select><div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.35">Можеш вибрати готовий каскад або залишити «Свій» і задати кожен стрибок окремо.</div>`;
  parent.insertBefore(wrap,add);

  wrap.querySelector('#cascadePreset').addEventListener('change',e=>{
    if(!e.target.value)return;
    const parts=e.target.value.split('|');
    const selects=[...document.querySelectorAll('.markerElement')];
    selects.forEach(ensureEulerOption);
    if(selects.length!==parts.length){
      toast(`Для ${parts.join(' + ')} потрібно ${parts.length} мітки на відриви. Зараз: ${selects.length}.`);
      e.target.value='';
      return;
    }
    parts.forEach((part,i)=>{
      selects[i].value=part;
      selects[i].dispatchEvent(new Event('change',{bubbles:true}));
    });
    toast(`Обрано каскад ${parts.join(' + ')}`);
  });
}

const observer=new MutationObserver(()=>enhance());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('DOMContentLoaded',enhance);
setTimeout(enhance,0);
