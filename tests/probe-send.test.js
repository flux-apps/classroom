// tests/probe-send.test.js — G2 "Send results" pure logic (spec v0.4 AC19–AC24, AC27, AC28).
// Red-first: every export used here is new in probe/probe-core.js (tech-plan §6). No DOM, no network.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../probe/probe-core.js');
const { ProbeStore, BILINGUAL } = core;

function mockStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}
const need = (name) => { assert.equal(typeof core[name], 'function', `probe-core.js must export ${name}()`); return core[name]; };
const CODE = 'visit-CODE-s3cret';
const WORKER = 'https://relay.example.com/probe';

function finishedStore() {
  const s = new ProbeStore(mockStorage());
  s.state.host.classification = 'gx-android';
  s.state.host.confidence = 0.85;
  for (const id of ['A', 'B', 'C', 'E']) s.setScenarioResult(id, 'pass', id === 'B' ? { sbPresent: false } : { x: 1 }, 'n');
  for (const t of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) s.setTrialResult(t, 'pass', { overlayOn: ['D3', 'D4', 'D6'].includes(t) });
  return s;
}

describe('G2 — summary builder (AC22)', () => {
  it('a run with zero completed scenarios still yields a valid summary', () => {
    const txt = need('buildSummary')(new ProbeStore(mockStorage()).exportPayload());
    assert.equal(typeof txt, 'string');
    assert.ok(txt.length > 0);
    assert.match(txt, /complete/i);
  });
  it('names classification, evidence.complete, sbPresent, A–G lines, D1–D6 with Overlay ticks', () => {
    const x = finishedStore().exportPayload();
    const txt = need('buildSummary')(x);
    assert.match(txt, /gx-android/);
    assert.match(txt, /complete=true/);
    assert.match(txt, /sbPresent/i);
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) assert.match(txt, new RegExp(`(^|\\n)\\s*${id}[ :=]`), `line for ${id}`);
    for (const t of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) assert.match(txt, new RegExp(t));
    assert.match(txt, /overlay/i);
  });
  it('carries the H mechanism and H5 answers when present', () => {
    const s = finishedStore();
    for (const t of ['H1a', 'H1b']) s.setHTrial(t, { verdict: 'follows', overlayOn: true, notes: '' });
    s.setHTrial('H3', { verdict: 'stays', overlayOn: true, notes: '' });
    s.setH5('H5a', 'yes', 'X');
    const txt = need('buildSummary')(s.exportPayload());
    assert.match(txt, /os-scroll/);
    assert.match(txt, /H5a/);
  });
  it('never contains a visit code, relay URL or recipient (AC23, AC28)', () => {
    const x = finishedStore().exportPayload();
    x.settings = { recipient: 'me@example.com', relayUrl: WORKER, visitCode: CODE };
    const txt = need('buildSummary')(x);
    assert.doesNotMatch(txt, new RegExp(CODE));
    assert.doesNotMatch(txt, /relay\.example\.com/);
    assert.doesNotMatch(txt, /me@example\.com/);
  });
});

describe('G2 — mailto builder (AC21)', () => {
  const base = { to: 'you@example.com', summary: 'line one\nline two & more', classification: 'gx-android', date: '2026-11-16', complete: false };
  it('subject is `Probe <classification> <YYYY-MM-DD> complete=<bool>`; body is percent-encoded', () => {
    const r = need('buildMailto')(base);
    assert.equal(r.error, undefined);
    const u = new URL(r.url);
    assert.equal(u.protocol, 'mailto:');
    assert.equal(decodeURIComponent(u.pathname), 'you@example.com');
    assert.equal(u.searchParams.get('subject'), 'Probe gx-android 2026-11-16 complete=false');
    assert.equal(u.searchParams.get('body'), base.summary);
    assert.doesNotMatch(r.url, /[\r\n ]/);
  });
  it('body ≤ 1500 chars; truncation is explicit, never silent', () => {
    const r = need('buildMailto')({ ...base, summary: 'x'.repeat(4000) });
    const body = new URL(r.url).searchParams.get('body');
    assert.ok(body.length <= 1500, `body ${body.length}`);
    assert.equal(r.truncated, true);
    assert.match(body, /truncated; full JSON in Downloads/);
    assert.equal(need('buildMailto')(base).truncated, false);
  });
  it('invalid or injected address → error, no url', () => {
    const f = need('buildMailto');
    for (const to of ['', 'nope', 'a@b', 'a@b.com?cc=evil@x.com', 'a@b.com,evil@x.com', 'a@b.com\r\nBcc: evil@x.com', ' you@example.com x']) {
      const r = f({ ...base, to });
      assert.ok(r.error, `should reject ${JSON.stringify(to)}`);
      assert.equal(r.url, undefined);
    }
  });
});

