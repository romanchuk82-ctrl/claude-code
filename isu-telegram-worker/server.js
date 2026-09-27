import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import OpenAI from 'openai';

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
const processed = new Set();

const RULES = `ISU Single Skating 2026/27. First complete Technical Call, only then GOE. Jump order: type A/T/S/Lo/F/Lz; rotations; solo/combo/SEQ; landing rotation clean/q/</<<; F/Lz edge clean/!/e only if visible; other errors; GOE. q=exactly 1/4 short, <=more than 1/4 but less than 1/2, <<=1/2 or more. Judge rotation by blade, not shoulders/hips. If F/Lz edge is not reliable say EDGE: NOT RELIABLY VISIBLE. Do not split combinations; one GOE for whole jump element. Prefer UNCERTAIN when evidence is insufficient. Never use 100% confidence from one unofficial angle. Explain in Ukrainian, keep ISU codes in English.`;
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

async function downloadTelegramFile(fileId) {
  const info = await tg('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let err = '';
    p.stderr.on('data', d => err += d.toString());
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(err) : reject(new Error(err)));
  });
}
async function probeDuration(file) {
  try {
    await runFfmpeg(['-i', file, '-f', 'null', '-']);
    return null;
  } catch (e) {
    const s = String(e.message || e);
    const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }
}

async function extractFrames(videoPath, dir, duration) {
  let fps = 0.25, max = 70;
  if (duration && duration <= 12) { fps = 6; max = 72; }
  else if (duration && duration <= 30) { fps = 3; max = 75; }
  else if (duration && duration <= 90) { fps = 1; max = 75; }
  const out = path.join(dir, 'frame-%04d.jpg');
  await runFfmpeg([
    '-i', videoPath,
    '-vf', `fps=${fps},scale=960:-2`,
    '-q:v', '3', '-frames:v', String(max), out
  ]);
  const names = (await fs.readdir(dir)).filter(x => x.endsWith('.jpg')).sort();
  return names.map(n => path.join(dir, n));
}
async function analyze(framePaths, duration, caption) {
  const full = (duration || 0) > 60 || /\bfull\b|повн/i.test(caption || '');
  const content = [{
    type: 'input_text',
    text: `${RULES}\nMode: ${full ? 'FULL PROGRAM' : 'JUMP / ELEMENT'}. Duration: ${duration ? duration.toFixed(1) + 's' : 'unknown'}. Caption: ${caption || '(none)'}. Frames are chronological samples. Mention sampling limits. For full program, inventory first; do not invent category/segment, factors, levels or PCS if not reliably known.`
  }];
  for (const f of framePaths) {
    const b64 = (await fs.readFile(f)).toString('base64');
    content.push({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${b64}`,
      detail: 'high'
    });
  }
  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: 'high' },
    max_output_tokens: 1800,
    input: [{ role: 'user', content }]
  });
  return response.output_text?.trim() || 'Не вдалося сформувати оцінку.';
}

function pickVideo(msg) {
  if (msg.video) return msg.video;
  if (msg.document && String(msg.document.mime_type || '').startsWith('video/')) return msg.document;
  return null;
}
app.get('/', (_req, res) => res.json({ ok: true, service: 'isu-telegram-worker' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

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

  try {
    await tg('sendChatAction', { chat_id: msg.chat.id, action: 'typing' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'isu-'));
    const videoPath = path.join(dir, 'input.mp4');
    await fs.writeFile(videoPath, await downloadTelegramFile(video.file_id));
    const duration = video.duration || await probeDuration(videoPath);
    const frames = await extractFrames(videoPath, dir, duration);
    if (!frames.length) throw new Error('No frames extracted');
    const result = await analyze(frames, duration, msg.caption || '');
    const text = (`⛸ ISU Judge 2026/27\n\n${result}`).slice(0, 4000);
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text,
      reply_to_message_id: msg.message_id,
      allow_sending_without_reply: true
    });
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error('analysis error', err);
    try {
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: '⚠️ ISU Judge: не вдалося автоматично проаналізувати це відео. Спробуйте коротший або чіткіший файл.',
        reply_to_message_id: msg.message_id,
        allow_sending_without_reply: true
      });
    } catch {}
  }
});

app.listen(PORT, async () => {
  console.log(`ISU worker listening on ${PORT}`);
  if (PUBLIC_URL) {
    try {
      await tg('setWebhook', { url: `${PUBLIC_URL}/telegram`, secret_token: WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true });
      console.log('Telegram webhook configured');
    } catch (e) { console.error('Webhook setup failed', e); }
  }
});
