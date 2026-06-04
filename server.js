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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';

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

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

function buildPrompt(materials, baseWidth, baseHeight) {
  // materials: [{ materialName, colorName }, ...]  (colorName = 'red' | 'green' | 'blue')
  const colorAssignments = materials.map((m, i) =>
    `   - ${m.colorName.toUpperCase()} pixels → apply material "${m.materialName}"`
  ).join('\n');

  const totalImages = 2 + materials.length; // base + N materials + 1 mask
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

Think of yourself as a Photoshop expert doing an in-place edit: open BASE PHOTO, paint new pixels on certain walls, save with the same dimensions. Nothing more.

The MATERIAL images you receive are REFERENCE TEXTURES — they describe what to apply on surfaces. They must NOT appear as separate elements in your output.

╔════════════════════════════════════════════════════════════╗

You will receive ${totalImages} images in this exact order:

IMAGE 1: BASE PHOTO — a real interior room or building facade. This is the scene to edit.

${materialList}

IMAGE ${totalImages}: COLOR-CODED MASK — same dimensions as BASE PHOTO. It is a black image with colored regions painted by the user. Use the mask to know where each material goes:
${colorAssignments}
   - BLACK pixels → leave untouched

═══════════════════════════════════════════════════════════════
ABSOLUTE RULES (highest to lowest priority — never break)
═══════════════════════════════════════════════════════════════

RULE 1 — APPLY EVERY MATERIAL THAT APPEARS IN THE MASK
You MUST apply every color region shown in the mask. If the mask contains red AND green AND blue, then all ${materials.length} materials must visibly appear in the final image. Do not skip any. Do not merge them. Each color region must produce its own material in the final output.

RULE 2 — PRESERVE OBJECTS ON OR NEAR WALLS (most important!)
The mask is hand-drawn with a brush and will OFTEN cover objects that the user does not intend to replace. Even when a colored region covers them, you MUST keep these objects EXACTLY as in the original photo:
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
   • Toys, books, kitchenware
   • People, pets

For each of these objects: keep them pixel-identical to the original. The new material must "flow around" them, NEVER cover them. Think of it like painting a real wall: you don't paint over the picture that's hanging there — you go around it.

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
The material must:
   • Follow the wall's perspective and curvature correctly
   • Have realistic scale (texture grain matches scene scale)
   • Show natural lighting and shadows from the scene's light sources
   • Interact with adjacent surfaces realistically (slight shadow at edges, etc.)
   • Look like it was physically installed, not pasted on top

RULE 6 — PRESERVE EVERYTHING OUTSIDE THE MASK
Areas where the mask is black must remain pixel-identical to the original photo. Do not change lighting, color, composition, or any object in unmasked areas.

RULE 7 — STRICT FORMAT (already covered at the top — re-emphasizing)
See FORBIDDEN OUTPUTS above. Single image, same dimensions as BASE PHOTO, no collage, no swatches, no labels. Period.

OUTPUT: return ONLY the final photorealistic edited image with the SAME dimensions and aspect ratio as BASE PHOTO. No text. No watermarks. No annotations. No swatches. No borders.`;
}

// ===== /api/generate-masked =====

app.post('/api/generate-masked', async (req, res) => {
  const started = Date.now();
  try {
    const { baseImage, baseWidth, baseHeight, materials, combinedMaskImage } = req.body || {};

    if (!baseImage) return res.status(400).json({ error: 'Missing baseImage' });
    if (!combinedMaskImage) return res.status(400).json({ error: 'Missing combinedMaskImage' });
    if (!Array.isArray(materials) || materials.length === 0) {
      return res.status(400).json({ error: 'At least one material required' });
    }
    if (materials.length > 3) {
      return res.status(400).json({ error: 'Max 3 materials supported' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on server' });
    }

    const base = parseDataUrl(baseImage);
    if (!base) return res.status(400).json({ error: 'Invalid baseImage format' });
    const combinedMask = parseDataUrl(combinedMaskImage);
    if (!combinedMask) return res.status(400).json({ error: 'Invalid combinedMaskImage format' });

    console.log(`[${new Date().toISOString()}] /api/generate-masked materials=${materials.length}`);
    materials.forEach((m, i) => console.log(`  #${i + 1}: ${m.materialName} → ${m.colorName.toUpperCase()}`));

    // Build parts: text + base + N materials + combined mask
    const parts = [];
    parts.push({ text: buildPrompt(materials, baseWidth, baseHeight) });
    parts.push({ inline_data: { mime_type: base.mime, data: base.base64 } });

    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (!m.materialUrl || !m.materialName || !m.colorName) {
        return res.status(400).json({ error: `Material ${i + 1} is incomplete` });
      }
      const matResp = await fetch(m.materialUrl);
      if (!matResp.ok) throw new Error(`Material ${i + 1}: failed to fetch image`);
      const matBuf = Buffer.from(await matResp.arrayBuffer());
      const matMime = mimeFromUrl(m.materialUrl);
      parts.push({ inline_data: { mime_type: matMime, data: matBuf.toString('base64') } });
      console.log(`  material ${i + 1} fetched: ${Math.round(matBuf.length / 1024)}KB`);
    }

    parts.push({ inline_data: { mime_type: combinedMask.mime, data: combinedMask.base64 } });
    console.log(`  combined mask: ${Math.round(combinedMask.base64.length * 0.75 / 1024)}KB`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.3 }
    };

    let apiResp;
    let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`  gemini attempt ${i}/3 (model=${GEMINI_IMAGE_MODEL})...`);
        apiResp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        break;
      } catch (e) {
        lastErr = e;
        console.error(`  gemini attempt ${i} failed: ${e.message}`);
        if (i < 3) await new Promise(r => setTimeout(r, 2000 * i));
      }
    }
    if (!apiResp) throw lastErr || new Error('All attempts failed');

    const data = await apiResp.json();
    if (!apiResp.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini error ${apiResp.status}`;
      console.error('Gemini error:', msg);
      return res.status(502).json({ error: msg });
    }

    const respParts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    if (!respParts || !respParts.length) {
      return res.status(502).json({ error: 'Empty response from Gemini' });
    }
    const imagePart = respParts.find(p => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textPart = respParts.find(p => p.text);
      return res.status(502).json({ error: textPart ? `No image returned: ${textPart.text.slice(0, 200)}` : 'No image returned' });
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

// ============== /api/generate-auto — designer mode (no masks) ==============

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

❌ FORBIDDEN OUTPUTS — never produce any of these:
   • A grid, collage, multi-panel layout (2×2, 3×1, triptych, etc.)
   • Before/after split-screen, side-by-side comparison
   • The BASE PHOTO alongside the edited version
   • Material samples or swatches shown beside / below / above the image
   • Multiple variations stacked or arranged together
   • Duplicated, doubled, or tripled photos
   • Text labels, annotations, color chips, captions, watermarks
   • Letterbox bars, mats, borders, frames
   • Extra canvas, padding, or empty regions

✅ ONLY VALID OUTPUT:
   • One single photorealistic image
   • Output dimensions: ${dimsText}
   • Same aspect ratio as BASE PHOTO (NEVER convert to 1:1, 9:16, 16:9 — preserve input ratio)
   • Same framing, camera angle, field of view as BASE PHOTO
   • A pure in-place edit of the BASE PHOTO

The MATERIAL images are REFERENCE TEXTURES — they describe what to apply on real surfaces. They must NOT appear as separate visual elements in the output.

╔════════════════════════════════════════════════════════════╗

# ROLE

You are a WORLD-CLASS INTERIOR DESIGNER with 25 years of experience. Your portfolio includes celebrity homes in Beverly Hills, luxury hotels in Milan, and historic villas in Tuscany. Your work has been featured in Architectural Digest, Elle Decor, Wallpaper*, and Domus. You combine Italian classical sensibility with contemporary minimalism. You are known for restrained, sophisticated palettes and impeccable proportion.

# INPUT

You will receive ${1 + numMaterials} images:
- IMAGE 1 — BASE PHOTO: the actual real-world scene to redesign (interior room or facade)
${list}

# TASK

Edit the BASE PHOTO in place. Apply the ${numMaterials} material${numMaterials > 1 ? 's' : ''} to suitable surfaces inside the scene with the taste, restraint, and judgment of a top designer.

# CRITICAL CONTENT REQUIREMENTS (DEALBREAKERS)

(Format rules already covered at the top — do not violate them.)

1. **USE ALL ${numMaterials} MATERIALS INSIDE THE SCENE**
   You MUST integrate every provided material (${allMatNames}) into the actual design within the scene. If 3 materials are given, all 3 must visibly appear on real surfaces in the room/facade. NEVER drop a material as a swatch outside the scene. NEVER skip a material. NEVER duplicate one material instead of using all of them.

3. **PRESERVE EVERY OBJECT EXACTLY**
   Furniture, windows, doors, door frames, window frames, sills, paintings, photo frames, hooks, nails, shelves, books, lamps, sconces, plants, vases, decorations, sculptures, mirrors, clocks, vents, radiators, pipes, sockets, switches, thermostats, smoke detectors, hanging clothes, towels, light fixtures, people, pets — all of these stay PIXEL-IDENTICAL to the original. Materials flow AROUND these objects, never over them. Think of it like real renovation: you don't paint over the picture on the wall — you go around it.

4. **NEVER apply material to:**
   windows, glass, doors, door frames, ceilings, floors (unless the texture is clearly a floor material like marble suited for flooring), roof, balconies, railings, furniture, plants, sky, ground, light fixtures, decorations.

# DESIGN DECISIONS (you decide as a professional)

- WHERE each material goes: accent wall behind the focal piece (bed/sofa/TV/dining table/fireplace)? full wall? facade panel? specific architectural element?
- HOW MUCH coverage: entire wall vs. half-wall vs. accent strip
- WHICH combinations work aesthetically
- For ${numMaterials > 1 ? 'multiple materials' : 'this material'}: use the hierarchy principle — one dominant material, the rest as accents. Distribute across DIFFERENT surfaces; don't cluster everything on one wall.

# DESIGN PRINCIPLES (your professional taste)

- Accent walls work best behind the room's focal piece
- Distribute textures across different planes for visual rhythm
- Match the room's existing aesthetic (modern minimalism? Italian classical? Scandinavian? industrial loft?)
- Consider direction of natural light — heavy textures on the lit wall, smoother on the shadow side
- "Restraint is luxury" — never over-decorate
- For facades: emphasize architectural rhythm (columns, bays, plinths) not random patches
- Color story: warm with warm, cool with cool, OR one bold contrast accent

# PHOTOREALISM REQUIREMENTS

- Correct perspective matching wall geometry exactly
- Realistic texture scale (grain matches the room scale)
- Natural lighting and shadows from existing light sources in the scene
- Proper edges and transitions to adjacent surfaces (slight shadow at seams)
- Material must look physically installed, like a real renovation

# OUTPUT

Return ONLY the final photorealistic edited photograph. Same dimensions as BASE PHOTO. No text. No swatches. No borders. No collage. No annotations. No watermarks. Just the edited scene.`;
}

