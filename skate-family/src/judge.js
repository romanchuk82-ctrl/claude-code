import { analyzeProgram, scoreProgram, PROGRAM_TYPES, ELEMENT_OPTIONS, formatTime } from './programJudge.js';
import { saveAnalysis } from './db.js';

const app=document.querySelector('#judgeApp');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let state={file:null,url:null,program:null,programType:'womenFS',busy:false};

function render(){
  app.innerHTML=`<div class="app judge-app">
    <header class="topbar"><div class="brand"><div><div class="logo"><div class="logo-mark">⛸</div><div>SKATE</div></div><div class="sub">ISU Judge · повний виступ</div></div><a class="judge-back" href="/">‹ Назад</a></div></header>
    <main>${state.url?judgeView():startView()}</main>
  </div>`;
  bind();
}

function startView(){
  return `<section class="hero"><div class="hero-badge">ESTIMATED ISU PANEL · 2026/27</div><h1>Оціни весь виступ.</h1><p>Повне відео → технічні елементи, GOE, TES, PCS, deductions і Total Segment Score.</p></section>
  <div class="section-title"><h2>Відео програми</h2><span>обробка на iPhone</span></div>
  <section class="card featured-card"><div class="feature-icon">🏆</div><div class="feature-copy"><h3>Суддівська панель</h3><p>Обери повний виступ. SKATE пройде відео, знайде кандидати на елементи та складе редагований протокол.</p></div>
    <input id="programLibrary" type="file" accept="video/*" hidden>
    <button class="primary" id="pickProgram">Обрати відео виступу</button>
    <div class="feature-tags"><span>TES</span><span>GOE −5…+5</span><span>PCS</span><span>Protocol</span></div>
    <p class="notice">Це Estimated ISU-style оцінка, не офіційний протокол. Тип стрибка, рівень обертання та доріжку кроків можна підтвердити або виправити після аналізу.</p>
  </section>`;
}

function judgeView(){
  return `<div class="section-title"><h2>ISU Judge</h2><span>${state.program?'протокол':'підготовка'}</span></div>
  <section class="card"><div class="video-wrap program-video"><video id="programVideo" src="${state.url}" playsinline controls preload="metadata"></video></div>
    <div class="field program-type"><label>Формат оцінки</label><select id="programType">${Object.entries(PROGRAM_TYPES).map(([k,v])=>`<option value="${k}" ${state.programType===k?'selected':''}>${v.label}</option>`).join('')}</select></div>
    <button class="primary" id="runProgram" ${state.busy?'disabled':''}>${state.program?'Проаналізувати заново':'Запустити суддівську панель'}</button>
    <button class="secondary judge-change" id="changeVideo">Інше відео</button><input id="programLibrary" type="file" accept="video/*" hidden>
    <div id="programProgress" class="progress ${state.busy?'':'hidden'}"><div class="bar"><div id="programBar"></div></div><div class="progress-text" id="programProgressText">Готую відео…</div></div>
    <p class="notice">Відео не завантажується на сервер. Для довгого виступу тримай SKATE відкритим під час аналізу.</p>
  </section>${state.program?programResult():''}`;
}

function optionHtml(selected){return ELEMENT_OPTIONS.map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join('')}

