import { analyzeVideo, estimateElement, estimateGOE } from './analyzer.js';
import { analyzeProgram, scoreProgram, PROGRAM_TYPES, ELEMENT_OPTIONS, formatTime } from './programJudge.js';
import { saveAnalysis, getAnalyses } from './db.js';

let state={
  view:'home',file:null,url:null,metrics:null,element:'auto',flags:{hand:false,twoFoot:false,stepOut:false,fall:false},
  programFile:null,programUrl:null,program:null,programType:'womenFS',
  installPrompt:null,installGuide:false
};
const el=document.querySelector('#app');
const isiOS=/iPhone|iPad|iPod/i.test(navigator.userAgent);
const isStandalone=window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function render(){
  const views={home,analyze:analyzeView,program:programView,history:historyView};
  el.innerHTML=`<div class="app"><header class="topbar"><div class="brand"><div><div class="logo"><div class="logo-mark">⛸</div><div>SKATE</div></div><div class="sub">аналіз фігурного катання</div></div></div></header>
  <main>${(views[state.view]||home)()}</main>${nav()}</div>`;
  bind();
}

function installGuide(){
  if(!state.installGuide)return '';
  return `<section class="card" style="margin-top:12px"><div class="section-title compact"><h2>Додати на iPhone</h2><span>30 секунд</span></div><p class="notice">Важливо: додавання на початковий екран працює з Safari. Якщо сторінка відкрита у вікні ChatGPT, відкрий її в Safari.</p><ol style="padding-left:22px;line-height:1.6"><li>У Safari натисни <b>Поділитися</b> ↑.</li><li>Обери <b>На початковий екран</b>.</li><li>Натисни <b>Додати</b>.</li></ol><button class="secondary" id="closeInstall">Зрозуміло</button></section>`;
}

function home(){
  return `<section class="hero"><div class="hero-badge">ISU PANEL · 2026/27</div><h1>Оціни весь виступ як суддівська панель.</h1><p>Повне відео → технічні елементи, Estimated GOE, TES, PCS, deductions і підсумковий бал.</p></section>
<div class="section-title"><h2>Повний виступ</h2><span>нове · локально</span></div>
<section class="card featured-card"><div class="feature-icon">🏆</div><div class="feature-copy"><h3>ISU Judge</h3><p>Для програми 1–5 хв. AI проходить весь ролик, шукає стрибки та обертання, оцінює якість виконання й компоненти програми.</p></div><input id="programLibrary" type="file" accept="video/*" hidden><button class="primary" id="pickProgram">Оцінити весь виступ</button><div class="feature-tags"><span>TES</span><span>GOE −5…+5</span><span>PCS</span><span>Protocol</span></div><p class="notice">Тип стрибка, spin level і step sequence з одного аматорського відео можуть визначатися неточно. Після AI-аналізу кожен елемент можна підтвердити або виправити - підсумок перерахується миттєво.</p></section>
<div class="section-title"><h2>Окремий стрибок</h2><span>3–10 секунд</span></div><section class="card"><div class="upload"><div class="upload-icon">🎥</div><h3>Додай відео стрибка</h3><p>Усе тіло в кадрі, камера стоїть стабільно.</p><input id="fileLibrary" type="file" accept="video/*" hidden><input id="fileCamera" type="file" accept="video/*" capture="environment" hidden><div class="upload-actions"><button class="primary" id="pickLibrary">Обрати з Фото</button><button class="secondary" id="pickCamera">Зняти зараз</button></div></div>${(!isStandalone?'<button class="secondary install show" id="install">Додати SKATE на екран iPhone</button>':'')}</section>${installGuide()}
<div class="section-title"><h2>Що отримуємо</h2><span>SKATE v2</span></div><div class="metric-grid"><div class="metric"><div class="k">TECHNICAL</div><div class="v">TES</div><div class="d">base value + GOE</div></div><div class="metric"><div class="k">COMPONENTS</div><div class="v">PCS</div><div class="d">3 компоненти</div></div><div class="metric"><div class="k">ELEMENTS</div><div class="v">GOE</div><div class="d">−5…+5</div></div><div class="metric"><div class="k">TOTAL</div><div class="v">IJS</div><div class="d">estimated score</div></div></div>`;
}

