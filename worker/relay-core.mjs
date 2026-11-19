// worker/relay-core.mjs — pure core of the smart-board-probe relay (spec AC23, AC26; tech-plan §8).
// `handleRelay(request, env, deps)` takes a duck-typed request (method, headers.get, text() or a body stream),
// the Worker environment and injected effects, and returns a Response. It imports nothing from the platform:
// no platform module, no network, no storage — the adapter (index.mjs) wires the real mail binding.
//
// Nothing in this file holds a deployment value. Recipient, sender, allowed origin and visit code all come from `env`
// (dashboard variables), never from the request. Nothing from the request is echoed or logged.

const DEFAULT_MAX_BYTES = 100 * 1024;
const ENC = new TextEncoder();

const TOP_KEYS = ['v', 'runId', 'startedAt', 'finishedAt', 'runState', 'complete', 'hostClassification',
  'fingerprint', 'scenarios', 'overlayFollow', 'delivery', 'summary'];
const REQUIRED_KEYS = ['v', 'runId', 'runState', 'complete', 'hostClassification', 'scenarios', 'summary'];
const RUN_STATES = ['empty', 'partial', 'finished'];
const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const CLASS_RE = /^[a-z0-9-]{1,32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SC_ID_RE = /^[A-Za-z0-9]{1,12}$/;
const WORD_RE = /^[a-z0-9-]{1,24}$/;
const ADDRESS_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}$/;
const TOKEN_RE = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/;
const MAX_SUMMARY = 8000;

/* ------------------------------------------------------------------ visit code */

// Constant-time string compare: the loop always runs over the longer input and folds the length difference in.
export function timingSafeEqual(a, b) {
  const x = ENC.encode(String(a));
  const y = ENC.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacB64url(secret, message) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, ENC.encode(message))));
}

// Stateless expiring token for the private link's #fragment (OQ12: the fragment may persist in Chrome history, so it
// must expire on its own). `v1.<expUnixSeconds>.<HMAC-SHA256(VISIT_CODE, "v1."+exp)>`.
export async function mintVisitToken(code, expUnix) {
  const exp = Math.floor(Number(expUnix));
  return `v1.${exp}.${await hmacB64url(code, 'v1.' + exp)}`;
}

async function visitCodeOk(given, env, nowMs) {
  const secret = env.VISIT_CODE;
  if (typeof secret !== 'string' || secret.length === 0) return false;   // unset secret: fail closed
  if (typeof given !== 'string' || given.length === 0 || given.length > 256) return false;
  if (timingSafeEqual(given, secret)) return true;
  const m = TOKEN_RE.exec(given);
  if (!m) return false;
  if (!(Number(m[1]) * 1000 > nowMs)) return false;                        // expired
  return timingSafeEqual(m[2], await hmacB64url(secret, 'v1.' + m[1]));
}

/* ------------------------------------------------------------------ responses */

function corsHeaders(origin, env) {
  const allowed = typeof env.ALLOWED_ORIGIN === 'string' && env.ALLOWED_ORIGIN !== '' ? env.ALLOWED_ORIGIN : null;
  return allowed && origin === allowed ? { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' } : {};
}

function reply(status, body, headers) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: Object.assign(body === null ? {} : { 'Content-Type': 'application/json' }, headers || {})
  });
}

const fail = (status, code, headers) => reply(status, { error: code }, headers);

/* ------------------------------------------------------------------ body + shape */

async function readCapped(request, cap) {
  if (request.body && typeof request.body.getReader === 'function') {
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) { try { await reader.cancel(); } catch (_) { /* ignore */ } return null; }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    return new TextDecoder().decode(all);
  }
  const text = await request.text();
  return ENC.encode(text).length > cap ? null : text;
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

// Whitelist: only the compact payload the probe builds (compactRelayPayload). Header-bound fields get a strict pattern
// so no CR/LF can ever reach a mail header; anything else is rejected, not repaired.
function validShape(p) {
  if (!isPlain(p)) return false;
  for (const k of Object.keys(p)) if (!TOP_KEYS.includes(k)) return false;
  for (const k of REQUIRED_KEYS) if (!(k in p)) return false;
  if (p.v !== 1) return false;
  if (typeof p.runId !== 'string' || !RUN_ID_RE.test(p.runId)) return false;
  if (typeof p.hostClassification !== 'string' || !CLASS_RE.test(p.hostClassification)) return false;
  if (!RUN_STATES.includes(p.runState)) return false;
  if (typeof p.complete !== 'boolean') return false;
  for (const k of ['startedAt', 'finishedAt']) if (k in p && !(typeof p[k] === 'string' && ISO_RE.test(p[k]))) return false;
  if (!isStr(p.summary, MAX_SUMMARY)) return false;
  if (!Array.isArray(p.scenarios) || p.scenarios.length > 20) return false;
  for (const s of p.scenarios) {
    if (!isPlain(s) || typeof s.id !== 'string' || !SC_ID_RE.test(s.id) || !isStr(s.status, 12)) return false;
  }
  if ('fingerprint' in p && !isPlain(p.fingerprint)) return false;
  if ('overlayFollow' in p && !isPlain(p.overlayFollow)) return false;
  if ('delivery' in p && !(Array.isArray(p.delivery) && p.delivery.length <= 50)) return false;
  return true;
}

