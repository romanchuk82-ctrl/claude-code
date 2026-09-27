import {
  analyzeProgram as analyzeProgramBase,
  analyzeJumpPass as analyzeJumpPassBase,
  scoreProgram,scoreJumpPass,PROGRAM_TYPES,ELEMENT_OPTIONS,formatTime
} from './programJudge.js?base=1';
import { classifyJump, groupJumpPasses } from './jumpClassifier.js';
import { estimateGOE } from './scoringEngine.js';

export { scoreProgram,scoreJumpPass,PROGRAM_TYPES,ELEMENT_OPTIONS,formatTime };

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,n=3)=>{const p=10**n;return Math.round((Number(v)||0)*p)/p};

function panelizeGrade(g){
  g=clamp(Math.round(Number(g)||0),-5,5);
  if(g===0)return 0;
  if(g===1)return .667;
  if(g===-1)return -.333;
  if(g>1)return round(g-.333,3);
  return round(g+.667,3);
}

function recodeJump(j){
  const call=classifyJump(j.metrics||{});
  const old=String(j.code||'');
  const code=call.code||old;
  if(!code||code===old)return {...j,confidence:Math.min(j.confidence||99,call.confidence||99)};
  const grade=panelizeGrade(estimateGOE(j.metrics||{},code,{}).goe);
  return {...j,code,suggestion:`${code}?`,goe:grade,goeGrade:grade,confidence:Math.min(j.confidence||99,call.confidence||99),needsConfirm:true};
}

function unifiedPasses(rawJumps=[]){
  const recoded=rawJumps.map(recodeJump);
  return {jumps:recoded,passes:groupJumpPasses(recoded)};
}

export async function analyzeJumpPass(video,onProgress=()=>{}){
  const base=await analyzeJumpPassBase(video,p=>onProgress(Math.min(92,p)));
  const unified=unifiedPasses(base.jumps||[]);
  onProgress(98);
  return {...base,...unified,version:'shared-ijs-v3-unified'};
}

export async function analyzeProgram(video,onProgress=()=>{},type='girlsB2526'){
  const base=await analyzeProgramBase(video,p=>onProgress(Math.min(94,p)),type);
  const unified=unifiedPasses(base.rawJumps||[]);
  const nonJump=(base.elements||[]).filter(x=>x.kind!=='jump'&&x.kind!=='jump-pass');
  const elements=[...unified.passes,...nonJump].sort((a,b)=>(a.time||0)-(b.time||0));
  onProgress(98);
  return {...base,rawJumps:unified.jumps,elements,version:'shared-ijs-v3-unified'};
}