app.post('/api/generate-auto', async (req, res) => {
  const started = Date.now();
  try {
    const { baseImage, baseWidth, baseHeight, materials } = req.body || {};
    if (!baseImage) return res.status(400).json({ error: 'Missing baseImage' });
    if (!Array.isArray(materials) || materials.length === 0) {
      return res.status(400).json({ error: 'At least one material required' });
    }
    if (materials.length > 3) return res.status(400).json({ error: 'Max 3 materials' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

    const base = parseDataUrl(baseImage);
    if (!base) return res.status(400).json({ error: 'Invalid baseImage format' });

    console.log(`[${new Date().toISOString()}] /api/generate-auto materials=${materials.length} (designer mode)`);
    materials.forEach((m, i) => console.log(`  #${i + 1}: ${m.materialName}`));

    const parts = [];
    parts.push({ text: buildDesignerPrompt(materials, baseWidth, baseHeight) });
    parts.push({ inline_data: { mime_type: base.mime, data: base.base64 } });

    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (!m.materialUrl || !m.materialName) {
        return res.status(400).json({ error: `Material ${i + 1} is incomplete` });
      }
      const matResp = await fetch(m.materialUrl);
      if (!matResp.ok) throw new Error(`Material ${i + 1}: failed to fetch image`);
      const matBuf = Buffer.from(await matResp.arrayBuffer());
      const matMime = mimeFromUrl(m.materialUrl);
      parts.push({ inline_data: { mime_type: matMime, data: matBuf.toString('base64') } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4 }
    };

    let apiResp; let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`  gemini attempt ${i}/3 (designer mode)...`);
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
    if (!apiResp.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini error ${apiResp.status}`;
      console.error('Gemini error:', msg);
      return res.status(502).json({ error: msg });
    }

    const respParts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    if (!respParts || !respParts.length) return res.status(502).json({ error: 'Empty response from Gemini' });
    const imagePart = respParts.find(p => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textPart = respParts.find(p => p.text);
      return res.status(502).json({ error: textPart ? `No image returned: ${textPart.text.slice(0, 200)}` : 'No image returned' });
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

// ============== /api/touchup — localized refinement ==============

function buildTouchupPrompt(materialName, baseWidth, baseHeight) {
  const dimsText = baseWidth && baseHeight
    ? `exactly ${baseWidth} × ${baseHeight} pixels (same as CURRENT VERSION)`
    : 'exactly the same width × height as CURRENT VERSION';

  return `╔════════════════════════════════════════════════════════════╗
║  CRITICAL FORMAT RULES (READ FIRST — DEAL-BREAKING)        ║
╚════════════════════════════════════════════════════════════╝

You MUST produce EXACTLY ONE photographic image — a localized edit of CURRENT VERSION.

❌ FORBIDDEN:
   • Any grid, collage, multi-panel layout
   • Before/after side-by-side
   • Material swatches shown anywhere in the output
   • Duplicated, doubled, tripled photos
   • Text, labels, captions, watermarks
   • Borders, mats, frames, letterbox bars, extra canvas

✅ ONLY VALID OUTPUT:
   • Single photorealistic image
   • Output dimensions: ${dimsText}
   • Same aspect ratio as CURRENT VERSION
   • Same framing, camera angle as CURRENT VERSION
   • Everything outside the white-mask region pixel-identical to CURRENT VERSION

╔════════════════════════════════════════════════════════════╗

# ROLE

You are performing a PRECISE LOCALIZED TOUCH-UP on an interior visualization that was already edited. The user is unhappy with one specific area and wants it changed — but everything else must stay EXACTLY as it is.

# INPUT

IMAGE 1 — CURRENT VERSION: the visualization as it currently looks (this is your starting canvas — do not regenerate the whole image)
IMAGE 2 — MATERIAL: texture sample of "${materialName}" (reference only — do NOT include it visually in the output)
IMAGE 3 — TOUCH-UP MASK: black image with one or more WHITE region(s) indicating where to apply MATERIAL

# TASK

Modify ONLY the white-marked region(s) in CURRENT VERSION. Apply MATERIAL there as if it were physically installed. Everywhere else: pixel-perfect copy of CURRENT VERSION.

# ABSOLUTE RULES

1. **ZERO CHANGE OUTSIDE THE MASK.**
   Every pixel where the mask is BLACK must be pixel-identical to CURRENT VERSION. No lighting changes, no color shifts, no object movements, no re-rendering. If you would change anything outside the mask, that is INCORRECT.

2. **SEAMLESS BLEND AT MASK EDGES.**
   Where the new material meets unchanged surroundings: smooth transition. Match existing lighting direction, shadow strength, exposure. No harsh seam visible.

3. **SNAP TO REAL SURFACE BOUNDARIES INSIDE THE MASK.**
   The mask may spill onto windows, doors, frames, or objects (paintings, hooks, plants, lamps) within the marked region. Do NOT cover those — keep them pixel-identical. Apply material only to actual wall/surface pixels inside the marked region. The new material flows AROUND objects, never over them.

4. **CONTEXT-AWARE INSTALLATION.**
   Match CURRENT VERSION's existing perspective, scale, lighting direction, and shadow behavior. The new material must look like it has always been there.

# OUTPUT

Return ONLY the touched-up image. Same dimensions as CURRENT VERSION. No text, no swatches, no labels, no borders.`;
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
    const body = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.25 }
    };

    let apiResp; let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`  touchup attempt ${i}/3...`);
        apiResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        break;
      } catch (e) {
        lastErr = e;
        console.error(`  touchup attempt ${i} failed: ${e.message}`);
        if (i < 3) await new Promise(r => setTimeout(r, 2000 * i));
      }
    }
    if (!apiResp) throw lastErr || new Error('All attempts failed');

    const data = await apiResp.json();
    if (!apiResp.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini error ${apiResp.status}`;
      console.error('Gemini error:', msg);
      return res.status(502).json({ error: msg });
    }
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

app.get('/health', (_req, res) => res.json({ ok: true, app: 'mask-studio', model: GEMINI_IMAGE_MODEL }));

app.listen(PORT, () => {
  console.log(`MASK STUDIO server listening on http://localhost:${PORT}`);
  console.log(`Model: ${GEMINI_IMAGE_MODEL}`);
  if (!GEMINI_API_KEY) console.warn('WARNING: GEMINI_API_KEY is empty — set it in .env');
});
