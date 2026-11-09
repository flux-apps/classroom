// canvas/canvas-core.js — Core domain logic for infinite-canvas lesson board
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CanvasCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Spanish first, English second, always both (D10). Static chrome lives in index.html;
  // these are the strings the controller composes at runtime.
  const BILINGUAL = {
    title: { es: 'Pizarra de lección', en: 'Lesson board' },
    tools: {
      select: { es: 'elegir', en: 'select' },
      pen: { es: 'lápiz', en: 'pen' },
      eraser: { es: 'goma', en: 'eraser' },
      text: { es: 'texto', en: 'text' }
    },
    overlayBanner: {
      text: {
        es: 'Este tablero pinta con el lápiz de la app, no con Overlay. Overlay puede estar ON: no hace falta apagarlo para dar clase. Usa el lápiz de la app y +/−. El pellizco puede no funcionar.',
        en: 'This board draws with the in-app pen, not Overlay. Overlay may be on: you do not need to turn it off to teach. Use the in-app pen and +/−. Pinch may fail.'
      },
      dismiss: { es: 'Entendido', en: 'Got it' }
    },
    overlayChip: {
      unknown: { es: 'Overlay ?', en: 'Overlay ?' },
      on: { es: 'Overlay ON', en: 'Overlay ON' },
      off: { es: 'Overlay OFF', en: 'Overlay OFF' }
    },
    penTouch: {
      provisional: { es: 'pen/touch: provisional', en: 'pen/touch: provisional' },
      fromProbe: { es: 'pen/touch: del probe', en: 'pen/touch: from probe' },
      toolbarOnly: { es: 'pen/touch: solo barra', en: 'pen/touch: toolbar-only' }
    },
    probe: {
      notGx: { es: 'Este JSON no es del GX', en: 'This JSON is not from the GX' },
      incomplete: {
        es: 'JSON incompleto: WDK oculto, pen/touch provisional',
        en: 'Incomplete JSON: WDK hidden, pen/touch provisional'
      },
      completeNoSb: {
        es: 'Evidencia completa del GX. WDK sigue oculto: window.SB no está presente.',
        en: 'Complete GX evidence. WDK stays hidden: window.SB is not present.'
      },
      unlocked: {
        es: 'Evidencia completa del GX con window.SB. Control WDK disponible.',
        en: 'Complete GX evidence with window.SB. WDK control available.'
      },
      invalid: { es: 'Archivo JSON no válido', en: 'Invalid JSON file' }
    },
    status: {
      unsaved: { es: 'sin guardar', en: 'unsaved' },
      saved: { es: 'guardada', en: 'saved' }
    },
    webCardHelper: {
      es: 'Para el libro usa un PDF',
      en: 'For the book, use a PDF'
    }
  };

  const STROKE_WIDTH = 4;
  const SCALE_MIN = 0.02;
  const SCALE_MAX = 20.0;
  // Zoom-button stops (fractions). Typed/wheel/pinch zoom is continuous within SCALE_MIN..SCALE_MAX.
  const ZOOM_STOPS = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 10, 15, 20];

  // Miro-style fractal grid: square cells at several nested pitches (each GRID_FACTOR times the
  // previous). Pitches slide with zoom; a level fades in as its cells grow past GRID_MIN_PITCH px
  // and the next-coarser levels get stronger, so one cycle of zoom replaces fine squares with
  // the 5x-coarser ones seamlessly. Returns [{ pitch (screen px), alpha 0..1 }], fine to coarse.
  const GRID_BASE = 24;
  const GRID_FACTOR = 5;
  const GRID_MIN_PITCH = 16;
  const GRID_LEVELS = 4;
  const GRID_STRENGTH = [0, 0.45, 0.7, 1, 0]; // strength at u = 0..GRID_LEVELS (u = log_factor(pitch / min))
  function gridLevels(scale) {
    const L = Math.log(GRID_MIN_PITCH / (GRID_BASE * scale)) / Math.log(GRID_FACTOR);
    const k0 = Math.ceil(L);
    const f = k0 - L; // 0 <= f < 1
    const levels = [];
    for (let i = 0; i < GRID_LEVELS; i++) {
      const u = f + i;
      const lo = Math.floor(u);
      const alpha = GRID_STRENGTH[lo] + (GRID_STRENGTH[lo + 1] - GRID_STRENGTH[lo]) * (u - lo);
      levels.push({ pitch: GRID_BASE * Math.pow(GRID_FACTOR, k0 + i) * scale, alpha });
    }
    return levels;
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  // --- Binary <-> base64 (lesson files embed PDF bytes) ---
  function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // --- Object <-> world geometry. An object sits at (x, y), is scaled by `scale`,
  // then rotated by `rotation` degrees about its top-left corner (CSS transform-origin 0 0).
  function objectToWorld(obj, lx, ly) {
    const s = obj.scale || 1;
    const r = ((obj.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const sx = lx * s;
    const sy = ly * s;
    return { x: obj.x + sx * cos - sy * sin, y: obj.y + sx * sin + sy * cos };
  }

  function worldToObject(obj, wx, wy) {
    const s = obj.scale || 1;
    const r = ((obj.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const dx = wx - obj.x;
    const dy = wy - obj.y;
    return { x: (dx * cos + dy * sin) / s, y: (-dx * sin + dy * cos) / s };
  }

  function pointInObject(obj, size, wx, wy) {
    const p = worldToObject(obj, wx, wy);
    return p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
  }

  // Distance from point p to segment a-b (any 2D space).
  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function strokeNearPoint(points, p, radius) {
    if (points.length === 1) return Math.hypot(points[0].x - p.x, points[0].y - p.y) <= radius;
    for (let i = 1; i < points.length; i++) {
      if (distToSegment(p, points[i - 1], points[i]) <= radius) return true;
    }
    return false;
  }

  class SceneGraph {
    constructor() {
      this.viewport = {
        scale: 1,
        panX: 0,
        panY: 0
      };
      this.objects = new Map();
      this.strokes = [];
      this.undoStack = [];
      this.redoStack = [];
      this.selectedObjectId = null;
    }

    screenToWorld(screenX, screenY) {
      return {
        x: (screenX - this.viewport.panX) / this.viewport.scale,
        y: (screenY - this.viewport.panY) / this.viewport.scale
      };
    }

    worldToScreen(worldX, worldY) {
      return {
        x: worldX * this.viewport.scale + this.viewport.panX,
        y: worldY * this.viewport.scale + this.viewport.panY
      };
    }

    pan(dx, dy) {
      this.viewport.panX += dx;
      this.viewport.panY += dy;
    }

    zoom(newScale, centerScreenX = 0, centerScreenY = 0) {
      const clampedScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(newScale.toPrecision(4))));
      if (clampedScale === this.viewport.scale) return;

      const worldBefore = this.screenToWorld(centerScreenX, centerScreenY);
      this.viewport.scale = clampedScale;
      const worldAfter = this.screenToWorld(centerScreenX, centerScreenY);

      this.viewport.panX += (worldAfter.x - worldBefore.x) * clampedScale;
      this.viewport.panY += (worldAfter.y - worldBefore.y) * clampedScale;
    }

    zoomIn(centerScreenX = 0, centerScreenY = 0) {
      const cur = this.viewport.scale;
      const next = ZOOM_STOPS.find(s => s > cur * 1.0001) ?? SCALE_MAX;
      this.zoom(next, centerScreenX, centerScreenY);
    }

    zoomOut(centerScreenX = 0, centerScreenY = 0) {
      const cur = this.viewport.scale;
      const prev = [...ZOOM_STOPS].reverse().find(s => s < cur / 1.0001) ?? SCALE_MIN;
      this.zoom(prev, centerScreenX, centerScreenY);
    }

    fit() {
      this.viewport.scale = 1.0;
      this.viewport.panX = 0;
      this.viewport.panY = 0;
    }

    // Fit a world-space rectangle {minX, minY, maxX, maxY} inside a view of viewW x viewH.
    fitTo(bounds, viewW, viewH, padding = 64) {
      const w = Math.max(1, bounds.maxX - bounds.minX);
      const h = Math.max(1, bounds.maxY - bounds.minY);
      const raw = Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h);
      const scale = Math.min(1, Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw)));
      this.viewport.scale = scale;
      this.viewport.panX = (viewW - w * scale) / 2 - bounds.minX * scale;
      this.viewport.panY = (viewH - h * scale) / 2 - bounds.minY * scale;
    }

    addObject(obj) {
      const id = obj.id || uid('obj');
      const newObj = { rotation: 0, scale: 1, ...obj, id };
      this.objects.set(id, newObj);
      this.saveUndo({ type: 'add_object', object: newObj });
      return newObj;
    }

    strokesOfObject(id) {
      return this.strokes.filter(s => s.objectId === id);
    }

    removeObject(id) {
      const obj = this.objects.get(id);
      if (!obj) return false;
      const strokes = this.strokesOfObject(id);
      this._dropObject(id, strokes);
      this.saveUndo({ type: 'remove_object', object: obj, strokes });
      return true;
    }

    _dropObject(id, strokes) {
      this.objects.delete(id);
      if (strokes && strokes.length) {
        const ids = new Set(strokes.map(s => s.id));
        this.strokes = this.strokes.filter(s => !ids.has(s.id));
      }
      if (this.selectedObjectId === id) this.selectedObjectId = null;
    }

    // Record a move/scale/rotate that the caller already applied live. `before` is the
    // snapshot of the changed keys taken at gesture start.
    commitObjectChange(id, before) {
      const obj = this.objects.get(id);
      if (!obj) return false;
      const after = {};
      let changed = false;
      for (const key of Object.keys(before)) {
        after[key] = obj[key];
        if (after[key] !== before[key]) changed = true;
      }
      if (!changed) return false;
      this.saveUndo({ type: 'update_object', id, before: { ...before }, after });
      return true;
    }

    addStroke(stroke) {
      const id = stroke.id || uid('strk');
      const newStroke = {
        id,
        color: stroke.color || null, // null = default ink token, resolved by the renderer
        width: stroke.width || STROKE_WIDTH,
        points: stroke.points || [] // { x, y } in world coords, or object-local coords when objectId is set
      };
      if (stroke.objectId) newStroke.objectId = stroke.objectId;
      this.strokes.push(newStroke);
      this.saveUndo({ type: 'add_stroke', stroke: newStroke });
      return newStroke;
    }

    removeStrokes(ids) {
      const set = new Set(ids);
      const removed = [];
      this.strokes.forEach((stroke, index) => {
        if (set.has(stroke.id)) removed.push({ stroke, index });
      });
      if (!removed.length) return 0;
      this.strokes = this.strokes.filter(s => !set.has(s.id));
      this.saveUndo({ type: 'remove_strokes', removed });
      return removed.length;
    }

    clearInk() {
      if (!this.strokes.length) return 0;
      const removed = this.strokes.map((stroke, index) => ({ stroke, index }));
      this.strokes = [];
      this.saveUndo({ type: 'remove_strokes', removed });
      return removed.length;
    }

    saveUndo(action) {
      this.undoStack.push(action);
      this.redoStack = []; // clear redo on new action
    }

    _apply(action, reverse) {
      switch (action.type) {
        case 'add_stroke':
          if (reverse) this.strokes = this.strokes.filter(s => s.id !== action.stroke.id);
          else this.strokes.push(action.stroke);
          break;
        case 'add_object':
          if (reverse) this._dropObject(action.object.id, this.strokesOfObject(action.object.id));
          else this.objects.set(action.object.id, action.object);
          break;
        case 'remove_object':
          if (reverse) {
            this.objects.set(action.object.id, action.object);
            this.strokes.push(...action.strokes);
          } else {
            this._dropObject(action.object.id, action.strokes);
          }
          break;
        case 'remove_strokes':
          if (reverse) {
            const restored = [...action.removed].sort((a, b) => a.index - b.index);
            for (const { stroke, index } of restored) this.strokes.splice(index, 0, stroke);
          } else {
            const ids = new Set(action.removed.map(r => r.stroke.id));
            this.strokes = this.strokes.filter(s => !ids.has(s.id));
          }
          break;
        case 'update_object': {
          const obj = this.objects.get(action.id);
          if (obj) Object.assign(obj, reverse ? action.before : action.after);
          break;
        }
        default:
          break;
      }
    }

    undo() {
      if (this.undoStack.length === 0) return false;
      const action = this.undoStack.pop();
      this._apply(action, true);
      this.redoStack.push(action);
      return true;
    }

    redo() {
      if (this.redoStack.length === 0) return false;
      const action = this.redoStack.pop();
      this._apply(action, false);
      this.undoStack.push(action);
      return true;
    }

    clearBoard() {
      this.strokes = [];
      this.objects.clear();
      this.undoStack = [];
      this.redoStack = [];
      this.selectedObjectId = null;
      this.fit();
    }
  }

  // --- PDF Book Document Model ---
  class PdfDocument {
    constructor(title = 'Agencia ELE — Unidad 5', pageCount = 6) {
      this.id = uid('pdf');
      this.title = title;
      this.pageCount = pageCount;
      this.currentPage = 1;
      this.bytes = null; // Uint8Array of the dropped file; null for a model without a file
      this.pageStrokes = {}; // { [pageNumber]: Stroke[] } in page space (PDF units at zoom 1)
      this.history = {}; // { [pageNumber]: { undo: [], redo: [] } } — session only
      for (let i = 1; i <= pageCount; i++) {
        this.pageStrokes[i] = [];
      }
    }

    _hist(pageNumber) {
      if (!this.history[pageNumber]) this.history[pageNumber] = { undo: [], redo: [] };
      return this.history[pageNumber];
    }

    _record(pageNumber, action) {
      const h = this._hist(pageNumber);
      h.undo.push(action);
      h.redo = [];
    }

    addPageStroke(pageNumber, stroke) {
      if (!this.pageStrokes[pageNumber]) {
        this.pageStrokes[pageNumber] = [];
      }
      const newStroke = {
        id: stroke.id || uid('p_strk'),
        color: stroke.color || null,
        width: stroke.width || STROKE_WIDTH,
        points: stroke.points || [] // page coordinates
      };
      this.pageStrokes[pageNumber].push(newStroke);
      this._record(pageNumber, { type: 'remove', removed: [{ stroke: newStroke, index: this.pageStrokes[pageNumber].length - 1 }] });
      return newStroke;
    }

    removePageStrokes(pageNumber, ids) {
      const list = this.pageStrokes[pageNumber] || [];
      const set = new Set(ids);
      const removed = [];
      list.forEach((stroke, index) => { if (set.has(stroke.id)) removed.push({ stroke, index }); });
      if (!removed.length) return 0;
      this.pageStrokes[pageNumber] = list.filter(s => !set.has(s.id));
      this._record(pageNumber, { type: 'restore', removed });
      return removed.length;
    }

    clearPage(pageNumber) {
      const list = this.pageStrokes[pageNumber] || [];
      return this.removePageStrokes(pageNumber, list.map(s => s.id));
    }

    // History actions are stored as "what undo does": 'remove' takes strokes out, 'restore' puts them back.
    undoPage(pageNumber) {
      const h = this._hist(pageNumber);
      if (!h.undo.length) return false;
      const action = h.undo.pop();
      h.redo.push(this._invert(pageNumber, action));
      return true;
    }

    redoPage(pageNumber) {
      const h = this._hist(pageNumber);
      if (!h.redo.length) return false;
      const action = h.redo.pop();
      h.undo.push(this._invert(pageNumber, action));
      return true;
    }

    _invert(pageNumber, action) {
      const list = this.pageStrokes[pageNumber] || (this.pageStrokes[pageNumber] = []);
      if (action.type === 'remove') {
        const ids = new Set(action.removed.map(r => r.stroke.id));
        this.pageStrokes[pageNumber] = list.filter(s => !ids.has(s.id));
        return { type: 'restore', removed: action.removed };
      }
      const restored = [...action.removed].sort((a, b) => a.index - b.index);
      for (const { stroke, index } of restored) list.splice(index, 0, stroke);
      return { type: 'remove', removed: action.removed };
    }

    canUndoPage(pageNumber) { return this._hist(pageNumber).undo.length > 0; }
    canRedoPage(pageNumber) { return this._hist(pageNumber).redo.length > 0; }

    getStrokes(pageNumber) {
      return this.pageStrokes[pageNumber] || [];
    }

    hasInk() {
      return Object.values(this.pageStrokes).some(list => list.length > 0);
    }

    nextPage() {
      if (this.currentPage < this.pageCount) {
        this.currentPage++;
        return true;
      }
      return false;
    }

    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--;
        return true;
      }
      return false;
    }

    goToPage(n) {
      if (Number.isInteger(n) && n >= 1 && n <= this.pageCount) {
        this.currentPage = n;
        return true;
      }
      return false;
    }
  }

  // --- WebView Card Model (v1.1 / AC13-AC16) ---
  class WebCard {
    constructor(url = '', title = 'Tarjeta web') {
      this.id = uid('web');
      this.url = url;
      this.title = title;
      this.mode = 'frozen'; // 'frozen' (ink enabled) or 'interact' (ink paused) — exactly one (AC15)
      this.strokes = [];
      this.helper = BILINGUAL.webCardHelper.es + ' / ' + BILINGUAL.webCardHelper.en;
    }

    setMode(mode) {
      if (mode !== 'frozen' && mode !== 'interact') throw new Error('Unknown web card mode: ' + mode);
      this.mode = mode;
      return this.mode;
    }

    toggleMode() {
      return this.setMode(this.mode === 'frozen' ? 'interact' : 'frozen');
    }

    isInkAllowed() {
      return this.mode === 'frozen';
    }

    addStroke(stroke) {
      if (!this.isInkAllowed()) {
        throw new Error('Cannot draw while in Interact mode');
      }
      this.strokes.push(stroke);
      return stroke;
    }
  }

  // --- Overlay Chip Cycle Manager (AC9) ---
  class OverlayChip {
    constructor(initialState = '?') {
      this.state = initialState; // '?' | 'ON' | 'OFF'
    }

    cycle() {
      if (this.state === '?') this.state = 'ON';
      else if (this.state === 'ON') this.state = 'OFF';
      else this.state = '?';
      return this.state;
    }

    getLabel() {
      if (this.state === 'ON') return BILINGUAL.overlayChip.on.es;
      if (this.state === 'OFF') return BILINGUAL.overlayChip.off.es;
      return BILINGUAL.overlayChip.unknown.es;
    }
  }

  // --- Lesson Serializer (AC11) ---
  class LessonSerializer {
    static serialize(sceneGraph, pdfDocs = [], webCards = []) {
      return {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        viewport: { ...sceneGraph.viewport },
        objects: Array.from(sceneGraph.objects.values()),
        strokes: sceneGraph.strokes,
        pdfDocuments: pdfDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          pageCount: doc.pageCount,
          currentPage: doc.currentPage,
          pageStrokes: doc.pageStrokes,
          data: doc.bytes ? bytesToBase64(doc.bytes) : null
        })),
        webCards: webCards.map(w => ({
          id: w.id,
          url: w.url,
          title: w.title,
          mode: w.mode,
          strokes: w.strokes
        }))
      };
    }

    // Validates first, then applies: a corrupt file never clobbers the current board.
    static deserialize(data, sceneGraph) {
      if (!data || data.version !== '1.0.0') {
        throw new Error('Invalid lesson format version');
      }
      const listOk = v => v === undefined || Array.isArray(v);
      if (!listOk(data.objects) || !listOk(data.strokes) || !listOk(data.pdfDocuments) || !listOk(data.webCards)) {
        throw new Error('Invalid lesson structure');
      }
      const vp = data.viewport || {};
      if (data.viewport && ![vp.scale, vp.panX, vp.panY].every(Number.isFinite)) {
        throw new Error('Invalid lesson viewport');
      }
      for (const obj of data.objects || []) {
        if (!obj || typeof obj.id !== 'string' || typeof obj.type !== 'string') throw new Error('Invalid lesson object');
      }

      const pdfDocs = (data.pdfDocuments || []).map(d => {
        const doc = new PdfDocument(d.title, d.pageCount);
        doc.id = d.id;
        doc.currentPage = d.currentPage || 1;
        doc.pageStrokes = d.pageStrokes || {};
        doc.bytes = d.data ? base64ToBytes(d.data) : null;
        return doc;
      });

      const webCards = (data.webCards || []).map(w => {
        const card = new WebCard(w.url, w.title);
        card.id = w.id;
        card.mode = w.mode === 'interact' ? 'interact' : 'frozen';
        card.strokes = w.strokes || [];
        return card;
      });

      sceneGraph.viewport = data.viewport ? { ...data.viewport } : { scale: 1, panX: 0, panY: 0 };
      sceneGraph.objects.clear();
      for (const obj of data.objects || []) {
        sceneGraph.objects.set(obj.id, { rotation: 0, scale: 1, ...obj });
      }
      sceneGraph.strokes = [...(data.strokes || [])];
      sceneGraph.undoStack = [];
      sceneGraph.redoStack = [];
      sceneGraph.selectedObjectId = null;

      return { pdfDocs, webCards };
    }
  }

  // --- Probe Evidence Gate (AC12) ---
  class ProbeGate {
    // Full reading of an imported probe JSON. WDK needs GX host + evidence.complete + sbPresent.
    static inspect(probePayload) {
      const result = {
        valid: Boolean(probePayload && typeof probePayload === 'object'),
        isGx: false,
        complete: false,
        sbPresent: false,
        wdk: false,
        missing: [],
        penTouch: 'provisional'
      };
      if (!result.valid) return result;

      const host = probePayload.host && probePayload.host.classification;
      result.isGx = host === 'gx-android';
      result.complete = Boolean(probePayload.evidence && probePayload.evidence.complete === true);
      result.missing = (probePayload.evidence && Array.isArray(probePayload.evidence.missing))
        ? probePayload.evidence.missing.slice()
        : [];
      result.sbPresent = Boolean(
        probePayload.scenarios &&
        probePayload.scenarios.B &&
        probePayload.scenarios.B.payload &&
        probePayload.scenarios.B.payload.sbPresent === true
      );
      result.wdk = result.complete && result.isGx && result.sbPresent;

      // The chip leaves "provisional" only for a complete GX payload (laptop JSON is not evidence).
      if (result.complete && result.isGx) {
        const c = probePayload.scenarios && probePayload.scenarios.C;
        result.penTouch = c && c.status === 'pass' ? 'fromProbe' : 'toolbarOnly';
      }
      return result;
    }

    static evaluateWdkUnlock(probePayload) {
      return ProbeGate.inspect(probePayload).wdk;
    }
  }

  // --- Pointer Routing (AC2) ---
  function routePointerAction(pointerEvent, activeTool) {
    const pointerType = pointerEvent.pointerType || 'touch';

    // In provisional split:
    // If pointerType is 'pen', it ALWAYS draws ink regardless of activeTool
    if (pointerType === 'pen') {
      return 'draw_ink';
    }

    // Finger / touch:
    if (activeTool === 'pan') {
      return 'pan_canvas';
    }

    if (activeTool === 'pen') {
      return 'draw_ink';
    }

    if (activeTool === 'select') {
      return 'select_object';
    }

    if (activeTool === 'eraser') {
      return 'erase_ink';
    }

    return 'pan_canvas';
  }

  return {
    BILINGUAL,
    STROKE_WIDTH,
    SCALE_MIN,
    SCALE_MAX,
    gridLevels,
    SceneGraph,
    PdfDocument,
    WebCard,
    OverlayChip,
    LessonSerializer,
    ProbeGate,
    routePointerAction,
    objectToWorld,
    worldToObject,
    pointInObject,
    strokeNearPoint,
    bytesToBase64,
    base64ToBytes
  };
});
