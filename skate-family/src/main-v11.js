import { analyzeVideo, estimateElement, estimateGOE } from '/src/analyzer.js?v=14';
import { beginMultiSession, endMultiSession, analyzeVideoRange } from './multi-analyzer.js?v=14';
import { estimateCascadeGOE, resolvedFall } from './cascade-score.js?v=14';
import { saveAnalysis, getAnalyses } from './db.js';

let state={view:'home',file:null,url:null,metrics:null,element:'auto',flags:{hand:false,twoFoot:false,stepOut:false,fall:false},mode:'single',markers:[],multiResults:[],fallOverrides:{},playhead:0,installPrompt:null,installGuide:false};
const el=document.querySelector('#app');
const isiOS=/iPhone|iPad|iPod/i.test(navigator.userAgent);
const isStandalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const signed=n=>n>0?`+${n}`:`${n}`;
const autoLabel=x=>/J$/.test(x)?`≈ ${x.replace('J','')} об.`:x;

function render(){
  el.innerHTML=`<div class="app"><header class="topbar"><div class="brand"><div><div class="logo"><div class="logo-mark">⛸</div><div>SKATE</div></div><div class="sub">аналіз фігурного катання</div></div></div></header><main>${state.view==='home'?home():state.view==='analyze'?analyzeView():historyView()}</main>${nav()}</div>`;
  bind();
}

function home(){
  return `<section class="hero"><h1>Кожен стрибок — це дані.</h1><p>Аналізуй один стрибок або цілу серію з одного відео. SKATE оцінює фази, flow, landing та орієнтовний GOE.</p></section>
  <div class="section-title"><h2>Новий аналіз</h2><span>локально на iPhone</span></div><section class="card"><div class="upload"><div class="upload-icon">🎥</div><h3>Додай відео</h3><p>Може бути один стрибок, комбінація або кілька окремих стрибків. Найкраще, коли все тіло в кадрі.</p><input id="fileLibrary" type="file" accept="video/*" hidden><input id="fileCamera" type="file" accept="video/*" capture="environment" hidden><div class="upload-actions"><button class="primary" id="pickLibrary">Обрати з Фото</button><button class="secondary" id="pickCamera">Зняти зараз</button></div></div>${!isStandalone?'<button class="secondary install show" id="install">Додати SKATE на екран iPhone</button>':''}<p class="notice">Відео не відправляється на сервер. Estimated GOE є допоміжною оцінкою, а не офіційним суддівським балом.</p></section>${installGuide()}`;
}

function installGuide(){
  if(!state.installGuide)return'';
  return `<section class="card" style="margin-top:12px"><h3 style="margin-top:0">Додати на iPhone</h3><ol style="padding-left:22px;line-height:1.6"><li>Відкрий у Safari.</li><li>Натисни <b>Поділитися</b> ↑.</li><li>Обери <b>На початковий екран</b>.</li></ol><button class="secondary" id="closeInstall">Зрозуміло</button></section>`;
}