describe('G2 — share file (AC20)', () => {
  it('file is probe-YYYYMMDD-HHMM.json.txt, text/plain, content equals the export JSON byte for byte', () => {
    const json = JSON.stringify(finishedStore().exportPayload(), null, 2);
    const f = need('buildShareFile')(json, new Date(2026, 10, 16, 14, 2));
    assert.equal(f.name, 'probe-20261116-1402.json.txt');
    assert.equal(f.type, 'text/plain');
    assert.equal(f.content, json);
  });
  it('export filename uses the same stamp (single source)', () => {
    assert.equal(need('exportFilename')(new Date(2026, 10, 16, 14, 2), 'json'), 'probe-20261116-1402.json');
  });
  it('runShare maps the share promise: shared | cancelled (AbortError) | error: <reason>', async () => {
    const run = need('runShare');
    const file = { name: 'f' };
    assert.equal(await run({ share: async () => {} }, { file, text: 't', title: 's' }), 'shared');
    assert.equal(await run({ share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } }, { file, text: 't', title: 's' }), 'cancelled');
    assert.equal(await run({ share: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } }, { file, text: 't', title: 's' }), 'error: NotAllowedError');
  });
});

describe('G2 — channels offered (AC19, AC27)', () => {
  const file = { name: 'f' };
  it('share needs canShare({files}) true; absent otherwise; mailto always; relay only with URL+code saved', () => {
    const f = need('offeredChannels');
    assert.deepEqual(f({ nav: { canShare: () => true, share: () => {} }, file, settings: {} }), ['share', 'mailto']);
    assert.deepEqual(f({ nav: {}, file, settings: {} }), ['mailto']);
    assert.deepEqual(f({ nav: { canShare: () => false }, file, settings: { relayUrl: WORKER } }), ['mailto']);
    assert.deepEqual(f({ nav: { canShare: () => true, share: () => {} }, file, settings: { relayUrl: WORKER, visitCode: CODE } }), ['share', 'mailto', 'relay']);
  });
  it('first-paint line «canales ofrecidos / channels offered»', () => {
    assert.match(need('channelsLine')(['share', 'mailto']), /canales ofrecidos \/ channels offered.*share, mailto/);
  });
  it('listing channels never changes state or storage (AC19)', () => {
    const s = finishedStore(); const before = JSON.stringify(s.state);
    need('offeredChannels')({ nav: { canShare: () => true, share: () => {} }, file, settings: {} });
    assert.equal(JSON.stringify(s.state), before);
  });
  it('channels and outcomes are bilingual', () => {
    for (const k of ['share', 'mailto', 'relay']) assert.ok(BILINGUAL.channels[k].es && BILINGUAL.channels[k].en, k);
    for (const k of ['shared', 'cancelled', 'opened', 'sent', 'failed']) assert.ok(BILINGUAL.outcome[k].es && BILINGUAL.outcome[k].en, k);
  });
});

