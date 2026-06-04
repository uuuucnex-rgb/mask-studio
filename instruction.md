# MASK STUDIO — спецификация

## Что делаем

Веб-приложение (один экран) для визуализации отделочных материалов на фото.
Пользователь загружает фото помещения/фасада, выбирает до **3 материалов** и для каждого
**рисует кистью** где этот материал должен быть применён. AI (Gemini 3 Pro Image / NanoBanana 2)
генерирует фотореалистичный результат с учётом масок и реальной геометрии помещения.

Главное отличие от обычного плагина: **точечное нанесение материала** — пользователь сам
указывает где какой материал должен лежать, а ИИ "обрезает" по реальным контурам стен.

---

## Стек

- **Frontend**: чистый HTML + Canvas + Vanilla JS
- **Backend**: Node.js + Express (тот же подход что в Castelia)
- **AI**: Gemini 3 Pro Image (NanoBanana 2) через Google Generative Language API
- **Деплой**: отдельный Railway-сервис (см. README.md)

---

## Архитектура

```
/MASK_STUDIO
  /public
    index.html       — единственный экран
    app.js           — вся логика фронта
    style.css        — дизайн (продолжаем светлую тему Castelia)
  server.js          — прокси к Gemini
  package.json
  .env               — GEMINI_API_KEY (создать вручную)
  .env.example
  instruction.md     — этот файл
  README.md          — запуск
```

Express отдаёт `public/` как статику + обрабатывает `POST /api/generate-masked`.

---

## Каталог материалов (стартовый — 3 штуки из Castelia)

```javascript
const MATERIALS = [
  { id: 1, name: 'Aerolite Coffee Grey',  imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Aerolite_COFFEE_grey.jpg' },
  { id: 2, name: 'Roman Pillar Milan Red', imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Roman_pillar_milan_red.jpg' },
  { id: 3, name: 'Marble Bianco Carara',   imageUrl: 'https://raw.githubusercontent.com/uuuucnex-rgb/casteliaCATALOG/refs/heads/main/Marble_Bianco_Carara.png' }
];
```

В будущем — подгружать из CMS / админки.

---

## UX-флоу

### Состояние "пусто"
- Заголовок "MASK STUDIO"
- Drop-зона на весь экран: "Загрузите фото помещения или фасада"

### После загрузки фото
- Слева: canvas с фото (фит по размеру экрана)
- Справа: панель материалов

### Панель материалов
- **3 слота** для материалов (Слой 1, Слой 2, Слой 3)
- Каждый слот изначально пустой → "+ Выбрать материал"
- При клике на слот: выпадает мини-каталог из 3 материалов
- После выбора материала слот показывает миниатюру + название + кнопку "удалить"

### Инструменты рисования
- **Активный слой подсвечивается** (золотая рамка)
- Кисть рисует полупрозрачным цветом выбранного слоя поверх фото:
  - Слой 1: голубой #5bd9ff с прозрачностью 0.4
  - Слой 2: розовый #ff6bb5 с прозрачностью 0.4
  - Слой 3: жёлтый #ffd34a с прозрачностью 0.4
- Контролы кисти: размер (10–80px), ластик, очистить слой
- Undo / Redo (стек до 20 шагов)

### Кнопка "Сгенерировать"
- Активна когда есть фото + хотя бы 1 слой с материалом и маской
- При клике: показывается экран загрузки (как в Castelia: орб + прогресс + факты)
- Backend крутит Gemini

### Результат
- Слайдер сравнения ДО / ПОСЛЕ (тащишь ползунок мышкой/пальцем)
- Кнопка "Скачать PNG"
- Кнопка "Попробовать другие материалы" → возврат в редактор с тем же фото и сброшенными масками
- Кнопка "Новое фото" → полный сброс

---

## API контракт

### `POST /api/generate-masked`

**Запрос:**
```json
{
  "baseImage": "data:image/jpeg;base64,...",
  "baseWidth": 1024,
  "baseHeight": 768,
  "layers": [
    { "materialUrl": "https://...", "materialName": "Aerolite Coffee Grey", "maskImage": "data:image/png;base64,..." },
    { "materialUrl": "https://...", "materialName": "Marble Bianco Carara",  "maskImage": "data:image/png;base64,..." }
  ]
}
```

Маска — это **чёрно-белый PNG** того же размера что и `baseImage`:
- БЕЛЫЕ пиксели = "сюда наложить материал"
- ЧЁРНЫЕ пиксели = "оставить как есть"

