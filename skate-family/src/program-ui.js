import { analyzeProgram, scoreProgram, PROGRAM_TYPES, ELEMENT_OPTIONS, formatTime } from './programJudge.js?v=1';

const state={url:null,file:null,program:null,type:'womenFS',busy:false};
let observer=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const signed=n=>Number(n)>0?`+${n}`:`${n}`;

function injectStyle(){
  if(document.querySelector('#programJudgeStyle'))return;
  const style=document.createElement('style');
  style.id='programJudgeStyle';
  style.textContent=`
  .pj-home{margin-bottom:14px}.pj-feature{border:2px solid #d9eaf8;background:linear-gradient(180deg,#f9fcff,#fff);box-shadow:0 12px 30px rgba(23,83,126,.08)}
  .pj-feature-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}.pj-medal{width:48px;height:48px;border-radius:15px;background:#e7f3ff;display:grid;place-items:center;font-size:25px;flex:0 0 auto}
  .pj-feature h3{margin:0;font-size:20px}.pj-feature p{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.pj-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.pj-tags span{font-size:10px;font-weight:900;padding:5px 7px;border-radius:999px;background:#edf5fa;color:#31566e}
  .pj-overlay{position:fixed;inset:0;z-index:99999;background:#f5f8fa;overflow:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(32px + env(safe-area-inset-bottom))}.pj-shell{max-width:760px;margin:0 auto}.pj-head{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:rgba(245,248,250,.96);backdrop-filter:blur(14px);border-bottom:1px solid #dfe8ee}.pj-head button{border:0;background:white;border-radius:12px;width:42px;height:42px;font-size:21px;box-shadow:0 2px 10px rgba(0,0,0,.06)}.pj-title{font-weight:950;font-size:18px;color:#102231}.pj-sub{font-size:11px;color:#718797;font-weight:750}
  .pj-pad{padding:14px}.pj-video{background:#06131c;border-radius:18px;overflow:hidden}.pj-video video{display:block;width:100%;max-height:42vh;background:#06131c}.pj-card{background:white;border:1px solid #dce6ec;border-radius:18px;padding:14px;margin-top:12px;box-shadow:0 8px 26px rgba(13,47,70,.05)}.pj-note{font-size:12px;line-height:1.45;color:#718797}.pj-progress{height:9px;background:#e8f0f5;border-radius:999px;overflow:hidden;margin-top:12px}.pj-progress>div{height:100%;background:#1785eb;width:0;transition:width .2s}.pj-progress-label{margin-top:8px;font-size:12px;font-weight:850;color:#48687e}
  .pj-btn{width:100%;border:0;border-radius:14px;padding:14px 12px;font-weight:950;font-size:15px;background:#1785eb;color:white}.pj-btn.secondary{background:#edf5fa;color:#15364d}.pj-select,.pj-input{width:100%;border:1px solid #d8e3ea;border-radius:11px;background:white;padding:9px 10px;font:inherit;font-weight:800;color:#102231}.pj-summary{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.pj-stat{background:#f3f8fb;border-radius:14px;padding:12px}.pj-stat .k{font-size:10px;font-weight:900;color:#718797;letter-spacing:.04em}.pj-stat .v{font-size:25px;font-weight:950;color:#102231;margin-top:3px}.pj-total{background:#0d2a3e;color:white}.pj-total .k,.pj-total .v{color:white}.pj-total .v{font-size:34px}
  .pj-section-title{display:flex;justify-content:space-between;align-items:end;gap:10px;margin:18px 2px 7px}.pj-section-title b{font-size:16px;color:#102231}.pj-section-title span{font-size:11px;color:#718797;font-weight:800}.pj-row{background:white;border:1px solid #dce6ec;border-radius:15px;padding:11px;margin-top:8px}.pj-row.warn{border-color:#efc36b;background:#fffaf0}.pj-row-top{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center}.pj-time{border:0;background:#edf5fa;color:#245775;border-radius:10px;padding:8px;font-size:11px;font-weight:900}.pj-del{border:0;background:#fff0f1;color:#b53645;border-radius:10px;width:36px;height:36px;font-weight:950}.pj-row-grid{display:grid;grid-template-columns:1fr 92px;gap:8px;margin-top:8px}.pj-meta{font-size:10px;color:#718797;font-weight:750;margin-top:6px}.pj-bonus{color:#16744b;font-weight:950}.pj-pcs{display:grid;gap:9px}.pj-pcs-line{display:grid;grid-template-columns:1fr 88px;gap:10px;align-items:center}.pj-pcs-line label{font-size:12px;font-weight:850;color:#29485d}.pj-footer-gap{height:24px}
  @media(min-width:680px){.pj-summary{grid-template-columns:repeat(4,1fr)}.pj-row-grid{grid-template-columns:1fr 120px}.pj-pad{padding:20px}}
  `;
  document.head.appendChild(style);
}