function analyzeView(){
  if(!state.url)return home();
  const r=state.metrics?jumpResult():'';
  return `<div class="section-title"><h2>Аналіз стрибка</h2><span>SKATE</span></div><section class="card"><div class="video-wrap"><video id="video" src="${state.url}" playsinline controls preload="auto"></video></div><div class="form-grid one"><div class="field"><label>Елемент</label><select id="element">${['auto','1T','1S','1Lo','1F','1Lz','1A','2T','2S','2Lo','2F','2Lz','2A','3T','3S','3Lo','3F','3Lz','3A','4T','4S','4Lo','4F','4Lz','4A'].map(x=>`<option ${state.element===x?'selected':''} value="${x}">${x==='auto'?'Визначити автоматично':x}</option>`).join('')}</select></div></div><button class="primary" id="run">${state.metrics?'Аналізувати ще раз':'Аналізувати відео'}</button><div id="progress" class="progress hidden"><div class="bar"><div id="bar"></div></div><div class="progress-text" id="progressText">Готую аналіз…</div></div></section>${r}`;
}

function jumpResult(){
  const m=state.metrics;
  const element=estimateElement(m.rotation,state.element);
  const e=estimateGOE(m,element,state.flags);
  const conf=m.confidence>=80?['Висока','high']:m.confidence>=55?['Середня','medium']:['Низька','low'];
  return `<div class="section-title"><h2>Результат</h2><span>${element}</span></div><section class="card score-card"><div class="score-ring" style="--p:${m.quality}"><div style="text-align:center"><strong>${m.quality}</strong><br><span>/100</span></div></div><div><div class="k">Estimated GOE</div><div class="goe">${e.goe>0?'+':''}${e.goe}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${m.confidence}%</span><div class="notice">GOE видно окремо і він рахується за шкалою −5…+5.</div></div></section>
<div class="section-title"><h2>Метрики</h2><span>${m.takeoff}s → ${m.landing}s</span></div><div class="metric-grid"><div class="metric"><div class="k">AIRTIME</div><div class="v">${m.airtime}s</div><div class="d">час у повітрі</div></div><div class="metric"><div class="k">HEIGHT</div><div class="v">${m.height}м</div><div class="d">за airtime</div></div><div class="metric"><div class="k">ROTATION</div><div class="v">${m.rotation}</div><div class="d">очікувано ${e.expected}</div></div><div class="metric"><div class="k">AXIS</div><div class="v">${m.axis}°</div><div class="d">середній нахил</div></div><div class="metric"><div class="k">LANDING</div><div class="v">${m.stability}%</div><div class="d">стабільність</div></div><div class="metric"><div class="k">ДЕФІЦИТ</div><div class="v">${e.deficit}</div><div class="d">rotation</div></div></div>
<div class="section-title"><h2>Чому такий GOE</h2><span>Estimated</span></div><section class="card"><ul class="reason-list">${e.reasons.map(x=>`<li><span class="tag ${x[0]}">${x[0]==='pos'?'+':x[0]==='neg'?'−':'•'}</span>${x[1]}</li>`).join('')}</ul></section>
<div class="section-title"><h2>Уточнити landing</h2><span>якщо камера не побачила</span></div><section class="card"><div class="checks">${[['hand','Дотик рукою'],['twoFoot','Landing на дві ноги'],['stepOut','Step-out'],['fall','Fall']].map(([k,t])=>`<label class="check"><span>${t}</span><input class="switch flag" type="checkbox" data-flag="${k}" ${state.flags[k]?'checked':''}></label>`).join('')}</div><button class="primary" id="save">Зберегти результат</button></section>`;
}

