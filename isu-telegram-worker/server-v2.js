import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import OpenAI from 'openai';
import { analyzeFullProgram } from './full-program.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TARGET_CHAT_ID = Number(process.env.TARGET_CHAT_ID || '-5368053565');
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const PUBLIC_URL = process.env.PUBLIC_URL || '';
if (!BOT_TOKEN || !OPENAI_API_KEY) throw new Error('Missing required secrets');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const RULES = await fs.readFile(new URL('./project-rules.md', import.meta.url), 'utf8');
const processed = new Set();

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

async function downloadTelegramFile(fileId) {
  const info = await tg('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let stderr = '';
    p.stderr.on('data', d => stderr += d.toString());
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(stderr)));
  });
}

async function probeDuration(file) {
  const stderr = await runFfmpeg(['-i', file, '-f', 'null', '-']);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function pickVideo(msg) {
  if (msg.video) return msg.video;  if (msg.document && String(msg.document.mime_type || '').startsWith('video/')) return msg.document;
  return null;
}

async function extractTimedFrames(videoPath, dir, opts = {}) {
  const start = Math.max(0, opts.start || 0);
  const length = Math.max(0.2, opts.length || 2);
  const fps = opts.fps || 4;
  const width = opts.width || 960;
  const prefix = opts.prefix || 'frame';
  const max = opts.max || Math.ceil(length * fps) + 2;
  const out = path.join(dir, `${prefix}-%04d.jpg`);
  const filters = [`fps=${fps}`];
  if (opts.cropNorm) { const c=opts.cropNorm; filters.push(`crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y}`); }
  filters.push(`scale=${width}:-2`);
  await runFfmpeg([
    '-ss', String(start), '-i', videoPath, '-t', String(length),
    '-vf', filters.join(','), '-q:v', '3',
    '-frames:v', String(max), out
  ]);
  const names = (await fs.readdir(dir))
    .filter(n => n.startsWith(`${prefix}-`) && n.endsWith('.jpg')).sort();
  return names.map((name, i) => ({
    path: path.join(dir, name),
    time: start + i / fps,
    label: `${prefix} ${i + 1}`
  }));
}

function textFromResponse(response) {
  const direct = response.output_text?.trim();
  if (direct) return direct;
  const parts = [];  for (const item of response.output || []) {
    for (const c of item.content || []) {
      if (typeof c.text === 'string' && c.text.trim()) parts.push(c.text.trim());
    }
  }
  return parts.join('\n\n').trim();
}

async function createTextResponse(input, { primaryEffort='high', primaryTokens=4200, label='analysis' } = {}) {
  const attempts = [
    { effort: primaryEffort, tokens: primaryTokens },
    { effort: 'medium', tokens: Math.max(primaryTokens, 6000) },
    { effort: 'low', tokens: Math.max(primaryTokens, 7000) }
  ];
  let last = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const response = await openai.responses.create({
      model: MODEL, reasoning: { effort: a.effort }, max_output_tokens: a.tokens, input
    });
    const text = textFromResponse(response);
    console.log('OpenAI text attempt', { label, attempt: i + 1, status: response.status, effort: a.effort, max_output_tokens: a.tokens, chars: text.length, incomplete: response.incomplete_details || null });
    if (text) return text;
    last = response;
  }
  throw new Error('OpenAI returned no textual answer after 3 attempts' + (last?.status ? ' (' + last.status + ')' : ''));
}

async function createJsonResponse(input, { label='json', primaryEffort='medium', primaryTokens=1000 } = {}) {
  const attempts = [
    { effort: primaryEffort, tokens: primaryTokens },
    { effort: 'low', tokens: Math.max(primaryTokens, 1400) },
    { effort: 'low', tokens: Math.max(primaryTokens, 1800) }
  ];
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const response = await openai.responses.create({ model: MODEL, reasoning:{ effort:a.effort }, max_output_tokens:a.tokens, input });
      const text = textFromResponse(response);
      if (!text) { console.log('OpenAI JSON empty', { label, attempt:i+1, status:response.status }); continue; }
      const parsed = parseJsonLoose(text);
      console.log('OpenAI JSON ok', { label, attempt:i+1 });
      return parsed;
    } catch (e) {
      console.log('OpenAI JSON retry', { label, attempt:i+1, error:String(e?.message || e).slice(0,160) });
    }
  }
  return null;
}