describe('G2 — outcome vocabulary and delivery[] (AC24, AC27)', () => {
  it('only the relay may be called "sent"', () => {
    const w = need('outcomeWord');
    assert.match(w('relay', 'sent').en, /sent/i);
    assert.doesNotMatch(w('share', 'shared').en, /\bsent\b/i);
    assert.doesNotMatch(w('mailto', 'opened').en, /\bsent\b/i);
    assert.match(w('share', 'shared').en, /handed/i);
  });
  it('addDelivery stores { channel, at, outcome, runState }; invalid channel/outcome pairs throw', () => {
    const s = finishedStore();
    const d = s.addDelivery({ channel: 'share', outcome: 'shared' });
    assert.deepEqual(Object.keys(d).sort(), ['at', 'channel', 'outcome', 'runState']);
    assert.equal(d.runState, 'finished');
    assert.throws(() => s.addDelivery({ channel: 'mailto', outcome: 'sent' }));
    assert.throws(() => s.addDelivery({ channel: 'share', outcome: 'opened' }));
    assert.throws(() => s.addDelivery({ channel: 'fax', outcome: 'shared' }));
    assert.doesNotThrow(() => s.addDelivery({ channel: 'relay', outcome: 'failed: timeout' }));
    assert.doesNotThrow(() => s.addDelivery({ channel: 'share', outcome: 'error: NotAllowedError' }));
  });
  it('runState is empty with nothing run, partial mid-run, finished when A–E are terminal', () => {
    const s = new ProbeStore(mockStorage());
    assert.equal(s.addDelivery({ channel: 'share', outcome: 'shared' }).runState, 'empty');
    s.setScenarioResult('A', 'pass', {}, '');
    assert.equal(s.addDelivery({ channel: 'share', outcome: 'shared' }).runState, 'partial');
  });
  it('confirmed is set only by the operator tick', () => {
    const s = finishedStore();
    s.addDelivery({ channel: 'share', outcome: 'shared' });
    assert.equal(s.state.delivery[0].confirmed, undefined);
    s.confirmDelivery(0);
    assert.equal(s.state.delivery[0].confirmed, true);
  });
  it('a send never changes scenario results or evidence.complete; delivery[] lands in the next Export and survives restore', () => {
    const st = mockStorage();
    const s = new ProbeStore(st);
    s.state.host.classification = 'gx-android';
    for (const id of ['A', 'B', 'C', 'E']) s.setScenarioResult(id, 'pass', id === 'B' ? { sbPresent: true } : {}, '');
    const before = JSON.stringify([s.state.scenarios, s.state.evidence]);
    s.addDelivery({ channel: 'relay', outcome: 'failed: network' });
    assert.equal(JSON.stringify([s.state.scenarios, s.state.evidence]), before);
    assert.equal(s.exportPayload().delivery.length, 1);
    const b = new ProbeStore(st); assert.equal(b.restore(), true);
    assert.equal(b.state.delivery.length, 1);
  });
  it('test send (AC27): empty-run summary, complete=false, recorded like any send, state untouched', () => {
    const s = new ProbeStore(mockStorage());
    const before = JSON.stringify(s.state.scenarios);
    const x = s.exportPayload();
    const m = need('buildMailto')({ to: 'you@example.com', summary: need('buildSummary')(x), classification: x.hostClassification, date: '2026-11-16', complete: x.evidence.complete });
    assert.match(new URL(m.url).searchParams.get('subject'), /complete=false/);
    assert.equal(s.addDelivery({ channel: 'mailto', outcome: 'opened' }).runState, 'empty');
    assert.equal(JSON.stringify(s.state.scenarios), before);
  });
});

describe('G2 — settings: Reset keeps, Forget removes, code masked (AC28)', () => {
  const full = { recipient: 'you@example.com', relayUrl: WORKER, visitCode: CODE };
  it('saves and reads recipient, relay URL, visit code; invalid values are refused', () => {
    const S = need('createSettings')(mockStorage());
    S.save(full);
    assert.deepEqual(S.load(), full);
    assert.throws(() => S.save({ recipient: 'not-an-email' }));
    assert.throws(() => S.save({ relayUrl: 'http://relay.example.com/x' }), /https/i);
  });
  it('Reset of the run keeps settings; Forget clears all three', () => {
    const st = mockStorage();
    const S = need('createSettings')(st); S.save(full);
    const s = new ProbeStore(st);
    s.clearSaved();                                  // Reset
    assert.deepEqual(S.load(), full);
    S.forget();
    assert.deepEqual(S.load(), { recipient: '', relayUrl: '', visitCode: '' });
    assert.equal(st.keys().some((k) => /settings/.test(k)), false);
  });
  it('visit code is masked for display and never appears in export, summary or delivery[]', () => {
    assert.match(need('maskCode')(CODE), /^•+$/);
    assert.doesNotMatch(need('maskCode')(CODE), /s3cret/);
    const st = mockStorage();
    need('createSettings')(st).save(full);
    const s = finishedStore(); s.storage = st;
    s.addDelivery({ channel: 'relay', outcome: 'sent' });
    const json = JSON.stringify(s.exportPayload());
    assert.doesNotMatch(json, new RegExp(CODE));
    assert.doesNotMatch(json, /relay\.example\.com/);
  });
  it('P6 gates Export only, not a send', () => {
    const f = need('needsIncompleteWarning');
    const inc = { complete: false };
    assert.equal(f('export', inc), true);
    for (const a of ['share', 'mailto', 'relay', 'test-send']) assert.equal(f(a, inc), false, a);
    assert.equal(f('export', { complete: true }), false);
  });
});

