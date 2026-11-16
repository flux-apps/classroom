// tests/canvas-rails.test.js — AC17 / AC18 / AC19: side-rail chrome, focus mode, Tarjeta web full-screen.
// RED-FIRST: written before the build (tech-plan §4-§7). Each test names the missing symbol or markup
// it waits on, so a red run means "not built yet", never a typo.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../canvas/canvas-core.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'canvas', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'canvas', 'app.js'), 'utf8');

const need = (name) =>
  assert.equal(typeof core[name], 'function', `canvas-core.${name} not built yet (tech-plan §4)`);

// Minimal balanced-tag slicer: the element whose opening tag contains `needle`.
function sliceElement(src, needle) {
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const open = src.lastIndexOf('<', at);
  const tag = /^<([a-zA-Z0-9]+)/.exec(src.slice(open))[1];
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
  re.lastIndex = open;
  let depth = 0;
  let m;
  while ((m = re.exec(src))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return src.slice(open, re.lastIndex);
  }
  return src.slice(open);
}
const rail = (root, side) => (root ? sliceElement(root, `data-rail="${side}"`) : null);
const has = (frag, ...needles) => {
  assert.ok(frag, 'element not found');
  needles.forEach((n) => assert.ok(frag.includes(n), `missing ${n}`));
};
const mkStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('railMetrics (UX §5 responsive table)', () => {
  it('picks rail width / target / labels per viewport band, boundaries inclusive', () => {
    need('railMetrics');
    const m = core.railMetrics;
    assert.deepEqual([m(1920).rail, m(1920).target, m(1920).labels], [96, 72, 'icon+es+en']);
    assert.deepEqual([m(1600).rail, m(1600).target], [96, 72]);
    assert.deepEqual([m(1599).rail, m(1599).target, m(1599).labels], [88, 64, 'icon+es+en']);
    assert.deepEqual([m(1280).rail, m(1280).target], [88, 64]);
    assert.deepEqual([m(1279).rail, m(1279).target, m(1279).labels], [64, 56, 'icon']);
    assert.deepEqual([m(800).rail, m(800).target], [64, 56]);
    assert.equal(m(799).mode, 'compact');
    assert.equal(m(799).target, 48);
    assert.equal(m(1920).mode, 'rails');
  });

  it('targets >= 56 px for v1 widths (>= 800); edge tabs 24x72 with >= 56 px hit area', () => {
    need('railMetrics');
    for (const w of [800, 1024, 1279, 1280, 1366, 1599, 1600, 1920, 2560]) {
      assert.ok(core.railMetrics(w).target >= 56, `target at ${w}`);
    }
    const t = core.railMetrics(1920).edgeTab;
    assert.deepEqual([t.w, t.h], [24, 72]);
    assert.ok(t.hit >= 56);
  });
});

describe('AC17 pdfFitScale: chrome never costs vertical space', () => {
  const A4 = { pageW: 595, pageH: 842 };

  it('1920x1080 and 1280x720: portrait page fits to viewport height - 32 (expanded and focus)', () => {
    need('pdfFitScale');
    for (const [viewW, viewH] of [[1920, 1080], [1280, 720]]) {
      for (const focus of [false, true]) {
        const s = core.pdfFitScale({ viewW, viewH, ...A4, spread: 1, focus });
        assert.ok(A4.pageH * s >= viewH - 32 - 1e-9, `${viewW}x${viewH} focus=${focus}: page h ${A4.pageH * s}`);
        assert.ok(A4.pageH * s <= viewH - 32 + 1e-9, 'never taller than the stage');
      }
    }
  });

  it('fit has no chrome-height term (a bar/tools/footer height input changes nothing)', () => {
    need('pdfFitScale');
    const a = core.pdfFitScale({ viewW: 1920, viewH: 1080, ...A4, spread: 1, focus: false });
    const b = core.pdfFitScale({ viewW: 1920, viewH: 1080, ...A4, spread: 1, focus: false, chromeH: 250 });
    assert.equal(a, b);
  });

  it('width-limited spread: expanded insets 2x(rail+16), focus insets 2x16; focus gains exactly 2x rail', () => {
    need('pdfFitScale');
    const land = { pageW: 842, pageH: 595 };
    const ex = core.pdfFitScale({ viewW: 1280, viewH: 720, ...land, spread: 2, focus: false });
    const fo = core.pdfFitScale({ viewW: 1280, viewH: 720, ...land, spread: 2, focus: true });
    const gap = 16;
    assert.ok(Math.abs(ex - (1280 - 2 * (88 + 16) - gap) / (2 * 842)) < 1e-9);
    assert.ok(Math.abs(fo - (1280 - 2 * 16 - gap) / (2 * 842)) < 1e-9);
    assert.ok(Math.abs((fo - ex) * 2 * 842 - 2 * 88) < 1e-9);
  });
});