**Ответ:**
```json
{
  "resultDataUrl": "data:image/png;base64,...",
  "generationTime": 28450
}
```

При ошибке: `{ "error": "..." }`

---

## Промпт для Gemini

Шлём в одном запросе: `BASE + N × (MATERIAL + MASK) + текст`.

Тег порядка картинок задаётся текстом — Gemini различает по позиции.

```
You will receive a sequence of images:

IMAGE 1 (BASE): a photo of an interior room or building facade — the scene to edit.

Then pairs of (MATERIAL, MASK) for each finishing material to apply:
- IMAGE 2: MATERIAL #1 — texture sample of "[NAME_1]"
- IMAGE 3: MASK #1 — black/white mask for material #1
- IMAGE 4: MATERIAL #2 — texture sample of "[NAME_2]"
- IMAGE 5: MASK #2 — black/white mask for material #2
- ... (and so on for each material)

TASK:
Create a single photorealistic architectural visualization of the BASE image
with each material applied to the areas indicated by its mask.

MASK INTERPRETATION:
- WHITE pixels in a mask = the user wants this material applied here
- BLACK pixels in a mask = leave untouched
- Masks are user-drawn approximations with a brush — they may be sloppy
  and spill onto windows, doors, frames, floors, ceilings, furniture, etc.

CRITICAL RULES (in order of priority):
1. SNAP material application to actual surface boundaries detected in the BASE image.
   Even if the mask spills over a window or door frame, the material must NOT cover those.
2. Apply each material ONLY to flat surfaces that make architectural sense
   (walls, facades, panels). Do NOT cover windows, doors, ceilings, floors,
   furniture, plants, people, sky, ground, lighting fixtures, decorations.
3. If two masks overlap, give priority to the LATER mask (later in the sequence).
4. Material must follow surface geometry with correct perspective.
5. Realistic lighting and shadows — the material should look physically installed.
6. Preserve EVERYTHING outside any masked area — exact lighting, composition,
   colors, geometry, all objects untouched.
7. Keep the same aspect ratio and dimensions as the BASE image.

OUTPUT: return only the final edited image. No text. No watermarks.
```

`[NAME_N]` подставляется на каждый материал.

---

## Технические детали реализации

### Frontend / Canvas

- **Главный canvas** показывает фото (масштабируется под экран, но внутреннее разрешение
  фиксированное — макс 1280px по большей стороне для качества).
- **3 overlay-canvas'a** — по одному на каждый слой материала. На них рисует пользователь.
  Все слои — поверх главного canvas с position:absolute.
- При клике/тапе с зажатой кнопкой кисть рисует круг alpha-цветом на active layer canvas.
- При генерации каждый overlay конвертируется в **бинарную чёрно-белую маску**
  через `getImageData → setImageData` (alpha > 0 → белый, иначе чёрный) и отправляется на сервер.

### Backend / Gemini

- Принимает JSON с base + слоями
- Скачивает каждое material image из URL → base64
- Декодирует mask из base64
- Собирает `contents[0].parts` массив: `text, base, mat1, mask1, mat2, mask2, ...`
- POST на `gemini-3-pro-image:generateContent`
- Извлекает результат → возвращает dataURL

### Деплой на Railway

- Новый сервис: **mask-studio-server**
- GitHub репо: **mask-studio** (создать)
- Переменные:
  - `GEMINI_API_KEY` =
  - `GEMINI_IMAGE_MODEL` = gemini-3-pro-image
  - `PORT` = 3002 (Railway сам подставит свой)

Адрес после деплоя — это и есть готовое веб-приложение, можно дать клиенту прямую ссылку.

---

## Чего сейчас НЕТ (заделы на будущее)

1. **Чат-консультант** — пока нет, можно добавить как в Castelia
2. **Свой каталог материалов** — пока хардкод 3 штуки, потом админка
3. **SAM (Segment Anything)** — умное выделение клик-по-стене без рисования
4. **Сохранение проектов** — пока всё в памяти
5. **Множество фото в одном проекте**
6. **Лидогенерация** — оставить контакт после результата

---

## Запуск (локально)

```bash
cd MASK_STUDIO
npm install
node server.js
# открой http://localhost:3002
```

`.env`:
```
GEMINI_API_KEY=твой_ключ
GEMINI_IMAGE_MODEL=gemini-3-pro-image
PORT=3002
```
