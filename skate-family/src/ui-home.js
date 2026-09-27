function enhanceHome(){
  const main=document.querySelector('main');
  const hero=main?.querySelector('.hero');
  const single=document.querySelector('#homeSingle');
  const pass=document.querySelector('#homePass');
  const program=document.querySelector('#homeProgram');
  if(!main||!hero||!single||!pass||!program||hero.dataset.uiEnhanced==='1')return;

  hero.dataset.uiEnhanced='1';
  hero.classList.add('home-intro');
  hero.innerHTML=`<div class="home-kicker">⛸ SKATE · ISU 2025/26</div><h1>Що хочеш оцінити?</h1><p>Обери тип відео. Далі SKATE сам покаже потрібний аналіз і результат.</p>`;

  const titles=[...main.querySelectorAll('.section-title')];
  const pickerTitle=titles.find(x=>x.querySelector('h2')?.textContent?.includes('Що аналізуємо'));
  const pickerCard=pickerTitle?.nextElementSibling;
  if(pickerTitle){
    pickerTitle.classList.add('home-mode-title');
    pickerTitle.innerHTML='<h2>Обери режим</h2><span>1 крок</span>';
  }
  pickerCard?.classList.add('mode-picker');

  single.className='mode-option mode-single';
  single.innerHTML='<span class="mode-icon">⛸</span><span class="mode-copy"><b>Один стрибок</b><small>Один окремий стрибок з заходом і приземленням</small><span class="mode-time">3–15 секунд</span></span>';

  pass.className='mode-option mode-pass';
  pass.innerHTML='<span class="mode-icon">⛸⛸</span><span class="mode-copy"><b>Каскад або кілька стрибків</b><small>Combo, jump sequence або коротка серія</small><span class="mode-time">до 25 секунд</span></span>';

  program.className='mode-option mode-program';
  program.innerHTML='<span class="mode-icon">🏆</span><span class="mode-copy"><b>Повний виступ</b><small>Елементи, TES, PCS, deductions і загальна оцінка</small><span class="mode-time">до 5½ хв</span></span>';

  const note=pickerCard?.querySelector('.notice');
  if(note)note.textContent='Порада: для точнішого результату фігурист має бути повністю в кадрі.';

  titles.forEach(title=>{
    const h=title.querySelector('h2')?.textContent?.trim();
    if(['Один стрибок','Кілька стрибків','Повний виступ'].includes(h)){
      title.classList.add('home-legacy-upload');
      title.nextElementSibling?.classList.add('home-legacy-upload');
    }
  });

  if(pickerCard && !main.querySelector('.home-privacy-note')){
    const info=document.createElement('div');
    info.className='home-privacy-note';
    info.innerHTML='<span>🔒</span><span><b>Відео обробляється у браузері.</b><br>Обери режим і файл - зайві технічні кроки приховані.</span>';
    pickerCard.after(info);
  }

  const directPick=(button,inputSelector)=>{
    button.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      document.querySelector(inputSelector)?.click();
    },true);
  };
  directPick(single,'#fileLibrary');
  directPick(pass,'#passLibrary');
  directPick(program,'#programLibrary');
}

const observer=new MutationObserver(()=>enhanceHome());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('DOMContentLoaded',enhanceHome);
enhanceHome();