function homeCard(){
  return `<div id="programJudgeCard" class="pj-home"><div class="section-title"><h2>Оцінити весь виступ</h2><span>ISU-style · локально</span></div><section class="card pj-feature"><div class="pj-feature-head"><div class="pj-medal">🏆</div><div><h3>SKATE Judge</h3><p>Повне відео програми: пошук елементів, Estimated GOE, TES, PCS, deductions і підсумковий бал.</p></div></div><input id="programJudgeFile" type="file" accept="video/*" hidden><button class="primary" id="pickProgramJudge">Оцінити весь виступ</button><div class="pj-tags"><span>TES</span><span>GOE −5…+5</span><span>PCS</span><span>Protocol</span></div><p class="notice" style="margin-bottom:0">Працює без платного AI API. Тип елемента з одного ракурсу може бути неточним - після аналізу його можна виправити вручну.</p></section></div>`;
}

function ensureHomeCard(){
  injectStyle();
  if(document.querySelector('#programJudgeCard')||document.querySelector('#programJudgeOverlay'))return;
  const main=document.querySelector('main');
  if(!main||!document.querySelector('#pickLibrary'))return;
  const firstTitle=[...main.querySelectorAll('.section-title')].find(x=>/Новий аналіз|Аналіз/i.test(x.textContent||''));
  if(firstTitle)firstTitle.insertAdjacentHTML('beforebegin',homeCard());
  else main.insertAdjacentHTML('afterbegin',homeCard());
}

function waitMetadata(video){
  return new Promise((resolve,reject)=>{
    if(video.readyState>=1&&Number.isFinite(video.duration))return resolve();
    const done=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Не вдалося відкрити відео'))},clean=()=>{video.removeEventListener('loadedmetadata',done);video.removeEventListener('error',bad)};
    video.addEventListener('loadedmetadata',done,{once:true});video.addEventListener('error',bad,{once:true});
  });
}

function typeOptions(){return Object.entries(PROGRAM_TYPES).map(([k,v])=>`<option value="${k}" ${k===state.type?'selected':''}>${esc(v.label)}</option>`).join('')}
function elementOptions(value){return ELEMENT_OPTIONS.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}
function goeOptions(value){return [-5,-4,-3,-2,-1,0,1,2,3,4,5].map(v=>`<option value="${v}" ${Number(value)===v?'selected':''}>${signed(v)}</option>`).join('')}

function overlayShell(){
  return `<div id="programJudgeOverlay" class="pj-overlay"><div class="pj-shell"><div class="pj-head"><button id="closeProgramJudge" aria-label="Закрити">‹</button><div><div class="pj-title">SKATE Judge</div><div class="pj-sub">оцінка повного виступу</div></div></div><div class="pj-pad"><div class="pj-video"><video id="programJudgeVideo" src="${esc(state.url)}" playsinline controls preload="auto"></video></div><div id="programJudgeBody"></div><div class="pj-footer-gap"></div></div></div></div>`;
}

function renderReady(){
  const body=document.querySelector('#programJudgeBody');if(!body)return;
  body.innerHTML=`<section class="pj-card"><label class="pj-note" for="programType">Формат програми</label><select id="programType" class="pj-select" style="margin-top:7px">${typeOptions()}</select><button class="pj-btn" id="runProgramJudge" style="margin-top:12px">Проаналізувати весь виступ</button><p class="pj-note" style="margin-bottom:0">Аналіз виконується локально на iPhone. Для довгого відео це може тривати кілька хвилин. Відео нікуди не завантажується.</p></section>`;
}