function programResult(){
  const p=state.program,s=scoreProgram(p,state.programType);
  const conf=p.confidence>=80?['Висока','high']:p.confidence>=55?['Середня','medium']:['Низька','low'];
  const pending=s.elements.filter(x=>!x.code||x.needsConfirm).length;
  return `<div class="section-title"><h2>Протокол виступу</h2><span>Estimated · 2026/27</span></div>
  <section class="card total-card"><div><div class="k">TOTAL SEGMENT SCORE</div><div class="big-total">${s.total.toFixed(2)}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${p.confidence}%</span></div><div class="score-stack"><div><span>TES</span><b>${s.tes.toFixed(2)}</b></div><div><span>PCS</span><b>${s.pcs.toFixed(2)}</b></div><div><span>DED</span><b>−${s.deductions.toFixed(2)}</b></div></div></section>
  <div class="protocol-status"><span class="dot ${pending?'warn':'ok'}"></span>${pending?`${pending} елементів варто підтвердити`:'Елементи підтверджені'}</div>
  <section class="card protocol-card"><div class="protocol-head"><span># / час</span><span>Елемент</span><span>GOE</span><span>Score</span><span></span></div>
    ${s.elements.length?s.elements.map((x,i)=>row(x,i)).join(''):'<div class="empty">Автоматично не знайдено технічних елементів. Додай їх вручну на потрібному місці відео.</div>'}
    <button class="secondary add-element" id="addProgramElement">+ Додати елемент на поточному кадрі</button>
  </section>
  <div class="section-title"><h2>Program Components</h2><span>factor × ${s.factor}</span></div>
  <div class="pcs-grid">${pcsCard('composition','Composition',p.pcs.composition)}${pcsCard('presentation','Presentation',p.pcs.presentation)}${pcsCard('skatingSkills','Skating Skills',p.pcs.skatingSkills)}</div>
  <p class="notice">PCS можна підправити кнопками − / + по 0.25. Це корисно, якщо тренер або суддя хоче скоригувати автоматичну оцінку.</p>
  <div class="section-title"><h2>Deductions</h2><span>falls</span></div><section class="card"><div class="deduction-row"><div><b>Падіння</b><p>У цьому режимі −1.00 за кожне</p></div><div class="stepper"><button data-fall="-1">−</button><strong>${p.fallCount||0}</strong><button data-fall="1">+</button></div></div></section>
  <section class="card judge-note"><b>Як читати результат</b><p>AI автоматично знаходить кандидати на стрибки та обертання і дає Estimated GOE/PCS. Technical Panel залишається редагованою: виправ код елемента, GOE або видали помилковий елемент - TES і Total перерахуються одразу.</p></section>
  <button class="primary" id="saveProgram">Зберегти протокол в історію SKATE</button>`;
}

function pcsCard(key,label,value){return `<div class="pcs-card"><span>${label}</span><b>${value.toFixed(2)}</b><small>/10</small><div class="pcs-step"><button data-pcs="${key}" data-delta="-.25">−</button><button data-pcs="${key}" data-delta=".25">+</button></div></div>`}

function row(x,i){
  const hint=x.needsConfirm||!x.code?`<small class="needs-confirm">${x.suggestion||'підтвердити'}</small>`:'';
  return `<div class="protocol-row judge-row" data-id="${x.id}"><button class="time-chip" data-seek="${x.time||0}"><b>${i+1}</b>${formatTime(x.time||0)}</button><div class="protocol-element"><select class="protocol-select" data-id="${x.id}">${optionHtml(x.code)}</select>${hint}${x.x?'<span class="x-badge">x · 10%</span>':''}</div><div class="goe-stepper"><button class="goe-btn" data-id="${x.id}" data-goe="-1">−</button><b class="${x.goe>0?'positive':x.goe<0?'negative':''}">${x.goe>0?'+':''}${x.goe}</b><button class="goe-btn" data-id="${x.id}" data-goe="1">+</button></div><div class="row-score"><b>${x.score.toFixed(2)}</b><small>BV ${x.base.toFixed(2)}</small></div><button class="delete-element" data-delete="${x.id}" aria-label="Видалити">×</button></div>`;
}