describe('AC17/AC19 RailState: focus mode, in-stroke dim, session persistence', () => {
  it('focus toggles, persists per session (storage), is not in the lesson file, survives blocked storage', () => {
    need('RailState');
    const store = mkStore();
    const rs = new core.RailState({ storage: store });
    assert.equal(rs.focus, false);
    assert.equal(rs.toggleFocus().focus, true);
    assert.equal(new core.RailState({ storage: store }).focus, true);
    const lesson = core.LessonSerializer.serialize(new core.SceneGraph(), [], []);
    assert.ok(!JSON.stringify(lesson).toLowerCase().includes('focus'));
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.doesNotThrow(() => new core.RailState({ storage: blocked }).toggleFocus());
  });

  it('toggling focus re-fits only while the view is still in fit state; manual zoom is kept', () => {
    need('RailState');
    const rs = new core.RailState({ storage: mkStore() });
    rs.setFit(true);
    assert.equal(rs.toggleFocus().refit, true);
    rs.setFit(false);
    assert.equal(rs.toggleFocus().refit, false);
  });

  it('in-stroke: rails drop to 30% and ignore pointers, no layout shift; pointercancel releases', () => {
    need('RailState');
    const rs = new core.RailState({ storage: mkStore() });
    assert.deepEqual(rs.chromeState(), { opacity: 1, pointerEvents: 'auto', layoutShift: 0 });
    rs.beginStroke();
    assert.deepEqual(rs.chromeState(), { opacity: 0.3, pointerEvents: 'none', layoutShift: 0 });
    rs.endStroke();
    assert.equal(rs.chromeState().opacity, 1);
    rs.beginStroke();
    rs.cancelStroke();
    assert.equal(rs.chromeState().pointerEvents, 'auto');
  });
});

describe('AC16/AC18 Interact fence', () => {
  it('isInteractAllowed refuses blinklearning.com and subdomains, not look-alikes; bad URLs refused', () => {
    need('isInteractAllowed');
    const f = core.isInteractAllowed;
    assert.equal(f('https://www.blinklearning.com/v/123'), false);
    assert.equal(f('https://blinklearning.com/'), false);
    assert.equal(f('https://BLINKLEARNING.COM/x'), false);
    assert.equal(f('https://es.wikipedia.org/wiki/Gato'), true);
    assert.equal(f('https://notblinklearning.com/'), true);
    assert.equal(f('https://blinklearning.com.example.org/'), true);
    assert.equal(f('not a url'), false);
    assert.equal(f(''), false);
  });

  it('WebCard Interact throws for Blink hosts (card and full-screen); Frozen stays allowed', () => {
    need('isInteractAllowed');
    const blink = new core.WebCard('https://www.blinklearning.com/v/9', 'Tarjeta');
    assert.throws(() => blink.setMode('interact'), /Interact is not allowed/);
    assert.throws(() => blink.toggleMode(), /Interact is not allowed/);
    assert.equal(blink.mode, 'frozen');
    assert.equal(blink.isInkAllowed(), true);
    const ok = new core.WebCard('https://es.wikipedia.org', 'Wikipedia');
    assert.equal(ok.setMode('interact'), 'interact');
  });
});

