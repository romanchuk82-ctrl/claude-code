import { analyzeVideo, estimateElement, estimateGOE } from './analyzer.js';
import { analyzeProgram, analyzeJumpPass, scoreProgram, scoreJumpPass, PROGRAM_TYPES, ELEMENT_OPTIONS, formatTime } from './programJudge.js';
import { saveAnalysis, getAnalyses } from './db.js';

let state={
  view:'home',
  file:null,url:null,metrics:null,element:'auto',flags:{hand:false,twoFoot:false,stepOut:false,fall:false},
  passFile:null,passUrl:null,pass:null,passSelection:[],
  programFile:null,programUrl:null,program:null,programType:'girlsB2526',
  installPrompt:null,installGuide:false
};
const el=document.querySelector('#app');
const isStandalone=window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmtSigned=v=>`${Number(v)>0?'+':''}${Number(v).toFixed(2)}`;
const JUMP_ELEMENTS=['1T','1S','1Lo','1F','1Lz','1A','2T','2S','2Lo','2F','2Lz','2A','3T','3S','3Lo','3F','3Lz','3A','4T','4S','4Lo','4F','4Lz','4A'];

function render(){
  const views={home,analyze:analyzeView,pass:passView,program:programView,history:historyView};
  el.innerHTML=`<div class="app"><header class="topbar"><div class="brand"><div><div class="logo"><div class="logo-mark">⛸</div><div>SKATE</div></div><div class="sub">аналіз фігурного катання</div></div></div></header><main>${(views[state.view]||home)()}</main>${nav()}</div>`;
  bind();
}

function installGuide(){
  if(!state.installGuide)return '';
  return `<section class="card" style="margin-top:12px"><div class="section-title compact"><h2>Додати на iPhone</h2><span>30 секунд</span></div><p class="notice">Відкрий сайт у Safari → Поділитися ↑ → На початковий екран → Додати.</p><button class="secondary" id="closeInstall">Зрозуміло</button></section>`;
}

function home(){
  return `<section class="hero"><div class="hero-badge">SHARED IJS ENGINE · 2025/26</div><h1>Одна логіка для стрибка, серії та всього виступу.</h1><p>Ті самі BV, GOE, каскади/SEQ і правила підрахунку використовуються в кожному режимі.</p></section>
<div class="section-title"><h2>Що аналізуємо?</h2><span>обери режим</span></div>
<section class="card"><div style="display:grid;grid-template-columns:1fr;gap:10px">
<button class="primary" id="homeSingle">① Один стрибок</button>
<button class="secondary" id="homePass">② Кілька стрибків / каскад / sequence</button>
<button class="secondary" id="homeProgram">③ Повний виступ</button>
</div><p class="notice" style="margin-top:12px">Еталон для математики: протокол Sofia Romanchuk, Open Championship Kyiv 07–09.05.2026.</p></section>
<div class="section-title"><h2>Один стрибок</h2><span>3–15 секунд</span></div><section class="card"><div class="upload"><div class="upload-icon">🎥</div><h3>Додай коротке відео</h3><p>Усе тіло в кадрі, бажано видно захід, take-off і landing.</p><input id="fileLibrary" type="file" accept="video/*" hidden><input id="fileCamera" type="file" accept="video/*" capture="environment" hidden><div class="upload-actions"><button class="primary" id="pickLibrary">Обрати з Фото</button><button class="secondary" id="pickCamera">Зняти зараз</button></div></div></section>
<div class="section-title"><h2>Кілька стрибків</h2><span>до 25 секунд</span></div><section class="card"><input id="passLibrary" type="file" accept="video/*" hidden><p>Для каскаду, jump sequence або короткого фрагмента з кількома стрибками.</p><button class="primary" id="pickPass">Обрати відео серії</button></section>
<div class="section-title"><h2>Повний виступ</h2><span>до 5½ хв</span></div><section class="card featured-card"><div class="feature-icon">🏆</div><div class="feature-copy"><h3>ISU Judge</h3><p>Стрибкові проходи, spins, StSq, TES, PCS, deductions і Total.</p></div><input id="programLibrary" type="file" accept="video/*" hidden><button class="primary" id="pickProgram">Оцінити весь виступ</button></section>
${(!isStandalone?'<button class="secondary install show" id="install">Додати SKATE на екран iPhone</button>':'')}${installGuide()}`;
}