function renderProgress(p=0,text='Аналізую відео…'){
  const body=document.querySelector('#programJudgeBody');if(!body)return;
  if(!document.querySelector('#programJudgeProgress'))body.innerHTML=`<section id="programJudgeProgress" class="pj-card"><b>${esc(text)}</b><div class="pj-progress"><div id="programJudgeBar"></div></div><div class="pj-progress-label" id="programJudgeProgressLabel">0%</div><p class="pj-note">SKATE проходить програму, шукає стрибки та обертання і оцінює рух. Не закривай цей екран під час аналізу.</p></section>`;
  const bar=document.querySelector('#programJudgeBar'),label=document.querySelector('#programJudgeProgressLabel');
  if(bar)bar.style.width=`${clamp(p,0,100)}%`;if(label)label.textContent=`${Math.round(p)}%`;
}

function score(){return state.program?scoreProgram(state.program,state.type):null}

function renderResults(){
  const body=document.querySelector('#programJudgeBody');if(!body||!state.program)return;
  const s=score(),missing=s.elements.filter(x=>!x.code).length;
  const rows=s.elements.map((x,i)=>{
    const src=state.program.elements[i]||x;
    const kind=src.kind==='jump'?'стрибок':src.kind==='spin'?'обертання':'елемент';
    const bonus=x.x?'<span class="pj-bonus"> · x1.1</span>':'';
    const warn=!x.code?' warn':'';
    return `<div class="pj-row${warn}" data-row="${i}"><div class="pj-row-top"><button class="pj-time" data-pj-seek="${src.time||0}">${formatTime(src.time||0)}</button><b>${kind.toUpperCase()}${bonus}</b><button class="pj-del" data-pj-delete="${i}" aria-label="Видалити">×</button></div><div class="pj-row-grid"><select class="pj-select" data-pj-element="${i}">${elementOptions(src.code||'')}</select><select class="pj-select" data-pj-goe="${i}" aria-label="GOE">${goeOptions(src.goe)}</select></div><div class="pj-meta">GOE ${signed(src.goe||0)} · BV ${x.base.toFixed(2)} · ${signed(x.goePoints.toFixed(2))} → <b>${x.score.toFixed(2)}</b>${src.confidence!=null?` · auto confidence ${src.confidence}%`:''}</div></div>`;
  }).join('');
  const p=state.program.pcs;
  body.innerHTML=`
    <section class="pj-card"><label class="pj-note" for="programType">Формат програми</label><select id="programType" class="pj-select" style="margin-top:7px">${typeOptions()}</select><div class="pj-summary" style="margin-top:12px"><div class="pj-stat pj-total"><div class="k">TOTAL</div><div class="v">${s.total.toFixed(2)}</div></div><div class="pj-stat"><div class="k">TES</div><div class="v">${s.tes.toFixed(2)}</div></div><div class="pj-stat"><div class="k">PCS</div><div class="v">${s.pcs.toFixed(2)}</div></div><div class="pj-stat"><div class="k">DEDUCTIONS</div><div class="v">−${s.deductions.toFixed(2)}</div></div></div><p class="pj-note" style="margin-bottom:0">Якість розпізнавання кадру: ${state.program.confidence}%. Це автоматична ISU-style оцінка, не офіційний протокол суддівської панелі.</p></section>
    <div class="pj-section-title"><b>Технічний протокол</b><span>${s.elements.length} елементів${missing?` · ${missing} треба підтвердити`:''}</span></div>
    ${rows||'<section class="pj-card"><p class="pj-note">Автоматично елементи не знайдені. Перемотай відео до елемента й додай його вручну.</p></section>'}
    <button class="pj-btn secondary" id="addProgramElement" style="margin-top:10px">＋ Додати елемент у поточному місці відео</button>
    <div class="pj-section-title"><b>Program Components</b><span>0.00–10.00</span></div>
    <section class="pj-card pj-pcs"><div class="pj-pcs-line"><label>Composition</label><input class="pj-input" data-pj-pcs="composition" type="number" min="0" max="10" step="0.25" value="${p.composition}"></div><div class="pj-pcs-line"><label>Presentation</label><input class="pj-input" data-pj-pcs="presentation" type="number" min="0" max="10" step="0.25" value="${p.presentation}"></div><div class="pj-pcs-line"><label>Skating Skills</label><input class="pj-input" data-pj-pcs="skatingSkills" type="number" min="0" max="10" step="0.25" value="${p.skatingSkills}"></div></section>
    <div class="pj-section-title"><b>Deductions</b><span>падіння</span></div>
    <section class="pj-card"><div class="pj-pcs-line"><label>Кількість падінь</label><input id="programFalls" class="pj-input" type="number" min="0" max="20" step="1" value="${state.program.fallCount||0}"></div></section>
    <button class="pj-btn secondary" id="rerunProgramJudge" style="margin-top:12px">Перезапустити автоматичний аналіз</button>`;
}

