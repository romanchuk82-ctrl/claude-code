function mountJudgeEntry(){
  const hero=document.querySelector('#app .hero');
  if(!hero||document.querySelector('#isuJudgeEntry'))return;
  const wrap=document.createElement('div');
  wrap.id='isuJudgeEntry';
  wrap.innerHTML=`<div class="section-title"><h2>Повний виступ</h2><span>нове · ISU Judge</span></div><a href="/judge.html" class="card featured-card judge-entry-link"><div class="feature-icon">🏆</div><div class="feature-copy"><h3>Оцінити весь виступ</h3><p>Estimated TES + GOE + PCS + deductions і редагований протокол за повним відео.</p></div><div class="feature-tags"><span>TES</span><span>GOE −5…+5</span><span>PCS</span></div><div class="judge-entry-cta">Відкрити суддівську панель ›</div></a>`;
  hero.insertAdjacentElement('afterend',wrap);
}
const root=document.querySelector('#app');
if(root)new MutationObserver(mountJudgeEntry).observe(root,{childList:true,subtree:true});
queueMicrotask(mountJudgeEntry);