function analyzeView(){
  if(!state.url)return home();
  const r=state.metrics?jumpResult():'';
  return `<div class="section-title"><h2>Один стрибок</h2><span>shared engine</span></div><section class="card"><div class="video-wrap"><video id="video" src="${state.url}" playsinline controls preload="auto"></video></div><div class="form-grid one"><div class="field"><label>Елемент</label><select id="element">${['auto','1T','1S','1Lo','1F','1Lz','1A','2T','2S','2Lo','2F','2Lz','2A','3T','3S','3Lo','3F','3Lz','3A','4T','4S','4Lo','4F','4Lz','4A'].map(x=>`<option ${state.element===x?'selected':''} value="${x}">${x==='auto'?'Визначити автоматично':x}</option>`).join('')}</select></div></div><button class="primary" id="run">${state.metrics?'Аналізувати ще раз':'Аналізувати відео'}</button><div id="progress" class="progress hidden"><div class="bar"><div id="bar"></div></div><div class="progress-text" id="progressText">Готую аналіз…</div></div></section>${r}`;
}

function jumpResult(){
  const m=state.metrics;
  const element=estimateElement(m,state.element);
  const e=estimateGOE(m,element,state.flags),sc=e.scoring||{};
  const conf=m.confidence>=80?['Висока','high']:m.confidence>=55?['Середня','medium']:['Низька','low'];
  return `<div class="section-title"><h2>Результат</h2><span>${element}</span></div><section class="card score-card"><div class="score-ring" style="--p:${m.quality}"><div style="text-align:center"><strong>${m.quality}</strong><br><span>/100</span></div></div><div><div class="k">Estimated GOE grade</div><div class="goe">${e.goe>0?'+':''}${e.goe}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${m.confidence}%</span></div></section>
<div class="metric-grid"><div class="metric"><div class="k">BASE VALUE</div><div class="v">${(sc.base??0).toFixed(2)}</div><div class="d">BV</div></div><div class="metric"><div class="k">GOE POINTS</div><div class="v">${fmtSigned(sc.goePoints??0)}</div><div class="d">як у protocol</div></div><div class="metric"><div class="k">SCORE</div><div class="v">${(sc.score??0).toFixed(2)}</div><div class="d">BV + GOE</div></div><div class="metric"><div class="k">ROTATION</div><div class="v">${m.rotation}</div><div class="d">очікувано ${e.expected}</div></div><div class="metric"><div class="k">AIRTIME</div><div class="v">${m.airtime}s</div><div class="d">час у повітрі</div></div><div class="metric"><div class="k">LANDING</div><div class="v">${m.stability}%</div><div class="d">стабільність</div></div></div>
<div class="section-title"><h2>Чому такий GOE</h2><span>Estimated</span></div><section class="card"><ul class="reason-list">${e.reasons.map(x=>`<li><span class="tag ${x[0]}">${x[0]==='pos'?'+':x[0]==='neg'?'−':'•'}</span>${x[1]}</li>`).join('')}</ul></section>
<div class="section-title"><h2>Уточнити landing</h2><span>за потреби</span></div><section class="card"><div class="checks">${[['hand','Дотик рукою'],['twoFoot','Landing на дві ноги'],['stepOut','Step-out'],['fall','Fall']].map(([k,t])=>`<label class="check"><span>${t}</span><input class="switch flag" type="checkbox" data-flag="${k}" ${state.flags[k]?'checked':''}></label>`).join('')}</div><button class="primary" id="save">Зберегти результат</button></section>`;
}

function cascadeBuilder(){
  const selected=state.passSelection||[];
  const chips=selected.length?selected.map((code,i)=>`<div class="cascade-chip"><span class="cascade-order">${i+1}</span><b>${code}</b><div class="cascade-actions"><button data-cascade-left="${i}" ${i===0?'disabled':''}>←</button><button data-cascade-right="${i}" ${i===selected.length-1?'disabled':''}>→</button><button data-cascade-remove="${i}">×</button></div></div>`).join(''):'<div class="cascade-empty">Постав галочки на елементах у потрібному порядку.</div>';
  return `<div class="section-title compact"><h2>Вибір елементів</h2><span>${selected.length?`обрано ${selected.length}`:'каскад'}</span></div><section class="card cascade-card"><p class="cascade-help">Обери окремі стрибки. Порядок вибору формує каскад.</p><div class="element-check-grid">${JUMP_ELEMENTS.map(code=>{const idx=selected.indexOf(code);return `<label class="element-check ${idx>=0?'selected':''}"><input class="cascade-choice" type="checkbox" value="${code}" ${idx>=0?'checked':''}><span>${code}</span>${idx>=0?`<i>${idx+1}</i>`:''}</label>`}).join('')}</div><div class="my-cascade"><div class="my-cascade-head"><b>Мій каскад</b><span>${selected.length?selected.join(' + '):'ще не обрано'}</span></div><div class="cascade-list">${chips}</div>${selected.length?'<button class="cascade-clear" id="clearCascade">Очистити</button>':''}</div></section>`;
}

