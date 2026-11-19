// tests/probe-h.test.js — scenario H "Overlay follows content" (spec v0.4 AC12–AC18) + script/step contract.
// Red-first: every export used here is new in probe/probe-core.js (see tech-plan §6). Pure functions only;
// board-only behaviour (real Overlay, real share) stays an operator checklist item.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../probe/probe-core.js');
const { ProbeStore, BILINGUAL, computeEvidenceComplete } = core;

function mockStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const need = (name) => { assert.equal(typeof core[name], 'function', `probe-core.js must export ${name}()`); return core[name]; };
const T = (verdict, extra) => ({ verdict, overlayOn: true, notes: '', ...(extra || {}) });

describe('H — mechanism truth table (AC15)', () => {
  const rows = [
    // [H1a, H1b, H3, expected]
    ['follows', 'follows', 'stays', 'os-scroll'],
    ['follows', 'stays', 'stays', 'os-scroll'],     // "H1a OR H1b follows & H3 stays"
    ['stays', 'follows', 'stays', 'os-scroll'],
    ['stays', 'stays', 'stays', 'host-only'],
    ['follows', 'follows', 'follows', 'image-track'],
    ['stays', 'stays', 'follows', 'image-track'],   // literal AC15: "H3 follows → image-track"
    ['partial', 'stays', 'stays', 'mixed'],
    ['follows', 'follows', 'partial', 'mixed']
  ];
  for (const [a, b, c, want] of rows) {
    it(`H1a=${a} H1b=${b} H3=${c} → ${want}`, () => {
      assert.equal(need('computeOverlayMechanism')({ H1a: T(a), H1b: T(b), H3: T(c) }), want);
    });
  }
  it('any of H1a/H1b/H3 missing or n/a → inconclusive', () => {
    const f = need('computeOverlayMechanism');
    assert.equal(f({ H1a: T('follows'), H1b: T('follows') }), 'inconclusive');
    assert.equal(f({ H1a: T('follows'), H1b: T('n/a', { notes: 'no pen' }), H3: T('stays') }), 'inconclusive');
    assert.equal(f({}), 'inconclusive');
  });
  it('H2 refines zoom only: it never changes the mechanism', () => {
    const f = need('computeOverlayMechanism');
    const base = { H1a: T('follows'), H1b: T('follows'), H3: T('stays') };
    assert.equal(f({ ...base, H2: T('scales') }), f({ ...base, H2: T('stays') }));
  });
});

describe('H — verdict gating (AC13)', () => {
  it('verdict is refused until "Overlay was ON" is ticked; n/a needs a reason', () => {
    const v = need('validateTrialVerdict');
    assert.equal(v('H1a', 'follows', { overlayOn: false }).ok, false);
    assert.equal(v('H1a', 'follows', { overlayOn: true }).ok, true);
    assert.equal(v('H1a', 'n/a', { overlayOn: true, notes: '' }).ok, false);
    assert.equal(v('H1a', 'n/a', { overlayOn: true, notes: 'pen dead' }).ok, true);
  });
  it('H2 takes scales|stays|partial; H1a/H1b/H3 take follows|stays|partial', () => {
    const v = need('validateTrialVerdict');
    assert.equal(v('H2', 'scales', { overlayOn: true }).ok, true);
    assert.equal(v('H2', 'follows', { overlayOn: true }).ok, false);
    assert.equal(v('H3', 'scales', { overlayOn: true }).ok, false);
  });
  it('finalizeTrial stores { verdict, overlayOn, notes, timeline } and flags recalled when no events were seen', () => {
    const rec = need('createTrialRecorder')({ cap: 2000 });
    const quiet = need('finalizeTrial')('H1a', { verdict: 'follows', overlayOn: true, notes: 'x' }, rec);
    assert.deepEqual(Object.keys(quiet).sort(), ['notes', 'overlayOn', 'recalled', 'timeline', 'truncated', 'verdict']);
    assert.equal(quiet.recalled, true);
    assert.deepEqual(quiet.timeline, []);            // empty timeline is data (AC14)
    const rec2 = need('createTrialRecorder')({ cap: 2000 });
    rec2.add({ kind: 'pointerdown', pointerType: 'touch', t: 1 });
    assert.equal(need('finalizeTrial')('H1a', { verdict: 'stays', overlayOn: true, notes: '' }, rec2).recalled, false);
  });
});