function parseJsonLoose(text) {
  if (!text) throw new Error('empty locator response');
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('locator did not return JSON');
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function classifyShortElement(videoPath, dir, duration, caption) {
  const frames = await extractTimedFrames(videoPath, dir, { start: 0, length: duration, fps: duration <= 6 ? 10 : 6, width: 768, prefix: 'classify', max: 90 });
  const content = [{ type: 'input_text', text:
`Classify the MAIN figure-skating element in this clip. This is classification only, not an ISU technical call.
Return JSON only: {"category":"jump|spin|step|choreographic|unknown","confidence":75,"notes":"short evidence"}.
Do NOT name a jump type, revolutions, spin level or GOE. Judge from the whole motion sequence, not one still frame.
Duration=${duration.toFixed(2)}s. Caption=${caption || '(none)'}.` }];
  for (const f of frames) {
    const b64 = (await fs.readFile(f.path)).toString('base64');
    content.push({ type: 'input_text', text: `t=${f.time.toFixed(3)}s` });
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'low' });
  }
  return await createJsonResponse([{ role: 'user', content }], { label:'element-classifier', primaryEffort:'medium', primaryTokens:700 }) || { category:'unknown', confidence:0, notes:'classification unresolved' };
}

async function locateJumpStructure(frames, duration, caption) {
  const content = [{ type: 'input_text', text:
`Locate jump events in this short figure-skating clip. This is only a temporal locator, NOT the final ISU call.
Return JSON only:
{"relationship":"solo|combination|sequence|multiple_separate|unknown","jumps":[{"index":1,"takeoff":1.2,"landing":1.8,"confidence":75}],"clip_confidence":75,"notes":"short"}
Times are seconds from clip start. Detect every visible jump, up to 4. DO NOT identify jump type or revolutions here. This locator may only determine timing and relationship.
Duration=${duration?.toFixed(2) || 'unknown'}s. Caption=${caption || '(none)'}.` }];
  for (const f of frames) {
    content.push({ type: 'input_text', text: `t=${f.time.toFixed(3)}s` });
    const b64 = (await fs.readFile(f.path)).toString('base64');
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'low' });
  }  const parsed = await createJsonResponse([{ role: 'user', content }], { label:'jump-locator', primaryEffort:'medium', primaryTokens:900 }) || { relationship:'unknown', jumps:[], clip_confidence:0, notes:'locator unresolved' };
  parsed.jumps = Array.isArray(parsed.jumps) ? parsed.jumps.slice(0, 4) : [];
  return parsed;
}

async function buildDenseReplay(videoPath, dir, duration, locator) {
  const jumps = (locator.jumps || []).filter(j => Number.isFinite(Number(j.takeoff)) && Number.isFinite(Number(j.landing)));
  if (!jumps.length) {
    return extractTimedFrames(videoPath, dir, {
      start: 0, length: Math.min(duration || 6, 8), fps: 12, width: 1024, prefix: 'dense-fallback', max: 96
    });
  }
  const frames = [];
  for (let i = 0; i < jumps.length; i++) {
    const j = jumps[i];
    const takeoff = Number(j.takeoff);
    const landing = Number(j.landing);
    const start = Math.max(0, takeoff - 0.42);
    const end = Math.min(duration || landing + 0.38, landing + 0.38);
    const length = Math.max(0.7, end - start);
    const set = await extractTimedFrames(videoPath, dir, {
      start, length, fps: 24, width: 1024, prefix: `j${i + 1}-dense`, max: 55
    });
    frames.push(...set.map(x => ({ ...x, jumpIndex: i + 1 })));
  }
  return frames;
}

async function buildNormalContext(videoPath, dir, duration, locator) {
  const jumps = locator.jumps || [];
  if (!jumps.length) return [];
  const first = Math.max(0, Number(jumps[0].takeoff || 0) - 0.8);
  const lastJump = jumps[jumps.length - 1];
  const last = Math.min(duration || Number(lastJump.landing || 3) + 0.8, Number(lastJump.landing || 3) + 0.8);  return extractTimedFrames(videoPath, dir, {
    start: first, length: Math.max(0.8, last - first), fps: 6, width: 960, prefix: 'normal-context', max: 45
  });
}

function confidencePct(v) {
  const n=Number(v);
  if (!Number.isFinite(n)) return 0;
  return n >= 0 && n <= 1 ? n * 100 : n;
}

function inferJumpTypeFromMechanics(o) {
  const dir = o?.takeoff_direction;
  const toe = o?.toe_assist;
  const edge = o?.takeoff_edge;
  const take = o?.skating_foot;
  const land = o?.landing_foot;
  const free = o?.free_leg_action;
  if (toe === 'yes') {
    if (edge === 'inside') return 'F';
    if (edge === 'outside' && take !== 'unclear' && land !== 'unclear') return take === land ? 'T' : 'Lz';
    return 'UNRESOLVED';
  }
  if (dir === 'forward' && toe === 'no') return edge === 'outside' || edge === 'unclear' ? 'A' : 'UNRESOLVED';
  if (dir !== 'backward') return 'UNRESOLVED';
  if (toe === 'no') {
    if (edge === 'inside' && (free === 'swing' || free === 'unclear')) return 'S';
    if (edge === 'outside' && take !== 'unclear' && land !== 'unclear' && take === land) return 'Lo';
    return 'UNRESOLVED';
  }
  return 'UNRESOLVED';
}

