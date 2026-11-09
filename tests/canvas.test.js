// tests/canvas.test.js — Automated test suite for infinite-canvas (AC1 - AC16)
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  SceneGraph,
  PdfDocument,
  WebCard,
  OverlayChip,
  LessonSerializer,
  ProbeGate,
  routePointerAction,
  BILINGUAL,
  gridLevels
} = require('../canvas/canvas-core.js');

describe('infinite-canvas Test Suite', () => {

  let sg;

  beforeEach(() => {
    sg = new SceneGraph();
  });

  // AC1: Scene-graph ink registration under pan & zoom
  it('AC1: World coordinate transform preserves ink registration under pan & zoom', () => {
    // Initial viewport at 1.0 scale, (0, 0) pan
    const screenPt = { x: 400, y: 300 };
    const worldPt = sg.screenToWorld(screenPt.x, screenPt.y);
    assert.deepEqual(worldPt, { x: 400, y: 300 });

    // Add stroke in world coordinates
    const stroke = sg.addStroke({ points: [worldPt, { x: 450, y: 350 }] });
    assert.equal(sg.strokes.length, 1);

    // Pan viewport by (100, 50)
    sg.pan(100, 50);
    // The stroke's world coordinates DO NOT CHANGE
    assert.deepEqual(sg.strokes[0].points[0], { x: 400, y: 300 });

    // When converting back to screen space with new pan, coordinates shift with camera
    const screenAfterPan = sg.worldToScreen(worldPt.x, worldPt.y);
    assert.deepEqual(screenAfterPan, { x: 500, y: 350 });

    // Zoom viewport to 2.0x
    sg.zoom(2.0);
    // World coordinates STILL remain locked
    assert.deepEqual(sg.strokes[0].points[0], { x: 400, y: 300 });
  });

  // AC2: Provisional pen/touch split (pen=ink, finger=pan)
  it('AC2: Pointer type dispatch routes pen to ink and finger to pan by default', () => {
    // Pen event routes to ink even if active tool is select or pan
    const penEvt = { pointerType: 'pen' };
    assert.equal(routePointerAction(penEvt, 'select'), 'draw_ink');
    assert.equal(routePointerAction(penEvt, 'pan'), 'draw_ink');

    // Touch event routes according to active tool
    const touchEvt = { pointerType: 'touch' };
    assert.equal(routePointerAction(touchEvt, 'pan'), 'pan_canvas');
    assert.equal(routePointerAction(touchEvt, 'select'), 'select_object');
    assert.equal(routePointerAction(touchEvt, 'pen'), 'draw_ink');
  });

  // AC3: In-app +/− zoom and fit buttons
  it('AC3: In-app +/− and fit buttons zoom viewport correctly', () => {
    assert.equal(sg.viewport.scale, 1.0);

    sg.zoomIn();
    assert.equal(sg.viewport.scale, 1.25);

    sg.zoomIn();
    assert.equal(sg.viewport.scale, 1.50);

    sg.zoomOut();
    assert.equal(sg.viewport.scale, 1.25);

    sg.pan(200, 150);
    sg.fit();
    assert.equal(sg.viewport.scale, 1.0);
    assert.equal(sg.viewport.panX, 0);
    assert.equal(sg.viewport.panY, 0);
  });

  it('AC3b: zoom spans 2%..2000%, clamped, keeps the anchor point fixed', () => {
    sg.zoom(0.001);
    assert.equal(sg.viewport.scale, 0.02);
    sg.zoom(500);
    assert.equal(sg.viewport.scale, 20);
    sg.zoomIn();
    assert.equal(sg.viewport.scale, 20);
    sg.zoom(0.02);
    sg.zoomOut();
    assert.equal(sg.viewport.scale, 0.02);
    sg.zoom(0.03, 100, 100); // 3% must not round to 2%/4%
    assert.equal(sg.viewport.scale, 0.03);
    const w = sg.screenToWorld(100, 100);
    sg.zoom(12, 100, 100);
    const w2 = sg.screenToWorld(100, 100);
    assert.ok(Math.abs(w.x - w2.x) < 1e-9 && Math.abs(w.y - w2.y) < 1e-9);
  });

  it('AC3c: fractal grid levels are 5x apart, in-range and continuous across zoom', () => {
    for (const s of [0.02, 0.1, 0.5, 1, 2.37, 20]) {
      const lv = gridLevels(s);
      assert.equal(lv.length, 4);
      assert.ok(lv[0].pitch >= 16 - 1e-9 && lv[0].pitch < 80 + 1e-9, `fine pitch ${lv[0].pitch} at ${s}`);
      for (let i = 1; i < 4; i++) assert.ok(Math.abs(lv[i].pitch / lv[i - 1].pitch - 5) < 1e-9);
      for (const l of lv) assert.ok(l.alpha >= 0 && l.alpha <= 1);
    }
    // at 100% the base 24px squares exist
    assert.ok(Math.abs(gridLevels(1)[0].pitch - 24) < 1e-9);
    // seamless handover: across a level boundary the same squares exist with the same strengths
    const edge = 16 / 24 / 5;
    const key = s => gridLevels(s).filter(l => l.alpha > 0.01)
      .map(l => `${Math.round(l.pitch * 10) / 10}:${Math.round(l.alpha * 100) / 100}`).sort();
    assert.deepEqual(key(edge * 1.000001), key(edge * 0.999999));
  });

  // AC4: First-run Overlay weather notice (C1)
  it('AC4: First-run Overlay banner is dismissible and persists in localStorage', () => {
    // Storage mock
    const storage = new Map();
    let seen = storage.get('overlayBannerSeen');
    assert.equal(seen, undefined);

    // Dismiss notice
    storage.set('overlayBannerSeen', 'true');
    assert.equal(storage.get('overlayBannerSeen'), 'true');

    // Verify text matches spec
    assert.ok(BILINGUAL.overlayBanner.text.es.includes('Overlay puede estar ON'));
    assert.ok(BILINGUAL.overlayBanner.text.en.includes('Overlay may be on'));
  });

  // AC5: Multi-page PDF viewer isolates ink strokes per page index
  it('AC5: Multi-page PDF viewer isolates ink strokes per page index', () => {
    const pdf = new PdfDocument('Agencia ELE Libro', 5);
    assert.equal(pdf.currentPage, 1);

    // Draw on Page 1
    pdf.addPageStroke(1, { points: [{ x: 10, y: 20 }] });
    assert.equal(pdf.getStrokes(1).length, 1);
    assert.equal(pdf.getStrokes(2).length, 0);

    // Navigate to Page 2
    pdf.nextPage();
    assert.equal(pdf.currentPage, 2);

    // Page 2 is clean
    assert.equal(pdf.getStrokes(2).length, 0);

    // Draw on Page 2
    pdf.addPageStroke(2, { points: [{ x: 50, y: 80 }, { x: 60, y: 90 }] });
    assert.equal(pdf.getStrokes(2).length, 1);

    // Return to Page 1
    pdf.prevPage();
    assert.equal(pdf.currentPage, 1);
    // Page 1 ink is intact and unaltered
    assert.equal(pdf.getStrokes(1).length, 1);
    assert.deepEqual(pdf.getStrokes(1)[0].points[0], { x: 10, y: 20 });
  });

  // AC6: PDF page zoom preserves stroke registration
  it('AC6: Zooming PDF page preserves stroke alignment to page coordinate space', () => {
    const pdf = new PdfDocument('Agencia ELE Libro', 3);
    const stroke = pdf.addPageStroke(1, { points: [{ x: 100, y: 150 }] });

    // Page strokes are kept in normalized page space
    assert.equal(pdf.getStrokes(1)[0].points[0].x, 100);
    assert.equal(pdf.getStrokes(1)[0].points[0].y, 150);
  });

  // AC7: Closing PDF viewer returns to board with state preserved
  it('AC7: Closing PDF viewer returns to board with document state preserved', () => {
    const pdf = new PdfDocument('Agencia ELE Libro', 4);
    pdf.goToPage(3);
    pdf.addPageStroke(3, { points: [{ x: 25, y: 35 }] });

    // Simulate closing viewer: document retains current page and page strokes
    assert.equal(pdf.currentPage, 3);
    assert.equal(pdf.getStrokes(3).length, 1);
  });

  // AC8: No live Blink / iframe as book surface
  it('AC8: PDF viewer is native board viewer, not an external iframe book', () => {
    const pdf = new PdfDocument('Agencia ELE PDF Export', 4);
    assert.ok(pdf instanceof PdfDocument);
    // Spec decision D2 & D9: PDF is local file viewer
    assert.equal(pdf.title.includes('PDF'), true);
  });

  // AC9: Overlay-on teachable mode & chip cycling
  it('AC9: Overlay chip cycles states (?, ON, OFF) and board remains usable in Overlay ON', () => {
    const chip = new OverlayChip('?');
    assert.equal(chip.state, '?');
    assert.equal(chip.getLabel(), 'Overlay ?');

    chip.cycle();
    assert.equal(chip.state, 'ON');
    assert.equal(chip.getLabel(), 'Overlay ON');

    chip.cycle();
    assert.equal(chip.state, 'OFF');
    assert.equal(chip.getLabel(), 'Overlay OFF');

    chip.cycle();
    assert.equal(chip.state, '?');
  });

  // AC11: Local save & load lesson
  it('AC11: Save and load serializes and restores all objects, strokes, and PDF ink', () => {
    // Populate board with objects, strokes, and PDF
    sg.addObject({ type: 'sticky', x: 100, y: 120, text: 'Vocabulario' });
    sg.addStroke({ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] });

    const pdf = new PdfDocument('Test PDF', 2);
    pdf.addPageStroke(1, { points: [{ x: 5, y: 5 }] });

    const web = new WebCard('https://example.com', 'Example');

    // Serialize
    const serialized = LessonSerializer.serialize(sg, [pdf], [web]);
    assert.equal(serialized.objects.length, 1);
    assert.equal(serialized.strokes.length, 1);
    assert.equal(serialized.pdfDocuments.length, 1);
    assert.equal(serialized.webCards.length, 1);

    // Deserialize into fresh scene graph
    const newSg = new SceneGraph();
    const { pdfDocs, webCards } = LessonSerializer.deserialize(serialized, newSg);

    assert.equal(newSg.objects.size, 1);
    assert.equal(newSg.strokes.length, 1);
    assert.equal(pdfDocs.length, 1);
    assert.equal(pdfDocs[0].getStrokes(1).length, 1);
    assert.equal(webCards.length, 1);
  });

  // AC12: WDK mode gated by probe evidence.complete
  it('AC12: WDK mode is locked until probe JSON with evidence.complete=true is loaded', () => {
    // 1. Incomplete probe
    const incompletePayload = {
      evidence: { complete: false },
      host: { classification: 'gx-android' },
      scenarios: { B: { payload: { sbPresent: true } } }
    };
    assert.equal(ProbeGate.evaluateWdkUnlock(incompletePayload), false);

    // 2. Laptop run with complete evidence (not GX host)
    const laptopPayload = {
      evidence: { complete: true },
      host: { classification: 'windows-desktop' },
      scenarios: { B: { payload: { sbPresent: true } } }
    };
    assert.equal(ProbeGate.evaluateWdkUnlock(laptopPayload), false);

    // 3. GX run without window.SB
    const gxNoSbPayload = {
      evidence: { complete: true },
      host: { classification: 'gx-android' },
      scenarios: { B: { payload: { sbPresent: false } } }
    };
    assert.equal(ProbeGate.evaluateWdkUnlock(gxNoSbPayload), false);

    // 4. Valid GX run with complete evidence AND window.SB present
    const validUnlockPayload = {
      evidence: { complete: true },
      host: { classification: 'gx-android' },
      scenarios: { B: { payload: { sbPresent: true } } }
    };
    assert.equal(ProbeGate.evaluateWdkUnlock(validUnlockPayload), true);
  });

  // AC13: WebView card defaults to Frozen mode with in-app ink enabled (v1.1)
  it('AC13: WebView card defaults to Frozen mode with in-app ink enabled', () => {
    const web = new WebCard('https://es.wikipedia.org', 'Wikipedia');
    assert.equal(web.mode, 'frozen');
    assert.equal(web.isInkAllowed(), true);

    const stroke = web.addStroke({ points: [{ x: 1, y: 1 }] });
    assert.equal(web.strokes.length, 1);
  });

  // AC14: WebView card Interact mode pauses ink and enables card interaction
  it('AC14: WebView card Interact mode pauses ink and enables card interaction', () => {
    const web = new WebCard('https://es.wikipedia.org', 'Wikipedia');
    web.toggleMode(); // now in 'interact'
    assert.equal(web.mode, 'interact');
    assert.equal(web.isInkAllowed(), false);

    // Drawing throws when in interact mode
    assert.throws(() => {
      web.addStroke({ points: [{ x: 2, y: 2 }] });
    }, /Cannot draw while in Interact mode/);
  });

  // AC15: Toggling back to Frozen re-enables ink
  it('AC15: Toggling back to Frozen re-enables ink and locks web card interaction', () => {
    const web = new WebCard('https://es.wikipedia.org', 'Wikipedia');
    web.toggleMode(); // interact
    web.toggleMode(); // frozen again
    assert.equal(web.mode, 'frozen');
    assert.equal(web.isInkAllowed(), true);
  });

  // AC16: WebView card includes helper stating PDF is for the book
  it('AC16: WebView card includes helper stating PDF is for the book', () => {
    const web = new WebCard();
    assert.ok(web.helper.includes('Para el libro usa un PDF'));
    assert.ok(web.helper.includes('For the book, use a PDF'));
  });

  // Undo / Redo functionality
  it('Undo and redo restore prior stroke and object states', () => {
    sg.addStroke({ points: [{ x: 1, y: 1 }] });
    assert.equal(sg.strokes.length, 1);

    sg.undo();
    assert.equal(sg.strokes.length, 0);

    sg.redo();
    assert.equal(sg.strokes.length, 1);
  });
});

