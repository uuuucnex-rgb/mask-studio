/* ========== MASK STUDIO — frontend ========== */

(function () {
  'use strict';

  // ============== Config ==============

  const SERVER_URL = window.MASK_STUDIO_SERVER || '';
  const MATERIALS = [
    { id: 1, name: 'Aerolite Coffee Grey',        imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Aerolite_COFFEE_grey.jpg' },
    { id: 2, name: 'Roman Pillar Milan Red',      imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Roman_pillar_milan_red.jpg' },
    { id: 3, name: 'Marble Bianco Carara',        imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Marble_Bianco_Carara.png' },
    { id: 4, name: 'Rust Board Bush-hummered',    imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Rust%20Board_BUSH_HUMMERED.jpg' },
    { id: 5, name: 'Ando & Zen Cement Grey',      imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Ando%20%26%20zen%20cement_CEMENT_GREY.jpg' },
    { id: 6, name: 'New Rock Cut Stone Beige',    imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/new_rock_cut%20stone_BEIGE.jpg' }
  ];
  const LAYER_COLORS = ['rgba(91,217,255,0.35)', 'rgba(255,107,181,0.35)', 'rgba(255,211,74,0.35)'];
  const LAYER_LABELS = ['СЛОЙ 01', 'СЛОЙ 02', 'СЛОЙ 03'];

  // ============== State ==============

  const state = {
    mode: 'empty', // 'empty' | 'editor' | 'loading' | 'result'
    baseImage: null,
    layers: [
      { material: null, hasPaint: false },
      { material: null, hasPaint: false },
      { material: null, hasPaint: false }
    ],
    activeLayer: 0,
    brushSize: 35,
    tool: 'brush',
    masks: [null, null, null],
    history: [[], [], []],
    historyIndex: [-1, -1, -1],
    pickerLayerIdx: null,
    touchupMode: false,
    lastResultUrl: null
  };

  // ============== DOM ==============

  const $ = (id) => document.getElementById(id);
  const dom = {
    newPhotoBtn: $('newPhotoBtn'),
    heroLede: $('heroLede'),
    slotsRow: $('slotsRow'),
    stage: $('stage'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    camInput: $('camInput'),
    pickFileBtn: $('pickFileBtn'),
    pickCamBtn: $('pickCamBtn'),
    canvasStack: $('canvasStack'),
    baseCanvas: $('baseCanvas'),
    maskCanvases: [$('maskCanvas1'), $('maskCanvas2'), $('maskCanvas3')],
    loadingOverlay: $('loadingOverlay'),
    progressBar: $('progressBar'),
    loaderStage: $('loaderStage'),
    loaderTipText: $('loaderTipText'),
    resultArea: $('resultArea'),
    resultImage: $('resultImage'),
    toolsRow: $('toolsRow'),
    brushSize: $('brushSize'),
    brushPreview: $('brushPreview'),
    toolBrush: $('toolBrush'),
    toolEraser: $('toolEraser'),
    toolUndo: $('toolUndo'),
    toolClear: $('toolClear'),
    generateBtn: $('generateBtn'),
    designerBtn: $('designerBtn'),
    resultActions: $('resultActions'),
    downloadBtn: $('downloadBtn'),
    touchupBtn: $('touchupBtn'),
    picker: $('materialPicker'),
    pickerEyebrow: $('pickerEyebrow'),
    pickerTitle: $('pickerTitle'),
    pickerGrid: $('pickerGrid'),
    pickerClose: $('pickerClose'),
    errorToast: $('errorToast')
  };

  // ============== Util ==============

  function showError(msg) {
    dom.errorToast.textContent = msg;
    dom.errorToast.hidden = false;
    setTimeout(() => { dom.errorToast.hidden = true; }, 4500);
  }

  function fileToDataUrlAndDims(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > maxDim || h > maxDim) {
            const r = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * r); h = Math.round(h * r);
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), w, h });
        };
        img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsDataURL(file);
    });
  }

  // ============== Mode switching ==============

  function setMode(m) {
    state.mode = m;
    // Stage children
    dom.dropZone.hidden       = (m !== 'empty');
    dom.canvasStack.hidden    = (m !== 'editor');
    dom.loadingOverlay.hidden = (m !== 'loading');
    dom.resultArea.hidden     = (m !== 'result');
    // Tools row visible in editor only
    dom.toolsRow.hidden       = (m === 'loading' || m === 'result');
    dom.resultActions.hidden  = (m !== 'result');
    // Кнопка "Новое фото" видна всегда в шапке
    // Hero lede
    if (m === 'empty') {
      dom.heroLede.textContent = 'Загрузите фото, выберите до 3 материалов и кистью отметьте куда их наложить. Учтём перспективу, свет и реальные границы стен — как опытный дизайнер.';
    } else if (m === 'editor') {
      dom.heroLede.textContent = 'Кликните слот материала → выберите из каталога. Затем кистью отметьте на фото где этот материал должен быть.';
    } else if (m === 'loading') {
      dom.heroLede.textContent = 'Готовим визуализацию: накладываем материалы с учётом реальной геометрии помещения.';
    } else if (m === 'result') {
      dom.heroLede.textContent = 'Готово! Перетащите ползунок чтобы сравнить ДО и ПОСЛЕ.';
    }
    // Tools enabled when editor
    const enabled = (m === 'editor');
    dom.brushSize.disabled = !enabled;
    dom.toolBrush.disabled = !enabled;
    dom.toolEraser.disabled = !enabled;
    dom.toolUndo.disabled = !enabled;
    dom.toolClear.disabled = !enabled;
    if (enabled) updateGenerateBtn(); else { dom.generateBtn.disabled = true; dom.designerBtn.disabled = true; }
    // Slots locking
    renderSlots();
  }

  // ============== Slots ==============

  function renderSlots() {
    dom.slotsRow.innerHTML = '';
    const locked = (state.mode === 'empty');
    state.layers.forEach((layer, idx) => {
      const div = document.createElement('div');
      div.className = 'ms_slot';
      if (locked) div.classList.add('ms_locked');
      if (!locked && idx === state.activeLayer) div.classList.add('ms_active');

      div.addEventListener('click', (e) => {
        if (e.target.closest('.ms_slot_remove')) return;
        if (locked) { showError('Сначала загрузите фото'); return; }
        if (layer.material) {
          setActiveLayer(idx);
        } else {
          openPicker(idx);
        }
      });

      const colorBar = document.createElement('span');
      colorBar.className = 'ms_slot_color';
      colorBar.style.background = LAYER_COLORS[idx];
      div.appendChild(colorBar);

      // Visual: thumb / placeholder / lock
      let visual;
      if (locked) {
        visual = document.createElement('div');
        visual.className = 'ms_slot_visual ms_slot_lock';
        visual.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      } else if (layer.material) {
        visual = document.createElement('img');
        visual.className = 'ms_slot_thumb';
        visual.src = layer.material.imageUrl;
        visual.alt = layer.material.name;
      } else {
        visual = document.createElement('div');
        visual.className = 'ms_slot_visual ms_slot_placeholder';
        visual.textContent = '+';
      }
      div.appendChild(visual);

      const meta = document.createElement('div');
      meta.className = 'ms_slot_meta';
      const nameTxt = locked
        ? 'Заблокировано'
        : (layer.material ? layer.material.name : 'Выбрать материал');
      const statusHtml = locked
        ? '<div class="ms_slot_status ms_off">загрузите фото</div>'
        : (layer.material
            ? `<div class="ms_slot_status ${layer.hasPaint ? '' : 'ms_off'}">${layer.hasPaint ? '● закрашено' : '○ не закрашено'}</div>`
            : '<div class="ms_slot_status ms_off">кликните чтобы выбрать</div>');
      meta.innerHTML =
        `<div class="ms_slot_label">${LAYER_LABELS[idx]}</div>` +
        `<div class="ms_slot_name ${(!layer.material && !locked) ? 'ms_dim' : ''} ${locked ? 'ms_dim' : ''}">${nameTxt}</div>` +
        statusHtml;
      div.appendChild(meta);

      if (!locked && layer.material) {
        const remove = document.createElement('button');
        remove.className = 'ms_slot_remove';
        remove.textContent = '×';
        remove.title = 'Убрать материал';
        remove.addEventListener('click', (e) => {
          e.stopPropagation();
          layer.material = null;
          clearLayer(idx);
          renderSlots();
          updateGenerateBtn();
        });
        div.appendChild(remove);
      }

      dom.slotsRow.appendChild(div);
    });
  }

  function setActiveLayer(idx) {
    state.activeLayer = idx;
    dom.maskCanvases.forEach((c, i) => c.classList.toggle('ms_active', i === idx));
    renderSlots();
    updateGenerateBtn();
    requestAnimationFrame(positionMasks);
  }

  // ============== Material picker (modal) ==============

  function openPicker(layerIdx) {
    state.pickerLayerIdx = layerIdx;
    dom.pickerEyebrow.textContent = LAYER_LABELS[layerIdx];
    dom.pickerTitle.textContent = 'Выберите материал';
    dom.pickerGrid.innerHTML = '';

    MATERIALS.forEach((m) => {
      const assignedLayer = getMaterialAssignedLayer(m.id);
      const isAssigned = assignedLayer >= 0;
      const isAssignedElsewhere = isAssigned && assignedLayer !== layerIdx;

      const card = document.createElement('div');
      card.className = 'ms_picker_card';
      if (isAssignedElsewhere) card.classList.add('ms_disabled');
      if (isAssigned && assignedLayer === layerIdx) card.classList.add('ms_assigned');

      const img = document.createElement('img');
      img.src = m.imageUrl;
      img.alt = m.name;
      img.loading = 'lazy';
      card.appendChild(img);

      const name = document.createElement('div');
      name.className = 'ms_picker_card_name';
      name.textContent = m.name;
      card.appendChild(name);

      if (isAssignedElsewhere) {
        const badge = document.createElement('div');
        badge.className = 'ms_picker_card_badge';
        badge.textContent = `Слой ${assignedLayer + 1}`;
        card.appendChild(badge);
      }

      card.addEventListener('click', () => {
        if (isAssignedElsewhere) {
          showError(`Этот материал уже на слое ${assignedLayer + 1}`);
          return;
        }
        state.layers[layerIdx].material = m;
        setActiveLayer(layerIdx);
        updateGenerateBtn();
        closePicker();
      });
      dom.pickerGrid.appendChild(card);
    });

    dom.picker.hidden = false;
  }
  function closePicker() {
    dom.picker.hidden = true;
    state.pickerLayerIdx = null;
  }
  function getMaterialAssignedLayer(materialId) {
    for (let i = 0; i < state.layers.length; i++) {
      if (state.layers[i].material && state.layers[i].material.id === materialId) return i;
    }
    return -1;
  }

  // ============== Upload ==============

  function setupUpload() {
    dom.pickFileBtn.addEventListener('click', (e) => { e.stopPropagation(); dom.fileInput.click(); });
    dom.pickCamBtn.addEventListener('click', (e) => { e.stopPropagation(); dom.camInput.click(); });
    dom.dropZone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      dom.fileInput.click();
    });
    dom.fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
    });
    dom.camInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
    });
    dom.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dom.dropZone.classList.add('ms_hover'); });
    dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('ms_hover'));
    dom.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.dropZone.classList.remove('ms_hover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    dom.newPhotoBtn.addEventListener('click', resetAll);
  }

  async function handleFile(file) {
    try {
      if (!/^image\//i.test(file.type) && !/\.(heic|heif)$/i.test(file.name || '')) {
        showError('Поддерживаются только изображения'); return;
      }
      const { dataUrl, w, h } = await fileToDataUrlAndDims(file);
      state.baseImage = { dataUrl, w, h };
      cachedBaseImg = null; // invalidate cache for fresh photo
      enterEditor();
    } catch (e) {
      showError(e.message || 'Не удалось загрузить фото');
    }
  }

  // ============== Editor ==============

  function enterEditor() {
    setMode('editor');
    setupCanvas();
    updateBrushPreview();
    setActiveLayer(0);
  }

  // Cache the loaded base image so we don't reload on touchup / setActiveLayer
  let cachedBaseImg = null;

  function setupCanvas() {
    const { w, h, dataUrl } = state.baseImage;
    dom.baseCanvas.width = w;
    dom.baseCanvas.height = h;
    dom.maskCanvases.forEach((c) => { c.width = w; c.height = h; });

    state.masks = dom.maskCanvases;
    state.masks.forEach((c, i) => {
      c.getContext('2d').clearRect(0, 0, w, h);
      state.history[i] = [];
      state.historyIndex[i] = -1;
    });

    if (cachedBaseImg && cachedBaseImg.src === dataUrl && cachedBaseImg.complete && cachedBaseImg.naturalWidth > 0) {
      drawBaseAndPosition();
    } else {
      cachedBaseImg = new Image();
      cachedBaseImg.onload = drawBaseAndPosition;
      cachedBaseImg.onerror = () => showError('Не удалось отобразить фото на холсте');
      cachedBaseImg.src = dataUrl;
    }

    bindCanvasDrawing();
    observeBaseCanvas();
  }

  function drawBaseAndPosition() {
    if (!state.baseImage || !cachedBaseImg) return;
    const { w, h } = state.baseImage;
    const ctx = dom.baseCanvas.getContext('2d');
    ctx.drawImage(cachedBaseImg, 0, 0, w, h);
    requestAnimationFrame(positionMasks);
  }

  // Re-draw base image if it appears the canvas got cleared (defensive)
  function ensureBaseDrawn() {
    if (!state.baseImage || !cachedBaseImg || !cachedBaseImg.complete) return;
    const { w, h } = state.baseImage;
    const ctx = dom.baseCanvas.getContext('2d');
    ctx.drawImage(cachedBaseImg, 0, 0, w, h);
  }

  function positionMasks() {
    const rect = dom.baseCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // skip if not laid out
    dom.maskCanvases.forEach((c) => {
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
    });
  }
  window.addEventListener('resize', () => { if (state.mode === 'editor') positionMasks(); });

  // Auto-reposition masks if base canvas changes size (e.g., layout shifts when slots row grows)
  let baseObserver = null;
  function observeBaseCanvas() {
    if (baseObserver || typeof ResizeObserver === 'undefined') return;
    baseObserver = new ResizeObserver(() => positionMasks());
    baseObserver.observe(dom.baseCanvas);
  }

  let canvasBound = false;
  function bindCanvasDrawing() {
    if (canvasBound) return;
    canvasBound = true;
    let drawing = false;
    let lastX = 0, lastY = 0;

    function pointerToCanvas(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const point = (e.touches && e.touches[0]) || e;
      const x = (point.clientX - rect.left) / rect.width * canvas.width;
      const y = (point.clientY - rect.top) / rect.height * canvas.height;
      return { x, y };
    }
    function getActiveCanvas() { return state.masks[state.activeLayer]; }

    function start(e) {
      if (state.mode !== 'editor') return;
      if (!state.layers[state.activeLayer].material) {
        showError('Сначала выберите материал для этого слоя'); return;
      }
      e.preventDefault();
      const canvas = getActiveCanvas();
      drawing = true;
      const p = pointerToCanvas(canvas, e);
      lastX = p.x; lastY = p.y;
      drawDot(canvas, p.x, p.y);
    }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const canvas = getActiveCanvas();
      const p = pointerToCanvas(canvas, e);
      drawLine(canvas, lastX, lastY, p.x, p.y);
      lastX = p.x; lastY = p.y;
    }
    function end() {
      if (!drawing) return;
      drawing = false;
      saveHistory(state.activeLayer);
      state.layers[state.activeLayer].hasPaint = layerHasContent(state.activeLayer);
      renderSlots();
      updateGenerateBtn();
    }

    dom.maskCanvases.forEach((c) => {
      c.addEventListener('mousedown', start);
      c.addEventListener('touchstart', start, { passive: false });
    });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
  }

  function drawDot(canvas, x, y) {
    const ctx = canvas.getContext('2d');
    const radius = state.brushSize / 2;
    if (state.tool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = LAYER_COLORS[state.activeLayer];
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawLine(canvas, x1, y1, x2, y2) {
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = state.brushSize;
    ctx.lineCap = 'round';
    if (state.tool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = LAYER_COLORS[state.activeLayer];
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  function layerHasContent(idx) {
    const c = state.masks[idx]; if (!c) return false;
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  }

  function saveHistory(idx) {
    const c = state.masks[idx]; if (!c) return;
    const snapshot = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const stack = state.history[idx];
    stack.splice(state.historyIndex[idx] + 1);
    stack.push(snapshot);
    if (stack.length > 20) stack.shift();
    state.historyIndex[idx] = stack.length - 1;
  }
  function undoLayer(idx) {
    const stack = state.history[idx];
    if (state.historyIndex[idx] < 0) return;
    state.historyIndex[idx]--;
    const ctx = state.masks[idx].getContext('2d');
    if (state.historyIndex[idx] < 0) {
      ctx.clearRect(0, 0, state.masks[idx].width, state.masks[idx].height);
    } else {
      ctx.putImageData(stack[state.historyIndex[idx]], 0, 0);
    }
    state.layers[idx].hasPaint = layerHasContent(idx);
    renderSlots(); updateGenerateBtn();
  }
  function clearLayer(idx) {
    const c = state.masks[idx]; if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    saveHistory(idx);
    state.layers[idx].hasPaint = false;
  }

  // ============== Toolbar ==============

  function setupToolbar() {
    dom.brushSize.addEventListener('input', (e) => {
      state.brushSize = parseInt(e.target.value, 10);
      updateBrushPreview();
    });
    dom.toolBrush.addEventListener('click', () => setTool('brush'));
    dom.toolEraser.addEventListener('click', () => setTool('eraser'));
    dom.toolUndo.addEventListener('click', () => undoLayer(state.activeLayer));
    dom.toolClear.addEventListener('click', () => {
      if (state.layers[state.activeLayer].hasPaint && confirm('Очистить текущий слой?')) {
        clearLayer(state.activeLayer);
        renderSlots();
        updateGenerateBtn();
      }
    });
    dom.pickerClose.addEventListener('click', closePicker);
    dom.picker.addEventListener('click', (e) => { if (e.target === dom.picker) closePicker(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
  }
  function setTool(t) {
    state.tool = t;
    dom.toolBrush.setAttribute('data-active', t === 'brush');
    dom.toolEraser.setAttribute('data-active', t === 'eraser');
  }
  function updateBrushPreview() {
    const size = Math.max(6, Math.min(28, state.brushSize / 3));
    dom.brushPreview.style.width = size + 'px';
    dom.brushPreview.style.height = size + 'px';
  }
  function updateGenerateBtn() {
    if (state.mode !== 'editor') {
      dom.generateBtn.disabled = true;
      dom.designerBtn.disabled = true;
      return;
    }
    // Main: needs at least one material with painted mask
    dom.generateBtn.disabled = !state.layers.some((l) => l.material && l.hasPaint);
    // Designer: needs at least one material (no paint required)
    dom.designerBtn.disabled = !state.layers.some((l) => l.material);
  }

  // ============== Generation ==============

  const TIPS = [
    'Сервис анализирует геометрию помещения и понимает где реально есть стены',
    'Маски — это подсказки, не точные границы. Сервис сам обрежет по контурам',
    'Тёплые тона визуально расширяют пространство, холодные — успокаивают',
    'Мрамор Bianco Carrara использовали ещё в Древнем Риме',
    'Гибкий камень в 5 раз тоньше плитки и в 3 раза легче',
    'Бежевый + тёплый дуб — классическая итальянская гамма',
    'Тёплый красный кирпич идеален для индустриального лофта',
    'Один материал при разном свете воспринимается на 30–40% иначе',
    'Цифровая визуализация ускоряет принятие решения в 10 раз',
    'Получается отлично — материал уже ложится на стены...',
    'Финализируем тени и свет для реалистичной картины',
    'Контрастные материалы создают акценты — не более трёх на зону',
    'Для маленькой комнаты выбирайте материал светлее пола — добавит высоты'
  ];
  const STAGES = ['Анализ фото', 'Распознавание границ', 'Применение материалов', 'Финальная обработка'];

  // Backend mask colors (must match server.js prompt)
  const MASK_COLORS_RGB = [
    [255, 0, 0],   // material 1 → RED
    [0, 255, 0],   // material 2 → GREEN
    [0, 0, 255]    // material 3 → BLUE
  ];
  const MASK_COLOR_NAMES = ['red', 'green', 'blue'];

  // Build ONE combined color-coded mask: red/green/blue regions for each material
  function buildCombinedMask(activeSpecs) {
    const w = state.baseImage.w;
    const h = state.baseImage.h;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const outImg = ctx.getImageData(0, 0, w, h);
    const outData = outImg.data;

    activeSpecs.forEach((spec) => {
      const srcCanvas = state.masks[spec.layerIdx];
      const srcData = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
      const [r, g, b] = MASK_COLORS_RGB[spec.materialOrder];
      for (let i = 0; i < srcData.length; i += 4) {
        if (srcData[i + 3] > 16) {
          outData[i]     = r;
          outData[i + 1] = g;
          outData[i + 2] = b;
          outData[i + 3] = 255;
        }
      }
    });

    ctx.putImageData(outImg, 0, 0);
    return out.toDataURL('image/png');
  }

  function startGeneration() {
    const active = state.layers
      .map((l, i) => ({ layer: l, idx: i }))
      .filter((x) => x.layer.material && x.layer.hasPaint);
    if (active.length === 0) {
      showError('Нужен хотя бы один материал с закрашенной областью'); return;
    }
    if (state.touchupMode) {
      startTouchup(active[0]);
      return;
    }
    setMode('loading');
    animateLoader();

    // Each active layer gets a sequential color index: 0=red, 1=green, 2=blue
    const specs = active.map((x, n) => ({
      layerIdx: x.idx,
      materialOrder: n,
      colorName: MASK_COLOR_NAMES[n],
      materialUrl: x.layer.material.imageUrl,
      materialName: x.layer.material.name
    }));

    const combinedMaskImage = buildCombinedMask(specs);

    const payload = {
      baseImage: state.baseImage.dataUrl,
      baseWidth: state.baseImage.w,
      baseHeight: state.baseImage.h,
      combinedMaskImage,
      materials: specs.map((s) => ({
        materialUrl: s.materialUrl,
        materialName: s.materialName,
        colorName: s.colorName
      }))
    };

    state.lastResultUrl = null; // will be set after success

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    fetch((SERVER_URL || '') + '/api/generate-masked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then((r) => {
        clearTimeout(timeoutId);
        stopLoaderAnimation();
        if (!r.ok || !r.data || r.data.error || !r.data.resultDataUrl) {
          showError((r.data && r.data.error) ? r.data.error : 'Ошибка сервера');
          setMode('editor');
          requestAnimationFrame(positionMasks);
          return;
        }
        showResult(r.data.resultDataUrl);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        stopLoaderAnimation();
        showError((err && err.message) ? err.message : 'Сеть недоступна');
        setMode('editor');
        requestAnimationFrame(positionMasks);
      });
  }

  let loaderTimers = [];
  let loaderTipInterval = null;
  function animateLoader() {
    dom.progressBar.style.width = '0%';
    const steps = [
      { at: 0,     pct: 8,  text: STAGES[0] },
      { at: 4000,  pct: 30, text: STAGES[1] },
      { at: 10000, pct: 60, text: STAGES[2] },
      { at: 25000, pct: 85, text: STAGES[3] }
    ];
    stopLoaderAnimation();
    steps.forEach((s) => {
      loaderTimers.push(setTimeout(() => {
        dom.progressBar.style.width = s.pct + '%';
        dom.loaderStage.textContent = s.text;
      }, s.at));
    });
    let tIdx = Math.floor(Math.random() * TIPS.length);
    dom.loaderTipText.textContent = TIPS[tIdx];
    loaderTipInterval = setInterval(() => {
      dom.loaderTipText.style.opacity = '0';
      setTimeout(() => {
        tIdx = (tIdx + 1) % TIPS.length;
        dom.loaderTipText.textContent = TIPS[tIdx];
        dom.loaderTipText.style.opacity = '1';
      }, 300);
    }, 6000);
  }
  function stopLoaderAnimation() {
    loaderTimers.forEach(clearTimeout); loaderTimers = [];
    if (loaderTipInterval) { clearInterval(loaderTipInterval); loaderTipInterval = null; }
  }

  // ============== Touchup mode (localized refinement) ==============

  function startTouchup(activeSpec) {
    if (!activeSpec) { showError('Выберите материал и закрасьте зону правки'); return; }
    setMode('loading');
    animateLoader();

    // Build a simple binary white-on-black mask from the active layer canvas
    const srcCanvas = state.masks[activeSpec.idx];
    const w = state.baseImage.w;
    const h = state.baseImage.h;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    const outImg = ctx.getImageData(0, 0, w, h);
    const outData = outImg.data;
    for (let i = 0; i < src.length; i += 4) {
      if (src[i + 3] > 16) {
        outData[i] = 255; outData[i + 1] = 255; outData[i + 2] = 255; outData[i + 3] = 255;
      }
    }
    ctx.putImageData(outImg, 0, 0);
    const maskDataUrl = out.toDataURL('image/png');

    const payload = {
      baseImage: state.baseImage.dataUrl,
      baseWidth: w, baseHeight: h,
      materialUrl: activeSpec.layer.material.imageUrl,
      materialName: activeSpec.layer.material.name,
      maskImage: maskDataUrl
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    fetch((SERVER_URL || '') + '/api/touchup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then((r) => {
        clearTimeout(timeoutId);
        stopLoaderAnimation();
        if (!r.ok || !r.data || r.data.error || !r.data.resultDataUrl) {
          showError((r.data && r.data.error) ? r.data.error : 'Ошибка сервера');
          setMode('editor'); requestAnimationFrame(positionMasks); return;
        }
        // After touchup: reset touchup mode, show new result
        state.touchupMode = false;
        const span = dom.generateBtn.querySelector('span');
        if (span) span.textContent = '✦ Сгенерировать';
        showResult(r.data.resultDataUrl);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        stopLoaderAnimation();
        showError((err && err.message) ? err.message : 'Сеть недоступна');
        setMode('editor'); requestAnimationFrame(positionMasks);
      });
  }

  // ============== Designer mode (no masks) ==============

  function startDesignerGeneration() {
    const activeMaterials = state.layers
      .filter((l) => l.material)
      .map((l) => ({ materialUrl: l.material.imageUrl, materialName: l.material.name }));
    if (activeMaterials.length === 0) {
      showError('Выберите хотя бы один материал в слотах'); return;
    }

    setMode('loading');
    animateLoader();

    const payload = {
      baseImage: state.baseImage.dataUrl,
      baseWidth: state.baseImage.w,
      baseHeight: state.baseImage.h,
      materials: activeMaterials
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    fetch((SERVER_URL || '') + '/api/generate-auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then((r) => {
        clearTimeout(timeoutId);
        stopLoaderAnimation();
        if (!r.ok || !r.data || r.data.error || !r.data.resultDataUrl) {
          showError((r.data && r.data.error) ? r.data.error : 'Ошибка сервера');
          setMode('editor'); requestAnimationFrame(positionMasks); return;
        }
        showResult(r.data.resultDataUrl);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        stopLoaderAnimation();
        showError((err && err.message) ? err.message : 'Сеть недоступна');
        setMode('editor'); requestAnimationFrame(positionMasks);
      });
  }

  // ============== Result ==============

  function showResult(resultUrl) {
    state.lastResultUrl = resultUrl;
    dom.resultImage.src = resultUrl;
    setMode('result');
  }

  // ============== Touchup mode ==============

  function enterTouchupMode() {
    if (!state.lastResultUrl) {
      showError('Нет результата для правки'); return;
    }
    // Load result image as new base
    const img = new Image();
    img.onload = () => {
      state.baseImage = { dataUrl: state.lastResultUrl, w: img.naturalWidth, h: img.naturalHeight };
      cachedBaseImg = img; // reuse this already-loaded image in setupCanvas (no reload flicker)
      // Clear all slots and masks
      state.layers.forEach((l) => { l.material = null; l.hasPaint = false; });
      state.history = [[], [], []]; state.historyIndex = [-1, -1, -1];
      state.activeLayer = 0;
      state.touchupMode = true;
      setMode('editor');
      setupCanvas();
      updateBrushPreview();
      setActiveLayer(0);
      // Visual cue: change generate button text
      const span = dom.generateBtn.querySelector('span');
      if (span) span.textContent = '✦ Применить правку';
    };
    img.onerror = () => showError('Не удалось загрузить результат для правки');
    img.src = state.lastResultUrl;
  }
  dom.touchupBtn.addEventListener('click', enterTouchupMode);
  dom.downloadBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = dom.resultImage.src;
    a.download = 'design-studio-result.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  // ============== Reset ==============

  function resetAll() {
    state.baseImage = null;
    state.layers.forEach((l) => { l.material = null; l.hasPaint = false; });
    state.activeLayer = 0;
    state.history = [[], [], []]; state.historyIndex = [-1, -1, -1];
    state.touchupMode = false;
    state.lastResultUrl = null;
    cachedBaseImg = null;
    if (state.masks[0]) {
      state.masks.forEach((c) => c.getContext('2d').clearRect(0, 0, c.width, c.height));
    }
    const span = dom.generateBtn.querySelector('span');
    if (span) span.textContent = '✦ Сгенерировать';
    setMode('empty');
  }

  // ============== Init ==============

  function init() {
    setupUpload();
    setupToolbar();
    dom.generateBtn.addEventListener('click', startGeneration);
    dom.designerBtn.addEventListener('click', startDesignerGeneration);
    setMode('empty');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