function bind(){
  document.querySelector('#pickProgram')?.addEventListener('click',()=>document.querySelector('#programLibrary').click());
  document.querySelector('#changeVideo')?.addEventListener('click',()=>document.querySelector('#programLibrary').click());
  document.querySelector('#programLibrary')?.addEventListener('change',e=>chooseFile(e.target.files?.[0]));
  document.querySelector('#programType')?.addEventListener('change',e=>{state.programType=e.target.value;render()});
  document.querySelector('#runProgram')?.addEventListener('click',runAnalysis);
  document.querySelectorAll('.protocol-select').forEach(x=>x.onchange=()=>updateElement(x.dataset.id,{code:x.value,needsConfirm:false}));
  document.querySelectorAll('.goe-btn').forEach(x=>x.onclick=()=>changeGOE(x.dataset.id,Number(x.dataset.goe)));
  document.querySelectorAll('[data-delete]').forEach(x=>x.onclick=()=>{state.program.elements=state.program.elements.filter(e=>e.id!==x.dataset.delete);render()});
  document.querySelectorAll('[data-seek]').forEach(x=>x.onclick=()=>{const v=document.querySelector('#programVideo');if(v){v.currentTime=Number(x.dataset.seek)||0;v.play().catch(()=>{})}});
  document.querySelectorAll('[data-fall]').forEach(x=>x.onclick=()=>{state.program.fallCount=clamp((state.program.fallCount||0)+Number(x.dataset.fall),0,10);render()});
  document.querySelectorAll('[data-pcs]').forEach(x=>x.onclick=()=>{const k=x.dataset.pcs;state.program.pcs[k]=Math.round(clamp(state.program.pcs[k]+Number(x.dataset.delta),0,10)*4)/4;render()});
  document.querySelector('#addProgramElement')?.addEventListener('click',addElement);
  document.querySelector('#saveProgram')?.addEventListener('click',saveProgram);
}

function chooseFile(file){
  if(!file)return;
  if(state.url)URL.revokeObjectURL(state.url);
  state.file=file;state.url=URL.createObjectURL(file);state.program=null;state.busy=false;render();
}

function waitMeta(v){return new Promise((res,rej)=>{if(v.readyState>=1&&Number.isFinite(v.duration))return res();v.onloadedmetadata=()=>res();v.onerror=()=>rej(new Error('Не вдалося відкрити відео'))})}

async function runAnalysis(){
  const v=document.querySelector('#programVideo');if(!v)return;
  try{
    await waitMeta(v);
    if(v.duration>360)throw new Error('Поки підтримується виступ до 6 хвилин');
    state.busy=true;render();
    const video=document.querySelector('#programVideo'),bar=document.querySelector('#programBar'),txt=document.querySelector('#programProgressText');
    await waitMeta(video);
    state.program=await analyzeProgram(video,p=>{
      if(bar)bar.style.width=`${p}%`;
      if(txt)txt.textContent=p<20?'Будую карту руху по всій програмі…':p<62?'Шукаю технічні елементи…':p<88?'Перевіряю стрибки та обертання…':'Рахую GOE, TES і PCS…';
    });
    state.busy=false;render();
  }catch(e){state.busy=false;render();toast(e.message||'Помилка аналізу виступу')}
}

function updateElement(id,patch){const x=state.program?.elements?.find(e=>e.id===id);if(!x)return;Object.assign(x,patch);render()}
function changeGOE(id,delta){const x=state.program?.elements?.find(e=>e.id===id);if(!x)return;x.goe=clamp((Number(x.goe)||0)+delta,-5,5);render()}
function addElement(){
  if(!state.program)return;
  const v=document.querySelector('#programVideo');
  const t=Math.min(state.program.duration,Math.max(0,v?.currentTime||0));
  state.program.elements.push({id:crypto.randomUUID(),kind:'manual',time:t,code:'',suggestion:'вручну',goe:0,confidence:100,needsConfirm:true,metrics:{}});
  state.program.elements.sort((a,b)=>a.time-b.time);render();
}

async function saveProgram(){
  if(!state.program)return;
  const scoring=scoreProgram(state.program,state.programType);
  const copy=JSON.parse(JSON.stringify(state.program));
  await saveAnalysis({id:crypto.randomUUID(),kind:'program',profile:'all',createdAt:Date.now(),programType:state.programType,program:copy,scoring});
  toast('Протокол збережено в історію SKATE');
}

function toast(text){const d=document.createElement('div');d.className='toast';d.textContent=text;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
render();
