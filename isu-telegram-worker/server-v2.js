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
  await runFfmpeg([
    '-ss', String(start), '-i', videoPath, '-t', String(length),
    '-vf', `fps=${fps},scale=${width}:-2`, '-q:v', '3',
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

function parseJsonLoose(text) {
  if (!text) throw new Error('empty locator response');
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('locator did not return JSON');
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function locateJumpStructure(frames, duration, caption) {
  const content = [{ type: 'input_text', text:
`Locate jump events in this short figure-skating clip. This is only a temporal locator, NOT the final ISU call.
Return JSON only:
{"relationship":"solo|combination|sequence|multiple_separate|unknown","jumps":[{"index":1,"takeoff":1.2,"landing":1.8,"likely_type":"T|S|Lo|F|Lz|A|unknown","likely_revolutions":"1|2|3|4|unknown","confidence":75}],"clip_confidence":75,"notes":"short"}
Times are seconds from clip start. Detect every visible jump, up to 4. Do not force jump type if unclear.
Duration=${duration?.toFixed(2) || 'unknown'}s. Caption=${caption || '(none)'}.` }];
  for (const f of frames) {
    content.push({ type: 'input_text', text: `t=${f.time.toFixed(3)}s` });
    const b64 = (await fs.readFile(f.path)).toString('base64');
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'low' });
  }  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: 'medium' },
    max_output_tokens: 700,
    input: [{ role: 'user', content }]
  });
  const parsed = parseJsonLoose(textFromResponse(response));
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

async function analyzeJumpClip(videoPath, dir, duration, caption, onProgress) {
  await onProgress('⏳ Аналізую відео… Крок 1/3: знаходжу всі стрибки та їх зв’язок.');
  const sparseFps = duration <= 6 ? 6 : duration <= 15 ? 4 : 3;
  const sparse = await extractTimedFrames(videoPath, dir, {
    start: 0, length: duration, fps: sparseFps, width: 768, prefix: 'locator', max: 120
  });
  const locator = await locateJumpStructure(sparse, duration, caption);

  await onProgress('⏳ Аналізую відео… Крок 2/3: готую normal-speed context і dense replay.');
  const normal = await buildNormalContext(videoPath, dir, duration, locator);
  const dense = await buildDenseReplay(videoPath, dir, duration, locator);

  await onProgress('⏳ Аналізую відео… Крок 3/3: Technical Call → GOE за ISU 2026/27.');
  const content = [{ type: 'input_text', text:
`${RULES}

MODE: JUMP / ELEMENT ANALYSIS.
Duration: ${duration.toFixed(2)}s. Caption: ${caption || '(none)'}.
A first pass located this temporal structure: ${JSON.stringify(locator)}.
Treat that locator only as navigation, NOT as a technical call.
First finish the Technical Call independently, then GOE.
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

async function analyzeGeneric(videoPath, dir, duration, caption, fullMode) {
  const fps = fullMode ? (duration <= 180 ? 1 : 0.75) : (duration <= 30 ? 3 : 1);
  const max = fullMode ? 240 : 90;
  const frames = await extractTimedFrames(videoPath, dir, {
    start: 0, length: duration, fps, width: 896, prefix: fullMode ? 'program' : 'fragment', max
  });
  const content = [{ type: 'input_text', text:
`${RULES}

MODE: ${fullMode ? 'FULL PROGRAM ANALYSIS' : 'JUMP / ELEMENT ANALYSIS'}.
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
    const shortJumpMode = !fullMode && duration <= 30;

    const eta = shortJumpMode ? (duration <= 12 ? '≈ 45–90 с' : '≈ 1–2 хв') : fullMode ? '≈ 3–6 хв' : '≈ 1–3 хв';
    await tg('editMessageText', {
      chat_id: msg.chat.id, message_id: progress.message_id,
      text: `⏳ Відео ${duration.toFixed(1)} с. Режим: ${fullMode ? 'FULL PROGRAM' : shortJumpMode ? 'JUMP / COMBO' : 'FRAGMENT'}. Орієнтовно ${eta}.`
    });

    let result;
    if (fullMode) {
      result = await analyzeFullProgram({
        openai, model: MODEL, rules: RULES, videoPath, dir, duration, caption,
        extractTimedFrames, textFromResponse,
        onProgress: async text => tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text })
      });
    } else if (shortJumpMode) {
      result = await analyzeJumpClip(videoPath, dir, duration, caption, async text => {
        await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text });
      });
    } else {
      await tg('editMessageText', { chat_id: msg.chat.id, message_id: progress.message_id, text: '⏳ Аналізую фрагмент за ISU 2026/27.' });
      result = await analyzeGeneric(videoPath, dir, duration, caption, false);
    }

    console.log('analysis complete', {
      duration, mode: fullMode ? 'full' : shortJumpMode ? 'jump' : 'fragment',
      locator: result.locator || null, chars: result.text.length
    });
    await deliverResult(msg.chat.id, msg.message_id, progress.message_id, result.text);
    try {
      const parentSummary = await makeParentSummary(result.text);
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: parentSummary,
        reply_to_message_id: msg.message_id,
        allow_sending_without_reply: true
      });
    } catch (summaryErr) {
      console.error('parent summary error', summaryErr);
    }
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