async function detectLowerBodyCrop(videoPath, dir, takeoff, duration, index) {
  const start=Math.max(0,takeoff-0.35);
  const frames=await extractTimedFrames(videoPath,dir,{start,length:Math.min(0.55,Math.max(0.3,(duration||takeoff+0.2)-start)),fps:5,width:1280,prefix:`bbox-${index}`,max:4});
  const content=[{type:'input_text',text:'Find the figure skater lower body in these chronological frames. Return JSON only: {"bbox":[x1,y1,x2,y2],"confidence":0}. Coordinates are normalized 0..1000. bbox must be the UNION box covering hips, both legs and both skates across all supplied frames. Ignore boards/background.'}];
  for (const f of frames) { const b64=(await fs.readFile(f.path)).toString('base64'); content.push({type:'input_image',image_url:`data:image/jpeg;base64,${b64}`,detail:'high'}); }
  const r=await createJsonResponse([{role:'user',content}],{label:`lower-body-bbox-${index}`,primaryEffort:'medium',primaryTokens:500});
  const b=Array.isArray(r?.bbox)?r.bbox.map(Number):null;
  if (!b || b.length!==4 || b.some(x=>!Number.isFinite(x)) || confidencePct(r?.confidence)<55) return {x:0.18,y:0.12,w:0.64,h:0.84,fallback:true};
  const unitScale=Math.max(...b.map(x=>Math.abs(x)))<=1.5 ? 1 : 1000;
  let [x1,y1,x2,y2]=b.map(x=>Math.max(0,Math.min(unitScale,x))/unitScale);
  if (x2<=x1 || y2<=y1) return {x:0.18,y:0.12,w:0.64,h:0.84,fallback:true};
  const w=x2-x1,h=y2-y1; x1=Math.max(0,x1-w*0.18); x2=Math.min(1,x2+w*0.18); y1=Math.max(0,y1-h*0.18); y2=Math.min(1,y2+h*0.20);
  return {x:x1,y:y1,w:x2-x1,h:y2-y1};
}

async function rankJumpTypesFromReplay(frames, index, method) {
  const content=[{type:'input_text',text:`Compare this chronological take-off replay against all six single-skating jump families. Do NOT assess revolutions or GOE. Score each family 0..100 by mechanics only.
Templates: A = forward outside edge, no toe-pick; T = backward outside-edge toe-assisted jump; S = backward inside-edge, no toe-pick; Lo = backward outside-edge, no toe-pick; F = backward inside-edge with toe-pick; Lz = backward outside-edge with toe-pick and counter-rotated entry.
Judge direction from blade travel across frames, never torso facing. A missing/blurred toe contact must be UNCLEAR, not NO.
Return JSON only: {\"scores\":{\"A\":0,\"T\":0,\"S\":0,\"Lo\":0,\"F\":0,\"Lz\":0},\"best_type\":\"A|T|S|Lo|F|Lz|UNRESOLVED\",\"confidence\":0,\"evidence\":\"short\"}. Method=${method}` }];
  for (const f of frames) { content.push({type:'input_text',text:`t=${f.time.toFixed(3)}s`}); const b64=(await fs.readFile(f.path)).toString('base64'); content.push({type:'input_image',image_url:`data:image/jpeg;base64,${b64}`,detail:'high'}); }
  const r=await createJsonResponse([{role:'user',content}],{label:`jump-template-ranker-${index}-${method}`,primaryEffort:'high',primaryTokens:1200});
  if (!r || !r.scores) return {best_type:'UNRESOLVED',confidence:0,scores:{},evidence:'unresolved'};
  const entries=Object.entries(r.scores).map(([k,v])=>[k,Number(v)||0]).sort((a,b)=>b[1]-a[1]);
  const top=entries[0]||['UNRESOLVED',0], second=entries[1]||['',0];
  const best=(top[1]>=65 && top[1]-second[1]>=10)?top[0]:'UNRESOLVED';
  return {...r,best_type:best,margin:top[1]-second[1]};
}

