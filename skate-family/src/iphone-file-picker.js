const isiOS=/iPhone|iPad|iPod/i.test(navigator.userAgent);
const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
let patchedInput=null;
let fallbackBusy=false;

function showPickerMessage(html,tone='info'){
  const upload=document.querySelector('.upload');
  if(!upload)return;
  let box=upload.querySelector('[data-ios-picker-message]');
  if(!box){
    box=document.createElement('div');
    box.dataset.iosPickerMessage='1';
    upload.appendChild(box);
  }
  const palette=tone==='warn'?'background:#fff6dd;color:#70510d;border:1px solid #f0d28b':'background:#eef7ff;color:#24536f;border:1px solid #cfe6f6';
  box.style.cssText=`margin-top:10px;padding:11px 12px;border-radius:13px;font-size:12px;line-height:1.45;font-weight:800;${palette}`;
  box.innerHTML=html;
}

function validVideo(file){
  if(!file)return false;
  return /^video\//i.test(file.type||'')||/\.(mp4|mov|m4v|avi|webm)$/i.test(file.name||'');
}

function configurePhotoPicker(input){
  fallbackBusy=false;
  try{input.value=''}catch{}
  input.accept='video/*';
  // On iOS this requests the explicit multi-select confirmation flow. The app
  // still consumes only files[0], but PHPicker now has a deterministic Done/Add step.
  input.multiple=true;
}

function configureFilesPicker(input){
  fallbackBusy=true;
  try{input.value=''}catch{}
  input.multiple=false;
  input.removeAttribute('accept');
  input.click();
}

function addFallbackUI(input){
  const actions=document.querySelector('.upload-actions');
  if(!actions||document.querySelector('#pickFromFilesIOS'))return;

  const files=document.createElement('button');
  files.id='pickFromFilesIOS';
  files.type='button';
  files.className='secondary';
  files.textContent='📁 Через Файли';
  files.style.cssText='width:100%;margin-top:8px';
  actions.insertAdjacentElement('afterend',files);
  files.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    showPickerMessage('<b>Вибір через Файли</b><br>Якщо відео зараз тільки у Фото: Фото → Поділитися → «Зберегти у Файли» → «На моєму iPhone», потім обери його тут. Це обходить збій Photo Library у WebKit на великих відео.');
    configureFilesPicker(input);
  });

  if(standalone){
    const safari=document.createElement('a');
    safari.id='openInSafariIOS';
    safari.href=`https://skate-family.pages.dev/?safariPicker=${Date.now()}`;
    safari.target='_blank';
    safari.rel='noopener';
    safari.className='secondary';
    safari.textContent='↗ Відкрити вибір у Safari';
    safari.style.cssText='display:block;text-align:center;text-decoration:none;width:100%;box-sizing:border-box;margin-top:8px';
    files.insertAdjacentElement('afterend',safari);
  }

  const note=document.createElement('div');
  note.style.cssText='margin-top:8px;font-size:11px;line-height:1.4;color:var(--muted);font-weight:750';
  note.textContent='Для довгих відео на iOS 26 SKATE має два запасні шляхи: Safari або локальний файл. Саме відео як і раніше не завантажується на сервер.';
  (document.querySelector('#openInSafariIOS')||files).insertAdjacentElement('afterend',note);
}

function patchInput(){
  if(!isiOS)return;
  const input=document.querySelector('#fileLibrary');
  const photoButton=document.querySelector('#pickLibrary');
  if(!input||!photoButton)return;
  if(patchedInput===input){addFallbackUI(input);return}
  patchedInput=input;

  configurePhotoPicker(input);
  photoButton.addEventListener('pointerdown',()=>configurePhotoPicker(input),true);
  photoButton.addEventListener('touchstart',()=>configurePhotoPicker(input),{capture:true,passive:true});

  input.addEventListener('change',()=>{
    const file=input.files?.[0];
    if(!file)return;
    if(!validVideo(file)){
      showPickerMessage('Це не схоже на відеофайл. Обери MP4/MOV/M4V.','warn');
      return;
    }
    showPickerMessage(`<b>Відео отримано від iPhone</b><br>${file.name||'Відео'} · ${(file.size/1024/1024).toFixed(0)} MB. Відкриваю в SKATE…`);
    if(fallbackBusy)setTimeout(()=>{input.accept='video/*';fallbackBusy=false},1000);
  },true);

  input.addEventListener('cancel',()=>{
    showPickerMessage('<b>iPhone не передав вибране відео сайту.</b><br>Це збій системного Photo Library у WebKit, а не розміру SKATE. Спробуй «Відкрити вибір у Safari» або «Через Файли».','warn');
    if(fallbackBusy){input.accept='video/*';fallbackBusy=false}
  });

  addFallbackUI(input);
}

const root=document.querySelector('#app')||document.documentElement;
new MutationObserver(()=>patchInput()).observe(root,{subtree:true,childList:true});
window.addEventListener('pageshow',patchInput);
window.addEventListener('focus',()=>setTimeout(patchInput,50));
patchInput();
