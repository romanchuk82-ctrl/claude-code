import * as core from './programJudge-core.js?v=25';
import { PROGRAM_TYPES, ELEMENT_VALUES, scoreProgramShared, estimateGOE, round, runScoringBenchmark } from './scoringEngine.js?v=25';

export { PROGRAM_TYPES, ELEMENT_VALUES, runScoringBenchmark };

export const ELEMENT_OPTIONS=[
  ['','— підтвердити елемент —'],
  ['2S+1A+SEQ','2S+1A+SEQ'],['1Lz+1Lo','1Lz+1Lo'],
  ['1T','1T'],['1S','1S'],['1Lo','1Lo'],['1F','1F'],['1Lz','1Lz'],['1A','1A'],
  ['2T','2T'],['2S','2S'],['2Lo','2Lo'],['2F','2F'],['2Lz','2Lz'],['2A','2A'],
  ['3T','3T'],['3S','3S'],['3Lo','3Lo'],['3F','3F'],['3Lz','3Lz'],['3A','3A'],
  ['4T','4T'],['4S','4S'],['4Lo','4Lo'],['4F','4F'],['4Lz','4Lz'],['4A','4A'],
  ['CCSpB','CCSpB'],['CCSp1','CCSp1'],['CCSp2','CCSp2'],['CCSp3','CCSp3'],['CCSp4','CCSp4'],
  ['CCoSpB','CCoSpB'],['CCoSp1','CCoSp1'],['CCoSp2','CCoSp2'],['CCoSp3','CCoSp3'],['CCoSp4','CCoSp4'],
  ['FCSpB','FCSpB'],['FCSp1','FCSp1'],['FCSp2','FCSp2'],['FCSp3','FCSp3'],['FCSp4','FCSp4'],
  ['FSSpB','FSSpB'],['FSSp1','FSSp1'],['FSSp2','FSSp2'],['FSSp3','FSSp3'],['FSSp4','FSSp4'],
  ['CSpB','CSpB'],['CSp1','CSp1'],['CSp2','CSp2'],['CSp3','CSp3'],['CSp4','CSp4'],
  ['SSpB','SSpB'],['SSp1','SSp1'],['SSp2','SSp2'],['SSp3','SSp3'],['SSp4','SSp4'],
  ['LSpB','LSpB'],['LSp1','LSp1'],['LSp2','LSp2'],['LSp3','LSp3'],['LSp4','LSp4'],
  ['StSqB','StSqB'],['StSq1','StSq1'],['StSq2','StSq2'],['StSq3','StSq3'],['StSq4','StSq4'],
  ['ChSq1','ChSq1'],['ChSp1','ChSp1']
];

const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function developmentPCS(raw={}){
  const c=Number(raw.composition)||0,p=Number(raw.presentation)||0,s=Number(raw.skatingSkills)||0;
  return {
    composition:round(clamp(3.45+(c-5.2)*.28,2.5,5.5),2),
    presentation:round(clamp(3.30+(p-5.2)*.28,2.5,5.5),2),
    skatingSkills:round(clamp(3.40+(s-5.2)*.28,2.5,5.5),2)
  };
}

function maybeAxelAfterLanding(current,prev){
  if(!current||!prev)return null;
  const take=Number(current.metrics?.takeoffTime??current.metrics?.takeoff),land=Number(prev.metrics?.landingTime??prev.metrics?.landing);
  const gap=take-land,rot=Number(current.metrics?.rotation)||0;
  if(!Number.isFinite(gap)||gap<.25||gap>1.55||rot<1.12||rot>1.95)return null;
  const axelDist=Math.abs(rot-1.5),doubleDist=Math.abs(rot-2);
  if(/A$/.test(current.code||'')||axelDist<=doubleDist+.10)return {code:'1A',gap};
  return null;
}

function normalizeElements(elements=[]){
  const sorted=[...elements].sort((a,b)=>(a.time||0)-(b.time||0));
  const seen=new Set(),out=[];
  for(const x of sorted){
    if(x.cascadeGroup){
      if(seen.has(x.cascadeGroup))continue;
      seen.add(x.cascadeGroup);
      const group=sorted.filter(y=>y.cascadeGroup===x.cascadeGroup).sort((a,b)=>(a.time||0)-(b.time||0));
      const children=group.map((g,i)=>{
        if(i===0)return {...g};
        const ax=maybeAxelAfterLanding(g,group[i-1]);
        return ax?{...g,code:ax.code,sequenceGap:ax.gap}:{...g};
      });
      const sequence=children.some((g,i)=>i>0&&(/A$/.test(g.code||'')||Number.isFinite(g.sequenceGap)));
      const code=children.map(y=>y.code).join('+')+(sequence?'+SEQ':'');
      const grades=children.map(y=>estimateGOE(y.metrics||{},y.code||'',{}).goe);
      let grade=Math.min(...grades);
      if(sequence&&children.some(y=>(y.metrics?.stability??100)<78))grade=Math.min(grade,0);
      out.push({
        id:x.id||crypto.randomUUID(),kind:'jump-pass',time:x.time,code,suggestion:`${code}?`,goe:grade,goeGrade:grade,
        confidence:Math.round(avg(children.map(y=>Number(y.confidence)||50))),needsConfirm:true,sequence,cascadeGroup:x.cascadeGroup,
        metrics:{children:children.map(y=>y.metrics||{}),takeoffTime:children[0]?.metrics?.takeoffTime,landingTime:children.at(-1)?.metrics?.landingTime}
      });
      continue;
    }
    if(x.kind==='jump'&&x.code){
      const g=estimateGOE(x.metrics||{},x.code,{}).goe;
      out.push({...x,goe:g,goeGrade:g});
    }else out.push({...x,goeGrade:Number(x.goe)||0});
  }
  return out.sort((a,b)=>(a.time||0)-(b.time||0));
}

export async function analyzeProgram(video,onProgress=()=>{},type='girlsB2526'){
  const raw=await core.analyzeProgram(video,onProgress);
  const pcsRaw={...raw.pcs};
  const pcs=type==='girlsB2526'?developmentPCS(pcsRaw):pcsRaw;
  return {...raw,elements:normalizeElements(raw.elements||[]),pcs,pcsRaw,programType:type,version:'shared-ijs-2526-v1'};
}

export function scoreProgram(program,type='girlsB2526'){
  return scoreProgramShared(program,type);
}

export const formatTime=core.formatTime;