describe('G2 — relay client (AC23)', () => {
  const x = () => finishedStore().exportPayload();
  it('compact payload: no timelines, no log, no settings, no visit code; far smaller than the full export', () => {
    const s = finishedStore();
    s.setHTrial('H1a', { verdict: 'follows', overlayOn: true, notes: '' });
    s.state.overlayFollow.trials.H1a.timeline = Array.from({ length: 500 }, (_, i) => ({ kind: 'blur', t: i }));
    for (let i = 0; i < 300; i++) s.log('noise ' + i);
    const full = s.exportPayload();
    full.settings = { visitCode: CODE };
    const c = need('compactRelayPayload')(full);
    const json = JSON.stringify(c);
    assert.doesNotMatch(json, /"timeline"/);
    assert.doesNotMatch(json, /"log"/);
    assert.doesNotMatch(json, new RegExp(CODE));
    assert.ok(json.length < JSON.stringify(full).length / 2);
    assert.ok(json.length < 100 * 1024, 'must fit the Worker cap');
    assert.equal(c.overlayFollow.trials.H1a.verdict, 'follows');
    assert.ok(Array.isArray(c.scenarios) && c.scenarios.every((sc) => 'id' in sc && 'status' in sc));
  });
  it('request: POST JSON, visit code in a header, 15 s timeout; non-https refused', () => {
    const r = need('buildRelayRequest')({ relayUrl: WORKER, visitCode: CODE, payload: need('compactRelayPayload')(x()) });
    assert.equal(r.url, WORKER);
    assert.equal(r.init.method, 'POST');
    assert.equal(r.init.headers['Content-Type'], 'application/json');
    assert.equal(r.init.headers['X-Visit-Code'], CODE);
    assert.doesNotMatch(r.init.body, new RegExp(CODE));
    assert.equal(r.timeoutMs, 15000);
    assert.throws(() => need('buildRelayRequest')({ relayUrl: 'http://relay.example.com/x', visitCode: CODE, payload: {} }));
  });
  it('confirm dialog data: host and payload size, never the code', () => {
    const d = need('describeRelayConfirm')({ relayUrl: WORKER, visitCode: CODE, payload: need('compactRelayPayload')(x()) });
    assert.equal(d.host, 'relay.example.com');
    assert.ok(d.bytes > 0);
    assert.doesNotMatch(JSON.stringify(d), new RegExp(CODE));
  });
  const reasons = [
    [401, 'failed: wrong-code'], [413, 'failed: too-large'], [400, 'failed: bad-format'],
    [500, 'failed: relay-5xx'], [503, 'failed: relay-5xx']
  ];
  for (const [status, want] of reasons) {
    it(`HTTP ${status} → ${want}`, async () => {
      const out = await need('sendRelay')({ fetchImpl: async () => ({ ok: false, status }), relayUrl: WORKER, visitCode: CODE, payload: {} });
      assert.equal(out, want);
    });
  }
  it('2xx → sent; TypeError → failed: network; no answer in the timeout → failed: timeout (no retry)', async () => {
    const f = need('sendRelay');
    assert.equal(await f({ fetchImpl: async () => ({ ok: true, status: 200 }), relayUrl: WORKER, visitCode: CODE, payload: {} }), 'sent');
    assert.equal(await f({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, relayUrl: WORKER, visitCode: CODE, payload: {} }), 'failed: network');
    let calls = 0;
    const hang = (url, init) => { calls++; return new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); })); };
    assert.equal(await f({ fetchImpl: hang, relayUrl: WORKER, visitCode: CODE, payload: {}, timeoutMs: 20 }), 'failed: timeout');
    assert.equal(calls, 1);
  });
  it('failure text never echoes the visit code', async () => {
    const out = await need('sendRelay')({ fetchImpl: async () => { throw new Error('bad ' + CODE); }, relayUrl: WORKER, visitCode: CODE, payload: {} });
    assert.doesNotMatch(out, new RegExp(CODE));
  });
});

describe('G2 — private-link #fragment import (AC23, OQ12)', () => {
  it('parses relay URL + code, returns the URL with the fragment removed', () => {
    const f = need('importFragment');
    const r = f(`#relay=${encodeURIComponent(WORKER)}&code=${encodeURIComponent('v1.1900000000.abc')}`, 'https://probe.example.com/probe/index.html');
    assert.equal(r.relayUrl, WORKER);
    assert.equal(r.visitCode, 'v1.1900000000.abc');
    assert.equal(r.cleanedUrl, 'https://probe.example.com/probe/index.html');
  });
  it('malformed, http, or missing parts → null (no partial import)', () => {
    const f = need('importFragment');
    for (const h of ['', '#', '#foo=bar', '#relay=http%3A%2F%2Fx.example.com&code=c', `#relay=${encodeURIComponent(WORKER)}`, '#code=abc']) {
      assert.equal(f(h, 'https://probe.example.com/'), null, h);
    }
  });
});

describe('G2 — service worker never touches the relay POST (AC23)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'probe', 'sw.js'), 'utf8');
  it('fetch handler returns early for non-GET and cross-origin requests', () => {
    assert.match(sw, /req\.method\s*!==\s*'GET'/);
    assert.match(sw, /url\.origin\s*!==\s*self\.location\.origin/);
  });
});