function passView(){
  if(!state.passUrl)return home();
  const result=state.pass?passResult():'';
  return `<div class="section-title"><h2>Кілька стрибків</h2><span>combo / SEQ</span></div><section class="card"><div class="video-wrap"><video id="passVideo" src="${state.passUrl}" playsinline controls preload="metadata"></video></div></section>${cascadeBuilder()}<section class="card pass-run-card"><button class="primary" id="runPass">${state.pass?'Проаналізувати заново':'Аналізувати серію'}</button><div id="passProgress" class="progress hidden"><div class="bar"><div id="passBar"></div></div><div class="progress-text" id="passProgressText">Шукаю стрибки…</div></div><p class="notice">Якщо обрано елементи, SKATE використає цей склад каскаду під час фінальної оцінки.</p></section>${result}`;
}

function passResult(){
  const passes=state.pass?.passes||[];
  const scored=passes.map(x=>({...x,...scoreJumpPass(x)}));
  const total=scored.reduce((s,x)=>s+x.score,0);
  return `<div class="section-title"><h2>Стрибкові елементи</h2><span>${scored.length}</span></div><section class="card protocol-card"><div class="protocol-head"><span># / час</span><span>Елемент</span><span>GOE</span><span>Score</span></div>${scored.length?scored.map((x,i)=>passRow(x,i)).join(''):'<div class="empty">Стрибків не знайдено. Спробуй фрагмент, де весь take-off і landing у кадрі.</div>'}</section><section class="card total-card"><div><div class="k">TOTAL ELEMENT SCORE</div><div class="big-total">${total.toFixed(2)}</div></div><div class="score-stack"><div><span>detected</span><b>${scored.length}</b></div><div><span>confidence</span><b>${state.pass.confidence||0}%</b></div></div></section><button class="primary" id="savePass">Зберегти серію</button>`;
}

function elementOptions(selected){return ELEMENT_OPTIONS.map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join('')}
function passRow(x,i){
  const grade=Number.isFinite(Number(x.goeGrade))?Number(x.goeGrade):Number(x.goe)||0;
  return `<div class="protocol-row" data-passid="${x.id}"><button class="time-chip" data-passseek="${x.time||0}"><b>${i+1}</b>${formatTime(x.time||0)}</button><div class="protocol-element"><select class="pass-select" data-id="${x.id}">${elementOptions(x.code)}</select>${x.needsConfirm?`<small class="needs-confirm">${x.suggestion||'підтвердити'}</small>`:''}</div><div class="goe-stepper"><button class="pass-goe" data-id="${x.id}" data-goe="-1">−</button><b>${fmtSigned(x.goePoints||0)}</b><button class="pass-goe" data-id="${x.id}" data-goe="1">+</button><small style="display:block">grade ${grade>0?'+':''}${grade.toFixed(2)}</small></div><div class="row-score"><b>${x.score.toFixed(2)}</b><small>BV ${x.base.toFixed(2)}</small></div></div>`;
}

function programView(){
  if(!state.programUrl)return home();
  const result=state.program?programResult():'';
  return `<div class="section-title"><h2>ISU Judge</h2><span>повний виступ</span></div><section class="card"><div class="video-wrap program-video"><video id="programVideo" src="${state.programUrl}" playsinline controls preload="metadata"></video></div><div class="field program-type"><label>Формат оцінки</label><select id="programType">${Object.entries(PROGRAM_TYPES).map(([k,v])=>`<option value="${k}" ${state.programType===k?'selected':''}>${v.label}</option>`).join('')}</select></div><button class="primary" id="runProgram">${state.program?'Проаналізувати заново':'Запустити суддівську панель'}</button><div id="programProgress" class="progress hidden"><div class="bar"><div id="programBar"></div></div><div class="progress-text" id="programProgressText">Готую відео…</div></div><p class="notice">Для протоколу Соні обери Women B / Girls B · 2025/26 · factor 1.67.</p></section>${result}`;
}

