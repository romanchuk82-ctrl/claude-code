let scheduled=false;
let autoSession=false;
let sessionMode='';
let sessionTimer=null;
let calibratedFirst=false;
const pending=new Map();

function setStatus(text){
  const node=document.querySelector('#autoFindStatus');
  if(node&&node.textContent!==text)node.textContent=text;
}

function markerIndex(node){
  const raw=node?.dataset?.i;
  if(raw!==undefined&&raw!=='')return Number(raw);
  return [...document.querySelectorAll('.markerElement')].indexOf(node);
}

function autoOrCountMode(){
  const value=String(sessionMode||document.querySelector('#cascadePreset')?.value||'');
  return !value||value.startsWith('count:');
}

function startAutoSession(){
  autoSession=true;
  calibratedFirst=false;
  pending.clear();
  sessionMode=String(document.querySelector('#cascadePreset')?.value||'');
  if(sessionTimer)clearTimeout(sessionTimer);
  sessionTimer=setTimeout(()=>{autoSession=false},90000);
}

function remember(node,index){
  pending.set(index,{
    value:String(node.value||''),
    learned:node.dataset.skateLearned==='1'
  });
}

function rehydrateSuggestionState(){
  const selects=[...document.querySelectorAll('.markerElement')];
  selects.forEach((select,index)=>{
    const saved=pending.get(index);
    if(!saved||select.value!==saved.value)return;
    select.dataset.skateSuggested='1';
    select.dataset.skateOriginal=saved.value;
    select.dataset.skateLearned=saved.learned?'1':'0';
  });
}

function finishCalibrationNote(){
  if(!calibratedFirst)return;
  const selects=[...document.querySelectorAll('.markerElement')];
  if(selects.length<2)return;
  const label=selects.map(s=>s.value).join(' + ');
  const node=document.querySelector('#autoFindStatus');
  if(!node)return;
  const current=String(node.textContent||'');
  if(current.includes('Запам')||current.includes('Виправлення'))return;
  setStatus(`SKATE пропонує: ${label}. Перший стрибок у неоднозначній парі Salchow / Toe Loop обрано обережно як Salchow. Якщо це Toe Loop — зміни тип вручну, SKATE запам'ятає виправлення.`);
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    rehydrateSuggestionState();
    if(calibratedFirst)setTimeout(finishCalibrationNote,80);
  });
}

// The automatic cascade module writes the proposed value and then dispatches a
// change event. main-v11 re-renders the marker list on that same event, so any
// correction done after the render is too late. Intercept the event in capture
// phase and calibrate the value BEFORE the app stores it in state.
document.addEventListener('change',e=>{
  const target=e.target;
  if(!target?.classList?.contains('markerElement'))return;
  const index=markerIndex(target);
  if(index<0)return;

  const suggested=target.dataset.skateSuggested==='1';
  const learned=target.dataset.skateLearned==='1';

  if(autoSession&&suggested&&index===0&&!learned&&autoOrCountMode()){
    const match=String(target.value||'').match(/^(\d)T$/);
    if(match){
      const corrected=`${match[1]}S`;
      if([...target.options].some(o=>o.value===corrected)){
        target.value=corrected;
        target.dataset.skateOriginal=corrected;
        calibratedFirst=true;
      }
    }
  }

  if(suggested||autoSession)remember(target,index);
  schedule();
},true);

document.addEventListener('click',e=>{
  if(e.target?.id!=='autoFindJumps')return;
  startAutoSession();
  setTimeout(schedule,80);
},true);

const app=document.querySelector('#app')||document.documentElement;
new MutationObserver(m=>{
  if(m.some(x=>x.addedNodes.length||x.removedNodes.length))schedule();
}).observe(app,{subtree:true,childList:true});

schedule();