const items=[['auto','Авто'],['1T','1T'],['1S','1S'],['1Lo','1Lo'],['1F','1F'],['1Lz','1Lz'],['1A','1A'],['2T','2T'],['2S','2S'],['2Lo','2Lo'],['2F','2F'],['2Lz','2Lz'],['2A','2A'],['3T','3T'],['3S','3S'],['3Lo','3Lo'],['3F','3F'],['3Lz','3Lz'],['3A','3A']];
function options(value='auto'){return items.map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${v==='auto'?'Визначити приблизно':t}</option>`).join('')}

function modeSwitch(){
  const base='flex:1;border:0;padding:11px 8px;border-radius:12px;font-weight:850;';
  return `<div style="display:flex;gap:6px;background:#edf3f7;padding:5px;border-radius:16px;margin-top:12px"><button id="modeSingle" style="${base}background:${state.mode==='single'?'white':'transparent'};color:#102231;box-shadow:${state.mode==='single'?'0 2px 8px rgba(8,28,44,.08)':'none'}">1 стрибок</button><button id="modeMulti" style="${base}background:${state.mode==='multi'?'white':'transparent'};color:#102231;box-shadow:${state.mode==='multi'?'0 2px 8px rgba(8,28,44,.08)':'none'}">Кілька стрибків</button></div>`;
}

function markerList(){
  if(!state.markers.length)return `<div class="notice" style="text-align:center;padding:12px 0">Перемотай відео на стрибок і натисни «Позначити стрибок тут». Повтори для кожного.</div>`;
  return `<div style="display:grid;gap:8px;margin-top:10px">${state.markers.map((m,i)=>`<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:9px 10px"><b style="font-size:12px">#${i+1}<br><span style="color:var(--muted);font-weight:700">${m.time.toFixed(2)}s</span></b><select class="markerElement" data-i="${i}" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;background:white">${options(m.element)}</select><button class="removeMarker" data-i="${i}" style="border:0;background:#fff0f1;color:#b53645;border-radius:10px;padding:9px 11px;font-weight:900">×</button></div>`).join('')}</div>`;
}

function analyzeView(){
  if(!state.url)return home();
  const resultHtml=state.mode==='single'&&state.metrics?singleResult():state.mode==='multi'&&state.multiResults.length?multiResults():'';
  return `<div class="section-title"><h2>Аналіз відео</h2><span>SKATE</span></div><section class="card"><div class="video-wrap"><video id="video" src="${state.url}" playsinline controls preload="auto"></video></div>${modeSwitch()}
  ${state.mode==='single'?`<div class="form-grid" style="grid-template-columns:1fr"><div class="field"><label>Елемент</label><select id="element">${options(state.element)}</select></div></div>`:`<div style="margin-top:12px"><button class="secondary" id="addMarker">＋ Позначити стрибок тут</button>${markerList()}<p class="notice">Для комбінації став окрему мітку приблизно на кожен відрив. SKATE розділить відео між сусідніми мітками.</p></div>`}
  <button class="primary" id="run" ${state.mode==='multi'&&state.markers.length<2?'disabled':''}>${state.mode==='single'?(state.metrics?'Аналізувати ще раз':'Аналізувати відео'):`Аналізувати ${state.markers.length||''} стрибки`}</button>
  <div id="progress" class="progress hidden"><div class="bar"><div id="bar"></div></div><div class="progress-text" id="progressText">Готую аналіз…</div></div></section>${resultHtml}`;
}

function evaluation(m,element,flags={}){const e=estimateGOE(m,estimateElement(m.rotation,element),flags);return e}

function singleResult(){
  const m=state.metrics,element=estimateElement(m.rotation,state.element),e=estimateGOE(m,element,state.flags),conf=m.confidence>=72?['Середня/висока','high']:m.confidence>=55?['Середня','medium']:['Низька','low'],range=e.goeLow===e.goeHigh?signed(e.goe):`${signed(e.goeLow)}…${signed(e.goeHigh)}`;
  return `<div class="section-title"><h2>Результат</h2><span>${autoLabel(element)}</span></div><section class="card score-card v2"><div class="score-ring" style="--p:${m.quality}"><div style="text-align:center"><strong>${m.quality}</strong><br><span>техніка</span></div></div><div><div class="k">Estimated GOE</div><div class="goe">${signed(e.goe)}</div><div style="font-size:12px;color:var(--muted);font-weight:800">діапазон ${range}</div><span class="confidence ${conf[1]}">${conf[0]} · ${e.confidence}%</span></div></section>${metricGrid(m)}<div class="section-title"><h2>Чому такий GOE</h2><span>${e.positives} + · −${e.reductions}</span></div><section class="card"><ul class="reason-list">${e.reasons.map(reason).join('')}</ul></section><div class="section-title"><h2>Уточнити landing</h2><span>якщо це було</span></div><section class="card"><div class="checks">${[['hand','Дотик рукою'],['twoFoot','Landing на дві ноги'],['stepOut','Step-out'],['fall','Fall']].map(([k,t])=>`<label class="check"><span>${t}</span><input class="switch flag" type="checkbox" data-flag="${k}" ${state.flags[k]?'checked':''}></label>`).join('')}</div><button class="primary" id="save">Зберегти результат</button></section>`;
}

function metricGrid(m){return `<div class="section-title"><h2>Фази та метрики</h2><span>${m.takeoff}s → ${m.landing}s</span></div><div class="metric-grid"><div class="metric"><div class="k">AIRTIME</div><div class="v">${m.airtime}s</div><div class="d">час у повітрі</div></div><div class="metric"><div class="k">HEIGHT</div><div class="v">${m.height}м</div><div class="d">за airtime</div></div><div class="metric"><div class="k">FLOW</div><div class="v">${m.flow}%</div><div class="d">збереження руху</div></div><div class="metric"><div class="k">LANDING</div><div class="v">${m.landingStability}%</div><div class="d">контроль після льоду</div></div></div>`}
function reason(x){return `<li><span class="tag ${x[0]}">${x[0]==='pos'?'+':x[0]==='neg'?'−':'•'}</span>${x[1]}</li>`}

function multiResults(){
  const cascade=estimateCascadeGOE(state.multiResults,state.markers,state.fallOverrides),cascadeRange=cascade.goeLow===cascade.goeHigh?signed(cascade.goe):`${signed(cascade.goeLow)}…${signed(cascade.goeHigh)}`;
  const fallNote=cascade.uncertainFall?`<div class="notice" style="margin-top:10px;background:#fff6dd;border-radius:12px;padding:10px;color:#70510d"><b>SKATE бачить можливе падіння.</b> Перевір перемикач біля відповідного стрибка нижче.</div>`:'';
  const cascadeReasons=`<ul class="reason-list" style="margin-top:12px">${cascade.reasons.map(reason).join('')}</ul>`;
  const primary=`<div class="section-title"><h2>Результат каскаду</h2><span>${cascade.label}</span></div><section class="card" style="border:2px solid #dbeaf5"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="k">ESTIMATED GOE КАСКАДУ</div><div style="font-size:25px;font-weight:950;margin-top:5px">${cascade.label}</div><div style="font-size:12px;color:var(--muted);font-weight:800;margin-top:3px">діапазон ${cascadeRange} · довіра ${cascade.confidence}%</div></div><div class="goe" style="font-size:54px;line-height:.95">${signed(cascade.goe)}</div></div>${cascade.fallDetected?'<div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:#fff0f1;color:#a52e3b;font-weight:900">Падіння враховано в GOE всього каскаду</div>':''}${fallNote}${cascadeReasons}<p class="notice" style="margin-bottom:0">Головна оцінка одна для всього каскаду. Нижче — діагностика кожного стрибка.</p></section>`;
  const diagnostics=`<div class="section-title"><h2>Діагностика стрибків</h2><span>${state.multiResults.length}</span></div><div style="display:grid;gap:12px">${state.multiResults.map((r,i)=>{
    const marker=state.markers[i],m=r.metrics,element=estimateElement(m.rotation,marker.element),fall=resolvedFall(m,i,state.fallOverrides),e=estimateGOE(m,element,{fall}),range=e.goeLow===e.goeHigh?signed(e.goe):`${signed(e.goeLow)}…${signed(e.goeHigh)}`;
    const prob=m.fallProbability==null?'':` · ML ${Math.round(m.fallProbability*100)}%`;
    const fallStatus=m.fallDetected?`<div style="font-size:11px;font-weight:900;color:#ad3040;margin-top:8px">⚠ Падіння виявлено${prob}</div>`:m.fallPossible?`<div style="font-size:11px;font-weight:900;color:#9a6a08;margin-top:8px">? Можливе падіння${prob}</div>`:m.fallModelAvailable?`<div style="font-size:11px;color:var(--muted);margin-top:8px">Падіння не виявлено${prob}</div>`:'';
    return `<section class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div><div class="k">СТРИБОК ${i+1} · ${marker.time.toFixed(2)}s</div><div style="font-size:24px;font-weight:950;margin-top:3px">${autoLabel(element)}</div></div><div style="text-align:right"><div class="goe" style="font-size:28px">${signed(e.goe)}</div><div style="font-size:10px;color:var(--muted);font-weight:800">діагностика ${range}</div></div></div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px"><div class="metric" style="padding:9px"><div class="k">AIR</div><div class="v" style="font-size:17px">${m.airtime}s</div></div><div class="metric" style="padding:9px"><div class="k">HEIGHT</div><div class="v" style="font-size:17px">${m.height}м</div></div><div class="metric" style="padding:9px"><div class="k">FLOW</div><div class="v" style="font-size:17px">${m.flow}%</div></div><div class="metric" style="padding:9px"><div class="k">LAND</div><div class="v" style="font-size:17px">${m.landingStability}%</div></div></div>${fallStatus}<label class="check" style="margin-top:9px"><span>Падіння було</span><input class="switch multiFall" type="checkbox" data-i="${i}" ${fall?'checked':''}></label></section>`}).join('')}</div>`;
  return `${primary}${diagnostics}<section class="card" style="margin-top:12px"><button class="primary" id="saveAll" style="margin-top:0">Зберегти каскад</button></section>`;
}

function historyView(){return `<div class="section-title"><h2>Історія</h2><span>усі стрибки</span></div><section id="history" class="history"><div class="empty">Завантажую…</div></section>`}
function nav(){return `<nav class="bottom-nav"><button class="navbtn ${state.view==='home'?'active':''}" data-view="home"><i>⌂</i>Головна</button><button class="navbtn ${state.view==='analyze'?'active':''}" data-view="analyze"><i>◎</i>Аналіз</button><button class="navbtn ${state.view==='history'?'active':''}" data-view="history"><i>◫</i>Історія</button></nav>`}

function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();if(state.view==='history')loadHistory()});
  document.querySelector('#pickLibrary')?.addEventListener('click',()=>document.querySelector('#fileLibrary').click());document.querySelector('#pickCamera')?.addEventListener('click',()=>document.querySelector('#fileCamera').click());document.querySelector('#fileLibrary')?.addEventListener('change',e=>chooseFile(e.target.files?.[0]));document.querySelector('#fileCamera')?.addEventListener('change',e=>chooseFile(e.target.files?.[0]));
  document.querySelector('#modeSingle')?.addEventListener('click',()=>setMode('single'));document.querySelector('#modeMulti')?.addEventListener('click',()=>setMode('multi'));document.querySelector('#element')?.addEventListener('change',e=>{state.element=e.target.value;if(state.metrics)render()});
  document.querySelector('#addMarker')?.addEventListener('click',addMarker);document.querySelectorAll('.removeMarker').forEach(b=>b.onclick=()=>removeMarker(+b.dataset.i));document.querySelectorAll('.markerElement').forEach(s=>s.onchange=()=>{state.markers[+s.dataset.i].element=s.value;state.multiResults=[]});
  document.querySelector('#run')?.addEventListener('click',runAnalysis);document.querySelectorAll('.flag').forEach(x=>x.onchange=()=>{state.flags[x.dataset.flag]=x.checked;render()});document.querySelectorAll('.multiFall').forEach(x=>x.onchange=()=>{state.fallOverrides[+x.dataset.i]=x.checked;render()});document.querySelector('#save')?.addEventListener('click',saveCurrent);document.querySelector('#saveAll')?.addEventListener('click',saveAll);document.querySelector('#install')?.addEventListener('click',installApp);document.querySelector('#closeInstall')?.addEventListener('click',()=>{state.installGuide=false;render()});
  const v=document.querySelector('#video');if(v&&state.playhead>0)v.addEventListener('loadedmetadata',()=>{v.currentTime=Math.min(state.playhead,Math.max(0,v.duration-.05))},{once:true});
}

function setMode(mode){const v=document.querySelector('#video');if(v)state.playhead=v.currentTime;state.mode=mode;state.metrics=null;state.multiResults=[];render()}
function addMarker(){const v=document.querySelector('#video');if(!v||!Number.isFinite(v.currentTime))return;state.playhead=v.currentTime;if(!state.markers.some(m=>Math.abs(m.time-v.currentTime)<.18)){state.markers.push({time:v.currentTime,element:'auto'});state.markers.sort((a,b)=>a.time-b.time)}render()}
function removeMarker(i){state.markers.splice(i,1);state.multiResults=[];render()}
function chooseFile(file){if(!file)return;if(state.url)URL.revokeObjectURL(state.url);state.file=file;state.url=URL.createObjectURL(file);state.metrics=null;state.multiResults=[];state.markers=[];state.mode='single';state.element='auto';state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};state.fallOverrides={};state.playhead=0;state.view='analyze';render()}

async function runAnalysis(){
  const v=document.querySelector('#video'),box=document.querySelector('#progress'),bar=document.querySelector('#bar'),txt=document.querySelector('#progressText'),btn=document.querySelector('#run');if(!v)return;
  try{btn.disabled=true;box.classList.remove('hidden');await waitMeta(v);
    if(state.mode==='single'){
      state.metrics=await analyzeVideo(v,p=>{bar.style.width=`${p}%`;txt.textContent=p<55?'Відстежую тіло по кадрах…':p<90?'Визначаю фази стрибка…':'Формую GOE…'});bar.style.width='100%';setTimeout(render,180);return;
    }
    if(state.markers.length<2)throw new Error('Познач щонайменше два стрибки');
    state.markers.sort((a,b)=>a.time-b.time);state.multiResults=[];state.fallOverrides={};await beginMultiSession();
    for(let i=0;i<state.markers.length;i++){
      const cur=state.markers[i],prev=state.markers[i-1],next=state.markers[i+1];let start=prev?(prev.time+cur.time)/2:Math.max(0,cur.time-1.4);let end=next?(cur.time+next.time)/2:Math.min(v.duration,cur.time+1.6);
      if(end-start<.7){start=Math.max(0,cur.time-.35);end=Math.min(v.duration,cur.time+.45)}
      txt.textContent=`Аналізую стрибок ${i+1} з ${state.markers.length}…`;
      const metrics=await analyzeVideoRange(v,start,end,p=>{bar.style.width=`${Math.round(((i+p/100)/state.markers.length)*100)}%`});state.multiResults.push({metrics,start,end});
    }
    endMultiSession();bar.style.width='100%';setTimeout(render,180);
  }catch(e){endMultiSession();toast(e.message||'Помилка аналізу');btn.disabled=false;box.classList.add('hidden')}
}

function waitMeta(v){return new Promise((res,rej)=>{if(v.readyState>=1&&Number.isFinite(v.duration))return res();v.onloadedmetadata=()=>res();v.onerror=()=>rej(new Error('Не вдалося відкрити відео'))})}

async function saveCurrent(){if(!state.metrics)return;const element=estimateElement(state.metrics.rotation,state.element),ev=estimateGOE(state.metrics,element,state.flags);await saveAnalysis({id:crypto.randomUUID(),profile:'all',createdAt:Date.now(),element,metrics:state.metrics,flags:{...state.flags},goe:ev.goe,goeLow:ev.goeLow,goeHigh:ev.goeHigh,analysisVersion:3});toast('Результат збережено');state.view='history';render();loadHistory()}
async function saveAll(){if(!state.multiResults.length)return;const sequenceId=crypto.randomUUID(),cascade=estimateCascadeGOE(state.multiResults,state.markers,state.fallOverrides);for(let i=0;i<state.multiResults.length;i++){const m=state.multiResults[i].metrics,marker=state.markers[i],element=estimateElement(m.rotation,marker.element),fall=resolvedFall(m,i,state.fallOverrides),ev=estimateGOE(m,element,{fall});await saveAnalysis({id:crypto.randomUUID(),profile:'all',createdAt:Date.now()+i,element,metrics:m,flags:{fall},goe:ev.goe,goeLow:ev.goeLow,goeHigh:ev.goeHigh,analysisVersion:4,sequenceId,jumpIndex:i+1,sourceTime:marker.time,cascadeLabel:cascade.label,cascadeGoe:cascade.goe,cascadeGoeLow:cascade.goeLow,cascadeGoeHigh:cascade.goeHigh})}toast(`Каскад ${cascade.label} збережено`);state.view='history';render();loadHistory()}

async function loadHistory(){const root=document.querySelector('#history');if(!root)return;const data=await getAnalyses();if(!data.length){root.innerHTML='<div class="empty">Ще немає збережених стрибків.</div>';return}root.innerHTML=data.map(x=>{const landing=x.metrics.landingStability??x.metrics.stability??0,range=x.goeLow!=null&&x.goeHigh!=null&&x.goeLow!==x.goeHigh?`${signed(x.goeLow)}…${signed(x.goeHigh)}`:`v${x.analysisVersion||x.metrics.version||1}`,seq=x.sequenceId?` · серія #${x.jumpIndex}`:'';return `<div class="history-item"><div class="thumb">${autoLabel(x.element)}</div><div><b>${new Date(x.createdAt).toLocaleDateString('uk-UA',{day:'2-digit',month:'short'})}${seq}</b><p>${x.metrics.airtime}s airtime · landing ${landing}%</p></div><div class="history-score">${signed(x.goe)}<small>${range}</small></div></div>`}).join('')}

function toast(t){document.querySelector('.toast')?.remove();const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),3200)}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});async function installApp(){if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;return}if(isiOS){state.installGuide=true;render();return}state.installGuide=true;render()}
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));render();