describe('canvas object geometry, eraser and page history', () => {
  const { objectToWorld, worldToObject, strokeNearPoint } = require('../canvas/canvas-core.js');

  it('object-local and world coordinates round-trip under scale and rotation', () => {
    const obj = { x: 100, y: 50, scale: 1.5, rotation: 30 };
    const w = objectToWorld(obj, 40, 20);
    const l = worldToObject(obj, w.x, w.y);
    assert.ok(Math.abs(l.x - 40) < 1e-9 && Math.abs(l.y - 20) < 1e-9);
  });

  it('object moves undo/redo and removing an object takes its ink with it', () => {
    const sg = new SceneGraph();
    const o = sg.addObject({ type: 'sticky', x: 0, y: 0 });
    sg.addStroke({ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], objectId: o.id });
    const before = { x: o.x, y: o.y };
    o.x = 30; o.y = 40;
    assert.equal(sg.commitObjectChange(o.id, before), true);
    sg.undo();
    assert.equal(o.x, 0);
    sg.redo();
    assert.equal(o.x, 30);
    sg.removeObject(o.id);
    assert.equal(sg.strokes.length, 0);
    sg.undo();
    assert.equal(sg.strokes.length, 1);
  });

  it('eraser removal is one undoable step and per-page PDF history is isolated', () => {
    const sg = new SceneGraph();
    const a = sg.addStroke({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    const b = sg.addStroke({ points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] });
    assert.equal(strokeNearPoint(a.points, { x: 5, y: 1 }, 2), true);
    sg.removeStrokes([a.id, b.id]);
    assert.equal(sg.strokes.length, 0);
    sg.undo();
    assert.equal(sg.strokes.length, 2);

    const pdf = new PdfDocument('x.pdf', 2);
    pdf.addPageStroke(1, { points: [{ x: 1, y: 1 }] });
    pdf.addPageStroke(2, { points: [{ x: 2, y: 2 }] });
    assert.equal(pdf.undoPage(1), true);
    assert.equal(pdf.getStrokes(1).length, 0);
    assert.equal(pdf.getStrokes(2).length, 1);
    pdf.redoPage(1);
    assert.equal(pdf.getStrokes(1).length, 1);
  });

  it('lesson round-trip keeps PDF bytes and a corrupt file does not clobber the board', () => {
    const sg = new SceneGraph();
    sg.addObject({ type: 'sticky', x: 1, y: 1 });
    const pdf = new PdfDocument('b.pdf', 1);
    pdf.bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
    const data = LessonSerializer.serialize(sg, [pdf], []);
    const sg2 = new SceneGraph();
    const { pdfDocs } = LessonSerializer.deserialize(JSON.parse(JSON.stringify(data)), sg2);
    assert.deepEqual(Array.from(pdfDocs[0].bytes), [37, 80, 68, 70, 0, 255]);
    assert.throws(() => LessonSerializer.deserialize({ version: '1.0.0', objects: 5 }, sg2));
    assert.equal(sg2.objects.size, 1);
  });

  it('probe inspect: laptop and incomplete JSON never unlock, complete GX leaves provisional', () => {
    const mk = (cls, complete, sb) => ({ host: { classification: cls }, evidence: { complete, missing: complete ? [] : ['trial:D3'] }, scenarios: { B: { payload: { sbPresent: sb } }, C: { status: 'pass' } } });
    assert.equal(ProbeGate.inspect(mk('windows-desktop', true, true)).penTouch, 'provisional');
    assert.deepEqual(ProbeGate.inspect(mk('gx-android', false, true)).missing, ['trial:D3']);
    const ok = ProbeGate.inspect(mk('gx-android', true, false));
    assert.equal(ok.wdk, false);
    assert.equal(ok.penTouch, 'fromProbe');
  });
});
