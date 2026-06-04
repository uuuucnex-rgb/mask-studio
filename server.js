// =============================================================
// UNIFIED SERVER — Castelia Plugin + MASK STUDIO
// Endpoints:
//   GET  /                       → MASK STUDIO web app (public/index.html)
//   GET  /health                 → status
//   POST /api/generate           → Castelia plugin generation
//   POST /api/chat               → Castelia plugin "Анна" consultant
//   POST /api/generate-masked    → MASK STUDIO masked generation
//   POST /api/generate-auto      → MASK STUDIO designer mode
//   POST /api/touchup            → MASK STUDIO localized touchup
// =============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err && err.message ? err.message : err);
});

const app = express();
const PORT = process.env.PORT || 3002;

const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'gemini').toLowerCase();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1024';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Helpers =====

function mimeFromUrl(url) {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function extFromMime(mime) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

// =============================================================
// CASTELIA PLUGIN — /api/generate and /api/chat
// =============================================================

const OPENAI_PROMPT_TEMPLATE = `You have two images:
- Image 1: A photo from a client — may be either interior room OR building facade/exterior
- Image 2: A texture sample of a finishing material called "[MATERIAL_NAME]"

STEP 1 — Analyze Image 1 and determine type:
- If interior: identify walls only (vertical flat surfaces between floor and ceiling)
- If facade/exterior: identify main building walls only (flat vertical surfaces of the building)

STEP 2 — Apply material from Image 2 STRICTLY ONLY to wall surfaces identified in Step 1.

ABSOLUTE RULES — NEVER APPLY material to:
- windows (including glass, frames, sills)
- doors (including door frames)
- ceilings
- floors
- roof
- balconies and railings
- furniture
- plants, trees, people, sky, ground
- lamps, sockets, switches
- pipes, gutters, wires
- decorative elements that are not part of the wall

ABSOLUTE RULES — PRESERVE unchanged:
- exact camera angle, perspective, composition
- original lighting, shadows, time of day
- room/building geometry and proportions
- all objects listed above (windows, doors, furniture etc.)
- image format and dimensions — do not crop, do not add, do not remove

QUALITY REQUIREMENTS:
- Material must follow wall geometry with correct perspective
- Natural lighting and shadows on new material surface
- Photorealistic architectural render, not a photoshop collage
- High detail, sharp, no artifacts
- Must look like the material is really installed on the walls

OUTPUT: Return only the final edited image. No text, no watermarks.`;

const GEMINI_PROMPT_TEMPLATE = `You will receive 2 images:
- Image 1: a photo of an interior room OR building facade/exterior
- Image 2: a texture sample of a finishing material called "[MATERIAL_NAME]"

TASK: Create a photorealistic architectural visualization showing the material from Image 2 applied to the wall surfaces of Image 1.

STRICT RULES:
1. Apply material ONLY to flat vertical wall surfaces (interior walls or main building walls).
2. Do NOT apply material to: windows, glass, doors, door frames, ceilings, floors, roof, balconies, railings, furniture, plants, people, sky, ground, lamps, sockets, pipes, gutters, decorative elements.
3. Preserve EXACTLY: camera angle, perspective, composition, original lighting, shadows, geometry, proportions, and all objects in the scene.
4. Material must follow wall geometry with correct perspective and realistic lighting/shadow interaction.
5. Keep the same aspect ratio and dimensions as Image 1. Do not crop, do not add borders, do not change framing.
6. Result must look like a professional architectural render — photorealistic, not a photoshop collage.

OUTPUT: return only the final edited image. No text, no watermarks.`;

async function generateWithOpenAI({ clientBuf, clientMime, materialBuf, materialMime, materialName, outputSize }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const prompt = OPENAI_PROMPT_TEMPLATE.replace('[MATERIAL_NAME]', materialName);
  const clientExt = extFromMime(clientMime);
  const materialExt = extFromMime(materialMime);

  async function call() {
    const form = new FormData();
    form.append('model', OPENAI_IMAGE_MODEL);
    form.append('prompt', prompt);
    form.append('size', outputSize);
    form.append('quality', OPENAI_IMAGE_QUALITY);
    form.append('n', '1');
    form.append('image[]', new Blob([clientBuf], { type: clientMime }), `client.${clientExt}`);
    form.append('image[]', new Blob([new Uint8Array(materialBuf)], { type: materialMime }), `material.${materialExt}`);
    return fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form
    });
  }

  let apiResp; let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      console.log(`  openai attempt ${i}/3...`);
      apiResp = await call();
      break;
    } catch (e) {
      lastErr = e;
      console.error(`  openai attempt ${i} failed: ${e.message}`);
      if (i < 3) await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  if (!apiResp) throw lastErr || new Error('All attempts failed');

  const text = await apiResp.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error(`OpenAI returned non-JSON (status ${apiResp.status})`); }
  if (!apiResp.ok) throw new Error((data && data.error && data.error.message) || `OpenAI error ${apiResp.status}`);
  if (!data.data || !data.data[0] || !data.data[0].b64_json) throw new Error('No image returned from OpenAI');
  return `data:image/png;base64,${data.data[0].b64_json}`;
}