function programView(){
  if(!state.programUrl)return home();
  const result=state.program?programResult():'';
  return `<div class="section-title"><h2>ISU Judge</h2><span>повний виступ</span></div><section class="card"><div class="video-wrap program-video"><video id="programVideo" src="${state.programUrl}" playsinline controls preload="metadata"></video></div><div class="field program-type"><label>Формат оцінки</label><select id="programType">${Object.entries(PROGRAM_TYPES).map(([k,v])=>`<option value="${k}" ${state.programType===k?'selected':''}>${v.label}</option>`).join('')}</select></div><button class="primary" id="runProgram">${state.program?'Проаналізувати заново':'Запустити суддівську панель'}</button><div id="programProgress" class="progress hidden"><div class="bar"><div id="programBar"></div></div><div class="progress-text" id="programProgressText">Готую відео…</div></div><p class="notice">Обробка виконується на цьому iPhone. Відео нікуди не завантажується.</p></section>${result}`;
}

function elementOptions(selected){return ELEMENT_OPTIONS.map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join('')}

function programResult(){
  const p=state.program,s=scoreProgram(p,state.programType);
  const conf=p.confidence>=80?['Висока','high']:p.confidence>=55?['Середня','medium']:['Низька','low'];
  const confirmed=s.elements.filter(x=>x.code).length;
  const pending=s.elements.length-confirmed;
  return `<div class="section-title"><h2>Протокол виступу</h2><span>ISU 2026/27</span></div>
<section class="card total-card"><div><div class="k">TOTAL SEGMENT SCORE</div><div class="big-total">${s.total.toFixed(2)}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${p.confidence}%</span></div><div class="score-stack"><div><span>TES</span><b>${s.tes.toFixed(2)}</b></div><div><span>PCS</span><b>${s.pcs.toFixed(2)}</b></div><div><span>DED</span><b>−${s.deductions.toFixed(2)}</b></div></div></section>
<div class="protocol-status"><span class="dot ${pending?'warn':'ok'}"></span>${confirmed}/${s.elements.length} елементів мають код${pending?` · ${pending} потребують підтвердження`:''}</div>
<section class="card protocol-card"><div class="protocol-head"><span># / час</span><span>Елемент</span><span>GOE</span><span>Score</span></div>${s.elements.length?s.elements.map((x,i)=>protocolRow(x,i)).join(''):'<div class="empty">AI не знайшов технічних елементів. Можна додати їх вручну нижче.</div>'}<button class="secondary add-element" id="addProgramElement">+ Додати елемент вручну</button></section>
<div class="section-title"><h2>Program Components</h2><span>factor × ${s.factor}</span></div><div class="pcs-grid"><div class="pcs-card"><span>Composition</span><b>${p.pcs.composition.toFixed(2)}</b><small>/10</small></div><div class="pcs-card"><span>Presentation</span><b>${p.pcs.presentation.toFixed(2)}</b><small>/10</small></div><div class="pcs-card"><span>Skating Skills</span><b>${p.pcs.skatingSkills.toFixed(2)}</b><small>/10</small></div></div>
<div class="section-title"><h2>Deductions</h2><span>falls</span></div><section class="card"><div class="deduction-row"><div><b>Падіння</b><p>−1.00 за кожне у цьому режимі</p></div><div class="stepper"><button data-fall="-1">−</button><strong>${p.fallCount||0}</strong><button data-fall="1">+</button></div></div></section>
<section class="card judge-note"><b>Що вже робить AI</b><p>Автоматично проходить повне відео, знаходить кандидати на стрибки/обертання, оцінює GOE та три PCS. Для справжньої точності Technical Panel потрібно підтвердити тип стрибка, spin level і StSq/ChSq. Після зміни коду або GOE TES і Total перераховуються одразу.</p></section>
<button class="primary" id="saveProgram">Зберегти протокол</button>`;
}

function protocolRow(x,i){
  const hint=x.needsConfirm||!x.code?`<small class="needs-confirm">${x.suggestion||'підтвердити'}</small>`:'';
  return `<div class="protocol-row" data-id="${x.id}"><button class="time-chip" data-seek="${x.time||0}"><b>${i+1}</b>${formatTime(x.time||0)}</button><div class="protocol-element"><select class="protocol-select" data-id="${x.id}">${elementOptions(x.code)}</select>${hint}${x.x?'<span class="x-badge">x · 10%</span>':''}</div><div class="goe-stepper"><button class="goe-btn" data-id="${x.id}" data-goe="-1">−</button><b class="${x.goe>0?'positive':x.goe<0?'negative':''}">${x.goe>0?'+':''}${x.goe}</b><button class="goe-btn" data-id="${x.id}" data-goe="1">+</button></div><div class="row-score"><b>${x.score.toFixed(2)}</b><small>BV ${x.base.toFixed(2)}</small></div></div>`;
}