describe('H — timeline recorder (AC14)', () => {
  it('counts per pointerType stay exact and storage is capped at 2000 with truncated:true', () => {
    const rec = need('createTrialRecorder')({ cap: 2000 });
    for (let i = 0; i < 5000; i++) rec.add({ kind: 'pointermove', pointerType: i % 2 ? 'pen' : 'touch', t: i });
    const s = rec.snapshot();
    assert.ok(s.entries.length <= 2000, `stored ${s.entries.length}`);
    assert.equal(s.counts.pointermove.pen + s.counts.pointermove.touch, 5000);
    assert.equal(s.truncated, true);
  });
  it('past the cap non-move events stop being stored but are still counted', () => {
    const rec = need('createTrialRecorder')({ cap: 10 });
    for (let i = 0; i < 25; i++) rec.add({ kind: 'blur', t: i });
    const s = rec.snapshot();
    assert.equal(s.entries.length, 10);
    assert.equal(s.counts.blur, 25);
    assert.equal(s.truncated, true);
  });
  it('under the cap nothing is truncated; pointermove is sampled so a long drag cannot fill the cap alone', () => {
    const rec = need('createTrialRecorder')({ cap: 2000 });
    rec.add({ kind: 'visibilitychange', state: 'hidden', t: 1 });
    assert.equal(rec.snapshot().truncated, false);
    for (let i = 0; i < 1500; i++) rec.add({ kind: 'pointermove', pointerType: 'touch', t: 10 + i });
    assert.ok(rec.snapshot().entries.length < 1500, 'pointermove must be sampled');
  });
  it('scroll entries carry scrollTop delta per surface', () => {
    const rec = need('createTrialRecorder')({ cap: 2000 });
    rec.add({ kind: 'scroll', target: 'S-doc', scrollTop: 100, t: 1 });
    rec.add({ kind: 'scroll', target: 'S-doc', scrollTop: 250, t: 2 });
    rec.add({ kind: 'scroll', target: 'S-box', scrollTop: 40, t: 3 });
    const sc = rec.snapshot().entries.filter((e) => e.kind === 'scroll');
    assert.deepEqual(sc.map((e) => e.delta), [100, 150, 40]);
  });
  it('visualViewport changes are recorded with scale and offsets', () => {
    const rec = need('createTrialRecorder')({ cap: 2000 });
    rec.add({ kind: 'vv', scale: 2, offsetLeft: 10, offsetTop: 20, t: 1 });
    const e = rec.snapshot().entries[0];
    assert.equal(e.scale, 2); assert.equal(e.offsetLeft, 10); assert.equal(e.offsetTop, 20);
  });
});

describe('H — signals around "Overlay is open now" taps (AC15)', () => {
  it('collects timeline events from 2 s before to 1 s after each tap; no taps → []', () => {
    const f = need('computeOverlaySignals');
    const entries = [{ kind: 'blur', t: 7999 }, { kind: 'blur', t: 8000 }, { kind: 'focus', t: 10000 }, { kind: 'focus', t: 11000 }, { kind: 'focus', t: 11001 }];
    assert.deepEqual(f([], entries), []);
    const out = f([10000], entries);
    assert.equal(out.length, 1);
    assert.equal(out[0].tapAt, 10000);
    assert.deepEqual(out[0].events.map((e) => e.t), [8000, 10000, 11000]);
  });
  it('every tap is stored with its timestamp, any number of times', () => {
    const s = new ProbeStore(mockStorage());
    assert.equal(typeof s.addOverlayTap, 'function');
    s.addOverlayTap(5); s.addOverlayTap(9);
    assert.deepEqual(s.state.overlayFollow.taps, [5, 9]);
  });
});

describe('H — H4 / H5 answers (AC16)', () => {
  it('H5 has seven rows H5a–H5g, default unset', () => {
    const s = new ProbeStore(mockStorage());
    assert.deepEqual(Object.keys(s.state.overlayFollow.h5), ['H5a', 'H5b', 'H5c', 'H5d', 'H5e', 'H5f', 'H5g']);
    for (const r of Object.values(s.state.overlayFollow.h5)) assert.equal(r.answer, null);
    assert.equal(typeof s.state.overlayFollow.h4, 'string');
  });
  it('only yes|no|unknown are accepted', () => {
    const s = new ProbeStore(mockStorage());
    s.setH5('H5a', 'yes', 'cierra con X');
    assert.equal(s.state.overlayFollow.h5.H5a.answer, 'yes');
    assert.throws(() => s.setH5('H5a', 'maybe', ''));
  });
  it('H5f becomes unknown with an auto-note when H5e = no', () => {
    const s = new ProbeStore(mockStorage());
    s.setH5('H5e', 'no', '');
    const f = s.state.overlayFollow.h5.H5f;
    assert.equal(f.answer, 'unknown');
    assert.match(f.note, /n\/a: H5e = no/);
  });
  it('Export works with no H answer at all', () => {
    const s = new ProbeStore(mockStorage());
    const x = s.exportPayload();
    assert.equal(x.overlayFollow.mechanism, 'inconclusive');
    assert.equal(x.overlayFollow.complete, false);
    assert.deepEqual(x.overlayFollow.signals, []);
  });
});

