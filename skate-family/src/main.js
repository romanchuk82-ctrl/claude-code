import { analyzeVideo, estimateElement, estimateGOE } from './analyzer.js?v=9';
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
  return `<section class="hero"><h1>Кожен стрибок — це дані.</h1><p>SKATE v2 розділяє стрибок на take-off, політ і landing, оцінює flow, контроль тіла, обертання та формує орієнтовний GOE.</p></section>
<div class="section-title"><h2>Новий аналіз</h2><span>локально на iPhone</span></div><section class="card"><div class="upload"><div class="upload-icon">🎥</div><h3>Додай відео стрибка</h3><p>Найкраще 3–10 секунд, усе тіло в кадрі, камера стоїть стабільно. Для точнішого GOE після завантаження обери конкретний елемент.</p><input id="fileLibrary" type="file" accept="video/*" hidden><input id="fileCamera" type="file" accept="video/*" capture="environment" hidden><div class="upload-actions"><button class="primary" id="pickLibrary">Обрати з Фото</button><button class="secondary" id="pickCamera">Зняти зараз</button></div></div>${(!isStandalone?'<button class="secondary install show" id="install">Додати SKATE на екран iPhone</button>':'')}<p class="notice">Аналіз v2 побудований за логікою якості виконання: позитивні ознаки + технічні зниження. Це не офіційна оцінка суддівської панелі.</p></section>${installGuide()}
<div class="section-title"><h2>Що вимірюємо</h2><span>v2</span></div><div class="metric-grid"><div class="metric"><div class="k">AIRTIME</div><div class="v">0.00</div><div class="d">час у повітрі</div></div><div class="metric"><div class="k">HEIGHT</div><div class="v">0.00 м</div><div class="d">орієнтовна висота</div></div><div class="metric"><div class="k">FLOW</div><div class="v">0%</div><div class="d">збереження руху</div></div><div class="metric"><div class="k">EST. GOE</div><div class="v">−5…+5</div><div class="d">з урахуванням довіри</div></div></div>`;
}

function elementOptions(){
  const items=[
    ['auto','Авто (лише кількість обертів)'],
    ['1T','1T'],['1S','1S'],['1Lo','1Lo'],['1F','1F'],['1Lz','1Lz'],['1A','1A'],
    ['2T','2T'],['2S','2S'],['2Lo','2Lo'],['2F','2F'],['2Lz','2Lz'],['2A','2A'],
    ['3T','3T'],['3S','3S'],['3Lo','3Lo'],['3F','3F'],['3Lz','3Lz'],['3A','3A']
  ];
  return items.map(([v,t])=>`<option ${state.element===v?'selected':''} value="${v}">${t}</option>`).join('');
}

function analyzeView(){
  if(!state.url)return home();
  const r=state.metrics?result():'';
  return `<div class="section-title"><h2>Аналіз стрибка</h2><span>SKATE v2</span></div><section class="card"><div class="video-wrap"><video id="video" src="${state.url}" playsinline controls preload="auto"></video></div><div class="form-grid" style="grid-template-columns:1fr"><div class="field"><label>Елемент</label><select id="element">${elementOptions()}</select></div></div><button class="primary" id="run">${state.metrics?'Аналізувати ще раз':'Аналізувати відео'}</button><div id="progress" class="progress hidden"><div class="bar"><div id="bar"></div></div><div class="progress-text" id="progressText">Готую аналіз…</div></div></section>${r}`;
}

const signed=n=>n>0?`+${n}`:`${n}`;
const autoLabel=element=>/J$/.test(element)?`≈ ${element.replace('J','')} об.`:element;