function historyView(){
  return `<div class="section-title"><h2>Історія</h2><span>аналізи й протоколи</span></div><section id="history" class="history"><div class="empty">Завантажую…</div></section>`;
}

function nav(){
  return `<nav class="bottom-nav four"><button class="navbtn ${state.view==='home'?'active':''}" data-view="home"><i>⌂</i>Головна</button><button class="navbtn ${state.view==='analyze'?'active':''}" data-view="analyze"><i>◎</i>Стрибок</button><button class="navbtn ${state.view==='program'?'active':''}" data-view="program"><i>🏆</i>Виступ</button><button class="navbtn ${state.view==='history'?'active':''}" data-view="history"><i>◫</i>Історія</button></nav>`;
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();if(state.view==='history')loadHistory()});
  document.querySelector('#pickLibrary')?.addEventListener('click',()=>document.querySelector('#fileLibrary').click());
  document.querySelector('#pickCamera')?.addEventListener('click',()=>document.querySelector('#fileCamera').click());
  document.querySelector('#pickProgram')?.addEventListener('click',()=>document.querySelector('#programLibrary').click());
  document.querySelector('#fileLibrary')?.addEventListener('change',e=>chooseJumpFile(e.target.files?.[0]));
  document.querySelector('#fileCamera')?.addEventListener('change',e=>chooseJumpFile(e.target.files?.[0]));
  document.querySelector('#programLibrary')?.addEventListener('change',e=>chooseProgramFile(e.target.files?.[0]));
  document.querySelector('#run')?.addEventListener('click',runAnalysis);
  document.querySelector('#runProgram')?.addEventListener('click',runProgramAnalysis);
  document.querySelector('#element')?.addEventListener('change',e=>{state.element=e.target.value;if(state.metrics)render()});
  document.querySelector('#programType')?.addEventListener('change',e=>{state.programType=e.target.value;render()});
  document.querySelectorAll('.flag').forEach(x=>x.onchange=()=>{state.flags[x.dataset.flag]=x.checked;render()});
  document.querySelector('#save')?.addEventListener('click',saveCurrent);
  document.querySelector('#saveProgram')?.addEventListener('click',saveCurrentProgram);
  document.querySelector('#addProgramElement')?.addEventListener('click',addProgramElement);
  document.querySelectorAll('.protocol-select').forEach(x=>x.onchange=()=>updateProgramElement(x.dataset.id,{code:x.value,needsConfirm:false}));
  document.querySelectorAll('.goe-btn').forEach(x=>x.onclick=()=>changeGOE(x.dataset.id,Number(x.dataset.goe)));
  document.querySelectorAll('[data-fall]').forEach(x=>x.onclick=()=>{state.program.fallCount=clamp((state.program.fallCount||0)+Number(x.dataset.fall),0,10);render()});
  document.querySelectorAll('[data-seek]').forEach(x=>x.onclick=()=>{const v=document.querySelector('#programVideo');if(v){v.currentTime=Number(x.dataset.seek)||0;v.play().catch(()=>{})}});
  document.querySelector('#install')?.addEventListener('click',installApp);
  document.querySelector('#closeInstall')?.addEventListener('click',()=>{state.installGuide=false;render()});
}

function chooseJumpFile(file){
  if(!file)return;
  if(state.url)URL.revokeObjectURL(state.url);
  state.file=file;state.url=URL.createObjectURL(file);state.metrics=null;state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};state.view='analyze';render();
}
function chooseProgramFile(file){
  if(!file)return;
  if(state.programUrl)URL.revokeObjectURL(state.programUrl);
  state.programFile=file;state.programUrl=URL.createObjectURL(file);state.program=null;state.view='program';render();
}

