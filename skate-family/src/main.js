import { analyzeVideo, estimateElement, estimateGOE } from './analyzer.js';
import { saveAnalysis, getAnalyses } from './db.js';

let state={view:'home',file:null,url:null,metrics:null,element:'auto',flags:{hand:false,twoFoot:false,stepOut:false,fall:false},installPrompt:null,installGuide:false};
const el=document.querySelector('#app');
const isiOS=/iPhone|iPad|iPod/i.test(navigator.userAgent);
const isStandalone=window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;

function render(){
  el.innerHTML=`<div class="app"><header class="topbar"><div class="brand"><div><div class="logo"><div class="logo-mark">⛸</div><div>SKATE</div></div><div class="sub">аналіз фігурного катання</div></div></div></header>
  <main>${state.view==='home'?home():state.view==='analyze'?analyzeView():historyView()}</main>${nav()}</div>`;
  bind();
}

function installGuide(){
  if(!state.installGuide)return '';
  return `<section class="card" style="margin-top:12px"><div class="section-title" style="margin:0 0 10px"><h2>Додати на iPhone</h2><span>30 секунд</span></div><p class="notice">Важливо: додавання на початковий екран працює з Safari. Якщо сторінка відкрита у вікні ChatGPT, натисни значок браузера у правому верхньому куті й відкрий її в Safari.</p><ol style="padding-left:22px;line-height:1.6"><li>У Safari натисни <b>Поділитися</b> ↑.</li><li>Обери <b>На початковий екран</b>.</li><li>Натисни <b>Додати</b>.</li></ol><button class="secondary" id="closeInstall">Зрозуміло</button></section>`;
}

function home(){
  return `<section class="hero"><h1>Кожен стрибок — це дані.</h1><p>Додай відео, отримай метрики техніки та орієнтовний Estimated GOE. Уся історія зберігається в одному місці.</p></section>
<div class="section-title"><h2>Новий аналіз</h2><span>локально на iPhone</span></div><section class="card"><div class="upload"><div class="upload-icon">🎥</div><h3>Додай відео стрибка</h3><p>Найкраще 3–10 секунд, усе тіло в кадрі, камера стоїть стабільно.</p><input id="fileLibrary" type="file" accept="video/*" hidden><input id="fileCamera" type="file" accept="video/*" capture="environment" hidden><div class="upload-actions"><button class="primary" id="pickLibrary">Обрати з Фото</button><button class="secondary" id="pickCamera">Зняти зараз</button></div></div>${(!isStandalone?'<button class="secondary install show" id="install">Додати SKATE на екран iPhone</button>':'')}<p class="notice">Відео аналізується на твоєму пристрої. Результат v1 орієнтовний і не замінює рішення тренера чи суддівської панелі.</p></section>${installGuide()}
<div class="section-title"><h2>Що вимірюємо</h2><span>v1</span></div><div class="metric-grid"><div class="metric"><div class="k">AIRTIME</div><div class="v">0.00</div><div class="d">час у повітрі</div></div><div class="metric"><div class="k">HEIGHT</div><div class="v">0.00 м</div><div class="d">орієнтовна висота</div></div><div class="metric"><div class="k">ROTATION</div><div class="v">0.00</div><div class="d">оберти</div></div><div class="metric"><div class="k">EST. GOE</div><div class="v">−5…+5</div><div class="d">орієнтовно</div></div></div>`;
}

function analyzeView(){
  if(!state.url)return home();
  const r=state.metrics?result():'';
  return `<div class="section-title"><h2>Аналіз стрибка</h2><span>SKATE</span></div><section class="card"><div class="video-wrap"><video id="video" src="${state.url}" playsinline controls preload="auto"></video></div><div class="form-grid"><div class="field"><label>Елемент</label><select id="element">${['auto','1T','1S','1Lo','1F','1Lz','1A','2T','2S','2Lo','2F','2Lz','2A','3T','3S','3Lo','3F','3Lz','3A'].map(x=>`<option ${state.element===x?'selected':''} value="${x}">${x==='auto'?'Визначити автоматично':x}</option>`).join('')}</select></div></div><button class="primary" id="run">${state.metrics?'Аналізувати ще раз':'Аналізувати відео'}</button><div id="progress" class="progress hidden"><div class="bar"><div id="bar"></div></div><div class="progress-text" id="progressText">Готую аналіз…</div></div></section>${r}`;
}