function programResult(){
  const p=state.program,s=scoreProgram(p,state.programType),rule=PROGRAM_TYPES[state.programType]||{};
  const conf=p.confidence>=80?['Висока','high']:p.confidence>=55?['Середня','medium']:['Низька','low'];
  const pending=s.elements.filter(x=>x.needsConfirm).length;
  return `<div class="section-title"><h2>Протокол виступу</h2><span>${rule.ruleset==='2526'?'2025/26':'IJS'}</span></div><section class="card total-card"><div><div class="k">TOTAL SEGMENT SCORE</div><div class="big-total">${s.total.toFixed(2)}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${p.confidence}%</span></div><div class="score-stack"><div><span>TES</span><b>${s.tes.toFixed(2)}</b></div><div><span>PCS</span><b>${s.pcs.toFixed(2)}</b></div><div><span>DED</span><b>−${s.deductions.toFixed(2)}</b></div></div></section><div class="protocol-status"><span class="dot ${pending?'warn':'ok'}"></span>${s.elements.length} елементів${pending?` · ${pending} потребують підтвердження`:''}</div><section class="card protocol-card"><div class="protocol-head"><span># / час</span><span>Елемент</span><span>GOE</span><span>Score</span></div>${s.elements.length?s.elements.map((x,i)=>protocolRow(x,i)).join(''):'<div class="empty">AI не знайшов технічних елементів.</div>'}<button class="secondary add-element" id="addProgramElement">+ Додати елемент вручну</button></section><div class="section-title"><h2>Program Components</h2><span>factor × ${s.factor}</span></div><div class="pcs-grid"><div class="pcs-card"><span>Composition</span><b>${p.pcs.composition.toFixed(2)}</b><small>/10</small></div><div class="pcs-card"><span>Presentation</span><b>${p.pcs.presentation.toFixed(2)}</b><small>/10</small></div><div class="pcs-card"><span>Skating Skills</span><b>${p.pcs.skatingSkills.toFixed(2)}</b><small>/10</small></div></div><div class="section-title"><h2>Deductions</h2><span>falls</span></div><section class="card"><div class="deduction-row"><div><b>Падіння</b><p>−1.00 за кожне</p></div><div class="stepper"><button data-fall="-1">−</button><strong>${p.fallCount||0}</strong><button data-fall="1">+</button></div></div></section><button class="primary" id="saveProgram">Зберегти протокол</button>`;
}

function protocolRow(x,i){
  const grade=Number.isFinite(Number(x.goeGrade))?Number(x.goeGrade):Number(x.goe)||0;
  const hint=x.needsConfirm||!x.code?`<small class="needs-confirm">${x.suggestion||'підтвердити'}</small>`:'';
  return `<div class="protocol-row" data-id="${x.id}"><button class="time-chip" data-seek="${x.time||0}"><b>${i+1}</b>${formatTime(x.time||0)}</button><div class="protocol-element"><select class="protocol-select" data-id="${x.id}">${elementOptions(x.code)}</select>${hint}${x.x?'<span class="x-badge">x · 10%</span>':''}</div><div class="goe-stepper"><button class="goe-btn" data-id="${x.id}" data-goe="-1">−</button><b class="${x.goePoints>0?'positive':x.goePoints<0?'negative':''}">${fmtSigned(x.goePoints||0)}</b><button class="goe-btn" data-id="${x.id}" data-goe="1">+</button><small style="display:block">grade ${grade>0?'+':''}${grade.toFixed(2)}</small></div><div class="row-score"><b>${x.score.toFixed(2)}</b><small>BV ${x.base.toFixed(2)}</small></div></div>`;
}