async function runAnalysis(){
  const v=document.querySelector('#video'),box=document.querySelector('#progress'),bar=document.querySelector('#bar'),txt=document.querySelector('#progressText'),btn=document.querySelector('#run');if(!v)return;
  try{btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);state.metrics=await analyzeVideo(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<25?'Читаю рух…':p<65?'Відстежую положення тіла…':p<90?'Визначаю take-off та landing…':'Рахую метрики й GOE…'});state.element=estimateElement(state.metrics.rotation,state.element);bar.style.width='100%';setTimeout(render,200)}catch(e){toast(e.message||'Помилка аналізу');btn.disabled=false;box.classList.add('hidden')}
}

async function runProgramAnalysis(){
  const v=document.querySelector('#programVideo'),box=document.querySelector('#programProgress'),bar=document.querySelector('#programBar'),txt=document.querySelector('#programProgressText'),btn=document.querySelector('#runProgram');if(!v)return;
  try{
    btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);
    if(v.duration>360)throw new Error('Поки підтримується виступ до 6 хвилин');
    state.program=await analyzeProgram(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<20?'Будую карту руху по всій програмі…':p<62?'Шукаю технічні елементи…':p<88?'Перевіряю стрибки та обертання…':'Рахую GOE, TES і PCS…'});
    bar.style.width='100%';setTimeout(render,220);
  }catch(e){toast(e.message||'Помилка аналізу виступу');btn.disabled=false;box.classList.add('hidden')}
}

function waitMeta(v){return new Promise((res,rej)=>{if(v.readyState>=1&&Number.isFinite(v.duration))return res();v.onloadedmetadata=()=>res();v.onerror=()=>rej(new Error('Не вдалося відкрити відео'))})}

function updateProgramElement(id,patch){const x=state.program?.elements?.find(e=>e.id===id);if(!x)return;Object.assign(x,patch);render()}
function changeGOE(id,delta){const x=state.program?.elements?.find(e=>e.id===id);if(!x)return;x.goe=clamp((Number(x.goe)||0)+delta,-5,5);render()}
function addProgramElement(){if(!state.program)return;state.program.elements.push({id:crypto.randomUUID(),kind:'manual',time:state.program.duration,code:'ChSq1',suggestion:'manual',goe:0,confidence:100,needsConfirm:false,metrics:{}});render()}

async function saveCurrent(){
  if(!state.metrics)return;
  const element=estimateElement(state.metrics.rotation,state.element),ev=estimateGOE(state.metrics,element,state.flags);
  const item={id:crypto.randomUUID(),kind:'jump',profile:'all',createdAt:Date.now(),element,metrics:state.metrics,flags:{...state.flags},goe:ev.goe};
  await saveAnalysis(item);toast('Результат збережено');state.view='history';render();loadHistory();
}
async function saveCurrentProgram(){
  if(!state.program)return;
  const scoring=scoreProgram(state.program,state.programType);
  const item={id:crypto.randomUUID(),kind:'program',profile:'all',createdAt:Date.now(),programType:state.programType,program:structuredClone(state.program),scoring};
  await saveAnalysis(item);toast('Протокол збережено');state.view='history';render();loadHistory();
}

async function loadHistory(){
  const root=document.querySelector('#history');if(!root)return;
  const data=await getAnalyses();
  if(!data.length){root.innerHTML='<div class="empty">Ще немає збережених результатів.</div>';return}
  root.innerHTML=data.map(x=>{
    if(x.kind==='program')return `<div class="history-item"><div class="thumb trophy">🏆</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})} · ISU Judge</b><p>TES ${x.scoring?.tes?.toFixed?.(2)||'—'} · PCS ${x.scoring?.pcs?.toFixed?.(2)||'—'} · ${x.program?.elements?.length||0} елементів</p></div><div class="history-score">${x.scoring?.total?.toFixed?.(2)||'—'}<small>Total</small></div></div>`;
    return `<div class="history-item"><div class="thumb">${x.element}</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})} · ${new Date(x.createdAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}</b><p>${x.metrics.airtime}s airtime · ${x.metrics.rotation} rotation · landing ${x.metrics.stability}%</p></div><div class="history-score">${x.goe>0?'+':''}${x.goe}<small>Est. GOE</small></div></div>`;
  }).join('');
}

function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});
async function installApp(){if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;return}state.installGuide=true;render()}

if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));
render();