/* ------------------------------------------------------------------ outbound mail */

const oneLine = (s, max) => String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max);
const bodyText = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, ' ');

function buildMail(p, env) {
  const date = (p.finishedAt || p.startedAt || '').slice(0, 10) || 'no-date';
  const subject = oneLine(`Probe ${p.hostClassification} ${date} complete=${p.complete}`, 120);
  const mech = isPlain(p.overlayFollow) && typeof p.overlayFollow.mechanism === 'string' && WORD_RE.test(p.overlayFollow.mechanism)
    ? p.overlayFollow.mechanism : 'n/a';
  const lines = [
    bodyText(p.summary),
    '',
    '--',
    `runId: ${p.runId}`,
    `state: ${p.runState} · complete=${p.complete}`,
    `scenarios: ${p.scenarios.map((s) => `${s.id} ${oneLine(s.status, 12)}`).join(' · ')}`,
    `overlayFollow.mechanism: ${mech}`,
    `delivery entries before this send: ${Array.isArray(p.delivery) ? p.delivery.length : 0}`,
    'Sent by the probe relay. The recipient is fixed in the relay configuration.'
  ];
  return { from: oneLine(env.RELAY_FROM, 254), to: oneLine(env.RELAY_TO, 254), subject, text: lines.join('\n') };
}

/* ------------------------------------------------------------------ handler (tech-plan §8 order) */

export async function handleRelay(request, env, deps) {
  const d = deps || {};
  const now = typeof d.now === 'function' ? d.now : Date.now;
  const log = typeof d.log === 'function' ? d.log : () => {};
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin, env);

  // 1. CORS preflight (the custom header forces one): grant only the single probe origin.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: Object.assign({
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-visit-code',
        'Access-Control-Max-Age': '600'
      }, cors)
    });
  }
  // 2. POST only.
  if (request.method !== 'POST') return fail(405, 'method-not-allowed', Object.assign({ Allow: 'POST' }, cors));
  // 3. A present Origin must be the probe's. (Missing Origin = non-browser client; the visit code is the real gate.)
  if (origin !== null && origin !== undefined && origin !== '' && !('Access-Control-Allow-Origin' in cors)) {
    log('relay: reject 403');
    return fail(403, 'origin-not-allowed');
  }
  // 4. JSON only.
  const ctype = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/json') { log('relay: reject 415'); return fail(415, 'unsupported-media-type', cors); }
  // 5. Visit code, before the body is read.
  if (!(await visitCodeOk(request.headers.get('x-visit-code'), env, now()))) { log('relay: reject 401'); return fail(401, 'unauthorized', cors); }
  // 6. Size cap: declared length first, then the bytes actually read.
  const parsedMax = parseInt(env.MAX_BYTES, 10);
  const cap = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_BYTES;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) { log('relay: reject 413'); return fail(413, 'payload-too-large', cors); }
  const text = await readCapped(request, cap);
  if (text === null) { log('relay: reject 413'); return fail(413, 'payload-too-large', cors); }
  // 7. JSON + whitelist shape.
  let payload;
  try { payload = JSON.parse(text); } catch (_) { log('relay: reject 400'); return fail(400, 'bad-request', cors); }
  if (!validShape(payload)) { log('relay: reject 400'); return fail(400, 'bad-request', cors); }
  // 8. Build the mail from whitelisted fields; recipient and sender are configuration, never input.
  try {
    if (!ADDRESS_RE.test(String(env.RELAY_TO)) || !ADDRESS_RE.test(String(env.RELAY_FROM)) || typeof d.send !== 'function') throw new Error('config');
    await d.send(buildMail(payload, env));
  } catch (_) {
    log('relay: reject 502');
    return fail(502, 'relay-failed', cors);
  }
  // 9. Done.
  return reply(200, { ok: true }, cors);
}
