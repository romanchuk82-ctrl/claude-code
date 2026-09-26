let scheduled=false;

function setStatus(text){
  const node=document.querySelector('#autoFindStatus');
  if(node&&node.textContent!==text)node.textContent=text;
}

function calibrateFirstJump(){
  const preset=document.querySelector('#cascadePreset');
  const selects=[...document.querySelectorAll('.markerElement')];
  if(!preset||selects.length<2)return;

  // Only calibrate SKATE's own automatic suggestion. A user choice or a learned
  // correction must always win and must never be changed behind the user's back.
  const first=selects[0];
  if(first.dataset.skateSuggested!=='1'||first.dataset.skateLearned==='1')return;
  if(preset.value&& !String(preset.value).startsWith('count:'))return;

  const match=String(first.value||'').match(/^(\d)T$/);
  if(!match)return;

  // With one phone camera, ankle lift is not a reliable toe-pick detector: a Salchow
  // free-leg swing can create the same pose signal. Therefore an unlearned first-jump
  // Toe Loop guess is treated as an ambiguous edge/toe case and defaults to Salchow.
  // If this is really a Toe Loop, changing it once teaches the local correction model.
  const corrected=`${match[1]}S`;
  if(![...first.options].some(o=>o.value===corrected))return;

  first.value=corrected;
  first.dataset.skateOriginal=corrected;
  first.dataset.skateSuggested='1';
  first.dispatchEvent(new Event('change',{bubbles:true}));

  const label=selects.map(s=>s.value).join(' + ');
  setStatus(`SKATE пропонує: ${label}. Перший стрибок визначено обережно як Salchow, бо з одного ракурсу toe-pick ненадійний. Якщо це Toe Loop — просто зміни список, і SKATE запам'ятає виправлення.`);
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    calibrateFirstJump();
  });
}

document.addEventListener('change',e=>{
  if(e.target?.classList?.contains('markerElement'))schedule();
},true);

document.addEventListener('click',e=>{
  if(e.target?.id==='autoFindJumps')setTimeout(schedule,80);
},true);

const app=document.querySelector('#app')||document.documentElement;
new MutationObserver(m=>{
  if(m.some(x=>x.addedNodes.length||x.removedNodes.length))schedule();
}).observe(app,{subtree:true,childList:true});

schedule();