async function detectToePickEvidence(frames, jumpIndex) {
  const content=[{type:'input_text',text:`ISU take-off micro-review for jump ${jumpIndex}. Determine ONLY whether a free-foot toe-pick assist occurred in the final take-off phase. Frames are chronological and tightly cropped to the lower body.
A toe assist can be extremely brief (1-3 frames) immediately before both skates leave the ice. Do not confuse body facing with travel direction.
Return JSON only: {"toe_contact":"yes|no|unclear","toe_pick_foot":"left|right|none|unclear","last_ice_frame":0,"contact_frames":[0],"both_skates_continuously_clear":"yes|no","confidence":0,"evidence":"short"}.
CRITICAL: return "no" ONLY if both skates are clearly distinguishable throughout the final ~0.25 s before the last ice contact AND the free foot is visibly off the ice in every one of those frames. If feet overlap, motion blur hides the blade, crop misses a skate, or contact cannot be excluded, return "unclear", never "no".`}];
  for (let idx=0; idx<frames.length; idx++) { const f=frames[idx]; content.push({type:'input_text',text:`frame=${idx+1} t=${f.time.toFixed(3)}s`}); const b64=(await fs.readFile(f.path)).toString('base64'); content.push({type:'input_image',image_url:`data:image/jpeg;base64,${b64}`,detail:'high'}); }
  return await createJsonResponse([{role:'user',content}],{label:`toe-pick-${jumpIndex}`,primaryEffort:'high',primaryTokens:900}) || {toe_contact:'unclear',toe_pick_foot:'unclear',both_skates_continuously_clear:'no',confidence:0,evidence:'unresolved'};
}

async function classifyJumpPattern(frames, jumpIndex) {
  const content=[{type:'input_text',text:`Independent ISU jump-family classifier for jump ${jumpIndex}. Use the WHOLE chronological take-off motion. Compare the mechanics directly; do not infer from landing pose and do not assess rotation count/GOE.
A = forward outside-edge take-off, no toe assist.
T = backward outside-edge take-off plus free-foot toe pick; skating/take-off foot corresponds to normal toe-loop mechanics.
S = backward inside-edge take-off, no toe assist, free-leg swing.
Lo = backward outside-edge take-off from skating foot, no toe assist, crossed free leg.
F = backward inside-edge plus toe pick.
Lz = backward outside-edge plus toe pick, counter-rotated Lutz setup; picking foot is separate from skating-edge foot.
A brief/blurred toe contact may be inferred as possible from the free-foot trajectory, but if mechanics do not distinguish types, choose UNRESOLVED.
Return JSON only: {"type":"A|T|S|Lo|F|Lz|UNRESOLVED","confidence":0,"toe_jump_likely":"yes|no|unclear","evidence":"short","alternatives":["..."]}.` }];
  for (let idx=0; idx<frames.length; idx++) { const f=frames[idx]; content.push({type:'input_text',text:`frame=${idx+1} t=${f.time.toFixed(3)}s`}); const b64=(await fs.readFile(f.path)).toString('base64'); content.push({type:'input_image',image_url:`data:image/jpeg;base64,${b64}`,detail:'high'}); }
  return await createJsonResponse([{role:'user',content}],{label:`jump-pattern-${jumpIndex}`,primaryEffort:'high',primaryTokens:900}) || {type:'UNRESOLVED',confidence:0,toe_jump_likely:'unclear',evidence:'unresolved',alternatives:[]};
}

