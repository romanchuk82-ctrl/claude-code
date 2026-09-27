import fs from 'fs/promises';

function parseJsonLoose(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('program inventory did not return JSON');
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function imagePart(file, detail = 'low') {
  const b64 = (await fs.readFile(file)).toString('base64');
  return { type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail };
}

export async function analyzeFullProgram(opts) {
  const {
    openai, model, rules, videoPath, dir, duration, caption,
    extractTimedFrames, textFromResponse, onProgress
  } = opts;

  await onProgress('⏳ FULL PROGRAM 1/3: переглядаю всю програму й складаю element inventory.');
  const scanFps = duration <= 210 ? 1.5 : 1.2;
  const scan = await extractTimedFrames(videoPath, dir, {
    start: 0, length: duration, fps: scanFps, width: 640, prefix: 'program-scan', max: 360
  });
  const inventoryContent = [{ type: 'input_text', text:
`You are the FIRST PASS inventory locator for an ISU Single Skating 2026/27 full program.
Return JSON only with chronological candidates:
{"elements":[{"index":1,"kind":"jump|spin|steps|choreo|unknown","start":12.0,"end":13.5,"likely":"2A|3S+2T|CCoSp|StSq|ChSq|unknown","confidence":75}],"falls":[{"time":44.2,"confidence":80}],"notes":"short"}
Review the entire timeline. Do not stop after early jumps. This is only navigation, not a final technical call.
Duration=${duration.toFixed(2)}s. Caption=${caption || '(none)'}.` }];  for (const f of scan) {
    inventoryContent.push({ type: 'input_text', text: `t=${f.time.toFixed(2)}s` });
    inventoryContent.push(await imagePart(f.path, 'low'));
  }

  const inventoryResponse = await openai.responses.create({
    model,
    reasoning: { effort: 'medium' },
    max_output_tokens: 2600,
    input: [{ role: 'user', content: inventoryContent }]
  });
  const inventory = parseJsonLoose(textFromResponse(inventoryResponse));
  inventory.elements = Array.isArray(inventory.elements) ? inventory.elements.slice(0, 24) : [];

  await onProgress(`⏳ FULL PROGRAM 2/3: inventory ${inventory.elements.length} елементів, готую детальні replay-вікна.`);
  const detailed = [];
  let frameBudget = 260;
  for (const e of inventory.elements) {
    if (frameBudget <= 0) break;
    const kind = String(e.kind || 'unknown');
    const start = Math.max(0, Number(e.start || 0) - (kind === 'jump' ? 0.65 : 0.4));
    const endRaw = Number(e.end || e.start || 0) + (kind === 'jump' ? 0.65 : 0.4);
    const end = Math.min(duration, Math.max(start + 0.8, endRaw));
    const length = end - start;
    const fps = kind === 'jump' ? 18 : kind === 'spin' ? 4 : 3;
    const cap = kind === 'jump' ? 42 : 26;
    const max = Math.min(cap, frameBudget);
    const frames = await extractTimedFrames(videoPath, dir, {
      start, length, fps, width: kind === 'jump' ? 1024 : 896,
      prefix: `program-e${e.index || detailed.length + 1}`, max
    });
    detailed.push({ element: e, frames });
    frameBudget -= frames.length;
  }

  await onProgress('⏳ FULL PROGRAM 3/3: Technical Calls → GOE → TES → PCS → deductions.');
  const finalContent = [{ type: 'input_text', text:
`${rules}

MODE: FULL PROGRAM ANALYSIS.
Duration: ${duration.toFixed(2)}s. Caption: ${caption || '(none)'}.
FIRST PASS inventory locator: ${JSON.stringify(inventory)}.
The inventory is navigation only, not a final call. Review all detailed replay evidence independently.
Required order: complete chronological inventory first; then Technical Panel calls; then GOE; then TES; then PCS only if sufficient full-program evidence and known category/segment; then deductions and estimated score.
For jumps use dense replay; for spins/steps do not invent levels if features are not reliably visible.
If category/segment is missing, do not invent requirements, factors, repeat rules, bonus or final segment score.
Follow the canonical full-program output formats and end with AI ESTIMATE — NOT AN OFFICIAL ISU RESULT.` }];  for (const block of detailed) {
    const e = block.element;
    finalContent.push({ type: 'input_text', text:
      `DETAIL ELEMENT #${e.index || '?'} kind=${e.kind || 'unknown'} likely=${e.likely || 'unknown'} locator confidence=${e.confidence || 'n/a'}%` });
    for (const f of block.frames) {
      finalContent.push({ type: 'input_text', text: `t=${f.time.toFixed(3)}s` });
      finalContent.push(await imagePart(f.path, e.kind === 'jump' ? 'high' : 'auto'));
    }
  }

  const finalResponse = await openai.responses.create({
    model,
    reasoning: { effort: 'high' },
    max_output_tokens: 7000,
    input: [{ role: 'user', content: finalContent }]
  });
  const text = textFromResponse(finalResponse);
  if (!text) throw new Error('OpenAI returned no textual full-program answer');
  return { text, inventory };
}
