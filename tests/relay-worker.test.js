// tests/relay-worker.test.js — G2 channel 3 Worker contract (spec v0.4 AC26, AC23 token, OQ12).
// The Worker core is worker/relay-core.mjs: pure `handleRelay(request, env, deps)`, no `cloudflare:*` imports, so it runs
// here with stubbed Request/env/send. worker/index.mjs (not tested here) is the thin adapter that wires the real
// send_email binding. The request is duck-typed (method, headers.get, text()) so tests need no platform Request.
// Red-first: worker/relay-core.mjs does not exist yet.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const core = require('../probe/probe-core.js');

const ORIGIN = 'https://probe.example.com';
const ENV = { VISIT_CODE: 'right-code-123', ALLOWED_ORIGIN: ORIGIN, RELAY_TO: 'owner@example.com', RELAY_FROM: 'probe@example.com' };
let relay;

before(async () => {
  relay = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'relay-core.mjs')).href);
});

function compact() {
  const s = new core.ProbeStore({ getItem: () => null, setItem() {}, removeItem() {} });
  s.state.host.classification = 'gx-android';
  s.setScenarioResult('A', 'pass', { ua: 'x' }, 'ok');
  return core.compactRelayPayload(s.exportPayload());
}

function req({ method = 'POST', headers = {}, body, origin = ORIGIN, contentType = 'application/json', code = ENV.VISIT_CODE, spy } = {}) {
  const h = new Map(Object.entries({
    ...(origin === null ? {} : { origin }),
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(code === null ? {} : { 'x-visit-code': code }),
    ...headers
  }).map(([k, v]) => [k.toLowerCase(), v]));
  const text = typeof body === 'string' ? body : JSON.stringify(body === undefined ? compact() : body);
  return {
    method,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    text: async () => { if (spy) spy.read = true; return text; }
  };
}
function deps() { const sent = []; const logs = []; return { sent, logs, send: async (m) => { sent.push(m); }, log: (...a) => logs.push(a.join(' ')), now: () => 1_800_000_000_000 }; }
async function run(r, env = ENV, d = deps()) { const res = await relay.handleRelay(r, env, d); return { res, d, text: await res.text() }; }

describe('Worker — method, content type, origin (AC26)', () => {
  it('non-POST is 405 with Allow: POST and sends nothing', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const { res, d } = await run(req({ method }));
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get('Allow'), 'POST');
      assert.equal(d.sent.length, 0);
    }
  });
  it('CORS preflight from the single probe origin → 204 with that origin (never *) and the two headers the probe sends', async () => {
    const { res } = await run(req({ method: 'OPTIONS', contentType: null, code: null, headers: { 'Access-Control-Request-Method': 'POST' } }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    const allow = res.headers.get('Access-Control-Allow-Headers').toLowerCase();
    assert.ok(allow.includes('x-visit-code') && allow.includes('content-type'));
  });
  it('preflight from another origin gets no CORS grant', async () => {
    const { res } = await run(req({ method: 'OPTIONS', origin: 'https://evil.example.net', contentType: null, code: null }));
    assert.notEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.notEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://evil.example.net');
  });
  it('wrong Origin header → 403, nothing sent', async () => {
    const { res, d } = await run(req({ origin: 'https://evil.example.net' }));
    assert.equal(res.status, 403);
    assert.equal(d.sent.length, 0);
  });
  it('non-JSON content type → 415', async () => {
    const { res, d } = await run(req({ contentType: 'text/plain' }));
    assert.equal(res.status, 415);
    assert.equal(d.sent.length, 0);
  });
});

describe('Worker — visit code (AC26)', () => {
  it('missing or wrong code → generic 401 BEFORE the body is read', async () => {
    for (const code of [null, '', 'wrong', ENV.VISIT_CODE + 'x', ENV.VISIT_CODE.slice(1)]) {
      const spy = { read: false };
      const { res, d, text } = await run(req({ code, spy, body: '{not json' }));
      assert.equal(res.status, 401, String(code));
      assert.equal(spy.read, false, 'body must not be parsed before auth');
      assert.equal(d.sent.length, 0);
      assert.doesNotMatch(text, /not json|right-code/);
    }
  });
  it('timingSafeEqual: equal, unequal, and different length strings', () => {
    assert.equal(relay.timingSafeEqual('abc', 'abc'), true);
    assert.equal(relay.timingSafeEqual('abc', 'abd'), false);
    assert.equal(relay.timingSafeEqual('abc', 'abcd'), false);
    assert.equal(relay.timingSafeEqual('', ''), true);
  });
  it('a stateless expiring token v1.<expUnix>.<hmac> is accepted until it expires (OQ12: fragment may persist in history)', async () => {
    const now = 1_800_000_000;
    const good = await relay.mintVisitToken(ENV.VISIT_CODE, now + 3600);
    assert.match(good, /^v1\.\d+\.[A-Za-z0-9_-]+$/);
    assert.equal((await run(req({ code: good }))).res.status, 200);
    const expired = await relay.mintVisitToken(ENV.VISIT_CODE, now - 1);
    assert.equal((await run(req({ code: expired }))).res.status, 401);
    const tampered = good.replace(/\.(\d+)\./, (_, n) => `.${Number(n) + 99999}.`);
    assert.equal((await run(req({ code: tampered }))).res.status, 401);
  });
});