describe('H — export shape, completeness, isolation (AC15, AC11)', () => {
  function gxStore() {
    const s = new ProbeStore(mockStorage());
    s.state.host.classification = 'gx-android';
    return s;
  }
  it('exports overlayFollow = { mechanism, signals, complete, trials:{H1a,H1b,H2,H3}, h4, h5 }', () => {
    const x = gxStore().exportPayload();
    assert.deepEqual(Object.keys(x.overlayFollow).sort(), ['complete', 'h4', 'h5', 'mechanism', 'signals', 'taps', 'trials'].sort());
    assert.deepEqual(Object.keys(x.overlayFollow.trials).sort(), ['H1a', 'H1b', 'H2', 'H3']);
  });
  it('overlayFollow.complete needs H1a, H1b, H3 terminal with Overlay ON on a GX host', () => {
    const s = gxStore();
    s.setHTrial('H1a', T('follows')); s.setHTrial('H1b', T('follows'));
    assert.equal(s.exportPayload().overlayFollow.complete, false);
    s.setHTrial('H3', T('stays'));
    const x = s.exportPayload();
    assert.equal(x.overlayFollow.complete, true);
    assert.equal(x.overlayFollow.mechanism, 'os-scroll');
    s.state.host.classification = 'windows-desktop';
    assert.equal(s.exportPayload().overlayFollow.complete, false);
  });
  it('H never changes evidence.complete', () => {
    const s = gxStore();
    const before = JSON.stringify(computeEvidenceComplete(s.state));
    s.setHTrial('H1a', T('follows')); s.setHTrial('H1b', T('follows')); s.setHTrial('H3', T('stays'));
    assert.equal(JSON.stringify(computeEvidenceComplete(s.state)), before);
  });
  it('restore (AC7) brings back H trials, taps, h4 and h5', () => {
    const st = mockStorage();
    const a = new ProbeStore(st);
    a.setHTrial('H1a', T('stays', { notes: 'ok' })); a.addOverlayTap(42); a.setH5('H5a', 'yes', 'X');
    const b = new ProbeStore(st);
    assert.equal(b.restore(), true);
    assert.equal(b.state.overlayFollow.trials.H1a.verdict, 'stays');
    assert.deepEqual(b.state.overlayFollow.taps, [42]);
    assert.equal(b.state.overlayFollow.h5.H5a.answer, 'yes');
  });
  it('restoring a pre-H saved run still works (ensureShape adds overlayFollow and delivery)', () => {
    const st = mockStorage();
    const old = new ProbeStore(st).state;
    delete old.overlayFollow; delete old.delivery;
    st.setItem('smart-board-probe:last', JSON.stringify(old));
    const b = new ProbeStore(st);
    assert.equal(b.restore(), true);
    assert.ok(b.state.overlayFollow && Array.isArray(b.state.delivery));
  });
});

describe('H — surfaces and dock (AC12, AC18)', () => {
  it('three surfaces with the scroll model each one tests', () => {
    const f = need('surfaceSpec');
    assert.equal(f('S-doc').scroll, 'document');
    assert.equal(f('S-box').scroll, 'inner');
    assert.equal(f('S-xform').scroll, 'transform');
  });
  it('S-doc is ≥ 4 viewport heights, allows page pinch-zoom; S-xform allows no native scroll', () => {
    const f = need('surfaceSpec');
    assert.ok(f('S-doc').minViewportHeights >= 4);
    assert.notEqual(f('S-doc').touchAction, 'none');
    assert.equal(f('S-xform').touchAction, 'none');
  });
  it('no surface draws ink and each marks target row 008', () => {
    const f = need('surfaceSpec');
    for (const id of ['S-doc', 'S-box', 'S-xform']) {
      assert.equal(f(id).ink, false, id);
      assert.equal(f(id).targetRow, 8, id);
    }
  });
  it('viewport meta never blocks user scaling (S-doc pinch)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'probe', 'index.html'), 'utf8');
    const meta = html.match(/<meta[^>]+name="viewport"[^>]*>/i)[0];
    assert.doesNotMatch(meta, /user-scalable\s*=\s*(no|0)/i);
    assert.doesNotMatch(meta, /maximum-scale/i);
  });
  it('dock stays reachable when the visual viewport is zoomed: tracked, or a visible "Zoom ≠ 1×" fallback', () => {
    const f = need('dockPlacement');
    const one = f({ scale: 1, offsetLeft: 0, offsetTop: 0, width: 1920, height: 1080 });
    assert.equal(one.mode, 'fixed'); assert.equal(one.showZoomBadge, false);
    const two = f({ scale: 2, offsetLeft: 300, offsetTop: 100, width: 960, height: 540 });
    assert.ok(two.mode === 'tracked' || two.showZoomBadge === true);
  });
});