async function identifyJumpTypePanel(videoPath, dir, duration, locator) {
  const results = [];
  const jumps = (locator.jumps || []).filter(j => Number.isFinite(Number(j.takeoff)));
  for (let i = 0; i < jumps.length; i++) {
    const takeoff = Number(jumps[i].takeoff);
    const landing = Number(jumps[i].landing || takeoff + 0.7);
    const wideStart = Math.max(0, takeoff - 1.25);
    const wideEnd = Math.min(duration || landing + 0.45, landing + 0.45);
    const takeStart = Math.max(0, takeoff - 0.85);
    const wide = await extractTimedFrames(videoPath, dir, { start:wideStart, length:Math.max(0.8,wideEnd-wideStart), fps:15, width:1280, prefix:`identity-wide-${i+1}`, max:24 });
    const dense = await extractTimedFrames(videoPath, dir, { start:takeStart, length:1.10, fps:30, width:1280, prefix:`identity-dense-${i+1}`, max:20 });
    const ask = async (frames, method) => {
      const content=[{type:'input_text',text:
`ISU Technical Panel mechanics subtask for jump ${i+1}. OBSERVE mechanics only; do not name the jump and do not assess revolutions/GOE.
Return JSON only with:
{"takeoff_direction":"forward|backward|unclear","toe_assist":"yes|no|unclear","takeoff_edge":"inside|outside|unclear","skating_foot":"left|right|unclear","toe_pick_foot":"left|right|none|unclear","landing_foot":"left|right|unclear","free_leg_action":"swing|crossed|held|unclear","confidence":0,"evidence":"short chronological evidence"}.
Use chronological motion. Take-off direction means blade travel immediately before leaving the ice, inferred across consecutive frames, never torso facing. Toe assist means a distinct toe-pick plant by the free foot. skating_foot means the foot gliding on the take-off edge; toe_pick_foot is the separate picking foot. For Lutz vs toe loop this distinction is mandatory. If a feature is not reliably visible, use unclear. Method=${method}.` }];
      for (const f of frames) { content.push({type:'input_text',text:`t=${f.time.toFixed(3)}s`}); const b64=(await fs.readFile(f.path)).toString('base64'); content.push({type:'input_image',image_url:`data:image/jpeg;base64,${b64}`,detail:'high'}); }
      return await createJsonResponse([{role:'user',content}], {label:`jump-mechanics-${i+1}-${method}`,primaryEffort:'high',primaryTokens:1100}) || {takeoff_direction:'unclear',toe_assist:'unclear',takeoff_edge:'unclear',skating_foot:'unclear',toe_pick_foot:'unclear',landing_foot:'unclear',free_leg_action:'unclear',confidence:0,evidence:'unresolved'};
    };
    const first=await ask(wide,'full jump context including landing');
    const second=await ask(dense,'dense take-off sequence');
    const cropNorm=await detectLowerBodyCrop(videoPath,dir,takeoff,duration,i+1);
    const zoom=cropNorm ? await extractTimedFrames(videoPath,dir,{start:takeStart,length:1.10,fps:30,width:1500,prefix:`identity-zoom-${i+1}`,max:34,cropNorm}) : [];
    const third=zoom.length ? await ask(zoom,'zoomed lower-body replay: prioritize toe-pick contact, take-off edge and skating foot') : null;
    const toeEvidence=zoom.length ? await detectToePickEvidence(zoom,i+1) : {toe_contact:'unclear',toe_pick_foot:'unclear',both_skates_continuously_clear:'no',confidence:0};
    const pattern=zoom.length ? await classifyJumpPattern(zoom,i+1) : {type:'UNRESOLVED',confidence:0,toe_jump_likely:'unclear'};
    if (third) {
      if (toeEvidence.toe_contact==='yes') { third.toe_assist='yes'; if (toeEvidence.toe_pick_foot && toeEvidence.toe_pick_foot!=='unclear') third.toe_pick_foot=toeEvidence.toe_pick_foot; }
      if (third.toe_assist==='no' && !(toeEvidence.toe_contact==='no' && toeEvidence.both_skates_continuously_clear==='yes' && confidencePct(toeEvidence.confidence)>=75)) third.toe_assist='unclear';
    }
    console.log('jump identity zoom', JSON.stringify({jump:i+1,cropNorm,zoomFrames:zoom.length,third,toeEvidence,pattern}));
    const type1=inferJumpTypeFromMechanics(first);
    const type2=inferJumpTypeFromMechanics(second);
    const type3=third ? inferJumpTypeFromMechanics(third) : 'UNRESOLVED';
    const merged={...first};
    for (const k of ['takeoff_direction','toe_assist','takeoff_edge','skating_foot','toe_pick_foot','free_leg_action']) {
      if (first[k] !== second[k] && second[k] !== 'unclear') merged[k]='unclear';
    }
    if (third && confidencePct(third.confidence)>=65) {
      for (const k of ['toe_assist','takeoff_edge','skating_foot','toe_pick_foot']) if (third[k] && third[k] !== 'unclear') merged[k]=third[k];
    }
    const typeMerged=inferJumpTypeFromMechanics(merged);
    let consensus_type='UNRESOLVED';
    const patternType=pattern?.type || 'UNRESOLVED';
    const patternStrong=confidencePct(pattern?.confidence)>=80;
    const toePositive=toeEvidence.toe_contact==='yes' && confidencePct(toeEvidence.confidence)>=65;
    const toeNegativeReliable=toeEvidence.toe_contact==='no' && toeEvidence.both_skates_continuously_clear==='yes' && confidencePct(toeEvidence.confidence)>=75;
    if (patternStrong && ['Lz','F','T'].includes(patternType) && pattern.toe_jump_likely==='yes' && toeEvidence.toe_contact!=='no') consensus_type=patternType;
    else if (toePositive && patternStrong && ['Lz','F','T'].includes(patternType)) consensus_type=patternType;
    else if (third && confidencePct(third.confidence)>=75 && type3!=='UNRESOLVED' && third.toe_assist==='yes') consensus_type=type3;
    else if (toeNegativeReliable && patternStrong && ['A','S','Lo'].includes(patternType)) consensus_type=patternType;
    else if (toeNegativeReliable && confidencePct(first.confidence)>=70 && confidencePct(second.confidence)>=70 && type1!=='UNRESOLVED' && type1===type2 && type1!=='A') consensus_type=type1;
    else if (toeNegativeReliable && typeMerged!=='UNRESOLVED' && [type1,type2,type3].filter(x=>x===typeMerged).length>=2) consensus_type=typeMerged;
    const candidates=[...new Set([patternType,type1,type2,type3,typeMerged,...(pattern?.alternatives||[])].filter(x=>x && x!=='UNRESOLVED'))];
    results.push({jump:i+1,consensus_type,toe_evidence:toeEvidence,pattern_classifier:pattern,mechanics_full:first,mechanics_takeoff:second,mechanics_zoom:third,cropNorm,merged_mechanics:merged,candidates});
  }
  return results;
}