describe('Worker — size and shape (AC26)', () => {
  it('body over the cap → 413 (Content-Length and actual length), default cap 100 KB', async () => {
    const big = { ...compact(), summary: 'x'.repeat(120 * 1024) };
    assert.equal((await run(req({ body: big }))).res.status, 413);
    const lying = req({ headers: { 'content-length': String(200 * 1024) }, body: compact() });
    assert.equal((await run(lying)).res.status, 413);
    assert.equal((await run(req({ body: compact() }), { ...ENV, MAX_BYTES: '50' })).res.status, 413);
  });
  it('invalid JSON, non-object, unknown keys (including a smuggled recipient), wrong types → 400', async () => {
    const bads = ['{not json', '[]', '"s"', 'null',
      JSON.stringify({ ...compact(), evil: 1 }),
      JSON.stringify({ ...compact(), to: 'evil@example.net' }),
      JSON.stringify({ ...compact(), bcc: 'evil@example.net' }),
      JSON.stringify({ ...compact(), scenarios: 'nope' }),
      JSON.stringify({ ...compact(), summary: { a: 1 } })];
    for (const b of bads) {
      const { res, d } = await run(req({ body: b }));
      assert.equal(res.status, 400, b.slice(0, 40));
      assert.equal(d.sent.length, 0);
    }
  });
  it('the real compactRelayPayload() output satisfies the Worker whitelist (probe ↔ Worker contract)', async () => {
    const { res } = await run(req());
    assert.equal(res.status, 200);
  });
  it('more than 50 delivery records are trimmed to the newest 50 in the relay payload, which the Worker accepts (delivery cap)', async () => {
    const s = new core.ProbeStore({ getItem: () => null, setItem() {}, removeItem() {} });
    s.state.host.classification = 'gx-android';
    s.setScenarioResult('A', 'pass', { ua: 'x' }, 'ok');
    for (let i = 0; i < 60; i++) s.addDelivery({ channel: 'relay', outcome: `failed: try ${i}` });
    const payload = core.compactRelayPayload(s.exportPayload());
    assert.equal(payload.delivery.length, 50);
    assert.deepEqual(payload.delivery.map((d) => d.outcome), Array.from({ length: 50 }, (_, k) => `failed: try ${k + 10}`));
    const { res, d } = await run(req({ body: payload }));
    assert.equal(res.status, 200);
    assert.equal(d.sent.length, 1);
    assert.equal(s.exportPayload().delivery.length, 60, 'only the relay payload is trimmed; the local export keeps every record');
  });
});

describe('Worker — outbound mail (AC26)', () => {
  it('happy path: one send; recipient and sender come from env only; plain text; 200 + CORS to the one origin', async () => {
    const { res, d, text } = await run(req());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(d.sent.length, 1);
    const m = d.sent[0];
    assert.equal(m.to, ENV.RELAY_TO);
    assert.equal(m.from, ENV.RELAY_FROM);
    assert.equal(typeof m.text, 'string');
    assert.equal(m.html, undefined);
    assert.match(m.subject, /gx-android/);
    assert.equal(text, JSON.stringify({ ok: true }));
  });
  it('CR/LF in any field never reaches a header (subject, to, from)', async () => {
    const evil = { ...compact(), hostClassification: 'gx\r\nBcc: evil@example.net', runId: 'a\nb' };
    const { res, d } = await run(req({ body: evil }));
    if (res.status === 200) {
      for (const k of ['subject', 'to', 'from']) assert.doesNotMatch(d.sent[0][k], /[\r\n]/, k);
    } else {
      assert.equal(res.status, 400);
      assert.equal(d.sent.length, 0);
    }
  });
  it('the body text is built by the Worker from whitelisted fields (no raw echo of unknown content)', async () => {
    const { d } = await run(req());
    assert.doesNotMatch(d.sent[0].text, /^\s*[{[]/, 'must not be a raw JSON dump of the request');
  });
  it('a failing mail binding → generic 502, no detail', async () => {
    const d = deps(); d.send = async () => { throw new Error('SECRET-INTERNAL ' + ENV.RELAY_TO); };
    const { res, text } = await run(req(), ENV, d);
    assert.equal(res.status, 502);
    assert.doesNotMatch(text, /SECRET-INTERNAL|owner@example\.com/);
  });
});

describe('Worker — no echo, no logging of bodies (AC26)', () => {
  it('error bodies are fixed strings that never contain input', async () => {
    const marker = 'MARKER_q7x';
    const cases = [
      req({ code: marker }), req({ body: JSON.stringify({ [marker]: marker }) }), req({ contentType: 'text/' + marker }),
      req({ origin: 'https://' + marker + '.example.net' })
    ];
    for (const c of cases) {
      const { text } = await run(c);
      assert.doesNotMatch(text, new RegExp(marker));
      assert.match(text, /^\{"error":"[a-z-]+"\}$/);
    }
  });
  it('nothing logged contains the visit code or any body content', async () => {
    const d = deps();
    await run(req({ body: { ...compact(), summary: 'BODY_MARKER_zz' } }), ENV, d);
    await run(req({ code: 'wrong-code-zz' }), ENV, d);
    for (const l of d.logs) assert.doesNotMatch(l, /BODY_MARKER_zz|right-code-123|wrong-code-zz/);
  });
});
