// tests/probe-hygiene.test.js — AC25: the repo is public; no deployment value is ever tracked.
// Scans tracked files under probe/ and worker/ for email literals, *.workers.dev, account_id; checks ignore rules.
// CI runs this file via `node --test tests/*.test.js` (see .github/workflows/pages.yml).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ALLOWED_EMAILS = new Set(['you@example.com']);
const ALLOWED_URL = /^https:\/\/relay\.example\.com\//;
const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|md|toml|txt|yml|yaml|svg|webmanifest)$/i;

// Exported-by-copy so the self-test below proves the scanner would catch a leak.
function scan(text) {
  const hits = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
    if (!ALLOWED_EMAILS.has(m[0])) hits.push('email:' + m[0]);
  }
  for (const m of text.matchAll(/(?:[A-Za-z0-9-]+\.)+workers\.dev/g)) hits.push('workers.dev:' + m[0]);
  for (const m of text.matchAll(/account_id\s*[=:]\s*["']?[0-9a-f]{8,}/gi)) hits.push('account_id:' + m[0]);
  return hits;
}

function trackedFiles(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '--', dir], { cwd: ROOT, encoding: 'utf8' });
    const files = out.split('\n').filter(Boolean);
    if (files.length) return files.map((f) => path.join(ROOT, f));
  } catch (_) { /* not a git checkout: fall through */ }
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  return walk(path.join(ROOT, dir));
}

describe('AC25 — public-repo hygiene', () => {
  it('scanner self-test: catches an address, a workers.dev host and an account id; allows the two placeholders', () => {
    assert.deepEqual(scan('mail me@example.org'), ['email:me@example.org']);
    assert.deepEqual(scan('https://relay-x.alex.workers.dev/p'), ['workers.dev:relay-x.alex.workers.dev']);
    assert.equal(scan('account_id = "0123456789abcdef0123456789abcdef"').length, 1);
    assert.deepEqual(scan('you@example.com and https://relay.example.com/probe'), []);
    assert.match('https://relay.example.com/probe', ALLOWED_URL);
  });
  it('no tracked file under probe/ or worker/ contains a deployment value', () => {
    const files = [...trackedFiles('probe'), ...trackedFiles('worker')].filter((f) => TEXT_EXT.test(f));
    const bad = [];
    for (const f of files) for (const h of scan(fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(ROOT, f)}: ${h}`);
    assert.deepEqual(bad, []);
  });
  it('the only https URL placeholder in probe/ UI copy is https://relay.example.com/…', () => {
    const bad = [];
    for (const f of trackedFiles('probe').filter((x) => /\.(html|js)$/.test(x))) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/placeholder\s*[=:]\s*["'](https?:\/\/[^"']+)["']/g)) if (!ALLOWED_URL.test(m[1])) bad.push(`${path.relative(ROOT, f)}: ${m[1]}`);
    }
    assert.deepEqual(bad, []);
  });
  it('.gitignore hides .dev.vars and local wrangler config', () => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gi, /^\.dev\.vars$/m);
    assert.match(gi, /^worker\/wrangler\.local\.\*$/m);
  });
  it('worker/ exists with the tested core, a thin adapter and a placeholder-only wrangler template', () => {
    for (const f of ['relay-core.mjs', 'index.mjs', 'wrangler.example.toml', 'README.md']) assert.ok(fs.existsSync(path.join(ROOT, 'worker', f)), f);
  });
  it('the wrangler template never pins a destination address or a real route (values come from the dashboard)', () => {
    const p = path.join(ROOT, 'worker', 'wrangler.example.toml');
    assert.ok(fs.existsSync(p), 'wrangler.example.toml missing');
    const t = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(t, /destination_address|allowed_destination_addresses/);
    assert.doesNotMatch(t, /^\s*(routes?|account_id)\s*=/m);
  });
  it('the adapter does not import the Cloudflare email module from the tested core', () => {
    const core = path.join(ROOT, 'worker', 'relay-core.mjs');
    assert.ok(fs.existsSync(core), 'relay-core.mjs missing');
    assert.doesNotMatch(fs.readFileSync(core, 'utf8'), /cloudflare:/);
  });
});