async function analyzeJumpClip(videoPath, dir, duration, caption, onProgress) {
  await onProgress('⏳ Аналізую відео… Крок 1/3: знаходжу всі стрибки та їх зв’язок.');
  const sparseFps = duration <= 6 ? 6 : duration <= 15 ? 4 : 3;
  const sparse = await extractTimedFrames(videoPath, dir, {
    start: 0, length: duration, fps: sparseFps, width: 768, prefix: 'locator', max: 120
  });
  const locator = await locateJumpStructure(sparse, duration, caption);

  await onProgress('⏳ Аналізую відео… Крок 2/4: незалежно перевіряю тип стрибка за take-off mechanics.');
  const identityPanel = await identifyJumpTypePanel(videoPath, dir, duration, locator);
  await onProgress('⏳ Аналізую відео… Крок 3/4: готую normal-speed context і dense replay.');
  const normal = await buildNormalContext(videoPath, dir, duration, locator);
  const dense = await buildDenseReplay(videoPath, dir, duration, locator);

  await onProgress('⏳ Аналізую відео… Крок 4/4: Technical Call → GOE за ISU 2026/27.');
  const content = [{ type: 'input_text', text:
`${RULES}

MODE: JUMP / ELEMENT ANALYSIS.
Duration: ${duration.toFixed(2)}s. Caption: ${caption || '(none)'}.
A first pass located this temporal structure: ${JSON.stringify(locator)}.
Independent jump-type panel: ${JSON.stringify(identityPanel)}.
Treat the locator only as navigation, NOT as a technical call. It contains no valid jump-type evidence.
For TYPE: obey identityPanel consensus_type. If it is UNRESOLVED, do NOT override it or force A/T/S/Lo/F/Lz; report UNRESOLVED and only list candidates supported by the mechanics panel. If consensus_type is resolved, use that type and then determine revolutions independently from the flight/landing replay.
Identify jump TYPE independently from the moving take-off sequence first (A/T/S/Lo/F/Lz), then revolutions, then relationship, rotation and edge. Do not infer type from the landing pose.
First finish the Technical Call independently, then GOE. If jump type OR revolution count OR landing rotation is UNRESOLVED, do not assign a numeric final GOE; report GOE as UNRESOLVED/NOT SCORED from this video.
The NORMAL CONTEXT frames represent temporal continuity around the whole element and are for jump relationship/rhythm/take-off context.
The DENSE REPLAY frames are 24 fps around each located jump and are the primary evidence for landing blade rotation and slow review.
Do not claim exact q/<</edge if the blade or first actual ice contact is not reliably visible.
For a combination/sequence: analyze every jump technically, but assign ONE GOE to the whole element.
Use emoji section headings such as 🔎 TECHNICAL CALL, 📊 GOE, 🔁 ALTERNATIVE CALL, ⚠️ ОБМЕЖЕННЯ. Do not use Markdown asterisks. Keep the response concise enough for Telegram.` }];

  for (const f of normal) {
    content.push({ type: 'input_text', text: `NORMAL CONTEXT t=${f.time.toFixed(3)}s` });
    const b64 = (await fs.readFile(f.path)).toString('base64');
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'high' });
  }  for (const f of dense) {
    content.push({ type: 'input_text', text: `DENSE REPLAY J${f.jumpIndex || '?'} t=${f.time.toFixed(3)}s` });
    const b64 = (await fs.readFile(f.path)).toString('base64');
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'high' });
  }

  const text = await createTextResponse([{ role: 'user', content }], { primaryEffort: 'high', primaryTokens: 5200, label: 'jump-final' });
  return { text, locator };
}