function historyView(){return `<div class="section-title"><h2>Історія</h2><span>аналізи й протоколи</span></div><section id="history" class="history"><div class="empty">Завантажую…</div></section>`}
function nav(){return `<nav class="bottom-nav four"><button class="navbtn ${state.view==='home'?'active':''}" data-view="home"><i>⌂</i>Головна</button><button class="navbtn ${state.view==='analyze'||state.view==='pass'?'active':''}" data-view="analyze"><i>◎</i>Стрибки</button><button class="navbtn ${state.view==='program'?'active':''}" data-view="program"><i>🏆</i>Виступ</button><button class="navbtn ${state.view==='history'?'active':''}" data-view="history"><i>◫</i>Історія</button></nav>`}

function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();if(state.view==='history')loadHistory()});
  document.querySelector('#homeSingle')?.addEventListener('click',()=>document.querySelector('#pickLibrary')?.click());
  document.querySelector('#homePass')?.addEventListener('click',()=>document.querySelector('#pickPass')?.click());
  document.querySelector('#homeProgram')?.addEventListener('click',()=>document.querySelector('#pickProgram')?.click());
  document.querySelector('#pickLibrary')?.addEventListener('click',()=>document.querySelector('#fileLibrary').click());
  document.querySelector('#pickCamera')?.addEventListener('click',()=>document.querySelector('#fileCamera').click());
  document.querySelector('#pickPass')?.addEventListener('click',()=>document.querySelector('#passLibrary').click());
  document.querySelector('#pickProgram')?.addEventListener('click',()=>document.querySelector('#programLibrary').click());
  document.querySelector('#fileLibrary')?.addEventListener('change',e=>chooseJumpFile(e.target.files?.[0]));
  document.querySelector('#fileCamera')?.addEventListener('change',e=>chooseJumpFile(e.target.files?.[0]));
  document.querySelector('#passLibrary')?.addEventListener('change',e=>choosePassFile(e.target.files?.[0]));
  document.querySelector('#programLibrary')?.addEventListener('change',e=>chooseProgramFile(e.target.files?.[0]));
  document.querySelector('#run')?.addEventListener('click',runAnalysis);
  document.querySelector('#runPass')?.addEventListener('click',runPassAnalysis);
  document.querySelector('#runProgram')?.addEventListener('click',runProgramAnalysis);
  document.querySelector('#element')?.addEventListener('change',e=>{state.element=e.target.value;if(state.metrics)render()});
  document.querySelector('#programType')?.addEventListener('change',e=>{state.programType=e.target.value;render()});
  document.querySelectorAll('.flag').forEach(x=>x.onchange=()=>{state.flags[x.dataset.flag]=x.checked;render()});
  document.querySelector('#save')?.addEventListener('click',saveCurrent);
  document.querySelector('#savePass')?.addEventListener('click',saveCurrentPass);
  document.querySelector('#saveProgram')?.addEventListener('click',saveCurrentProgram);
  document.querySelector('#addProgramElement')?.addEventListener('click',addProgramElement);
  document.querySelectorAll('.protocol-select').forEach(x=>x.onchange=()=>updateProgramElement(x.dataset.id,{code:x.value,needsConfirm:false}));
  document.querySelectorAll('.goe-btn').forEach(x=>x.onclick=()=>changeGOE(x.dataset.id,Number(x.dataset.goe)));
  document.querySelectorAll('.pass-select').forEach(x=>x.onchange=()=>updatePassElement(x.dataset.id,{code:x.value,needsConfirm:false}));
  document.querySelectorAll('.pass-goe').forEach(x=>x.onclick=()=>changePassGOE(x.dataset.id,Number(x.dataset.goe)));
  document.querySelectorAll('.cascade-choice').forEach(x=>x.onchange=()=>toggleCascadeElement(x.value,x.checked));
  document.querySelectorAll('[data-cascade-remove]').forEach(x=>x.onclick=()=>removeCascadeElement(Number(x.dataset.cascadeRemove)));
  document.querySelectorAll('[data-cascade-left]').forEach(x=>x.onclick=()=>moveCascadeElement(Number(x.dataset.cascadeLeft),-1));
  document.querySelectorAll('[data-cascade-right]').forEach(x=>x.onclick=()=>moveCascadeElement(Number(x.dataset.cascadeRight),1));
  document.querySelector('#clearCascade')?.addEventListener('click',()=>{state.passSelection=[];render()});
  document.querySelectorAll('[data-fall]').forEach(x=>x.onclick=()=>{state.program.fallCount=clamp((state.program.fallCount||0)+Number(x.dataset.fall),0,10);render()});
  document.querySelectorAll('[data-seek]').forEach(x=>x.onclick=()=>seekAndPlay('#programVideo',x.dataset.seek));
  document.querySelectorAll('[data-passseek]').forEach(x=>x.onclick=()=>seekAndPlay('#passVideo',x.dataset.passseek));
  document.querySelector('#install')?.addEventListener('click',installApp);
  document.querySelector('#closeInstall')?.addEventListener('click',()=>{state.installGuide=false;render()});
}