function result(){
  const m=state.metrics;
  const element=estimateElement(m.rotation,state.element);
  const e=estimateGOE(m,element,state.flags);
  const conf=m.confidence>=80?['Висока','high']:m.confidence>=55?['Середня','medium']:['Низька','low'];
  return `<div class="section-title"><h2>Результат</h2><span>${element}</span></div><section class="card score-card"><div class="score-ring" style="--p:${m.quality}"><div style="text-align:center"><strong>${m.quality}</strong><br><span>/100</span></div></div><div><div class="k">Estimated GOE</div><div class="goe">${e.goe>0?'+':''}${e.goe}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${m.confidence}%</span><div class="notice">Estimated GOE — наша орієнтовна оцінка якості, не офіційний суддівський бал.</div></div></section>
<div class="section-title"><h2>Метрики</h2><span>${m.takeoff}s → ${m.landing}s</span></div><div class="metric-grid"><div class="metric"><div class="k">AIRTIME</div><div class="v">${m.airtime}s</div><div class="d">час у повітрі</div></div><div class="metric"><div class="k">HEIGHT</div><div class="v">${m.height}м</div><div class="d">за airtime</div></div><div class="metric"><div class="k">ROTATION</div><div class="v">${m.rotation}</div><div class="d">очікувано ${e.expected}</div></div><div class="metric"><div class="k">AXIS</div><div class="v">${m.axis}°</div><div class="d">середній нахил</div></div><div class="metric"><div class="k">LANDING</div><div class="v">${m.stability}%</div><div class="d">стабільність</div></div><div class="metric"><div class="k">ДЕФІЦИТ</div><div class="v">${e.deficit}</div><div class="d">rotation</div></div></div>
<div class="section-title"><h2>Чому такий GOE</h2><span>правила v1</span></div><section class="card"><ul class="reason-list">${e.reasons.map(x=>`<li><span class="tag ${x[0]}">${x[0]==='pos'?'+':x[0]==='neg'?'−':'•'}</span>${x[1]}</li>`).join('')}</ul></section>
<div class="section-title"><h2>Уточнити landing</h2><span>якщо камера не побачила</span></div><section class="card"><div class="checks">${[['hand','Дотик рукою'],['twoFoot','Landing на дві ноги'],['stepOut','Step-out'],['fall','Fall']].map(([k,t])=>`<label class="check"><span>${t}</span><input class="switch flag" type="checkbox" data-flag="${k}" ${state.flags[k]?'checked':''}></label>`).join('')}</div><button class="primary" id="save">Зберегти результат</button></section>`;
}

function historyView(){
  return `<div class="section-title"><h2>Історія</h2><span>усі стрибки</span></div><section id="history" class="history"><div class="empty">Завантажую…</div></section>`;
}

function nav(){
  return `<nav class="bottom-nav"><button class="navbtn ${state.view==='home'?'active':''}" data-view="home"><i>⌂</i>Головна</button><button class="navbtn ${state.view==='analyze'?'active':''}" data-view="analyze"><i>◎</i>Аналіз</button><button class="navbtn ${state.view==='history'?'active':''}" data-view="history"><i>◫</i>Історія</button></nav>`;
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();if(state.view==='history')loadHistory()});
  document.querySelector('#pickLibrary')?.addEventListener('click',()=>document.querySelector('#fileLibrary').click());
  document.querySelector('#pickCamera')?.addEventListener('click',()=>document.querySelector('#fileCamera').click());
  document.querySelector('#fileLibrary')?.addEventListener('change',e=>chooseFile(e.target.files?.[0]));
  document.querySelector('#fileCamera')?.addEventListener('change',e=>chooseFile(e.target.files?.[0]));
  document.querySelector('#run')?.addEventListener('click',runAnalysis);
  document.querySelector('#element')?.addEventListener('change',e=>{state.element=e.target.value;if(state.metrics)render()});
  document.querySelectorAll('.flag').forEach(x=>x.onchange=()=>{state.flags[x.dataset.flag]=x.checked;render()});
  document.querySelector('#save')?.addEventListener('click',saveCurrent);
  document.querySelector('#install')?.addEventListener('click',installApp);
  document.querySelector('#closeInstall')?.addEventListener('click',()=>{state.installGuide=false;render()});
}

function chooseFile(file){
  if(!file)return;
  if(state.url)URL.revokeObjectURL(state.url);
  state.file=file;state.url=URL.createObjectURL(file);state.metrics=null;state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};state.view='analyze';render();
}

async function runAnalysis(){
  const v=document.querySelector('#video');const box=document.querySelector('#progress'),bar=document.querySelector('#bar'),txt=document.querySelector('#progressText'),btn=document.querySelector('#run');if(!v)return;
  try{btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);state.metrics=await analyzeVideo(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<25?'Читаю рух…':p<65?'Відстежую положення тіла…':p<90?'Визначаю take-off та landing…':'Рахую метрики й GOE…'});state.element=estimateElement(state.metrics.rotation,state.element);bar.style.width='100%';setTimeout(render,250)}catch(e){toast(e.message||'Помилка аналізу');btn.disabled=false;box.classList.add('hidden')}
}

function waitMeta(v){return new Promise((res,rej)=>{if(v.readyState>=1&&Number.isFinite(v.duration))return res();v.onloadedmetadata=()=>res();v.onerror=()=>rej(new Error('Не вдалося відкрити відео'))})}

async function saveCurrent(){
  if(!state.metrics)return;
  const element=estimateElement(state.metrics.rotation,state.element);const ev=estimateGOE(state.metrics,element,state.flags);
  const item={id:crypto.randomUUID(),profile:'all',createdAt:Date.now(),element,metrics:state.metrics,flags:{...state.flags},goe:ev.goe};
  await saveAnalysis(item);toast('Результат збережено');state.view='history';render();loadHistory();
}

async function loadHistory(){
  const root=document.querySelector('#history');if(!root)return;
  const data=await getAnalyses();
  if(!data.length){root.innerHTML='<div class="empty">Ще немає збережених стрибків.</div>';return}
  root.innerHTML=data.map(x=>`<div class="history-item"><div class="thumb">${x.element}</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})} · ${new Date(x.createdAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}</b><p>${x.metrics.airtime}s airtime · ${x.metrics.rotation} rotation · landing ${x.metrics.stability}%</p></div><div class="history-score">${x.goe>0?'+':''}${x.goe}<small>Est. GOE</small></div></div>`).join('');
}

function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2200)}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});
async function installApp(){
  if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;return}
  if(isiOS){state.installGuide=true;render();return}
  state.installGuide=true;render();
}

if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));
render();
