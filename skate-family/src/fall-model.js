// Uses the MIT-licensed TFLite Transformer from punpayut/Fall-Detection.
// Model source/license: /skate-family/models/MODEL_SOURCES.md

let modelPromise=null;
const MODEL_URL='/skate-family/models/fall_detection_transformer.tflite';
const TF_VERSION='4.22.0';
const TFLITE_VERSION='0.0.1-alpha.9';

const loadScript=src=>new Promise((resolve,reject)=>{
  const existing=[...document.scripts].find(s=>s.src===src);
  if(existing){if(existing.dataset.loaded==='1')return resolve();existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return}
  const s=document.createElement('script');s.src=src;s.async=true;
  s.onload=()=>{s.dataset.loaded='1';resolve()};s.onerror=()=>reject(new Error(`Не вдалося завантажити ML runtime: ${src}`));
  document.head.appendChild(s);
});

async function loadRuntime(){
  if(!globalThis.tf){
    await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@${TF_VERSION}/dist/tf-core.min.js`);
    await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-cpu@${TF_VERSION}/dist/tf-backend-cpu.min.js`);
  }
  if(!globalThis.tflite){
    await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@${TFLITE_VERSION}/dist/tf-tflite.min.js`);
  }
  if(globalThis.tf?.getBackend?.()!=='cpu')await globalThis.tf.setBackend('cpu');
  await globalThis.tf.ready();
}

async function getModel(){
  if(!modelPromise)modelPromise=(async()=>{
    await loadRuntime();
    return globalThis.tflite.loadTFLiteModel(MODEL_URL);
  })().catch(err=>{modelPromise=null;throw err});
  return modelPromise;
}

const NAMES=[
  ['Left Ankle',27],['Left Ear',7],['Left Elbow',13],['Left Eye',2],['Left Hip',23],['Left Knee',25],['Left Shoulder',11],['Left Wrist',15],
  ['Nose',0],
  ['Right Ankle',28],['Right Ear',8],['Right Elbow',14],['Right Eye',5],['Right Hip',24],['Right Knee',26],['Right Shoulder',12],['Right Wrist',16]
];
const INDEX=Object.fromEntries(NAMES.map(([name],i)=>[name,i]));

function tripletOffset(name){return INDEX[name]*3}

export function makeFallFeatures(landmarks){
  if(!landmarks?.length)return null;
  const f=new Float32Array(51);
  for(const [name,mpIndex] of NAMES){
    const lm=landmarks[mpIndex];if(!lm)continue;
    const o=tripletOffset(name);f[o]=lm.x||0;f[o+1]=lm.y||0;f[o+2]=lm.visibility??0;
  }
  const get=name=>{const o=tripletOffset(name);return [f[o],f[o+1],f[o+2]]};
  const ls=get('Left Shoulder'),rs=get('Right Shoulder'),lh=get('Left Hip'),rh=get('Right Hip');
  const good=p=>p[2]>.3;
  let shoulder=null,hip=null;
  if(good(ls)&&good(rs))shoulder=[(ls[0]+rs[0])/2,(ls[1]+rs[1])/2];else if(good(ls))shoulder=ls;else if(good(rs))shoulder=rs;
  if(good(lh)&&good(rh))hip=[(lh[0]+rh[0])/2,(lh[1]+rh[1])/2];else if(good(lh))hip=lh;else if(good(rh))hip=rh;
  if(!hip)return f;
  const scale=shoulder?Math.abs(shoulder[1]-hip[1]):0;
  for(const [name] of NAMES){
    const o=tripletOffset(name);f[o]-=hip[0];f[o+1]-=hip[1];
    if(scale>=1e-5){f[o]/=scale;f[o+1]/=scale}
  }
  return f;
}

async function predictWindow(window){
  const model=await getModel(),tf=globalThis.tf;
  const flat=new Float32Array(30*51);
  for(let i=0;i<30;i++)flat.set(window[i],i*51);
  const input=tf.tensor(flat,[1,30,51],'float32');
  let output;
  try{
    output=model.predict(input);
    const tensor=Array.isArray(output)?output[0]:(output?.data?output:Object.values(output||{})[0]);
    if(!tensor?.data)throw new Error('Невідомий формат відповіді fall-моделі');
    const values=await tensor.data();
    return Number(values[0]);
  }finally{
    input.dispose?.();
    if(Array.isArray(output))output.forEach(x=>x?.dispose?.());else if(output?.dispose)output.dispose();else Object.values(output||{}).forEach(x=>x?.dispose?.());
  }
}

export async function inferFallProbability(featureFrames){
  const frames=(featureFrames||[]).filter(Boolean);
  if(frames.length<12)return {available:false,probability:null,reason:'Недостатньо кадрів після landing'};
  // Upstream model expects 30 frames. Pad a short tail with the last valid pose.
  if(frames.length<30){const last=frames.at(-1);while(frames.length<30)frames.push(last)}
  const starts=[];
  if(frames.length===30)starts.push(0);else{
    for(let s=Math.max(0,frames.length-50);s<=frames.length-30;s+=5)starts.push(s);
    const last=frames.length-30;if(!starts.includes(last))starts.push(last);
  }
  let max=0;
  try{
    for(const s of starts){max=Math.max(max,await predictWindow(frames.slice(s,s+30)))}
    return {available:true,probability:max,threshold:.90,model:'Open Transformer fall detector'};
  }catch(error){
    console.warn('SKATE fall model unavailable',error);
    return {available:false,probability:null,reason:error?.message||'Fall model unavailable'};
  }
}