function chooseJumpFile(file){if(!file)return;if(state.url)URL.revokeObjectURL(state.url);state.file=file;state.url=URL.createObjectURL(file);state.metrics=null;state.element='auto';state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};state.view='analyze';render()}
function choosePassFile(file){if(!file)return;if(state.passUrl)URL.revokeObjectURL(state.passUrl);state.passFile=file;state.passUrl=URL.createObjectURL(file);state.pass=null;state.passSelection=[];state.view='pass';render()}
function chooseProgramFile(file){if(!file)return;if(state.programUrl)URL.revokeObjectURL(state.programUrl);state.programFile=file;state.programUrl=URL.createObjectURL(file);state.program=null;state.view='program';render()}

async function runAnalysis(){
  const v=document.querySelector('#video'),box=document.querySelector('#progress'),bar=document.querySelector('#bar'),txt=document.querySelector('#progressText'),btn=document.querySelector('#run');if(!v)return;
  try{btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);state.metrics=await analyzeVideo(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<25?'Читаю рух…':p<65?'Відстежую тіло й take-off…':p<90?'Визначаю rotation та landing…':'Рахую BV і GOE…'});state.element=estimateElement(state.metrics,state.element);bar.style.width='100%';setTimeout(render,180)}catch(e){toast(e.message||'Помилка аналізу');btn.disabled=false;box.classList.add('hidden')}
}
async function runPassAnalysis(){
  const v=document.querySelector('#passVideo'),box=document.querySelector('#passProgress'),bar=document.querySelector('#passBar'),txt=document.querySelector('#passProgressText'),btn=document.querySelector('#runPass');if(!v)return;
  try{btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);state.pass=await analyzeJumpPass(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<60?'Шукаю всі take-off…':p<92?'Відрізняю окремі стрибки від combo / SEQ…':'Рахую BV і GOE…'});applyCascadeSelection();bar.style.width='100%';setTimeout(render,180)}catch(e){toast(e.message||'Помилка аналізу серії');btn.disabled=false;box.classList.add('hidden')}
}
async function runProgramAnalysis(){
  const v=document.querySelector('#programVideo'),box=document.querySelector('#programProgress'),bar=document.querySelector('#programBar'),txt=document.querySelector('#programProgressText'),btn=document.querySelector('#runProgram');if(!v)return;
  try{btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);if(v.duration>360)throw new Error('Поки підтримується виступ до 6 хвилин');state.program=await analyzeProgram(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<20?'Будую карту руху…':p<60?'Шукаю всі стрибкові проходи…':p<86?'Визначаю combo, SEQ, spins і StSq…':'Рахую TES і PCS…'},state.programType);bar.style.width='100%';setTimeout(render,220)}catch(e){toast(e.message||'Помилка аналізу виступу');btn.disabled=false;box.classList.add('hidden')}
}
function waitMeta(v){return new Promise((res,rej)=>{if(v.readyState>=1&&Number.isFinite(v.duration))return res();v.onloadedmetadata=()=>res();v.onerror=()=>rej(new Error('Не вдалося відкрити відео'))})}
function seekAndPlay(sel,t){const v=document.querySelector(sel);if(v){v.currentTime=Number(t)||0;v.play().catch(()=>{})}}