async function generateWithGemini({ clientBuf, clientMime, materialBuf, materialMime, materialName }) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const prompt = GEMINI_PROMPT_TEMPLATE.replace('[MATERIAL_NAME]', materialName);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: clientMime, data: clientBuf.toString('base64') } },
        { inline_data: { mime_type: materialMime, data: Buffer.from(materialBuf).toString('base64') } }
      ]
    }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.3 }
  };

  let apiResp; let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      console.log(`  gemini attempt ${i}/3...`);
      apiResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      break;
    } catch (e) {
      lastErr = e;
      console.error(`  gemini attempt ${i} failed: ${e.message}`);
      if (i < 3) await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  if (!apiResp) throw lastErr || new Error('All attempts failed');

  const data = await apiResp.json();
  if (!apiResp.ok) throw new Error((data && data.error && data.error.message) || `Gemini error ${apiResp.status}`);
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  if (!parts || !parts.length) throw new Error('Empty response from Gemini');
  const imagePart = parts.find(p => p.inlineData || p.inline_data);
  if (!imagePart) {
    const textPart = parts.find(p => p.text);
    throw new Error(textPart ? `Gemini returned text: ${textPart.text.slice(0, 200)}` : 'No image in response');
  }
  const inline = imagePart.inlineData || imagePart.inline_data;
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return `data:${mime};base64,${inline.data}`;
}