describe('AC18 WebViewer: Tarjeta web full-screen', () => {
  const mk = (url = 'https://es.wikipedia.org/wiki/Gato') => {
    const sg = new core.SceneGraph();
    const card = new core.WebCard(url, 'Wikipedia');
    return { sg, card, viewer: new core.WebViewer(sg) };
  };

  it('opens only on an explicit user action, never on drop or auto', () => {
    need('WebViewer');
    const { viewer, card } = mk();
    assert.throws(() => viewer.open(card), /explicit/i);
    assert.throws(() => viewer.open(card, { explicit: false }), /explicit/i);
    assert.equal(viewer.isOpen, false);
    viewer.open(card, { explicit: true });
    assert.equal(viewer.isOpen, true);
  });

  it('dialog label is Tarjeta web / Web page with the host, never Libro / Book', () => {
    need('WebViewer');
    const { viewer, card } = mk();
    viewer.open(card, { explicit: true });
    assert.equal(viewer.ariaLabel, 'Tarjeta web: es.wikipedia.org / Web page: es.wikipedia.org');
    const strings = JSON.stringify(core.BILINGUAL.webViewer);
    assert.ok(strings.includes('Pantalla completa') && strings.includes('Full screen'));
    assert.ok(!/libro|book/i.test(strings), 'viewer strings must not say book');
    assert.ok(!/libro|book/i.test(viewer.ariaLabel));
  });

  it('closing restores the exact board camera; the viewer owns no second camera', () => {
    need('WebViewer');
    const { sg, viewer, card } = mk();
    sg.pan(120, 80);
    sg.zoom(1.5);
    const snap = { ...sg.viewport };
    viewer.open(card, { explicit: true });
    assert.deepEqual({ ...sg.viewport }, snap, 'opening must not move the board camera');
    sg.pan(5, 5);
    viewer.close();
    assert.deepEqual({ ...sg.viewport }, snap);
    assert.equal(viewer.isOpen, false);
  });

  it('Frozen: ink on, iframe inert. Interact: ink paused, iframe live. One at a time (AC15)', () => {
    need('WebViewer');
    const { viewer, card } = mk();
    viewer.open(card, { explicit: true });
    assert.deepEqual(viewer.layers(), { iframePointerEvents: 'none', inkPointerEvents: 'auto' });
    viewer.setMode('interact');
    assert.deepEqual(viewer.layers(), { iframePointerEvents: 'auto', inkPointerEvents: 'none' });
    assert.throws(() => viewer.addStroke({ points: [{ x: 0.1, y: 0.1 }] }), /Cannot draw while in Interact mode/);
    assert.equal(card.strokes.length, 0);
    viewer.setMode('frozen');
    assert.equal(viewer.layers().inkPointerEvents, 'auto');
    viewer.addStroke({ points: [{ x: 0.1, y: 0.1 }] });
    assert.equal(card.strokes.length, 1);
  });

  it('Interact control is disabled for Blink hosts (Frozen only)', () => {
    need('WebViewer');
    const b = mk('https://www.blinklearning.com/v/9');
    b.viewer.open(b.card, { explicit: true });
    assert.deepEqual(b.viewer.modeControls(), { frozen: { enabled: true }, interact: { enabled: false } });
    assert.throws(() => b.viewer.setMode('interact'), /Interact is not allowed/);
    const ok = mk();
    ok.viewer.open(ok.card, { explicit: true });
    assert.equal(ok.viewer.modeControls().interact.enabled, true);
  });

  it('frame-space helpers: full-screen ink lands on the same card point at any resolution', () => {
    need('toFrameSpace');
    need('fromFrameSpace');
    const full = { w: 1600, h: 900 };
    const small = { w: 400, h: 225 };
    const p = { x: 800, y: 450 };
    assert.deepEqual(core.toFrameSpace(p, full), { x: 0.5, y: 0.5 });
    assert.deepEqual(core.fromFrameSpace(core.toFrameSpace(p, full), small), { x: 200, y: 112.5 });
  });
});

describe('AC17 markup: PDF viewer has rails, no horizontal bands', () => {
  const pdf = sliceElement(html, 'id="pdf-viewer-overlay"');

  it('bar / tools row / status footer / seg are gone', () => {
    assert.ok(pdf, 'pdf overlay present');
    for (const gone of ['cv-pdf__bar', 'cv-pdf__tools', 'cv-pdf__status', 'cv-pdf__seg']) {
      assert.ok(!pdf.includes(gone), `${gone} must be removed (AC17)`);
    }
  });

  it('left rail: back, tools, undo/redo, clear, Overlay chip; right rail: menu, nav, zoom, focus', () => {
    has(rail(pdf, 'left'), 'role="toolbar"', 'btn-pdf-close', 'data-pdf-tool="select"', 'data-pdf-tool="pen"', 'data-pdf-tool="eraser"', 'btn-pdf-undo', 'btn-pdf-redo', 'btn-pdf-clear', 'data-overlay-chip');
    has(rail(pdf, 'right'), 'role="toolbar"', 'aria-haspopup="menu"', 'btn-pdf-prev', 'pdf-page-input', 'btn-pdf-next', 'btn-pdf-zoom-out', 'btn-pdf-zoom-in', 'btn-pdf-fit', 'data-act="focus-toggle"');
  });

  it('⋮ menu holds title, 1/2-page view, status text, close-book; two edge tabs with ES / EN labels', () => {
    has(sliceElement(pdf, 'id="pdf-menu"'), 'pdf-viewer-title', 'btn-pdf-view-1', 'btn-pdf-view-2', 'pdf-status-text', 'btn-pdf-close-book');
    assert.equal((pdf.match(/data-edge-tab="(left|right)"/g) || []).length, 2);
    assert.ok(/data-edge-tab="left"[^>]*aria-label="[^"]*\/[^"]*"/.test(pdf), 'edge tab aria-label is ES / EN');
  });

  it('PDF path has no iframe and no Blink host literal anywhere outside canvas-core (AC8)', () => {
    assert.ok(!pdf.includes('<iframe'));
    assert.ok(!/blinklearning/i.test(html) && !/blinklearning/i.test(appSrc));
  });
});