function result(){
  const m=state.metrics;
  const element=estimateElement(m.rotation,state.element);
  const e=estimateGOE(m,element,state.flags);
  const conf=m.confidence>=82?['Висока','high']:m.confidence>=62?['Середня','medium']:['Низька','low'];
  const range=e.goeLow===e.goeHigh?signed(e.goe):`${signed(e.goeLow)}…${signed(e.goeHigh)}`;
  const rotStatus=e.rotationCall==='ok'?'rotation OK':e.rotationCall==='uncertain'?'rotation невпевнено':e.rotationCall==='q'?'можливий q':e.rotationCall==='<'?'можливий <':e.rotationCall==='<<'?'можливий <<':'';
  return `<div class="section-title"><h2>Результат</h2><span>${autoLabel(element)}</span></div>
<section class="card score-card v2"><div class="score-ring" style="--p:${m.quality}"><div style="text-align:center"><strong>${m.quality}</strong><br><span>техніка</span></div></div><div><div class="k">Estimated GOE v2</div><div class="goe">${signed(e.goe)}</div><div style="font-size:12px;color:var(--muted);font-weight:800;margin-top:-2px">діапазон ${range}</div><span class="confidence ${conf[1]}">${conf[0]} довіра · ${m.confidence}%</span><div class="notice">GOE показує якість саме цього виконання. Чим нижча довіра камери, тим ширший діапазон.</div></div></section>
<div class="section-title"><h2>Фази та метрики</h2><span>${m.takeoff}s → ${m.landing}s</span></div>
<div class="metric-grid">
  <div class="metric"><div class="k">AIRTIME</div><div class="v">${m.airtime}s</div><div class="d">час у повітрі</div></div>
  <div class="metric"><div class="k">HEIGHT</div><div class="v">${m.height}м</div><div class="d">за airtime</div></div>
  <div class="metric"><div class="k">ROTATION</div><div class="v">${m.rotation}</div><div class="d">${rotStatus||`довіра ${m.rotationConfidence}%`}</div></div>
  <div class="metric"><div class="k">LENGTH</div><div class="v">${m.lengthBodies}×</div><div class="d">довжин тіла в польоті</div></div>
  <div class="metric"><div class="k">FLOW</div><div class="v">${m.flow}%</div><div class="d">збереження швидкості</div></div>
  <div class="metric"><div class="k">LANDING</div><div class="v">${m.landingStability}%</div><div class="d">контроль після льоду</div></div>
  <div class="metric"><div class="k">BODY</div><div class="v">${m.bodyControl}%</div><div class="d">стабільність корпусу</div></div>
  <div class="metric"><div class="k">TAKE-OFF</div><div class="v">${m.takeoffQuality}%</div><div class="d">контроль входу у політ</div></div>
</div>
<div class="section-title"><h2>Чому такий GOE</h2><span>${e.positives} +критеріїв · −${e.reductions}</span></div>
<section class="card"><ul class="reason-list">${e.reasons.map(x=>`<li><span class="tag ${x[0]}">${x[0]==='pos'?'+':x[0]==='neg'?'−':'•'}</span>${x[1]}</li>`).join('')}</ul></section>
<div class="section-title"><h2>Що камера не вирішує сама</h2><span>важливо</span></div>
<section class="card"><ul class="reason-list compact">${e.unmeasured.map(x=>`<li><span class="tag neu">?</span>${x}</li>`).join('')}</ul><p class="notice">Ці пункти не штрафуються автоматично, щоб SKATE не занижував чистий стрибок через слабкий ракурс.</p></section>
<div class="section-title"><h2>Уточнити landing</h2><span>лише якщо це реально було</span></div>
<section class="card"><div class="checks">${[['hand','Дотик рукою'],['twoFoot','Landing на дві ноги'],['stepOut','Step-out'],['fall','Fall']].map(([k,t])=>`<label class="check"><span>${t}</span><input class="switch flag" type="checkbox" data-flag="${k}" ${state.flags[k]?'checked':''}></label>`).join('')}</div><button class="primary" id="save">Зберегти результат</button></section>`;
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
  state.file=file;
  state.url=URL.createObjectURL(file);
  state.metrics=null;
  state.element='auto';
  state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};
  state.view='analyze';
  render();
}

async function runAnalysis(){
  const v=document.querySelector('#video'),box=document.querySelector('#progress'),bar=document.querySelector('#bar'),txt=document.querySelector('#progressText'),btn=document.querySelector('#run');
  if(!v)return;
  try{
    btn.disabled=true;
    box.classList.remove('hidden');
    await waitMeta(v);
    state.metrics=await analyzeVideo(v,p=>{
      bar.style.width=`${p}%`;
      txt.textContent=p<20?'Читаю рух…':p<55?'Відстежую тіло по кадрах…':p<84?'Розділяю take-off, політ і landing…':p<94?'Оцінюю rotation, flow та landing…':'Формую GOE v2…';
    });
    bar.style.width='100%';
    setTimeout(render,220);
  }catch(e){
    toast(e.message||'Помилка аналізу');
    btn.disabled=false;
    box.classList.add('hidden');
  }
}

function waitMeta(v){
  return new Promise((res,rej)=>{
    if(v.readyState>=1&&Number.isFinite(v.duration))return res();
    v.onloadedmetadata=()=>res();
    v.onerror=()=>rej(new Error('Не вдалося відкрити відео'));
  });
}

async function saveCurrent(){
  if(!state.metrics)return;
  const element=estimateElement(state.metrics.rotation,state.element);
  const ev=estimateGOE(state.metrics,element,state.flags);
  const item={id:crypto.randomUUID(),profile:'all',createdAt:Date.now(),element,metrics:state.metrics,flags:{...state.flags},goe:ev.goe,goeLow:ev.goeLow,goeHigh:ev.goeHigh,analysisVersion:2};
  await saveAnalysis(item);
  toast('Результат збережено');
  state.view='history';
  render();
  loadHistory();
}

async function loadHistory(){
  const root=document.querySelector('#history');
  if(!root)return;
  const data=await getAnalyses();
  if(!data.length){root.innerHTML='<div class="empty">Ще немає збережених стрибків.</div>';return}
  root.innerHTML=data.map(x=>{
    const landing=x.metrics.landingStability??x.metrics.stability??0;
    const ver=x.analysisVersion||x.metrics.version||1;
    const range=x.goeLow!=null&&x.goeHigh!=null&&x.goeLow!==x.goeHigh?`${signed(x.goeLow)}…${signed(x.goeHigh)}`:`v${ver}`;
    return `<div class="history-item"><div class="thumb">${autoLabel(x.element)}</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})} · ${new Date(x.createdAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}</b><p>${x.metrics.airtime}s airtime · ${x.metrics.rotation} rotation · landing ${landing}%</p></div><div class="history-score">${signed(x.goe)}<small>${range}</small></div></div>`;
  }).join('');
}

function toast(t){
  const old=document.querySelector('.toast');
  old?.remove();
  const d=document.createElement('div');
  d.className='toast';
  d.textContent=t;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),3200);
}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});
async function installApp(){
  if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;return}
  state.installGuide=true;
  render();
}

if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));
render();
