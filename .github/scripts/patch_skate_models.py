from pathlib import Path

p=Path('skate-family/src/main-v11.js')
s=p.read_text()
s=s.replace("import { analyzeVideo, estimateElement, estimateGOE } from '/src/analyzer.js?v=11';", "import { analyzeVideo, estimateElement, estimateGOE } from '/src/analyzer.js?v=14';")
s=s.replace("import { beginMultiSession, endMultiSession, analyzeVideoRange } from './multi-analyzer.js?v=11';", "import { beginMultiSession, endMultiSession, analyzeVideoRange } from './multi-analyzer.js?v=14';\nimport { estimateCascadeGOE, resolvedFall } from './cascade-score.js?v=14';")
s=s.replace("mode:'single',markers:[],multiResults:[],playhead:0", "mode:'single',markers:[],multiResults:[],fallOverrides:{},playhead:0")

start=s.index('function multiResults(){')
end=s.index('\nfunction historyView()',start)
new_func="""function multiResults(){
  const cascade=estimateCascadeGOE(state.multiResults,state.markers,state.fallOverrides),cascadeRange=cascade.goeLow===cascade.goeHigh?signed(cascade.goe):`${signed(cascade.goeLow)}…${signed(cascade.goeHigh)}`;
  const fallNote=cascade.uncertainFall?`<div class=\"notice\" style=\"margin-top:10px;background:#fff6dd;border-radius:12px;padding:10px;color:#70510d\"><b>SKATE бачить можливе падіння.</b> Перевір перемикач біля відповідного стрибка нижче.</div>`:'';
  const cascadeReasons=`<ul class=\"reason-list\" style=\"margin-top:12px\">${cascade.reasons.map(reason).join('')}</ul>`;
  const primary=`<div class=\"section-title\"><h2>Результат каскаду</h2><span>${cascade.label}</span></div><section class=\"card\" style=\"border:2px solid #dbeaf5\"><div style=\"display:flex;justify-content:space-between;gap:12px;align-items:flex-start\"><div><div class=\"k\">ESTIMATED GOE КАСКАДУ</div><div style=\"font-size:25px;font-weight:950;margin-top:5px\">${cascade.label}</div><div style=\"font-size:12px;color:var(--muted);font-weight:800;margin-top:3px\">діапазон ${cascadeRange} · довіра ${cascade.confidence}%</div></div><div class=\"goe\" style=\"font-size:54px;line-height:.95\">${signed(cascade.goe)}</div></div>${cascade.fallDetected?'<div style=\"margin-top:12px;padding:10px 12px;border-radius:12px;background:#fff0f1;color:#a52e3b;font-weight:900\">Падіння враховано в GOE всього каскаду</div>':''}${fallNote}${cascadeReasons}<p class=\"notice\" style=\"margin-bottom:0\">Головна оцінка одна для всього каскаду. Нижче — діагностика кожного стрибка.</p></section>`;
  const diagnostics=`<div class=\"section-title\"><h2>Діагностика стрибків</h2><span>${state.multiResults.length}</span></div><div style=\"display:grid;gap:12px\">${state.multiResults.map((r,i)=>{
    const marker=state.markers[i],m=r.metrics,element=estimateElement(m.rotation,marker.element),fall=resolvedFall(m,i,state.fallOverrides),e=estimateGOE(m,element,{fall}),range=e.goeLow===e.goeHigh?signed(e.goe):`${signed(e.goeLow)}…${signed(e.goeHigh)}`;
    const prob=m.fallProbability==null?'':` · ML ${Math.round(m.fallProbability*100)}%`;
    const fallStatus=m.fallDetected?`<div style=\"font-size:11px;font-weight:900;color:#ad3040;margin-top:8px\">⚠ Падіння виявлено${prob}</div>`:m.fallPossible?`<div style=\"font-size:11px;font-weight:900;color:#9a6a08;margin-top:8px\">? Можливе падіння${prob}</div>`:m.fallModelAvailable?`<div style=\"font-size:11px;color:var(--muted);margin-top:8px\">Падіння не виявлено${prob}</div>`:'';
    return `<section class=\"card\"><div style=\"display:flex;align-items:center;justify-content:space-between;gap:10px\"><div><div class=\"k\">СТРИБОК ${i+1} · ${marker.time.toFixed(2)}s</div><div style=\"font-size:24px;font-weight:950;margin-top:3px\">${autoLabel(element)}</div></div><div style=\"text-align:right\"><div class=\"goe\" style=\"font-size:28px\">${signed(e.goe)}</div><div style=\"font-size:10px;color:var(--muted);font-weight:800\">діагностика ${range}</div></div></div><div style=\"display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px\"><div class=\"metric\" style=\"padding:9px\"><div class=\"k\">AIR</div><div class=\"v\" style=\"font-size:17px\">${m.airtime}s</div></div><div class=\"metric\" style=\"padding:9px\"><div class=\"k\">HEIGHT</div><div class=\"v\" style=\"font-size:17px\">${m.height}м</div></div><div class=\"metric\" style=\"padding:9px\"><div class=\"k\">FLOW</div><div class=\"v\" style=\"font-size:17px\">${m.flow}%</div></div><div class=\"metric\" style=\"padding:9px\"><div class=\"k\">LAND</div><div class=\"v\" style=\"font-size:17px\">${m.landingStability}%</div></div></div>${fallStatus}<label class=\"check\" style=\"margin-top:9px\"><span>Падіння було</span><input class=\"switch multiFall\" type=\"checkbox\" data-i=\"${i}\" ${fall?'checked':''}></label></section>`}).join('')}</div>`;
  return `${primary}${diagnostics}<section class=\"card\" style=\"margin-top:12px\"><button class=\"primary\" id=\"saveAll\" style=\"margin-top:0\">Зберегти каскад</button></section>`;
}
"""
s=s[:start]+new_func+s[end:]