describe('AC19 markup: main board rails replace the floating docks', () => {
  const board = sliceElement(html, 'id="board"');

  it('no horizontal docks over the board (cv-chrome removed)', () => {
    assert.ok(!board.includes('cv-chrome'), 'floating docks must be replaced by rails');
  });

  it('left rail: select/pen/eraser/text, sticky/image/pdf/link/web card, Overlay chip', () => {
    has(rail(board, 'left'), 'role="toolbar"', 'data-tool="select"', 'data-tool="pen"', 'data-tool="eraser"', 'data-tool="text"', 'data-act="add-sticky"', 'data-act="add-image"', 'data-act="add-pdf"', 'data-act="add-link"', 'btn-add-webcard', 'chip-overlay');
  });

  it('right rail: undo/redo, zoom, fit, clear ink, ⋮ menu, focus toggle', () => {
    has(rail(board, 'right'), 'role="toolbar"', 'btn-undo', 'btn-redo', 'btn-zoom-out', 'zoom-display', 'btn-zoom-in', 'btn-fit', 'btn-clear-ink', 'btn-more', 'aria-haspopup="menu"', 'data-act="focus-toggle"');
  });

  it('every rail button is bilingual (ES / EN) and two edge tabs exist', () => {
    for (const side of ['left', 'right']) {
      const frag = rail(board, side);
      assert.ok(frag, `${side} rail present`);
      const bare = (frag.match(/<button\b[^>]*>/g) || []).filter((b) => !/(aria-label|title)="[^"]*\/[^"]*"/.test(b));
      assert.deepEqual(bare, [], 'each button needs a bilingual title or aria-label');
    }
    assert.equal((board.match(/data-edge-tab="(left|right)"/g) || []).length, 2);
  });
});

describe('AC18 markup: web full-screen viewer', () => {
  const web = sliceElement(html, 'id="web-viewer-overlay"');

  it('is a hidden modal dialog labelled Tarjeta web / Web page, never Libro / Book', () => {
    assert.ok(web, '#web-viewer-overlay present');
    const open = web.slice(0, web.indexOf('>') + 1);
    has(open, 'role="dialog"', 'aria-modal="true"', 'hidden');
    assert.ok(/aria-label="Tarjeta web[^"]*Web page/.test(open));
    assert.ok(!/libro|book/i.test(open));
  });

  it('left rail: back, tools, undo/redo, clear, Overlay chip; right rail: menu, Frozen|Interact radiogroup, zoom, fit, focus', () => {
    has(rail(web, 'left'), 'role="toolbar"', 'btn-web-close', 'data-web-tool="select"', 'data-web-tool="pen"', 'data-web-tool="eraser"', 'btn-web-undo', 'btn-web-redo', 'btn-web-clear', 'data-overlay-chip');
    has(rail(web, 'right'), 'role="toolbar"', 'aria-haspopup="menu"', 'role="radiogroup"', 'data-web-mode="frozen"', 'data-web-mode="interact"', 'btn-web-zoom-out', 'btn-web-zoom-in', 'btn-web-fit', 'data-act="focus-toggle"');
    has(sliceElement(web, 'id="web-menu"'), 'btn-web-open-tab', 'btn-web-reload', 'btn-web-close-menu');
  });

  it('card header has an explicit «Pantalla completa / Full screen» action in app.js', () => {
    assert.ok(appSrc.includes('Pantalla completa') && appSrc.includes('Full screen'));
    assert.ok(appSrc.includes('web-fullscreen'));
  });
});
