// canvas/app.js — interactive controller for the infinite-canvas lesson board.
// Domain logic lives in canvas-core.js; this file wires the DOM, pointers, PDF viewer and persistence.
(function () {
  'use strict';

  const {
    SceneGraph, PdfDocument, WebCard, OverlayChip, LessonSerializer, ProbeGate,
    routePointerAction, objectToWorld, worldToObject, pointInObject, strokeNearPoint,
    BILINGUAL, STROKE_WIDTH, SCALE_MIN, SCALE_MAX, gridLevels
  } = window.CanvasCore;

  const STICKY_COLORS = ['yellow', 'green', 'teal', 'pink', 'lavender'];
  const ERASER_RADIUS_PX = 14;
  const IMAGE_MAX_PX = 1600;
  const IMAGE_CARD_PX = 480;

  // ---------- State ----------
  const sg = new SceneGraph();
  let pdfDocuments = [];
  let webCards = [];
  let activeTool = 'pen'; // 'select' | 'pen' | 'eraser' | 'text'
  const overlayChip = new OverlayChip('?');
  let penTouch = 'provisional';
  let wdkUnlocked = false;
  let dirty = false;

  const elements = new Map();      // object id -> wrapper element
  const proxies = new Map();       // pdf id -> Promise<pdf.js document>
  const thumbs = new Map();        // pdf id -> data URL of the last viewed page
  const failedFiles = new Map();   // failed pdf object id -> File (for retry)

  const pointers = new Map();      // pointerId -> { x, y, type }
  let gesture = null;
  let liveStroke = null;           // { points, objectId } while inking
  let hiddenStrokes = new Set();   // strokes being erased (hidden until pointer up)

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const app = $('app');
  const board = $('board');
  const viewport = $('canvas-viewport');
  const sceneLayer = $('scene-layer');
  const inkCanvas = $('ink-canvas');
  const inkCtx = inkCanvas.getContext('2d');
  const toasts = $('toasts');
  const dialogHost = $('dialog-host');
  const overflowMenu = $('overflow-menu');
  const zoomDisplay = $('zoom-display');
  const zoomInput = $('zoom-input');
  const css = getComputedStyle(document.documentElement);
  const inkColor = () => css.getPropertyValue('--text-body').trim();

  // ---------- Pen options (colour + thickness), shared by board and PDF book ----------
  const PEN_COLORS = [
    ['--color-example-blue', 'Azul', 'Blue'], ['--color-ink', 'Negro', 'Black'], ['--color-red', 'Rojo', 'Red'],
    ['--color-grass-green', 'Verde', 'Green'], ['--color-orange', 'Naranja', 'Orange'], ['--color-purple', 'Morado', 'Purple']
  ];
  const PEN_WIDTHS = [[2, 'Fino', 'Thin'], [4, 'Medio', 'Medium'], [8, 'Grueso', 'Thick'], [14, 'Muy grueso', 'Extra thick']];
  let penColor = css.getPropertyValue(PEN_COLORS[0][0]).trim();   // default: blue
  let penWidth = STROKE_WIDTH;

  function buildPenOptions() {
    const hosts = [...document.querySelectorAll('[data-pen-options]')];
    const wraps = hosts.map(host => host.parentElement);
    const penBtn = wrap => wrap.querySelector('.ds-tool');
    const closePen = () => hosts.forEach(host => {
      host.hidden = true;
      penBtn(host.parentElement).setAttribute('aria-expanded', 'false');
    });
    const refresh = () => {
      hosts.forEach(host => {
        host.querySelectorAll('[data-pen-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.penColor === penColor)));
        host.querySelectorAll('[data-pen-width]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.penWidth) === penWidth)));
      });
      wraps.forEach(wrap => wrap.style.setProperty('--pen-current', penColor));
    };
    hosts.forEach(host => {
      host.replaceChildren(
        ...PEN_COLORS.map(([token, es, en]) => {
          const value = css.getPropertyValue(token).trim();
          const b = h('button', { type: 'button', class: 'cv-pen__swatch', 'aria-label': `${es} / ${en}`, title: `${es} / ${en}`, data: { penColor: value }, on: { click: () => { penColor = value; refresh(); closePen(); } } });
          b.style.setProperty('--swatch', value);
          return b;
        }),
        h('span', { class: 'cv-pen__break', role: 'separator' }),
        ...PEN_WIDTHS.map(([w, es, en]) => {
          const b = h('button', { type: 'button', class: 'cv-pen__width', 'aria-label': `${es} / ${en}`, title: `${es} / ${en}`, data: { penWidth: String(w) }, on: { click: () => { penWidth = w; refresh(); closePen(); } } },
            h('span', { class: 'cv-pen__dot', 'aria-hidden': 'true' }));
          b.style.setProperty('--dot', `${w + 2}px`);
          return b;
        })
      );
      // Tapping the pen while it is already the active tool toggles its panel; the panel is closed otherwise.
      const btn = penBtn(host.parentElement);
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-pressed') === 'true' && host.hidden;
        closePen();
        if (open) { host.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.cv-pen-wrap')) closePen(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePen(); });
    // Switching to another tool closes the panel too (those clicks never reach the pen button).
    document.querySelectorAll('.ds-tool[data-tool], .ds-tool[data-pdf-tool]').forEach(b => {
      if (!b.closest('.cv-pen-wrap')) b.addEventListener('click', closePen);
    });
    refresh();
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'data') Object.assign(el.dataset, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }
  const icon = name => h('span', { class: `ic ic-${name}`, 'aria-hidden': 'true' });
  const bi = (es, en) => h('span', { class: 'ds-bi' },
    h('span', { class: 'ds-bi__es', lang: 'es', text: es }),
    h('span', { class: 'ds-bi__en', lang: 'en', text: en }));
  const biLine = (es, en) => h('span', { class: 'cv-bi-stack' },
    h('span', { lang: 'es', text: es }), h('span', { lang: 'en', text: en }));

  // ---------- Toasts / dialogs ----------
  function toast(es, en, tone = 'neutral', iconName) {
    const node = h('div', { role: 'status', class: `ds-toast${tone === 'neutral' ? '' : ' ds-toast--' + tone}` },
      iconName ? icon(iconName) : null, `${es} / ${en}`);
    toasts.append(node);
    setTimeout(() => node.remove(), tone === 'error' || tone === 'warning' ? 5000 : 2800);
  }

  let dialogReturnFocus = null;
  function closeDialog() {
    dialogHost.hidden = true;
    dialogHost.replaceChildren();
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
  }

  // actions: [{ label, variant, onClick(close) -> keep open when it returns false, disabled, ref }]
  function showDialog({ title, body, actions, wide }) {
    dialogReturnFocus = document.activeElement;
    const foot = h('div', { class: 'ds-dialog__foot' });
    const buttons = (actions || []).map(a => {
      const b = h('button', {
        type: 'button',
        class: `ds-btn ds-btn--board${a.variant && a.variant !== 'primary' ? ' ds-btn--' + a.variant : ''}`,
        disabled: !!a.disabled,
        on: { click: () => { if (a.onClick && a.onClick() === false) return; closeDialog(); } }
      }, a.label);
      foot.append(b);
      return b;
    });
    const dlg = h('div', { class: 'ds-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'ds-dialog__head' },
        h('h2', { class: 'ds-dialog__title', text: title }),
        h('button', { type: 'button', class: 'ds-iconbtn ds-iconbtn--board', 'aria-label': 'Cerrar / Close', on: { click: closeDialog } }, icon('x'))),
      h('div', { class: 'ds-dialog__body' }, body),
      actions && actions.length ? foot : null);
    dialogHost.replaceChildren(dlg);
    dialogHost.hidden = false;
    const first = dlg.querySelector('input:not([hidden])') || buttons[buttons.length - 1] || dlg.querySelector('button');
    if (first) first.focus();
    return { buttons, dlg };
  }

  function confirmDialog({ title, body, confirmLabel, danger }) {
    return new Promise(resolve => {
      let answered = false;
      const done = v => { if (!answered) { answered = true; resolve(v); } };
      showDialog({
        title,
        body: h('p', { class: 't-body', text: body }),
        actions: [
          { label: 'Cancelar / Cancel', variant: 'ghost', onClick: () => done(false) },
          { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => done(true) }
        ]
      });
      // closing with X / Escape counts as cancel
      const obs = new MutationObserver(() => { if (dialogHost.hidden) { done(false); obs.disconnect(); } });
      obs.observe(dialogHost, { attributes: true, attributeFilter: ['hidden'] });
    });
  }

  // ---------- View / camera ----------
  function viewSize() { return { w: viewport.clientWidth, h: viewport.clientHeight }; }

  function updateView() {
    const v = sg.viewport;
    board.style.setProperty('--pan-x', `${v.panX}px`);
    board.style.setProperty('--pan-y', `${v.panY}px`);
    board.style.setProperty('--zoom', String(v.scale));
    gridLevels(v.scale).forEach((l, i) => {
      board.style.setProperty(`--grid-p${i}`, `${l.pitch}px`);
      board.style.setProperty(`--grid-a${i}`, `${Math.round(l.alpha * 100)}%`);
    });
    zoomDisplay.textContent = `${Math.round(v.scale * 100)}%`;
    redrawInk();
  }

  function sizeInkCanvas() {
    const dpr = window.devicePixelRatio || 1;
    inkCanvas.width = Math.max(1, Math.round(viewport.clientWidth * dpr));
    inkCanvas.height = Math.max(1, Math.round(viewport.clientHeight * dpr));
    redrawInk();
  }

  function viewPoint(e) {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  const worldPoint = e => { const p = viewPoint(e); return sg.screenToWorld(p.x, p.y); };

  function contentBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
    for (const obj of sg.objects.values()) {
      const s = sizeOf(obj.id);
      [[0, 0], [s.width, 0], [0, s.height], [s.width, s.height]].forEach(([x, y]) => add(objectToWorld(obj, x, y)));
    }
    for (const stroke of sg.strokes) (strokeWorldPoints(stroke) || []).forEach(add);
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  function fitView() {
    const b = contentBounds();
    const { w, h: vh } = viewSize();
    if (b) sg.fitTo(b, w, vh, 96); else sg.fit();
    updateView();
  }

  function zoomBy(dir) {
    const { w, h: vh } = viewSize();
    if (dir > 0) sg.zoomIn(w / 2, vh / 2); else sg.zoomOut(w / 2, vh / 2);
    updateView();
  }

  // ---------- Ink rendering (board) ----------
  function strokeWorldPoints(stroke) {
    if (!stroke.objectId) return stroke.points;
    const obj = sg.objects.get(stroke.objectId);
    if (!obj) return null;
    return stroke.points.map(p => objectToWorld(obj, p.x, p.y));
  }

  function strokeWidthWorld(stroke) {
    if (!stroke.objectId) return stroke.width;
    const obj = sg.objects.get(stroke.objectId);
    return stroke.width * (obj ? obj.scale || 1 : 1);
  }

  function drawPolyline(ctx, pts, color, width) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function redrawInk() {
    const dpr = window.devicePixelRatio || 1;
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    const s = sg.viewport.scale;
    const color = inkColor();
    const toScreen = pts => pts.map(p => sg.worldToScreen(p.x, p.y));
    for (const stroke of sg.strokes) {
      if (hiddenStrokes.has(stroke.id)) continue;
      const world = strokeWorldPoints(stroke);
      if (!world || !world.length) continue;
      drawPolyline(inkCtx, toScreen(world), stroke.color || color, strokeWidthWorld(stroke) * s);
    }
    if (liveStroke && liveStroke.points.length) {
      const obj = liveStroke.objectId ? sg.objects.get(liveStroke.objectId) : null;
      const world = obj ? liveStroke.points.map(p => objectToWorld(obj, p.x, p.y)) : liveStroke.points;
      drawPolyline(inkCtx, toScreen(world), liveStroke.color, liveStroke.width * s);
    }
  }

  let redrawQueued = false;
  function queueRedrawInk() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => { redrawQueued = false; redrawInk(); });
  }

  // ---------- Status / chrome ----------
  function setDirty(v) {
    dirty = v;
    $('chip-unsaved').hidden = !dirty;
  }

  function afterChange(markDirty = true) {
    if (markDirty) setDirty(true);
    $('empty-hint').hidden = sg.objects.size > 0 || sg.strokes.length > 0;
    $('btn-undo').disabled = sg.undoStack.length === 0;
    $('btn-redo').disabled = sg.redoStack.length === 0;
  }

  const OVERLAY_ICON = { '?': 'info', ON: 'triangle-alert', OFF: 'circle-check' };
  function updateStatus() {
    for (const chip of document.querySelectorAll('[data-overlay-chip]')) {
      chip.classList.toggle('ds-chip--on', overlayChip.state === 'ON');
      chip.classList.toggle('ds-chip--off', overlayChip.state === 'OFF');
      chip.querySelector('.ic').className = `ic ic-${OVERLAY_ICON[overlayChip.state]}`;
      chip.querySelector('.cv-chip__label').textContent = overlayChip.getLabel();
    }
    const t = BILINGUAL.tools[activeTool];
    $('chip-active-tool').textContent = `herramienta: ${t.es} / tool: ${t.en}`;

    const pt = $('chip-pen-touch');
    const label = BILINGUAL.penTouch[penTouch];
    pt.textContent = label.es === label.en ? label.es : `${label.es} / ${label.en}`;
    pt.className = `ds-badge cv-badge${penTouch === 'provisional' ? ' ds-badge--warning' : ' ds-badge--success'}`;

    $('chip-wdk-status').hidden = !wdkUnlocked;
  }

  function setTool(tool) {
    activeTool = tool;
    app.dataset.tool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => {
      if (b.classList.contains('ds-tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    if (tool !== 'select') selectObject(null);
    updateStatus();
  }

  // ---------- Objects ----------
  function sizeOf(id) {
    const el = elements.get(id);
    return el ? { width: el.offsetWidth, height: el.offsetHeight } : { width: 0, height: 0 };
  }

  function hitObject(world) {
    const list = Array.from(sg.objects.values());
    for (let i = list.length - 1; i >= 0; i--) {
      if (pointInObject(list[i], sizeOf(list[i].id), world.x, world.y)) return list[i];
    }
    return null;
  }

  const webModel = obj => webCards.find(w => w.id === obj.webCardId);
  const pdfModel = obj => pdfDocuments.find(d => d.id === obj.pdfId);

  function hostOf(url) { try { return new URL(url).host; } catch (e) { return url; } }

  function parseUrl(text, httpsOnly) {
    let raw = (text || '').trim();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    try {
      const u = new URL(raw);
      const ok = httpsOnly ? u.protocol === 'https:' : (u.protocol === 'https:' || u.protocol === 'http:');
      return ok && u.hostname.includes('.') ? u.href : null;
    } catch (e) { return null; }
  }

  function openLink(url) {
    const w = window.open(url, '_blank');
    if (w) {
      try { w.opener = null; } catch (e) { /* cross-origin */ }
      toast('Abierto en otra pestaña: la lección sigue aquí', 'Opened in a new tab: the lesson stays here', 'info', 'external-link');
    } else {
      toast('Permite ventanas emergentes', 'Allow pop-ups', 'warning', 'triangle-alert');
    }
  }

  function objectCard({ accent, icon: iconName, tab, title, meta, image, badge, failed, actions }) {
    return h('div', { class: `ds-object acc-${accent}${failed ? ' ds-object--failed' : ''}` },
      h('div', { class: 'ds-object__thumb' },
        image ? h('img', { src: image, alt: '' }) : icon(failed ? 'triangle-alert' : iconName),
        tab ? h('div', { class: 'ds-object__tab' }, h('span', { class: 'ds-tab-wrap' }, h('span', { class: 'ds-tab', text: tab }))) : null,
        badge ? h('span', { class: 'ds-badge ds-badge--accent', text: badge }) : null),
      h('div', { class: 'ds-object__body' },
        h('span', { class: 'ds-object__title', text: title }),
        meta ? h('span', { class: 'ds-object__meta', text: meta }) : null,
        actions && actions.length ? h('div', { class: 'ds-object__action' }, actions) : null));
  }

  const cardButton = (label, iconName, onClick, variant = 'accent') => h('button', {
    type: 'button', class: `ds-btn ds-btn--${variant} ds-btn--board`, on: { click: e => { e.stopPropagation(); onClick(); } }
  }, iconName ? icon(iconName) : null, label);

  function buildObject(obj) {
    const el = h('div', { class: `cv-obj cv-obj--${obj.type}`, data: { id: obj.id }, role: 'group' });
    if (obj.type === 'sticky') {
      const ta = h('textarea', {
        class: 'cv-sticky__text', placeholder: 'Escribe… / Type…', value: obj.text || '', 'aria-label': 'Nota / Note',
        on: { input: () => { obj.text = ta.value; setDirty(true); }, blur: () => stopEditing(obj.id) }
      });
      el.append(h('div', { class: `ds-sticky${obj.color && obj.color !== 'yellow' ? ' ds-sticky--' + obj.color : ''}` }, ta));
      el.setAttribute('aria-label', 'Nota / Note');
    } else if (obj.type === 'text') {
      const ta = h('textarea', {
        class: 'cv-text', rows: 1, placeholder: 'Escribe… / Type…', value: obj.text || '', 'aria-label': 'Texto / Text',
        on: { input: () => { obj.text = ta.value; setDirty(true); }, blur: () => stopEditing(obj.id) }
      });
      el.append(ta);
      el.setAttribute('aria-label', 'Texto / Text');
    } else if (obj.type === 'pdf') {
      el.setAttribute('aria-label', obj.title);
      if (obj.failed) {
        el.append(objectCard({
          accent: 'green', failed: true, title: obj.title, meta: obj.error,
          actions: [
            cardButton('Reintentar / Retry', 'redo-2', () => retryPdf(obj.id), 'accent'),
            cardButton('Quitar / Remove', 'trash-2', () => deleteObject(obj.id, true), 'secondary')
          ]
        }));
      } else {
        const doc = pdfModel(obj);
        const page = doc ? doc.currentPage : 1;
        el.append(objectCard({
          accent: 'green', icon: 'file-text', tab: 'Libro', title: obj.title, image: thumbs.get(obj.pdfId),
          meta: `${obj.pageCount} pp · p.${page}`, badge: doc && doc.hasInk() ? 'tinta / ink' : null,
          actions: [cardButton('Abrir libro / Open book', 'book-open', () => openViewer(obj.pdfId))]
        }));
      }
    } else if (obj.type === 'link') {
      el.setAttribute('aria-label', obj.title);
      const valid = !!parseUrl(obj.url);
      el.append(objectCard({
        accent: 'blue', icon: 'link', title: obj.title, meta: obj.url,
        actions: [(() => { const b = cardButton('Abrir en pestaña / Open in new tab', 'external-link', () => openLink(obj.url)); b.disabled = !valid; return b; })()]
      }));
    } else if (obj.type === 'image') {
      el.setAttribute('aria-label', obj.title);
      el.style.setProperty('--img-w', `${Math.min(obj.w || IMAGE_CARD_PX, IMAGE_CARD_PX)}px`);
      el.append(h('figure', { class: 'cv-photo' }, h('img', { src: obj.src, alt: obj.title }), h('figcaption', { text: obj.title })));
    } else if (obj.type === 'webcard') {
      buildWebCard(el, obj);
    }
    el.addEventListener('dblclick', () => { if (obj.type === 'sticky' || obj.type === 'text') startEditing(obj.id); });
    return el;
  }

  function buildWebCard(el, obj) {
    const card = webModel(obj) || (() => { const c = new WebCard(obj.url, obj.title); c.id = obj.webCardId; webCards.push(c); return c; })();
    el.classList.add('cv-web');
    el.setAttribute('aria-label', 'tarjeta web / web page');
    const frame = h('div', { class: 'cv-web__frame' },
      h('span', { class: 'cv-bi-stack' },
        h('strong', { text: hostOf(card.url) }),
        h('span', { text: 'Fija: tinta nuestra, página quieta. / Frozen: our ink, page still.' })));
    const modes = h('fieldset', { class: 'cv-web__modes', role: 'radiogroup', 'aria-label': 'Modo de la tarjeta web / Web card mode' },
      h('legend', { text: 'Modo / Mode' }));
    const radio = (value, es, en) => {
      const input = h('input', { type: 'radio', name: `mode-${card.id}`, value, checked: card.mode === value,
        on: { change: () => { card.setMode(value); applyWebMode(el, card); setDirty(true); } } });
      return h('label', { class: 'ds-radio acc-teal' }, input, h('span', { class: 'ds-radio__dot' }), bi(es, en));
    };
    modes.append(
      radio('frozen', 'Frozen: tinta nuestra, página quieta', 'Frozen: our ink, page still'),
      radio('interact', 'Interact: tinta en pausa, no es el libro', 'Interact: ink paused, not the book'));
    const frameBox = h('div', { class: 'ds-frame' },
      h('span', { class: 'ds-frame__title' }, bi('Tarjeta web', 'Web page'), h('span', { class: 'ds-badge', text: 'v1.1' })),
      h('div', { class: 'cv-web__body' },
        h('div', { class: 'cv-web__head' }, icon('link'), h('span', { class: 'cv-web__url', text: card.url }),
          h('button', { type: 'button', class: 'ds-iconbtn ds-iconbtn--board', 'aria-label': 'Abrir en pestaña / Open in new tab',
            on: { click: e => { e.stopPropagation(); openLink(card.url); } } }, icon('external-link'))),
        frame, modes,
        h('p', { class: 'cv-web__helper' }, h('span', { lang: 'es', text: 'Para el libro usa un PDF.' }), h('span', { lang: 'en', class: 'ds-bi__en', text: 'For the book, use a PDF.' }))));
    el.append(frameBox);
    applyWebMode(el, card);
  }

  function applyWebMode(el, card) {
    const frame = el.querySelector('.cv-web__frame');
    frame.classList.toggle('is-frozen', card.mode === 'frozen');
    el.querySelectorAll('input[type=radio]').forEach(r => { r.checked = r.value === card.mode; });
    // The document is loaded only once the teacher chooses Interact; Frozen keeps the last painted frame.
    if (card.mode === 'interact' && !frame.querySelector('iframe')) {
      frame.append(h('iframe', { src: card.url, title: 'Tarjeta web / Web page', referrerPolicy: 'no-referrer',
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' }));
    }
    el.classList.toggle('is-interact', card.mode === 'interact');
  }

  function syncObject(obj) {
    const el = elements.get(obj.id);
    if (!el) return;
    el.style.setProperty('--ox', `${obj.x}px`);
    el.style.setProperty('--oy', `${obj.y}px`);
    el.style.setProperty('--rot', `${obj.rotation || 0}deg`);
    el.style.setProperty('--sc', String(obj.scale || 1));
    el.classList.toggle('is-selected', sg.selectedObjectId === obj.id);
  }

  function mountObject(obj) {
    const el = buildObject(obj);
    elements.set(obj.id, el);
    sceneLayer.append(el);
    syncObject(obj);
    return el;
  }

  function refreshObject(id) {
    const obj = sg.objects.get(id);
    const old = elements.get(id);
    if (!obj || !old) return;
    const el = buildObject(obj);
    old.replaceWith(el);
    elements.set(id, el);
    syncObject(obj);
    if (sg.selectedObjectId === id) syncHandles();
  }

  // Reconcile the DOM with the scene graph (after undo/redo/load).
  function reconcileObjects() {
    for (const [id, el] of elements) {
      if (!sg.objects.has(id)) { el.remove(); elements.delete(id); }
    }
    for (const obj of sg.objects.values()) {
      if (!elements.has(obj.id)) mountObject(obj); else syncObject(obj);
    }
    if (sg.selectedObjectId && !sg.objects.has(sg.selectedObjectId)) sg.selectedObjectId = null;
    syncHandles();
  }

  function rebuildAllObjects() {
    elements.forEach(el => el.remove());
    elements.clear();
    sg.objects.forEach(obj => mountObject(obj));
    syncHandles();
  }

  function selectObject(id) {
    if (sg.selectedObjectId && sg.selectedObjectId !== id) stopEditing(sg.selectedObjectId);
    sg.selectedObjectId = id;
    for (const obj of sg.objects.values()) syncObject(obj);
    syncHandles();
  }

  function startEditing(id) {
    const el = elements.get(id);
    const ta = el && el.querySelector('textarea');
    if (!ta) return;
    el.classList.add('is-editing');
    ta.focus();
  }
  function stopEditing(id) {
    const el = elements.get(id);
    if (el) el.classList.remove('is-editing');
  }

  function syncHandles() {
    document.querySelectorAll('.cv-handle').forEach(n => n.remove());
    const obj = sg.selectedObjectId && sg.objects.get(sg.selectedObjectId);
    const el = obj && elements.get(obj.id);
    if (!el) return;
    const handle = (cls, iconName, label, onDown, onClick) => {
      const b = h('button', { type: 'button', class: `cv-handle ${cls}`, 'aria-label': label, title: label,
        on: { pointerdown: e => { e.stopPropagation(); if (onDown) onDown(e); }, click: e => { e.stopPropagation(); if (onClick) onClick(); } } }, icon(iconName));
      // The sticky's selection frame lives on the tilted paper, so its handles must be children of the paper to sit on the frame's corners.
      (el.querySelector('.ds-sticky') || el).append(b);
    };
    handle('cv-handle--scale', 'maximize', 'Cambiar tamaño / Resize', e => beginHandleGesture(e, 'scale', obj));
    handle('cv-handle--rotate', 'rotate-cw', 'Girar / Rotate', e => beginHandleGesture(e, 'rotate', obj));
    handle('cv-handle--delete', 'trash-2', 'Quitar objeto / Delete object', null, () => deleteObject(obj.id));
  }

  async function deleteObject(id, skipConfirm) {
    const obj = sg.objects.get(id);
    if (!obj) return;
    if (!skipConfirm) {
      const ok = await confirmDialog({
        title: '¿Quitar este objeto? / Delete this object?',
        body: 'La tinta que lleva también se quita; puedes deshacer. / Its ink goes too; you can undo.',
        confirmLabel: 'Quitar / Delete', danger: true
      });
      if (!ok) return;
    }
    sg.removeObject(id);
    failedFiles.delete(id);
    reconcileObjects();
    redrawInk();
    afterChange();
  }

  // ---------- Adding materials ----------
  // New materials land at the view centre, cascading so they never sit exactly on top of each other.
  let cascade = 0;
  function viewCenterWorld() {
    const { w, h: vh } = viewSize();
    const step = (cascade++ % 6) * 32;
    return sg.screenToWorld(w / 2 + step, vh / 2 + step);
  }

  function addObject(spec, at, anchor) {
    const c = at || viewCenterWorld();
    const obj = sg.addObject({ ...spec, x: c.x - (anchor ? anchor.x : 150), y: c.y - (anchor ? anchor.y : 100) });
    mountObject(obj);
    afterChange();
    return obj;
  }

  function focusNew(obj, edit) {
    setTool('select');
    selectObject(obj.id);
    if (edit) startEditing(obj.id);
  }

  function addSticky() {
    const count = Array.from(sg.objects.values()).filter(o => o.type === 'sticky').length;
    const obj = addObject({ type: 'sticky', text: '', color: STICKY_COLORS[count % STICKY_COLORS.length] }, null, { x: 110, y: 100 });
    focusNew(obj, true);
  }

  function addText(at) {
    const obj = addObject({ type: 'text', text: '' }, at, { x: 0, y: 0 });
    focusNew(obj, true);
  }

  function describePdfError(err) {
    const name = err && err.name;
    if (name === 'PasswordException') return 'PDF con contraseña / Password-protected PDF';
    if (name === 'InvalidPDFException' || name === 'FormatError') return 'PDF dañado o no válido / Corrupt or invalid PDF';
    return 'No se pudo abrir el PDF / Could not open the PDF';
  }

  async function addPdfFile(file, at) {
    if (!window.pdfjsLib) { toast('Falta el lector de PDF', 'PDF reader missing', 'error', 'triangle-alert'); return; }
    const spot = at || viewCenterWorld();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const proxy = await window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      const doc = new PdfDocument(file.name, proxy.numPages);
      doc.bytes = bytes;
      pdfDocuments.push(doc);
      proxies.set(doc.id, Promise.resolve(proxy));
      const obj = addObject({ type: 'pdf', pdfId: doc.id, title: file.name, pageCount: doc.pageCount, sizeBytes: file.size }, spot, { x: 160, y: 140 });
      focusNew(obj, false);
      const size = file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
      toast(`PDF añadido: ${doc.pageCount} pp, ${size}`, `PDF added: ${doc.pageCount} pp, ${size}`, 'success', 'circle-check');
      renderThumb(doc);
    } catch (err) {
      console.error('PDF load failed', err);
      const obj = addObject({ type: 'pdf', failed: true, title: file.name, error: describePdfError(err), pageCount: 0 }, spot, { x: 160, y: 140 });
      failedFiles.set(obj.id, file);
      toast(describePdfError(err), 'PDF not added', 'error', 'triangle-alert');
    }
  }

  async function retryPdf(objId) {
    const obj = sg.objects.get(objId);
    const file = failedFiles.get(objId);
    if (!obj) return;
    if (!file) { $('pdf-file-input').click(); return; }
    const at = { x: obj.x + 160, y: obj.y + 140 };
    sg.removeObject(objId);
    failedFiles.delete(objId);
    reconcileObjects();
    await addPdfFile(file, at);
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w0 = img.naturalWidth, h0 = img.naturalHeight;
        if (!w0 || !h0) { URL.revokeObjectURL(url); reject(new Error('empty image')); return; }
        const k = Math.min(1, IMAGE_MAX_PX / Math.max(w0, h0));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w0 * k);
        canvas.height = Math.round(h0 * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ src: canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9), w: canvas.width, h: canvas.height });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode')); };
      img.src = url;
    });
  }

  async function addImageFile(file, at) {
    try {
      const { src, w, h: ih } = await loadImageFile(file);
      const shown = Math.min(w, IMAGE_CARD_PX);
      const obj = addObject({ type: 'image', title: file.name, src, w, h: ih }, at, { x: shown / 2, y: (shown * ih / w) / 2 });
      focusNew(obj, false);
    } catch (err) {
      toast('No se pudo leer la imagen', 'Could not read the image', 'error', 'triangle-alert');
    }
  }

  async function handleFiles(files, at) {
    let i = 0;
    for (const file of files) {
      const spot = at ? { x: at.x + i * 40, y: at.y + i * 40 } : null;
      i++;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) await addPdfFile(file, spot);
      else if (file.type.startsWith('image/')) await addImageFile(file, spot);
      else toast(`Tipo de archivo no admitido: ${file.name}`, 'Unsupported file type', 'error', 'triangle-alert');
    }
  }

  // Link / web card dialogs
  function urlDialog({ title, httpsOnly, withTitle, helper, submitLabel, initial, onSubmit }) {
    const titleInput = h('input', { class: 'ds-input', type: 'text', autocomplete: 'off' });
    const urlInput = h('input', { class: 'ds-input', type: 'url', inputMode: 'url', autocomplete: 'off', placeholder: 'https://', value: initial || '' });
    const errorLine = h('span', { class: 'ds-field__error', hidden: true }, icon('circle-alert'),
      httpsOnly ? 'Usa una dirección https. / Use an https address.' : 'Dirección no válida. / Invalid address.');
    const body = h('div', { class: 'cv-stack' },
      withTitle ? h('label', { class: 'ds-field' }, h('span', { class: 'ds-field__label', text: 'Título / Title' }), titleInput) : null,
      h('label', { class: 'ds-field' }, h('span', { class: 'ds-field__label', text: 'Dirección / URL' }), urlInput, errorLine,
        helper ? h('span', { class: 'ds-field__hint', text: helper }) : null));
    const dlg = showDialog({
      title, body,
      actions: [
        { label: 'Cancelar / Cancel', variant: 'ghost' },
        { label: submitLabel, disabled: true, onClick: () => {
          const url = parseUrl(urlInput.value, httpsOnly);
          if (!url) return false;
          onSubmit(url, titleInput.value.trim());
        } }
      ]
    });
    const submit = dlg.buttons[1];
    const check = () => {
      const ok = !!parseUrl(urlInput.value, httpsOnly);
      submit.disabled = !ok;
      errorLine.hidden = ok || !urlInput.value.trim();
      urlInput.setAttribute('aria-invalid', String(!ok && !!urlInput.value.trim()));
    };
    urlInput.addEventListener('input', check);
    for (const input of [urlInput, titleInput]) {
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !submit.disabled) submit.click(); });
    }
    check();
    urlInput.focus();
  }

  function addLinkDialog(prefill) {
    urlDialog({
      title: 'Añadir enlace / Add link', httpsOnly: false, withTitle: true, submitLabel: 'Añadir / Add', initial: prefill,
      helper: 'Se abre en una pestaña nueva; no se incrusta. / Opens in a new tab; never embedded.',
      onSubmit: (url, title) => {
        const obj = addObject({ type: 'link', title: title || hostOf(url), url }, null, { x: 160, y: 120 });
        focusNew(obj, false);
      }
    });
  }

  function addWebCardDialog() {
    urlDialog({
      title: 'Tarjeta web (v1.1) / Web card (v1.1)', httpsOnly: true, withTitle: false, submitLabel: 'Añadir / Add',
      helper: 'Para el libro usa un PDF. / For the book, use a PDF.',
      onSubmit: url => {
        const card = new WebCard(url, hostOf(url));
        webCards.push(card);
        const obj = addObject({ type: 'webcard', webCardId: card.id, title: card.title, url }, null, { x: 260, y: 200 });
        focusNew(obj, false);
      }
    });
  }

  // ---------- Pointer handling (board) ----------
  function touchCount() { let n = 0; pointers.forEach(p => { if (p.type === 'touch') n++; }); return n; }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    closeMenu();
    if (e.target.closest('.cv-handle')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    if (e.pointerType === 'touch' && touchCount() === 2) { startPinch(); return; }
    if (gesture) return;

    const interactive = e.target.closest('button, a, input, label, iframe');
    if (interactive && (activeTool === 'select' || activeTool === 'text')) return;

    let action = routePointerAction(e, activeTool);
    if (activeTool === 'select' && action === 'draw_ink') action = 'select_object'; // UX §4: pen does not ink in select mode
    if (activeTool === 'text') action = 'place_text';

    const sp = viewPoint(e);
    const world = sg.screenToWorld(sp.x, sp.y);
    const hit = hitObject(world);

    if (action === 'select_object') {
      if (hit) {
        const wasSelected = sg.selectedObjectId === hit.id;
        selectObject(hit.id);
        gesture = { kind: 'move', pointerId: e.pointerId, id: hit.id, before: { x: hit.x, y: hit.y }, dx: world.x - hit.x, dy: world.y - hit.y, moved: false, wasSelected };
      } else {
        selectObject(null);
        gesture = { kind: 'pan', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
      }
    } else if (action === 'draw_ink') {
      if (hit && hit.type === 'webcard') { const card = webModel(hit); if (card && !card.isInkAllowed()) return; }
      if (hit && hit.type === 'pdf' && hit.failed) { /* ink on a failed card is still ours */ }
      const objectId = hit ? hit.id : null;
      const p = hit ? worldToObject(hit, world.x, world.y) : world;
      liveStroke = { points: [p], objectId, color: penColor, width: penWidth };
      gesture = { kind: 'ink', pointerId: e.pointerId };
      queueRedrawInk();
    } else if (action === 'erase_ink') {
      gesture = { kind: 'erase', pointerId: e.pointerId, ids: new Set() };
      eraseAt(world);
    } else if (action === 'place_text') {
      gesture = { kind: 'text', pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, world };
    } else {
      gesture = { kind: 'pan', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
    }
  }

  function startPinch() {
    if (liveStroke) { liveStroke = null; queueRedrawInk(); }
    const pts = [...pointers.values()].filter(p => p.type === 'touch');
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const r = viewport.getBoundingClientRect();
    const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
    gesture = { kind: 'pinch', d0: d, scale0: sg.viewport.scale, anchor: sg.screenToWorld(mid.x, mid.y) };
  }

  function eraseAt(world) {
    const r = ERASER_RADIUS_PX / sg.viewport.scale;
    let changed = false;
    for (const stroke of sg.strokes) {
      if (gesture.ids.has(stroke.id)) continue;
      const pts = strokeWorldPoints(stroke);
      if (pts && strokeNearPoint(pts, world, r + strokeWidthWorld(stroke) / 2)) {
        gesture.ids.add(stroke.id);
        changed = true;
      }
    }
    if (changed) { hiddenStrokes = new Set(gesture.ids); queueRedrawInk(); }
  }

  function onPointerMove(e) {
    const rec = pointers.get(e.pointerId);
    if (rec) { rec.x = e.clientX; rec.y = e.clientY; }
    if (!gesture) return;

    if (gesture.kind === 'pinch') {
      const pts = [...pointers.values()].filter(p => p.type === 'touch');
      if (pts.length < 2) return;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const r = viewport.getBoundingClientRect();
      const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
      const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, gesture.scale0 * d / gesture.d0));
      sg.viewport.scale = scale;
      sg.viewport.panX = mid.x - gesture.anchor.x * scale;
      sg.viewport.panY = mid.y - gesture.anchor.y * scale;
      updateView();
      return;
    }
    if (e.pointerId !== gesture.pointerId) return;

    if (gesture.kind === 'ink') {
      const world = worldPoint(e);
      const obj = liveStroke.objectId ? sg.objects.get(liveStroke.objectId) : null;
      liveStroke.points.push(obj ? worldToObject(obj, world.x, world.y) : world);
      queueRedrawInk();
    } else if (gesture.kind === 'erase') {
      eraseAt(worldPoint(e));
    } else if (gesture.kind === 'pan') {
      sg.pan(e.clientX - gesture.last.x, e.clientY - gesture.last.y);
      gesture.last = { x: e.clientX, y: e.clientY };
      updateView();
    } else if (gesture.kind === 'move') {
      const obj = sg.objects.get(gesture.id);
      const world = worldPoint(e);
      obj.x = world.x - gesture.dx;
      obj.y = world.y - gesture.dy;
      if (Math.hypot(obj.x - gesture.before.x, obj.y - gesture.before.y) * sg.viewport.scale > 3) gesture.moved = true;
      syncObject(obj);
      queueRedrawInk();
    } else if (gesture.kind === 'scale') {
      const obj = sg.objects.get(gesture.id);
      const world = worldPoint(e);
      const d = Math.hypot(world.x - obj.x, world.y - obj.y);
      obj.scale = Math.min(5, Math.max(0.2, Number((gesture.before.scale * d / gesture.d0).toFixed(3))));
      syncObject(obj);
      queueRedrawInk();
    } else if (gesture.kind === 'rotate') {
      const obj = sg.objects.get(gesture.id);
      const world = worldPoint(e);
      const a = Math.atan2(world.y - obj.y, world.x - obj.x) * 180 / Math.PI;
      let rot = gesture.before.rotation + (a - gesture.a0);
      rot = ((rot + 540) % 360) - 180;
      obj.rotation = Number(rot.toFixed(1));
      syncObject(obj);
      queueRedrawInk();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (touchCount() < 2) gesture = null;
      return;
    }
    if (e.pointerId !== gesture.pointerId) return;
    const g = gesture;
    gesture = null;

    if (g.kind === 'ink') {
      const stroke = liveStroke;
      liveStroke = null;
      if (e.type !== 'pointercancel') {
        const obj = stroke.objectId ? sg.objects.get(stroke.objectId) : null;
        if (stroke.points.length > 1) {
          sg.addStroke({ points: stroke.points, objectId: stroke.objectId || undefined, color: stroke.color, width: stroke.width / (obj ? obj.scale || 1 : 1) });
        } else {
          // a tap leaves a dot
          sg.addStroke({ points: [stroke.points[0], { x: stroke.points[0].x + 0.01, y: stroke.points[0].y }], objectId: stroke.objectId || undefined, color: stroke.color, width: stroke.width / (obj ? obj.scale || 1 : 1) });
        }
        afterChange();
      }
      redrawInk();
    } else if (g.kind === 'erase') {
      hiddenStrokes = new Set();
      if (g.ids.size) { sg.removeStrokes([...g.ids]); afterChange(); }
      redrawInk();
    } else if (g.kind === 'move' || g.kind === 'scale' || g.kind === 'rotate') {
      if (sg.commitObjectChange(g.id, g.before)) afterChange();
      if (g.kind === 'move' && !g.moved && g.wasSelected) {
        const obj = sg.objects.get(g.id);
        if (obj && (obj.type === 'sticky' || obj.type === 'text')) startEditing(g.id);
      }
    } else if (g.kind === 'text') {
      if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 8) addText(g.world);
    }
  }

  function beginHandleGesture(e, kind, obj) {
    if (gesture) return;
    const world = worldPoint(e);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (kind === 'scale') {
      gesture = { kind, pointerId: e.pointerId, id: obj.id, before: { scale: obj.scale || 1 }, d0: Math.max(1, Math.hypot(world.x - obj.x, world.y - obj.y)) };
    } else {
      gesture = { kind, pointerId: e.pointerId, id: obj.id, before: { rotation: obj.rotation || 0 }, a0: Math.atan2(world.y - obj.y, world.x - obj.x) * 180 / Math.PI };
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const p = viewPoint(e);
      sg.zoom(sg.viewport.scale * (e.deltaY < 0 ? 1.1 : 0.9), p.x, p.y);
    } else {
      sg.pan(-e.deltaX, -e.deltaY);
    }
    updateView();
  }

  // ---------- Drag & drop of materials (C2) ----------
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).some(t => t === 'Files' || t === 'text/uri-list');
  function setupDrop() {
    viewport.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop-veil').hidden = false; });
    viewport.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    viewport.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-veil').hidden = true; });
    viewport.addEventListener('drop', e => {
      e.preventDefault();
      dragDepth = 0;
      $('drop-veil').hidden = true;
      const at = worldPoint(e);
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) { handleFiles(files, { x: at.x, y: at.y }); return; }
      const uri = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#'));
      if (uri) addLinkDialog(uri.trim());
    });
  }

  // ---------- Overflow menu ----------
  function closeMenu() {
    if (overflowMenu.hidden) return;
    overflowMenu.hidden = true;
    $('btn-more').setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() {
    overflowMenu.hidden = !overflowMenu.hidden;
    $('btn-more').setAttribute('aria-expanded', String(!overflowMenu.hidden));
    if (!overflowMenu.hidden) overflowMenu.querySelector('button').focus();
  }

  async function clearBoard() {
    const ok = await confirmDialog({
      title: '¿Borrar el tablero? / Clear board?',
      body: 'Se perderán los objetos y la tinta. / Objects and ink will be lost.',
      confirmLabel: 'Borrar / Clear', danger: true
    });
    if (!ok) return;
    sg.clearBoard();
    pdfDocuments = []; webCards = [];
    proxies.clear(); thumbs.clear(); failedFiles.clear();
    rebuildAllObjects();
    updateView();
    afterChange();
    toast('Tablero borrado', 'Board cleared', 'success', 'circle-check');
  }

  async function clearInk() {
    if (!sg.strokes.length) { toast('No hay tinta en el tablero', 'No ink on the board', 'info', 'info'); return; }
    const ok = await confirmDialog({
      title: '¿Borrar la tinta? / Clear ink?',
      body: 'Los objetos se quedan; puedes deshacer. / Objects stay; you can undo.',
      confirmLabel: 'Borrar tinta / Clear ink', danger: true
    });
    if (!ok) return;
    sg.clearInk();
    redrawInk();
    afterChange();
  }

  // ---------- Persistence (C5) ----------
  function snapshot() {
    const usedPdf = new Set(), usedWeb = new Set();
    sg.objects.forEach(o => { if (o.pdfId) usedPdf.add(o.pdfId); if (o.webCardId) usedWeb.add(o.webCardId); });
    return LessonSerializer.serialize(sg, pdfDocuments.filter(d => usedPdf.has(d.id)), webCards.filter(w => usedWeb.has(w.id)));
  }

  function openLessonDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('infinite-canvas', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('lessons');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(value) {
    const db = await openLessonDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('lessons', 'readwrite');
      tx.objectStore('lessons').put(value, 'last');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }
  async function idbGet() {
    const db = await openLessonDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('lessons').objectStore('lessons').get('last');
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function saveLesson() {
    const data = snapshot();
    let stored = true;
    try { await idbPut(data); } catch (err) { stored = false; console.warn('IndexedDB save failed', err); }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `leccion-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDirty(false);
    if (stored) toast('Guardada', 'Saved', 'success', 'circle-check');
    else toast('Guardada solo como archivo: almacenamiento lleno', 'Saved as file only: storage full', 'warning', 'triangle-alert');
  }

  async function applyLesson(data) {
    app.classList.add('is-loading');
    try {
      const { pdfDocs, webCards: loadedWeb } = LessonSerializer.deserialize(data, sg);
      pdfDocuments = pdfDocs;
      webCards = loadedWeb;
      proxies.clear(); thumbs.clear(); failedFiles.clear();
      rebuildAllObjects();
      updateView();
      afterChange(false);
      setDirty(false);
      pdfDocs.forEach(renderThumb);
      toast('Lección abierta', 'Lesson opened', 'success', 'circle-check');
    } finally {
      app.classList.remove('is-loading');
    }
  }

  function loadFromText(text) {
    try {
      applyLesson(JSON.parse(text));
    } catch (err) {
      toast('No se pudo abrir la lección; se conserva la actual', 'Could not open the lesson; keeping the current one', 'error', 'triangle-alert');
    }
  }

  async function openLessonDialog() {
    let hasSaved = false;
    try { hasSaved = !!(await idbGet()); } catch (e) { hasSaved = false; }
    const hasContent = sg.objects.size > 0 || sg.strokes.length > 0;
    const dlg = showDialog({
      title: 'Abrir lección / Open lesson',
      body: h('div', { class: 'cv-stack' },
        h('p', { class: 't-body' }, hasContent
          ? biLine('Esto reemplaza el tablero actual.', 'This replaces the current board.')
          : biLine('Elige de dónde abrir la lección.', 'Choose where to open the lesson from.')),
        hasSaved ? null : h('p', { class: 'cv-note' }, 'No hay lección guardada en este equipo. / No lesson saved on this device.')),
      actions: [
        { label: 'Cancelar / Cancel', variant: 'ghost' },
        { label: 'Desde archivo / From file', variant: 'secondary', onClick: () => { $('lesson-file-input').click(); } },
        { label: 'Última guardada / Last saved', disabled: !hasSaved, onClick: async () => {
          try { await applyLesson(await idbGet()); } catch (err) { toast('No se pudo abrir la lección guardada', 'Could not open the saved lesson', 'error', 'triangle-alert'); }
        } }
      ]
    });
    return dlg;
  }

  // ---------- Settings / probe import (C8) ----------
  function showBanner(show) {
    $('c1-banner').hidden = !show;
    try { localStorage.setItem('overlayBannerSeen', show ? 'false' : 'true'); } catch (e) { /* storage blocked */ }
  }

  let probeReport = null;
  function openSettings() {
    const result = h('div', { class: 'cv-result', role: 'status', 'aria-live': 'polite', hidden: true });
    const showSwitch = h('input', { type: 'checkbox', role: 'switch', checked: !$('c1-banner').hidden,
      on: { change: e => showBanner(e.target.checked) } });
    const penBadge = h('span', { class: 'ds-badge', id: 'settings-pen-touch' });
    const refreshPen = () => {
      const l = BILINGUAL.penTouch[penTouch];
      penBadge.textContent = l.es === l.en ? l.es : `${l.es} / ${l.en}`;
      penBadge.className = `ds-badge ${penTouch === 'provisional' ? 'ds-badge--warning' : 'ds-badge--success'}`;
    };
    refreshPen();
    probeReport = null;
    showDialog({
      title: 'Ajustes / Settings',
      body: h('div', { class: 'cv-stack' },
        h('div', { class: 'cv-row' }, h('strong', { text: 'Idioma / Language' }), h('span', { text: 'ES + EN siempre / always' })),
        h('div', { class: 'cv-row' }, h('strong', { text: 'Puntero / Pointer' }), penBadge),
        h('p', { class: 'cv-note' }, 'Lápiz = tinta, dedo = mover; provisional hasta importar un JSON completo del GX. / Pen = ink, finger = pan; provisional until a complete GX JSON is imported.'),
        h('div', { class: 'cv-stack' },
          h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--board', on: { click: () => $('probe-file-input').click() } },
            icon('upload'), 'Importar JSON del probe / Import probe JSON'),
          result),
        h('label', { class: 'ds-switch' }, showSwitch, h('span', { class: 'ds-switch__track' }), bi('Mostrar aviso Overlay', 'Show Overlay notice'))),
      actions: [{ label: 'Cerrar / Close', variant: 'secondary' }]
    });
    probeReport = (message, tone, missing) => {
      result.hidden = false;
      result.replaceChildren(
        h('span', { class: `ds-badge ds-badge--${tone}`, text: tone === 'success' ? 'ok' : tone === 'error' ? 'no' : 'aviso / notice' }),
        h('span', { class: 'cv-bi-stack' }, h('span', { lang: 'es', text: message.es }), h('span', { lang: 'en', text: message.en })),
        missing && missing.length ? h('span', { class: 'cv-tags' }, missing.map(m => h('span', { class: 'ds-tag', text: m }))) : null);
      refreshPen();
    };
  }

  function importProbe(text) {
    const report = probeReport || (() => {});
    let payload;
    try { payload = JSON.parse(text); } catch (e) { report(BILINGUAL.probe.invalid, 'error'); return; }
    const info = ProbeGate.inspect(payload);
    if (!info.valid || typeof payload !== 'object') { report(BILINGUAL.probe.invalid, 'error'); return; }

    penTouch = 'provisional';
    wdkUnlocked = false;
    if (!info.isGx) report(BILINGUAL.probe.notGx, 'error');
    else if (!info.complete) report(BILINGUAL.probe.incomplete, 'warning', info.missing);
    else {
      penTouch = info.penTouch;
      wdkUnlocked = info.wdk;
      report(info.wdk ? BILINGUAL.probe.unlocked : BILINGUAL.probe.completeNoSb, 'success');
    }
    updateStatus();
  }

  // ---------- C3 PDF book viewer ----------
  const V = { doc: null, proxy: null, zoom: 1, tool: 'pen', cssScale: 1, token: 0, renderTask: null, lastGood: 1, gesture: null, live: null, hidden: new Set(), busyBack: false };
  const pdfEl = $('pdf-viewer-overlay');
  const pdfStage = $('pdf-stage');
  const pdfPage = $('pdf-page-container');
  const pdfCanvas = $('pdf-page-canvas');
  const pdfInk = $('pdf-ink-canvas');
  const pdfInkCtx = pdfInk.getContext('2d');
  const pdfMsg = $('pdf-msg');

  function getProxy(doc) {
    if (!proxies.has(doc.id)) {
      if (!doc.bytes || !window.pdfjsLib) return Promise.reject(new Error('no pdf bytes'));
      proxies.set(doc.id, window.pdfjsLib.getDocument({ data: doc.bytes.slice(), isEvalSupported: false }).promise);
    }
    return proxies.get(doc.id);
  }

  async function openViewer(pdfId) {
    const doc = pdfDocuments.find(d => d.id === pdfId);
    if (!doc) return;
    let proxy;
    try { proxy = await getProxy(doc); } catch (err) {
      proxies.delete(doc.id);
      toast('No se pudo abrir el libro', 'Could not open the book', 'error', 'triangle-alert');
      return;
    }
    V.doc = doc; V.proxy = proxy; V.zoom = 1; V.lastGood = doc.currentPage; V.busyBack = false;
    $('pdf-viewer-title').textContent = doc.title;
    $('pdf-total-pages').textContent = String(doc.pageCount);
    pdfEl.hidden = false;
    setViewerTool(V.tool);
    $('btn-pdf-close').focus();
    renderPdfPage();
  }

  function closeViewer() {
    if (!V.doc) return;
    const doc = V.doc;
    updateThumbFromViewer(doc);
    V.token++;
    if (V.renderTask) { try { V.renderTask.cancel(); } catch (e) { /* done */ } }
    V.doc = null; V.proxy = null; V.gesture = null; V.live = null;
    pdfEl.hidden = true;
    for (const obj of sg.objects.values()) if (obj.pdfId === doc.id) refreshObject(obj.id);
    redrawInk();
  }

  function setViewerTool(tool) {
    V.tool = tool;
    pdfEl.dataset.tool = tool;
    pdfEl.querySelectorAll('[data-pdf-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pdfTool === tool)));
  }

  function updateViewerStatus() {
    if (!V.doc) return;
    const n = V.doc.currentPage;
    $('pdf-status-text').textContent = `tinta en la página ${n} · ink on page ${n} · zoom ${Math.round(V.zoom * 100)}%`;
    $('btn-pdf-undo').disabled = !V.doc.canUndoPage(n);
    $('btn-pdf-redo').disabled = !V.doc.canRedoPage(n);
    $('btn-pdf-prev').disabled = n <= 1;
    $('btn-pdf-next').disabled = n >= V.doc.pageCount;
  }

  function showPdfMessage(es, en) {
    pdfMsg.hidden = false;
    pdfMsg.replaceChildren(h('span', { class: 'cv-bi-stack' }, h('span', { lang: 'es', text: es }), h('span', { lang: 'en', text: en })));
  }

  async function renderPdfPage() {
    const doc = V.doc;
    if (!doc) return;
    const n = doc.currentPage;
    const token = ++V.token;
    $('pdf-page-input').value = String(n);
    updateViewerStatus();
    showPdfMessage(`cargando p.${n}`, `loading p.${n}`);
    try {
      const page = await V.proxy.getPage(n);
      if (token !== V.token) return;
      const base = page.getViewport({ scale: 1 });
      const availW = Math.max(100, pdfStage.clientWidth - 32);
      const availH = Math.max(100, pdfStage.clientHeight - 32);
      const fit = Math.min(availW / base.width, availH / base.height);
      V.cssScale = fit * V.zoom;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: V.cssScale * dpr });
      pdfPage.style.setProperty('--pw', `${base.width * V.cssScale}px`);
      pdfPage.style.setProperty('--ph', `${base.height * V.cssScale}px`);
      pdfCanvas.width = pdfInk.width = Math.floor(vp.width);
      pdfCanvas.height = pdfInk.height = Math.floor(vp.height);
      if (V.renderTask) { try { V.renderTask.cancel(); } catch (e) { /* done */ } }
      V.renderTask = page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp });
      await V.renderTask.promise;
      if (token !== V.token) return;
      pdfMsg.hidden = true;
      V.lastGood = n;
      redrawPdfInk();
    } catch (err) {
      if (token !== V.token || (err && err.name === 'RenderingCancelledException')) return;
      console.error('PDF page failed', err);
      toast(`No se pudo abrir la página ${n}`, `Could not open page ${n}`, 'error', 'triangle-alert');
      if (V.lastGood !== n) { doc.currentPage = V.lastGood; renderPdfPage(); }
      else showPdfMessage(`No se pudo abrir la página ${n}`, `Could not open page ${n}`);
    }
  }

  function goToPdfPage(n) {
    if (!V.doc || !V.doc.goToPage(n)) { $('pdf-page-input').value = String(V.doc ? V.doc.currentPage : 1); return; }
    renderPdfPage();
  }

  function redrawPdfInk() {
    if (!V.doc) return;
    const dpr = window.devicePixelRatio || 1;
    const k = V.cssScale * dpr;
    pdfInkCtx.setTransform(k, 0, 0, k, 0, 0);
    pdfInkCtx.clearRect(0, 0, pdfInk.width / k, pdfInk.height / k);
    const color = inkColor();
    for (const s of V.doc.getStrokes(V.doc.currentPage)) {
      if (V.hidden.has(s.id) || !s.points.length) continue;
      drawPolyline(pdfInkCtx, s.points, s.color || color, s.width);
    }
    if (V.live && V.live.length) drawPolyline(pdfInkCtx, V.live, penColor, penWidth);
  }

  const pagePoint = e => {
    const r = pdfInk.getBoundingClientRect();
    return { x: (e.clientX - r.left) / V.cssScale, y: (e.clientY - r.top) / V.cssScale };
  };

  function onPdfPointerDown(e) {
    if (!V.doc || V.gesture) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    let action = routePointerAction(e, V.tool);
    if (V.tool === 'select' && action === 'draw_ink') action = 'pan_canvas';
    if (action === 'select_object') action = 'pan_canvas';
    const onPage = e.target === pdfInk;
    if (action === 'draw_ink' && onPage) {
      V.live = [pagePoint(e)];
      V.gesture = { kind: 'ink', pointerId: e.pointerId };
    } else if (action === 'erase_ink' && onPage) {
      V.gesture = { kind: 'erase', pointerId: e.pointerId, ids: new Set() };
      pdfErase(pagePoint(e));
    } else {
      V.gesture = { kind: 'pan', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
    }
  }

  function pdfErase(p) {
    const r = ERASER_RADIUS_PX / V.cssScale;
    let changed = false;
    for (const s of V.doc.getStrokes(V.doc.currentPage)) {
      if (V.gesture.ids.has(s.id)) continue;
      if (strokeNearPoint(s.points, p, r + s.width / 2)) { V.gesture.ids.add(s.id); changed = true; }
    }
    if (changed) { V.hidden = new Set(V.gesture.ids); redrawPdfInk(); }
  }

  function onPdfPointerMove(e) {
    const g = V.gesture;
    if (!g || e.pointerId !== g.pointerId || !V.doc) return;
    if (g.kind === 'ink') { V.live.push(pagePoint(e)); redrawPdfInk(); }
    else if (g.kind === 'erase') pdfErase(pagePoint(e));
    else if (g.kind === 'pan') {
      pdfStage.scrollLeft -= e.clientX - g.last.x;
      pdfStage.scrollTop -= e.clientY - g.last.y;
      g.last = { x: e.clientX, y: e.clientY };
    }
  }

  function onPdfPointerUp(e) {
    const g = V.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    V.gesture = null;
    if (!V.doc) return;
    const n = V.doc.currentPage;
    if (g.kind === 'ink') {
      const pts = V.live;
      V.live = null;
      if (e.type !== 'pointercancel') {
        const points = pts.length > 1 ? pts : [pts[0], { x: pts[0].x + 0.01, y: pts[0].y }];
        V.doc.addPageStroke(n, { points, color: penColor, width: penWidth });
        setDirty(true);
      }
    } else if (g.kind === 'erase') {
      V.hidden = new Set();
      if (g.ids.size) { V.doc.removePageStrokes(n, [...g.ids]); setDirty(true); }
    }
    redrawPdfInk();
    updateViewerStatus();
  }

  function pdfHistory(dir) {
    if (!V.doc) return;
    const n = V.doc.currentPage;
    if (dir < 0 ? V.doc.undoPage(n) : V.doc.redoPage(n)) { setDirty(true); redrawPdfInk(); updateViewerStatus(); }
  }

  async function pdfClearPage() {
    if (!V.doc) return;
    const n = V.doc.currentPage;
    if (!V.doc.getStrokes(n).length) { toast('La página no tiene tinta', 'This page has no ink', 'info', 'info'); return; }
    const ok = await confirmDialog({
      title: `¿Borrar la tinta de la página ${n}? / Clear ink on page ${n}?`,
      body: 'Solo esta página; puedes deshacer. / This page only; you can undo.',
      confirmLabel: 'Borrar página / Clear page', danger: true
    });
    if (!ok || !V.doc) return;
    V.doc.clearPage(n);
    setDirty(true);
    redrawPdfInk();
    updateViewerStatus();
  }

  function pdfZoom(delta) {
    V.zoom = delta === 0 ? 1 : Math.min(3, Math.max(0.5, Number((V.zoom + delta).toFixed(2))));
    renderPdfPage();
  }

  // Thumbnail of the board card: last viewed page plus its ink, drawn from the viewer canvases.
  function updateThumbFromViewer(doc) {
    if (pdfCanvas.width < 2 || pdfMsg.hidden === false) return;
    const t = document.createElement('canvas');
    t.width = 320;
    t.height = Math.round(320 * pdfCanvas.height / pdfCanvas.width);
    const ctx = t.getContext('2d');
    ctx.drawImage(pdfCanvas, 0, 0, t.width, t.height);
    ctx.drawImage(pdfInk, 0, 0, t.width, t.height);
    thumbs.set(doc.id, t.toDataURL('image/jpeg', 0.8));
  }

  async function renderThumb(doc) {
    try {
      const proxy = await getProxy(doc);
      const page = await proxy.getPage(doc.currentPage);
      const base = page.getViewport({ scale: 1 });
      const k = 320 / base.width;
      const vp = page.getViewport({ scale: k });
      const t = document.createElement('canvas');
      t.width = Math.floor(vp.width);
      t.height = Math.floor(vp.height);
      const ctx = t.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const color = inkColor();
      for (const s of doc.getStrokes(doc.currentPage)) if (s.points.length) drawPolyline(ctx, s.points, s.color || color, s.width);
      thumbs.set(doc.id, t.toDataURL('image/jpeg', 0.8));
      for (const obj of sg.objects.values()) if (obj.pdfId === doc.id) refreshObject(obj.id);
    } catch (err) {
      console.warn('Thumbnail failed', err);
    }
  }

  // ---------- Wiring ----------
  function fillBilingualCopy() {
    document.querySelectorAll('[data-bi]').forEach(el => {
      el.textContent = el.dataset.bi.split('.').reduce((o, k) => o[k], BILINGUAL);
    });
  }

  function beginZoomEdit() {
    zoomInput.value = String(Math.round(sg.viewport.scale * 100));
    zoomDisplay.hidden = true;
    zoomInput.hidden = false;
    zoomInput.focus();
    zoomInput.select();
  }
  function endZoomEdit(apply) {
    if (zoomInput.hidden) return;
    const v = parseInt(zoomInput.value, 10);
    zoomInput.hidden = true;
    zoomDisplay.hidden = false;
    if (apply && Number.isFinite(v)) {
      const { w, h: vh } = viewSize();
      sg.zoom(Math.min(SCALE_MAX * 100, Math.max(SCALE_MIN * 100, v)) / 100, w / 2, vh / 2);
      updateView();
    }
  }

  function setupEvents() {
    // C1 banner
    $('btn-dismiss-banner').addEventListener('click', () => showBanner(false));
    $('btn-banner-toggle').addEventListener('click', () => {
      const open = $('c1-banner').classList.toggle('is-open');
      $('btn-banner-toggle').setAttribute('aria-expanded', String(open));
    });

    // Tools and add actions
    document.querySelectorAll('.cv-chrome [data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    document.querySelectorAll('.cv-chrome [data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'add-sticky') addSticky();
      else if (act === 'add-pdf') $('pdf-file-input').click();
      else if (act === 'add-image') $('image-file-input').click();
      else if (act === 'add-link') addLinkDialog();
    }));
    $('pdf-file-input').addEventListener('change', e => { handleFiles(Array.from(e.target.files)); e.target.value = ''; });
    $('image-file-input').addEventListener('change', e => { handleFiles(Array.from(e.target.files)); e.target.value = ''; });

    // Overlay chip (AC9) — honor-system, cycles ? → ON → OFF → ?
    document.querySelectorAll('[data-overlay-chip]').forEach(c => c.addEventListener('click', () => { overlayChip.cycle(); updateStatus(); }));

    // Zoom (AC3) and history
    $('btn-zoom-in').addEventListener('click', () => zoomBy(1));
    $('btn-zoom-out').addEventListener('click', () => zoomBy(-1));
    $('btn-fit').addEventListener('click', fitView);
    zoomDisplay.addEventListener('click', beginZoomEdit);
    zoomInput.addEventListener('keydown', e => { if (e.key === 'Enter') endZoomEdit(true); else if (e.key === 'Escape') { e.stopPropagation(); endZoomEdit(false); } });
    zoomInput.addEventListener('blur', () => endZoomEdit(false));
    $('btn-undo').addEventListener('click', () => { if (sg.undo()) { reconcileObjects(); redrawInk(); afterChange(); } });
    $('btn-redo').addEventListener('click', () => { if (sg.redo()) { reconcileObjects(); redrawInk(); afterChange(); } });

    // Clear ink (toolbar) / save / open (More menu)
    $('btn-clear-ink').addEventListener('click', clearInk);
    $('btn-add-webcard').addEventListener('click', addWebCardDialog);
    $('menu-save').addEventListener('click', () => { closeMenu(); saveLesson(); });
    $('menu-open').addEventListener('click', () => { closeMenu(); openLessonDialog(); });
    $('lesson-file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) file.text().then(loadFromText);
    });

    // Overflow menu
    $('btn-more').addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
    overflowMenu.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', closeMenu);
    $('menu-clear-board').addEventListener('click', () => { closeMenu(); clearBoard(); });
    $('menu-settings').addEventListener('click', () => { closeMenu(); openSettings(); });
    $('probe-file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) file.text().then(importProbe);
    });

    // Board pointers
    viewport.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    setupDrop();
    window.addEventListener('resize', () => { sizeInkCanvas(); if (V.doc) renderPdfPage(); });

    // PDF viewer
    $('btn-pdf-close').addEventListener('click', closeViewer);
    $('btn-pdf-prev').addEventListener('click', () => { if (V.doc && V.doc.prevPage()) renderPdfPage(); });
    $('btn-pdf-next').addEventListener('click', () => { if (V.doc && V.doc.nextPage()) renderPdfPage(); });
    $('pdf-page-input').addEventListener('change', e => goToPdfPage(parseInt(e.target.value, 10)));
    $('pdf-page-input').addEventListener('keydown', e => { if (e.key === 'Enter') goToPdfPage(parseInt(e.target.value, 10)); });
    $('btn-pdf-zoom-in').addEventListener('click', () => pdfZoom(0.25));
    $('btn-pdf-zoom-out').addEventListener('click', () => pdfZoom(-0.25));
    $('btn-pdf-fit').addEventListener('click', () => pdfZoom(0));
    pdfEl.querySelectorAll('[data-pdf-tool]').forEach(b => b.addEventListener('click', () => setViewerTool(b.dataset.pdfTool)));
    $('btn-pdf-undo').addEventListener('click', () => pdfHistory(-1));
    $('btn-pdf-redo').addEventListener('click', () => pdfHistory(1));
    $('btn-pdf-clear').addEventListener('click', pdfClearPage);
    pdfStage.addEventListener('pointerdown', onPdfPointerDown);
    window.addEventListener('pointermove', onPdfPointerMove);
    window.addEventListener('pointerup', onPdfPointerUp);
    window.addEventListener('pointercancel', onPdfPointerUp);

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!dialogHost.hidden) closeDialog();
        else if (!overflowMenu.hidden) closeMenu();
        else if (!pdfEl.hidden) closeViewer();
        return;
      }
      const typing = e.target.closest('input, textarea');
      if (typing || !dialogHost.hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (!pdfEl.hidden) pdfHistory(e.shiftKey ? 1 : -1); else (e.shiftKey ? $('btn-redo') : $('btn-undo')).click();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sg.selectedObjectId && pdfEl.hidden) {
        e.preventDefault();
        deleteObject(sg.selectedObjectId);
      }
    });
  }

  function init() {
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    fillBilingualCopy();
    let seen = false;
    try { seen = localStorage.getItem('overlayBannerSeen') === 'true'; } catch (e) { seen = false; }
    $('c1-banner').hidden = seen;
    buildPenOptions();
    setupEvents();
    sizeInkCanvas();
    setTool('pen');
    updateView();
    afterChange(false);
    updateStatus();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