bind_old="document.querySelector('#run')?.addEventListener('click',runAnalysis);document.querySelectorAll('.flag').forEach(x=>x.onchange=()=>{state.flags[x.dataset.flag]=x.checked;render()});"
bind_new="document.querySelector('#run')?.addEventListener('click',runAnalysis);document.querySelectorAll('.flag').forEach(x=>x.onchange=()=>{state.flags[x.dataset.flag]=x.checked;render()});document.querySelectorAll('.multiFall').forEach(x=>x.onchange=()=>{state.fallOverrides[+x.dataset.i]=x.checked;render()});"
if bind_old not in s: raise SystemExit('bind anchor missing')
s=s.replace(bind_old,bind_new)
s=s.replace("state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};state.playhead=0", "state.flags={hand:false,twoFoot:false,stepOut:false,fall:false};state.fallOverrides={};state.playhead=0")
s=s.replace("state.markers.sort((a,b)=>a.time-b.time);state.multiResults=[];await beginMultiSession();", "state.markers.sort((a,b)=>a.time-b.time);state.multiResults=[];state.fallOverrides={};await beginMultiSession();")

save_start=s.index('async function saveAll(){')
save_end=s.index('\n\nasync function loadHistory()',save_start)
save_new="""async function saveAll(){if(!state.multiResults.length)return;const sequenceId=crypto.randomUUID(),cascade=estimateCascadeGOE(state.multiResults,state.markers,state.fallOverrides);for(let i=0;i<state.multiResults.length;i++){const m=state.multiResults[i].metrics,marker=state.markers[i],element=estimateElement(m.rotation,marker.element),fall=resolvedFall(m,i,state.fallOverrides),ev=estimateGOE(m,element,{fall});await saveAnalysis({id:crypto.randomUUID(),profile:'all',createdAt:Date.now()+i,element,metrics:m,flags:{fall},goe:ev.goe,goeLow:ev.goeLow,goeHigh:ev.goeHigh,analysisVersion:4,sequenceId,jumpIndex:i+1,sourceTime:marker.time,cascadeLabel:cascade.label,cascadeGoe:cascade.goe,cascadeGoeLow:cascade.goeLow,cascadeGoeHigh:cascade.goeHigh})}toast(`Каскад ${cascade.label} збережено`);state.view='history';render();loadHistory()}"""
s=s[:save_start]+save_new+s[save_end:]
p.write_text(s)

ip=Path('skate-family/index.html')
x=ip.read_text().replace('/src/main-v11.js?v=11','/src/main-v11.js?v=14').replace('/src/cascade-presets.js?v=13','/src/cascade-presets.js?v=14')
ip.write_text(x)

sp=Path('skate-family/sw.js')
w=sp.read_text()
w=w.replace("const CACHE='skate-v13'","const CACHE='skate-v14'")
w=w.replace("'/src/main-v11.js?v=11'", "'/src/main-v11.js?v=14'")
w=w.replace("'/src/cascade-presets.js?v=13'", "'/src/cascade-presets.js?v=14'")
w=w.replace("'/src/analyzer.js?v=11'", "'/src/analyzer.js?v=14'")
w=w.replace("'/src/multi-analyzer.js?v=11'", "'/src/multi-analyzer.js?v=14',\n  '/src/fall-model.js?v=14',\n  '/src/cascade-score.js?v=14',\n  '/skate-family/models/fall_detection_transformer.tflite'")
sp.write_text(w)