async function analyzeGeneric(videoPath, dir, duration, caption, fullMode, classification = null) {
  const fps = fullMode ? (duration <= 180 ? 1 : 0.75) : (duration <= 30 ? 3 : 1);
  const max = fullMode ? 240 : 90;
  const frames = await extractTimedFrames(videoPath, dir, {
    start: 0, length: duration, fps, width: 896, prefix: fullMode ? 'program' : 'fragment', max
  });
  const content = [{ type: 'input_text', text:
`${RULES}

MODE: ${fullMode ? 'FULL PROGRAM ANALYSIS' : classification?.category ? classification.category.toUpperCase() + ' ELEMENT ANALYSIS' : 'ELEMENT ANALYSIS'}.
Pre-classification: ${classification ? JSON.stringify(classification) : '(none)'}. Treat this only as routing, not as a technical call.
Duration: ${duration.toFixed(2)}s. Caption: ${caption || '(none)'}.
Frames are chronological samples with timestamps. For a full program: inventory first, then Technical Calls, GOE, TES, PCS, deductions. Do not invent category/segment, requirements, factors, levels or PCS when evidence/context is insufficient. Explicitly flag every limitation caused by sampling.` }];
  for (const f of frames) {
    content.push({ type: 'input_text', text: `t=${f.time.toFixed(3)}s` });
    const b64 = (await fs.readFile(f.path)).toString('base64');
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: fullMode ? 'low' : 'high' });
  }
  const text = await createTextResponse([{ role: 'user', content }], { primaryEffort: 'high', primaryTokens: fullMode ? 7000 : 5000, label: fullMode ? 'full-generic' : 'fragment-final' });
  return { text, locator: null };
}

function cleanTelegramText(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function makeParentSummary(resultText) {
  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: 'low' },
    max_output_tokens: 650,
    input: [{ role: 'user', content: [{ type: 'input_text', text:
`Using ONLY the completed ISU analysis below, create a very short Ukrainian summary for parents. Do not change or re-judge the Technical Call. Do not invent a diagnosis or training technique not supported by the analysis. Use exactly this visual structure, no Markdown asterisks:

👨‍👩‍👧 ДЛЯ БАТЬКІВ
⛸ Елемент: ...
[✅ or ⚠️ or ❌] Підсумок: one plain-language sentence saying whether the element looks good, borderline, or has a clear issue.
🎯 Що покращити: 1-2 concrete priorities directly supported by the analysis. If nothing reliable can be prescribed, say what needs a clearer video/replay.
📌 Простими словами: one short final sentence.

Use ✅ only for a clean/confident result without a meaningful technical issue; ⚠️ for borderline/uncertain/minor issue; ❌ only for a clearly established significant error.

COMPLETED ANALYSIS:
${resultText}` }]}]
  });
  const text = cleanTelegramText(textFromResponse(response));
  if (!text) throw new Error('Parent summary returned no text');
  return text;
}

function chunkTelegramText(text, limit = 3800) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.6) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.6) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function sanitizeTelegramText(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/^#{1,4}\s*/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^A\.\s*Technical call:?/gmi, '🔎 TECHNICAL CALL')
    .replace(/^B\.\s*GOE:?/gmi, '📊 GOE')
    .replace(/^C\.\s*Alternative call:?/gmi, '🔁 ALTERNATIVE CALL')
    .replace(/^I\.\s*(Limitation|Обмеження):?/gmi, '⚠️ ОБМЕЖЕННЯ')
    .trim();
}

async function buildParentSummary(resultText) {
  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: 'low' },
    max_output_tokens: 500,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `Based ONLY on the completed ISU analysis below, write a short Ukrainian summary for parents. Do not make a new technical call and do not invent facts. Use exactly this visual structure, with no Markdown asterisks:
👨‍👩‍👧 ПІДСУМОК ДЛЯ БАТЬКІВ
⛸ Елемент: ...
✅/⚠️/❌/❓ Виконання: ...
🎯 Що покращити: ...
💡 Простими словами: ...
If the technical result is uncertain, use ❓ or ⚠️ and say what is uncertain. Keep it to 4-6 short lines.

ISU analysis:
${resultText}` }] }]
  });
  return sanitizeTelegramText(textFromResponse(response));
}

async function deliverResult(chatId, originalMessageId, progressId, resultText) {
  const clean = sanitizeTelegramText(resultText);
  const chunks = chunkTelegramText(`⛸️ ISU Judge 2026/27\n\n${clean}`);
  await tg('editMessageText', { chat_id: chatId, message_id: progressId, text: chunks[0] });
  for (let i = 1; i < chunks.length; i++) {
    await tg('sendMessage', {
      chat_id: chatId, text: `📄 Продовження ${i + 1}/${chunks.length}\n\n${chunks[i]}`,
      reply_to_message_id: originalMessageId, allow_sending_without_reply: true
    });
  }
  try {
    const parentSummary = await buildParentSummary(clean);
    if (parentSummary) await tg('sendMessage', {
      chat_id: chatId, text: parentSummary,
      reply_to_message_id: originalMessageId, allow_sending_without_reply: true
    });
  } catch (e) { console.error('parent summary error', e); }
}