describe('H6 — share target (AC17, should-have)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'probe', 'manifest.json'), 'utf8'));
  it('manifest declares a POST multipart share_target for image/* and application/pdf', () => {
    const st = manifest.share_target;
    assert.ok(st, 'share_target missing');
    assert.equal(st.method, 'POST');
    assert.equal(st.enctype, 'multipart/form-data');
    const accept = st.params.files.flatMap((f) => f.accept);
    assert.ok(accept.includes('image/*') && accept.includes('application/pdf'));
  });
  function png(width, height, colorType) {
    const zlib = require('node:zlib');
    const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const t = Buffer.from(type); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType;
    const bpp = colorType === 6 ? 4 : 3;
    const raw = Buffer.alloc((width * bpp + 1) * height);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
  it('describeSharedFile returns metadata only: mime, byteSize, width, height, hasAlpha — never the content', () => {
    const f = need('describeSharedFile');
    const rgba = png(3, 2, 6), rgb = png(3, 2, 2);
    const a = f(new Uint8Array(rgba), 'image/png');
    assert.deepEqual({ ...a }, { mime: 'image/png', byteSize: rgba.length, width: 3, height: 2, hasAlpha: true });
    assert.equal(f(new Uint8Array(rgb), 'image/png').hasAlpha, false);
    const pdf = f(new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    assert.equal(pdf.byteSize, 4);
    assert.deepEqual(Object.keys(a).sort(), ['byteSize', 'hasAlpha', 'height', 'mime', 'width']);
  });
});

describe('Script and scenario list (AC9, spec v0.4)', () => {
  it('steps are 1, 1b, 2..9; H = step 7, F = step 8, export+send = step 9', () => {
    assert.deepEqual(BILINGUAL.steps.map((s) => s.num), [1, '1b', 2, 3, 4, 5, 6, 7, 8, 9]);
    const by = (n) => BILINGUAL.steps.find((s) => s.num === n);
    assert.deepEqual(by(7).targets, ['H']);
    assert.deepEqual(by(8).targets, ['F']);
    assert.ok(by(9).targets.includes('G') && by(9).targets.includes('G2'));
    assert.ok(by('1b').targets.includes('G2'));
  });
  it('every step is bilingual, and no step tells the operator to turn Overlay off to start', () => {
    for (const s of BILINGUAL.steps) {
      assert.ok(s.es && s.en, `step ${s.num}`);
      assert.doesNotMatch(s.es + s.en, /(apaga|desactiva|turn off|dismiss|close)[^.]*overlay/i);
    }
  });
  it('step 9 names the honest outcome words: handed/entregado for share+mail, sent/enviado for relay only', () => {
    const s9 = BILINGUAL.steps.find((s) => s.num === 9);
    assert.match(s9.en, /handed/i); assert.match(s9.en, /sent/i); assert.match(s9.en, /arrived/i);
    assert.match(s9.es, /entregado/i); assert.match(s9.es, /enviado/i); assert.match(s9.es, /lleg/i);
  });
  it('scenario list has H and G2, neither required for evidence.complete', () => {
    const ids = BILINGUAL.scenarios.map((s) => s.id);
    assert.ok(ids.includes('H') && ids.includes('G2'));
    assert.equal(BILINGUAL.scenarios.find((s) => s.id === 'H').required, false);
    assert.equal(BILINGUAL.scenarios.find((s) => s.id === 'G2').required, false);
    assert.ok(ids.indexOf('E') < ids.indexOf('H') && ids.indexOf('H') < ids.indexOf('F'), 'order E → H → F');
  });
});