app.post('/api/generate', async (req, res) => {
  const started = Date.now();
  try {
    const { clientImageBase64, clientImageMime, clientImageWidth, clientImageHeight, materialImageUrl, materialName } = req.body || {};
    if (!clientImageBase64 || !clientImageMime || !materialImageUrl || !materialName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    function pickSize(w, h) {
      if (!w || !h) return OPENAI_IMAGE_SIZE;
      const ratio = w / h;
      if (ratio > 1.15) return '1536x1024';
      if (ratio < 0.87) return '1024x1536';
      return '1024x1024';
    }
    const outputSize = pickSize(clientImageWidth, clientImageHeight);
    console.log(`[${new Date().toISOString()}] /api/generate provider=${IMAGE_PROVIDER} material="${materialName}"`);

    const matResp = await fetch(materialImageUrl);
    if (!matResp.ok) throw new Error(`Failed to fetch material image: ${matResp.status}`);
    const matAB = await matResp.arrayBuffer();
    const materialMime = mimeFromUrl(materialImageUrl);
    const clientBuf = Buffer.from(clientImageBase64, 'base64');

    let resultDataUrl;
    if (IMAGE_PROVIDER === 'openai') {
      resultDataUrl = await generateWithOpenAI({
        clientBuf, clientMime: clientImageMime, materialBuf: matAB, materialMime, materialName, outputSize
      });
    } else {
      resultDataUrl = await generateWithGemini({
        clientBuf, clientMime: clientImageMime, materialBuf: matAB, materialMime, materialName
      });
    }
    const generationTime = Date.now() - started;
    console.log(`[${new Date().toISOString()}] /api/generate done in ${generationTime}ms`);
    res.json({ resultDataUrl, generationTime });
  } catch (err) {
    const generationTime = Date.now() - started;
    const msg = (err && err.message) || 'Unknown server error';
    console.error(`[${new Date().toISOString()}] /api/generate failed in ${generationTime}ms: ${msg}`);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

const CHAT_SYSTEM_PROMPT = `Ты — Анна, AI-консультант бренда Castelia (премиальные отделочные материалы — гибкий камень из Италии).

В каталоге сейчас 3 материала:
1. Aerolite Coffee Grey — тёплый серо-кофейный нейтральный универсал. Современная классика, минимализм, скандинавский стиль.
2. Roman Pillar Milan Red — насыщенный кирпично-красный, лофт, индустриальный стиль, акцентные стены.
3. Marble Bianco Carara — белый мрамор с серыми прожилками, классика, лакшери, парадные интерьеры.

Твоя цель: за 1-3 коротких сообщения понять что у клиента и порекомендовать ровно один материал.

Стиль: на "вы", тёплый профессиональный тон, короткие ответы (1-3 предложения), без markdown, эмоджи минимально.
Не упоминай конкурентов и не давай гарантий по срокам/цене.

Когда даёшь финальную рекомендацию — заверши сообщение тегом [RECOMMEND:N] где N это 1, 2 или 3.`;

app.post('/api/chat', async (req, res) => {
  const started = Date.now();
  try {
    const { messages, imageBase64, imageMime } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Missing messages' });
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });

    const apiMessages = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }];
    messages.forEach(function (m, i) {
      const isLast = i === messages.length - 1;
      if (isLast && imageBase64 && imageMime && m.role === 'user') {
        apiMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content || 'Вот фото моего помещения' },
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}`, detail: 'low' } }
          ]
        });
      } else {
        apiMessages.push({ role: m.role, content: m.content });
      }
    });

    const apiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: CHAT_MODEL, messages: apiMessages, max_tokens: 220, temperature: 0.7 })
    });
    const data = await apiResp.json();
    if (!apiResp.ok) {
      const msg = (data && data.error && data.error.message) || `OpenAI error ${apiResp.status}`;
      return res.status(502).json({ error: msg });
    }
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const match = reply.match(/\[RECOMMEND:([123])\]/);
    const recommendId = match ? parseInt(match[1], 10) : null;
    const cleanReply = reply.replace(/\[RECOMMEND:[123]\]/g, '').trim();
    console.log(`[${new Date().toISOString()}] /api/chat done in ${Date.now() - started}ms, rec=${recommendId}`);
    res.json({ reply: cleanReply, recommendId });
  } catch (err) {
    const msg = (err && err.message) || 'Unknown server error';
    console.error('Chat exception:', msg);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// =============================================================
// MASK STUDIO — /api/generate-masked, /api/generate-auto, /api/touchup
// =============================================================

function buildPrompt(materials, baseWidth, baseHeight) {
  const colorAssignments = materials.map((m) =>
    `   - ${m.colorName.toUpperCase()} pixels → apply material "${m.materialName}"`
  ).join('\n');
  const totalImages = 2 + materials.length;
  const materialList = materials.map((m, i) =>
    `IMAGE ${i + 2}: MATERIAL "${m.materialName}" — texture sample (reference only — DO NOT include this sample visually in the output)`
  ).join('\n');
  const dimsText = baseWidth && baseHeight
    ? `OUTPUT DIMENSIONS: exactly ${baseWidth} × ${baseHeight} pixels (same as BASE PHOTO).`
    : 'OUTPUT DIMENSIONS: exactly the same width × height as BASE PHOTO.';

  return `╔════════════════════════════════════════════════════════════╗
║  CRITICAL FORMAT RULES (READ FIRST — DEAL-BREAKING)        ║
╚════════════════════════════════════════════════════════════╝

You MUST produce EXACTLY ONE photographic image of the same scene as BASE PHOTO.

❌ FORBIDDEN OUTPUTS — never produce any of these:
   • A grid, collage, or multi-panel layout (2×2, 3×1, triptych, etc.)
   • Before/after split-screen or side-by-side comparison
   • The BASE PHOTO appearing alongside the edited version
   • Material samples or swatches shown beside / below / above the image
   • Multiple variations of the result stacked together
   • Duplicated, doubled, or tripled photos
   • Text labels, annotations, color chips, captions, watermarks
   • Letterbox bars, mats, borders, frames around the image
   • Extra canvas, padding, or empty regions

✅ ONLY VALID OUTPUT:
   • One single photorealistic image
   • ${dimsText}
   • Same aspect ratio as BASE PHOTO (do NOT convert to 1:1, 9:16, 16:9 — keep input ratio)
   • Same framing, camera angle, field of view as BASE PHOTO
   • The edited scene from BASE PHOTO with materials applied to surfaces inside it

The MATERIAL images you receive are REFERENCE TEXTURES — they describe what to apply on surfaces. They must NOT appear as separate elements in your output.

╔════════════════════════════════════════════════════════════╗

You will receive ${totalImages} images in this exact order:

IMAGE 1: BASE PHOTO — a real interior room or building facade. This is the scene to edit.

${materialList}

IMAGE ${totalImages}: COLOR-CODED MASK — same dimensions as BASE PHOTO. It is a black image with colored regions painted by the user. Use the mask to know where each material goes:
${colorAssignments}
   - BLACK pixels → leave untouched

ABSOLUTE RULES (highest to lowest priority — never break)

RULE 1 — APPLY EVERY MATERIAL THAT APPEARS IN THE MASK
You MUST apply every color region shown in the mask. If the mask contains red AND green AND blue, then all ${materials.length} materials must visibly appear in the final image. Do not skip any.

RULE 2 — PRESERVE OBJECTS ON OR NEAR WALLS (most important!)
The mask is hand-drawn with a brush and OFTEN covers objects that the user does not intend to replace. Even when a colored region covers them, keep these objects EXACTLY as in the original photo:
   • Paintings, photos, posters, picture frames
   • Hooks, nails, pegs, knobs, handles
   • Shelves and items on them
   • Mirrors, clocks
   • Hanging clothes, towels, bags, jackets
   • Light switches, sockets, outlets, thermostats, smoke detectors
   • Lamps, sconces, wall lights, ceiling lights
   • Vents, grilles, radiators, pipes, cables, wires
   • Plants in pots, flowers, hanging planters
   • Decorations, sculptures, ornaments
   • People, pets

The new material flows AROUND these objects, NEVER over them.

RULE 3 — SNAP TO REAL SURFACE BOUNDARIES
The user's brush strokes are approximate. Even when a colored region spills outside the actual wall (onto a window, door frame, floor, ceiling, etc.), the material must NOT cover those areas. Use the BASE photo to detect real edges and apply material only to the actual flat wall/surface pixels inside the marked region.

RULE 4 — NEVER APPLY MATERIAL TO:
   • Windows (glass, frames, sills, mullions)
   • Doors, door frames
   • Ceilings
   • Floors
   • Roofs
   • Balconies, railings, balustrades
   • Furniture (sofas, tables, chairs, beds, cabinets, shelves)
   • Sky, ground, plants, trees, people

RULE 5 — PHOTOREALISTIC INSTALLATION
Material must follow the wall's perspective and curvature correctly, have realistic scale, show natural lighting and shadows from existing light sources, interact with adjacent surfaces realistically.

RULE 6 — PRESERVE EVERYTHING OUTSIDE THE MASK
Areas where the mask is black must remain pixel-identical to the original photo.

RULE 7 — STRICT FORMAT (already covered at the top — re-emphasizing)
Single image, same dimensions as BASE PHOTO, no collage, no swatches, no labels. Period.

OUTPUT: return ONLY the final photorealistic edited image. No text. No watermarks. No annotations. No swatches. No borders.`;
}

app.post('/api/generate-masked', async (req, res) => {
  const started = Date.now();
  try {
    const { baseImage, baseWidth, baseHeight, materials, combinedMaskImage } = req.body || {};
    if (!baseImage) return res.status(400).json({ error: 'Missing baseImage' });
    if (!combinedMaskImage) return res.status(400).json({ error: 'Missing combinedMaskImage' });
    if (!Array.isArray(materials) || materials.length === 0) return res.status(400).json({ error: 'At least one material required' });
    if (materials.length > 3) return res.status(400).json({ error: 'Max 3 materials supported' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

    const base = parseDataUrl(baseImage);
    if (!base) return res.status(400).json({ error: 'Invalid baseImage format' });
    const combinedMask = parseDataUrl(combinedMaskImage);
    if (!combinedMask) return res.status(400).json({ error: 'Invalid combinedMaskImage format' });

    console.log(`[${new Date().toISOString()}] /api/generate-masked materials=${materials.length}`);

    const parts = [];
    parts.push({ text: buildPrompt(materials, baseWidth, baseHeight) });
    parts.push({ inline_data: { mime_type: base.mime, data: base.base64 } });

    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (!m.materialUrl || !m.materialName || !m.colorName) return res.status(400).json({ error: `Material ${i + 1} is incomplete` });
      const matResp = await fetch(m.materialUrl);
      if (!matResp.ok) throw new Error(`Material ${i + 1}: failed to fetch image`);
      const matBuf = Buffer.from(await matResp.arrayBuffer());
      const matMime = mimeFromUrl(m.materialUrl);
      parts.push({ inline_data: { mime_type: matMime, data: matBuf.toString('base64') } });
    }
    parts.push({ inline_data: { mime_type: combinedMask.mime, data: combinedMask.base64 } });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.3 } };

    let apiResp; let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`  gemini-masked attempt ${i}/3...`);
        apiResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        break;
      } catch (e) {
        lastErr = e;
        console.error(`  gemini-masked attempt ${i} failed: ${e.message}`);
        if (i < 3) await new Promise(r => setTimeout(r, 2000 * i));
      }
    }
    if (!apiResp) throw lastErr || new Error('All attempts failed');

    const data = await apiResp.json();
    if (!apiResp.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || `Gemini error ${apiResp.status}` });
    const respParts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    if (!respParts || !respParts.length) return res.status(502).json({ error: 'Empty response from Gemini' });
    const imagePart = respParts.find(p => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textPart = respParts.find(p => p.text);
      return res.status(502).json({ error: textPart ? `No image: ${textPart.text.slice(0, 200)}` : 'No image returned' });
    }
    const inline = imagePart.inlineData || imagePart.inline_data;
    const mime = inline.mimeType || inline.mime_type || 'image/png';
    const resultDataUrl = `data:${mime};base64,${inline.data}`;
    const generationTime = Date.now() - started;
    console.log(`[${new Date().toISOString()}] /api/generate-masked done in ${generationTime}ms`);
    res.json({ resultDataUrl, generationTime });
  } catch (err) {
    const generationTime = Date.now() - started;
    const msg = (err && err.message) || 'Unknown server error';
    console.error(`[${new Date().toISOString()}] /api/generate-masked failed in ${generationTime}ms: ${msg}`);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

function buildDesignerPrompt(materials, baseWidth, baseHeight) {
  const list = materials.map((m, i) =>
    `IMAGE ${i + 2}: MATERIAL "${m.materialName}" — texture sample (reference only — DO NOT visually include this sample in the output)`
  ).join('\n');
  const numMaterials = materials.length;
  const allMatNames = materials.map(m => `"${m.materialName}"`).join(', ');
  const dimsText = baseWidth && baseHeight
    ? `exactly ${baseWidth} × ${baseHeight} pixels (same as BASE PHOTO)`
    : 'exactly the same width × height as BASE PHOTO';

  return `╔════════════════════════════════════════════════════════════╗
║  CRITICAL FORMAT RULES (READ FIRST — DEAL-BREAKING)        ║
╚════════════════════════════════════════════════════════════╝

You MUST produce EXACTLY ONE photographic image — the edited scene from BASE PHOTO.

❌ FORBIDDEN OUTPUTS:
   • Grid, collage, multi-panel layout
   • Before/after split-screen
   • The BASE PHOTO alongside the edited version
   • Material samples or swatches anywhere in the output
   • Duplicated, doubled, or tripled photos
   • Text labels, annotations, color chips, watermarks
   • Borders, mats, frames, extra canvas

✅ ONLY VALID OUTPUT:
   • One single photorealistic image
   • Output dimensions: ${dimsText}
   • Same aspect ratio as BASE PHOTO
   • Same framing, camera angle as BASE PHOTO

The MATERIAL images are REFERENCE TEXTURES only — never include as separate visual elements.

╔════════════════════════════════════════════════════════════╗

# ROLE

You are a WORLD-CLASS INTERIOR DESIGNER with 25 years of experience. Your portfolio includes celebrity homes in Beverly Hills, luxury hotels in Milan, and historic villas in Tuscany. Your work has been featured in Architectural Digest, Elle Decor, Wallpaper*, and Domus. You combine Italian classical sensibility with contemporary minimalism.

# INPUT

You will receive ${1 + numMaterials} images:
- IMAGE 1 — BASE PHOTO: the actual real-world scene to redesign (interior room or facade)
${list}

# TASK

Edit the BASE PHOTO in place. Apply the ${numMaterials} material${numMaterials > 1 ? 's' : ''} to suitable surfaces inside the scene with the taste, restraint, and judgment of a top designer.

# CRITICAL CONTENT REQUIREMENTS

1. **USE ALL ${numMaterials} MATERIALS INSIDE THE SCENE**
   You MUST integrate every provided material (${allMatNames}) into the actual design within the scene. NEVER drop a material as a swatch outside the scene. NEVER skip a material.

2. **PRESERVE EVERY OBJECT EXACTLY**
   Furniture, windows, doors, frames, paintings, hooks, shelves, lamps, plants, decorations, books, people, pets — all stay PIXEL-IDENTICAL. Material flows AROUND them, never over them.

3. **NEVER APPLY MATERIAL TO**: windows, glass, doors, frames, ceilings, floors (unless clearly a floor texture), roof, balconies, furniture, plants, sky.

4. **PHOTOREALISTIC INSTALLATION**: correct perspective, realistic scale, natural lighting and shadows, proper edges.

# DESIGN DECISIONS

- WHERE each material goes
- HOW MUCH coverage
- For multiple materials: hierarchy (one dominant, others as accents). Distribute across DIFFERENT surfaces.

OUTPUT: return ONLY the final photorealistic edited image. No text. No swatches. No borders.`;
}

app.post('/api/generate-auto', async (req, res) => {
  const started = Date.now();
  try {
    const { baseImage, baseWidth, baseHeight, materials } = req.body || {};
    if (!baseImage) return res.status(400).json({ error: 'Missing baseImage' });
    if (!Array.isArray(materials) || materials.length === 0) return res.status(400).json({ error: 'At least one material required' });
    if (materials.length > 3) return res.status(400).json({ error: 'Max 3 materials' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

    const base = parseDataUrl(baseImage);
    if (!base) return res.status(400).json({ error: 'Invalid baseImage format' });

    console.log(`[${new Date().toISOString()}] /api/generate-auto materials=${materials.length}`);

    const parts = [];
    parts.push({ text: buildDesignerPrompt(materials, baseWidth, baseHeight) });
    parts.push({ inline_data: { mime_type: base.mime, data: base.base64 } });

    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (!m.materialUrl || !m.materialName) return res.status(400).json({ error: `Material ${i + 1} is incomplete` });
      const matResp = await fetch(m.materialUrl);
      if (!matResp.ok) throw new Error(`Material ${i + 1}: failed to fetch image`);
      const matBuf = Buffer.from(await matResp.arrayBuffer());
      const matMime = mimeFromUrl(m.materialUrl);
      parts.push({ inline_data: { mime_type: matMime, data: matBuf.toString('base64') } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4 } };

    let apiResp; let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`  gemini-auto attempt ${i}/3...`);
        apiResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        break;
      } catch (e) { lastErr = e; if (i < 3) await new Promise(r => setTimeout(r, 2000 * i)); }
    }
    if (!apiResp) throw lastErr || new Error('All attempts failed');

    const data = await apiResp.json();
    if (!apiResp.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || `Gemini error ${apiResp.status}` });
    const respParts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    if (!respParts || !respParts.length) return res.status(502).json({ error: 'Empty response from Gemini' });
    const imagePart = respParts.find(p => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textPart = respParts.find(p => p.text);
      return res.status(502).json({ error: textPart ? `No image: ${textPart.text.slice(0, 200)}` : 'No image returned' });
    }
    const inline = imagePart.inlineData || imagePart.inline_data;
    const mime = inline.mimeType || inline.mime_type || 'image/png';
    const resultDataUrl = `data:${mime};base64,${inline.data}`;
    const generationTime = Date.now() - started;
    console.log(`[${new Date().toISOString()}] /api/generate-auto done in ${generationTime}ms`);
    res.json({ resultDataUrl, generationTime });
  } catch (err) {
    const generationTime = Date.now() - started;
    const msg = (err && err.message) || 'Unknown server error';
    console.error(`[${new Date().toISOString()}] /api/generate-auto failed in ${generationTime}ms: ${msg}`);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

function buildTouchupPrompt(materialName, baseWidth, baseHeight) {
  const dimsText = baseWidth && baseHeight
    ? `exactly ${baseWidth} × ${baseHeight} pixels (same as CURRENT VERSION)`
    : 'exactly the same width × height as CURRENT VERSION';

  return `╔════════════════════════════════════════════════════════════╗
║  CRITICAL FORMAT RULES (READ FIRST — DEAL-BREAKING)        ║
╚════════════════════════════════════════════════════════════╝

You MUST produce EXACTLY ONE photographic image — a localized edit of CURRENT VERSION.

❌ FORBIDDEN: any grid/collage, before/after, swatches in output, doubled photos, text/labels, borders.

✅ ONLY VALID OUTPUT:
   • Single photorealistic image
   • Output dimensions: ${dimsText}
   • Same aspect ratio, framing as CURRENT VERSION
   • Everything outside white-mask region pixel-identical to CURRENT VERSION

╔════════════════════════════════════════════════════════════╗

# ROLE

You are performing a PRECISE LOCALIZED TOUCH-UP on an interior visualization that was already edited. The user is unhappy with one specific area and wants it changed — but everything else must stay EXACTLY as it is.

# INPUT

IMAGE 1 — CURRENT VERSION: the visualization as it currently looks
IMAGE 2 — MATERIAL: texture sample of "${materialName}" (reference only — do NOT include visually)
IMAGE 3 — TOUCH-UP MASK: black image with WHITE region(s) indicating where to apply MATERIAL

# TASK

Modify ONLY the white-marked region(s) in CURRENT VERSION. Apply MATERIAL there as if physically installed. Everywhere else: pixel-perfect copy of CURRENT VERSION.

# ABSOLUTE RULES

1. **ZERO CHANGE OUTSIDE THE MASK.** Every pixel where mask is BLACK must be pixel-identical to CURRENT VERSION.
2. **SEAMLESS BLEND AT MASK EDGES.** Smooth transition, match existing lighting/shadow direction.
3. **SNAP TO REAL SURFACE BOUNDARIES INSIDE THE MASK.** If mask spills onto windows/doors/objects within the marked region, do NOT cover those — keep them pixel-identical.
4. **CONTEXT-AWARE INSTALLATION.** Match existing perspective, scale, lighting.

OUTPUT: return ONLY the touched-up image. Same dimensions as CURRENT VERSION. No text, no swatches, no labels, no borders.`;
}

app.post('/api/touchup', async (req, res) => {
  const started = Date.now();
  try {
    const { baseImage, baseWidth, baseHeight, materialUrl, materialName, maskImage } = req.body || {};
    if (!baseImage) return res.status(400).json({ error: 'Missing baseImage' });
    if (!materialUrl || !materialName) return res.status(400).json({ error: 'Missing material' });
    if (!maskImage) return res.status(400).json({ error: 'Missing maskImage' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

    const base = parseDataUrl(baseImage);
    if (!base) return res.status(400).json({ error: 'Invalid baseImage' });
    const mask = parseDataUrl(maskImage);
    if (!mask) return res.status(400).json({ error: 'Invalid maskImage' });

    console.log(`[${new Date().toISOString()}] /api/touchup material="${materialName}"`);

    const matResp = await fetch(materialUrl);
    if (!matResp.ok) throw new Error(`Failed to fetch material image`);
    const matBuf = Buffer.from(await matResp.arrayBuffer());
    const matMime = mimeFromUrl(materialUrl);

    const parts = [];
    parts.push({ text: buildTouchupPrompt(materialName, baseWidth, baseHeight) });
    parts.push({ inline_data: { mime_type: base.mime, data: base.base64 } });
    parts.push({ inline_data: { mime_type: matMime, data: matBuf.toString('base64') } });
    parts.push({ inline_data: { mime_type: mask.mime, data: mask.base64 } });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.25 } };

    let apiResp; let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`  touchup attempt ${i}/3...`);
        apiResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        break;
      } catch (e) { lastErr = e; if (i < 3) await new Promise(r => setTimeout(r, 2000 * i)); }
    }
    if (!apiResp) throw lastErr || new Error('All attempts failed');

    const data = await apiResp.json();
    if (!apiResp.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || `Gemini error ${apiResp.status}` });
    const respParts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    if (!respParts || !respParts.length) return res.status(502).json({ error: 'Empty response from Gemini' });
    const imagePart = respParts.find(p => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textPart = respParts.find(p => p.text);
      return res.status(502).json({ error: textPart ? `No image: ${textPart.text.slice(0, 200)}` : 'No image returned' });
    }
    const inline = imagePart.inlineData || imagePart.inline_data;
    const mime = inline.mimeType || inline.mime_type || 'image/png';
    const resultDataUrl = `data:${mime};base64,${inline.data}`;
    const generationTime = Date.now() - started;
    console.log(`[${new Date().toISOString()}] /api/touchup done in ${generationTime}ms`);
    res.json({ resultDataUrl, generationTime });
  } catch (err) {
    const generationTime = Date.now() - started;
    const msg = (err && err.message) || 'Unknown server error';
    console.error(`[${new Date().toISOString()}] /api/touchup failed in ${generationTime}ms: ${msg}`);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// =============================================================
// HEALTH + STATIC ROOT
// =============================================================

app.get('/health', (_req, res) => res.json({
  ok: true,
  provider: IMAGE_PROVIDER,
  gemini_model: GEMINI_IMAGE_MODEL,
  chat_model: CHAT_MODEL,
  has_gemini_key: !!GEMINI_API_KEY,
  has_openai_key: !!OPENAI_API_KEY
}));

// NOTE: express.static() above already serves public/index.html on GET /
// If you want to keep the plugin's "DesignAI proxy is running" text endpoint, uncomment:
// app.get('/proxy-status', (_req, res) => res.send('DesignAI proxy is running'));

app.listen(PORT, () => {
  console.log(`Unified server listening on http://localhost:${PORT}`);
  console.log(`Image provider: ${IMAGE_PROVIDER}`);
  console.log(`  Gemini model: ${GEMINI_IMAGE_MODEL}`);
  console.log(`  Chat model:   ${CHAT_MODEL}`);
  if (!GEMINI_API_KEY) console.warn('WARNING: GEMINI_API_KEY is empty');
  if (!OPENAI_API_KEY) console.warn('WARNING: OPENAI_API_KEY is empty (chat will fail)');
  console.log(`Static files served from: public/`);
});