async function processVideoMessage(msg, video) {
  let dir;
  let progress;
  try {
    progress = await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: '⏳ Аналізую відео… Завантажую файл і визначаю тривалість.',
      reply_to_message_id: msg.message_id,
      allow_sending_without_reply: true
    });
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'isu-'));
    const videoPath = path.join(dir, 'input.mp4');
    await fs.writeFile(videoPath, await downloadTelegramFile(video.file_id));    const duration = Number(video.duration) || await probeDuration(videoPath);
    if (!duration || duration <= 0) throw new Error('Could not determine video duration');
    const caption = msg.caption || '';
    const fullMode = duration > 60 || /\bfull\b|повн/i.test(caption);
    const shortElementMode = !fullMode && duration <= 30;
    let elementClassification = null;

    const eta = shortElementMode ? (duration <= 12 ? '≈ 45–90 с' : '≈ 1–2 хв') : fullMode ? '≈ 3–6 хв' : '≈ 1–3 хв';
    await tg('editMessageText', {
      chat_id: msg.chat.id, message_id: progress.message_id,
      text: `⏳ Відео ${duration.toFixed(1)} с. Режим: ${fullMode ? 'FULL PROGRAM' : shortElementMode ? 'ELEMENT' : 'FRAGMENT'}. Орієнтовно ${eta}.`
    });

    let result;
    if (fullMode) {
      result = await analyzeFullProgram({
        openai, model: MODEL, rules: RULES, videoPath, dir, duration, caption,
        extractTimedFrames, textFromResponse,
        onProgress: async text => tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text })
      });
    } else if (shortElementMode) {
      await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text: '⏳ Крок 1: визначаю клас елемента без припущення, що це стрибок.' });
      elementClassification = await classifyShortElement(videoPath, dir, duration, caption);
      if (elementClassification.category === 'jump') {
        result = await analyzeJumpClip(videoPath, dir, duration, caption, async text => {
          await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text });
        });
      } else {
        await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text: `⏳ Визначено: ${elementClassification.category}. Роблю Technical Call без jump-bias.` });
        result = await analyzeGeneric(videoPath, dir, duration, caption, false, elementClassification);
      }
    } else {
      await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text: '⏳ Аналізую фрагмент за ISU 2026/27.' });
      result = await analyzeGeneric(videoPath, dir, duration, caption, false, null);
    }

    console.log('analysis complete', {
      duration, mode: fullMode ? 'full' : elementClassification?.category || (shortElementMode ? 'element' : 'fragment'),
      locator: result.locator || null, chars: result.text.length
    });
    await deliverResult(msg.chat.id, msg.message_id, progress.message_id, result.text);
  } catch (err) {
    console.error('analysis error', err);
    const errorText = err?.status === 429 || err?.code === 'credit_balance_exhausted'
      ? '⚠️ ISU Judge: OpenAI API не має доступного балансу.'
      : `⚠️ ISU Judge: аналіз не завершено. ${String(err?.message || err).slice(0, 240)}`;
    try {
      if (progress?.message_id) await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text: errorText });
      else await tg('sendMessage', { chat_id: msg.chat.id, text: errorText, reply_to_message_id: msg.message_id, allow_sending_without_reply: true });
    } catch {}
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
app.get('/', (_req, res) => res.json({ ok: true, service: 'isu-telegram-worker-v2' }));
app.get('/health', (_req, res) => res.json({ ok: true, version: 2 }));

app.post('/telegram', async (req, res) => {
  if (WEBHOOK_SECRET && req.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) return res.sendStatus(403);
  res.sendStatus(200);
  const msg = req.body.message || req.body.channel_post;
  if (!msg || Number(msg.chat?.id) !== TARGET_CHAT_ID) return;
  const video = pickVideo(msg);
  if (!video) return;
  const key = `${msg.chat.id}:${msg.message_id}`;
  if (processed.has(key)) return;
  processed.add(key);
  processVideoMessage(msg, video).catch(err => console.error('unhandled processVideoMessage', err));
});

app.listen(PORT, async () => {
  console.log(`ISU worker v2 listening on ${PORT}`);
  if (PUBLIC_URL) {
    try {
      await tg('setWebhook', {
        url: `${PUBLIC_URL}/telegram`,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ['message'],
        drop_pending_updates: true
      });
      console.log('Telegram webhook configured');
    } catch (e) {
      console.error('Webhook setup failed', e);
    }
  }
});