function updateProgramElement(id,patch){const x=state.program?.elements?.find(e=>e.id===id);if(!x)return;Object.assign(x,patch);render()}
function changeGOE(id,delta){const x=state.program?.elements?.find(e=>e.id===id);if(!x)return;const g=Number.isFinite(Number(x.goeGrade))?Number(x.goeGrade):Number(x.goe)||0;x.goeGrade=clamp(g+delta,-5,5);x.goe=x.goeGrade;render()}
function addProgramElement(){if(!state.program)return;state.program.elements.push({id:crypto.randomUUID(),kind:'manual',time:state.program.duration,code:'StSq1',suggestion:'manual',goe:0,goeGrade:0,confidence:100,needsConfirm:false,metrics:{}});render()}
function toggleCascadeElement(code,checked){
  const list=[...(state.passSelection||[])];
  const i=list.indexOf(code);
  if(checked&&i<0)list.push(code);
  if(!checked&&i>=0)list.splice(i,1);
  state.passSelection=list.slice(0,3);
  render();
}
function removeCascadeElement(i){if(i<0)return;state.passSelection.splice(i,1);render()}
function moveCascadeElement(i,delta){const j=i+delta;if(i<0||j<0||j>=state.passSelection.length)return;[state.passSelection[i],state.passSelection[j]]=[state.passSelection[j],state.passSelection[i]];render()}
function applyCascadeSelection(){
  const sel=state.passSelection||[];if(!sel.length||!state.pass)return;
  const code=sel.join('+');const passes=state.pass.passes||[];
  if(passes.length){passes[0].code=code;passes[0].needsConfirm=false;passes[0].suggestion='обрано користувачем';}
  else state.pass.passes=[{id:crypto.randomUUID(),kind:'jump-pass',time:0,code,suggestion:'обрано користувачем',goe:0,goeGrade:0,confidence:100,needsConfirm:false,metrics:{members:[]}}];
}
function updatePassElement(id,patch){const x=state.pass?.passes?.find(e=>e.id===id);if(!x)return;Object.assign(x,patch);render()}
function changePassGOE(id,delta){const x=state.pass?.passes?.find(e=>e.id===id);if(!x)return;const g=Number.isFinite(Number(x.goeGrade))?Number(x.goeGrade):Number(x.goe)||0;x.goeGrade=clamp(g+delta,-5,5);x.goe=x.goeGrade;render()}

async function saveCurrent(){if(!state.metrics)return;const element=estimateElement(state.metrics,state.element),ev=estimateGOE(state.metrics,element,state.flags);await saveAnalysis({id:crypto.randomUUID(),kind:'jump',profile:'all',createdAt:Date.now(),element,metrics:state.metrics,flags:{...state.flags},goe:ev.goe,scoring:ev.scoring});toast('Результат збережено');state.view='history';render();loadHistory()}
async function saveCurrentPass(){if(!state.pass)return;const passes=state.pass.passes.map(x=>({...x,scoring:scoreJumpPass(x)}));await saveAnalysis({id:crypto.randomUUID(),kind:'pass',profile:'all',createdAt:Date.now(),pass:{...state.pass,passes}});toast('Серію збережено');state.view='history';render();loadHistory()}
async function saveCurrentProgram(){if(!state.program)return;const scoring=scoreProgram(state.program,state.programType);await saveAnalysis({id:crypto.randomUUID(),kind:'program',profile:'all',createdAt:Date.now(),programType:state.programType,program:structuredClone(state.program),scoring});toast('Протокол збережено');state.view='history';render();loadHistory()}

async function loadHistory(){
  const root=document.querySelector('#history');if(!root)return;const data=await getAnalyses();if(!data.length){root.innerHTML='<div class="empty">Ще немає збережених результатів.</div>';return}
  root.innerHTML=data.map(x=>{
    if(x.kind==='program')return `<div class="history-item"><div class="thumb trophy">🏆</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})} · ISU Judge</b><p>TES ${x.scoring?.tes?.toFixed?.(2)||'—'} · PCS ${x.scoring?.pcs?.toFixed?.(2)||'—'} · ${x.program?.elements?.length||0} елементів</p></div><div class="history-score">${x.scoring?.total?.toFixed?.(2)||'—'}<small>Total</small></div></div>`;
    if(x.kind==='pass')return `<div class="history-item"><div class="thumb">SEQ</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})} · Серія</b><p>${x.pass?.passes?.map(p=>p.code).join(' · ')||'—'}</p></div><div class="history-score">${x.pass?.passes?.length||0}<small>passes</small></div></div>`;
    return `<div class="history-item"><div class="thumb">${x.element}</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})}</b><p>${x.metrics.airtime}s airtime · ${x.metrics.rotation} rotation · landing ${x.metrics.stability}%</p></div><div class="history-score">${x.goe>0?'+':''}${x.goe}<small>GOE grade</small></div></div>`;
  }).join('');
}
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});
async function installApp(){if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;return}state.installGuide=true;render()}
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));
render();