async function runAnalysis(){
  if(state.busy)return;
  const video=document.querySelector('#programJudgeVideo');if(!video)return;
  state.busy=true;state.program=null;renderProgress(1,'Аналізую весь виступ…');
  try{
    await waitMetadata(video);
    const result=await analyzeProgram(video,p=>renderProgress(p,'Аналізую весь виступ…'));
    state.program=result;renderProgress(100,'Готово');setTimeout(renderResults,120);
  }catch(err){
    const body=document.querySelector('#programJudgeBody');
    if(body)body.innerHTML=`<section class="pj-card"><b>Не вдалося завершити аналіз</b><p class="pj-note">${esc(err?.message||err)}</p><button class="pj-btn" id="runProgramJudge">Спробувати ще раз</button></section>`;
  }finally{state.busy=false}
}

async function openFile(file){
  if(!file)return;
  if(state.url)URL.revokeObjectURL(state.url);
  state.file=file;state.url=URL.createObjectURL(file);state.program=null;
  document.querySelector('#programJudgeOverlay')?.remove();
  document.body.insertAdjacentHTML('beforeend',overlayShell());
  document.body.style.overflow='hidden';
  const video=document.querySelector('#programJudgeVideo');
  try{await waitMetadata(video);renderReady()}catch(err){const body=document.querySelector('#programJudgeBody');if(body)body.innerHTML=`<section class="pj-card"><b>${esc(err.message)}</b></section>`}
}

function closeOverlay(){
  document.querySelector('#programJudgeOverlay')?.remove();document.body.style.overflow='';
  if(state.url){URL.revokeObjectURL(state.url);state.url=null}state.file=null;state.program=null;state.busy=false;
  ensureHomeCard();
}

function resort(){if(state.program)state.program.elements.sort((a,b)=>(a.time||0)-(b.time||0))}

function bindGlobal(){
  document.addEventListener('click',e=>{
    const t=e.target;
    if(t?.id==='pickProgramJudge'){document.querySelector('#programJudgeFile')?.click();return}
    if(t?.id==='closeProgramJudge'){closeOverlay();return}
    if(t?.id==='runProgramJudge'||t?.id==='rerunProgramJudge'){runAnalysis();return}
    if(t?.id==='addProgramElement'&&state.program){const video=document.querySelector('#programJudgeVideo');state.program.elements.push({id:crypto.randomUUID(),kind:'manual',time:Number(video?.currentTime||0),code:'',goe:0,confidence:100,needsConfirm:false,metrics:{}});resort();renderResults();return}
    const seek=t?.closest?.('[data-pj-seek]');if(seek){const video=document.querySelector('#programJudgeVideo');if(video)video.currentTime=Number(seek.dataset.pjSeek)||0;return}
    const del=t?.closest?.('[data-pj-delete]');if(del&&state.program){state.program.elements.splice(Number(del.dataset.pjDelete),1);renderResults();return}
  },true);

  document.addEventListener('change',e=>{
    const t=e.target;
    if(t?.id==='programJudgeFile'){openFile(t.files?.[0]);t.value='';return}
    if(t?.id==='programType'){state.type=t.value;renderResults();return}
    if(t?.dataset?.pjElement!==undefined&&state.program){const i=Number(t.dataset.pjElement);if(state.program.elements[i]){state.program.elements[i].code=t.value;state.program.elements[i].needsConfirm=false;renderResults()}return}
    if(t?.dataset?.pjGoe!==undefined&&state.program){const i=Number(t.dataset.pjGoe);if(state.program.elements[i]){state.program.elements[i].goe=clamp(Number(t.value)||0,-5,5);renderResults()}return}
    if(t?.dataset?.pjPcs&&state.program){state.program.pcs[t.dataset.pjPcs]=clamp(Number(t.value)||0,0,10);renderResults();return}
    if(t?.id==='programFalls'&&state.program){state.program.fallCount=clamp(Math.round(Number(t.value)||0),0,20);renderResults();return}
  },true);
}

injectStyle();bindGlobal();ensureHomeCard();
observer=new MutationObserver(()=>ensureHomeCard());observer.observe(document.querySelector('#app')||document.body,{subtree:true,childList:true});
