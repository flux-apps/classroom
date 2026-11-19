// probe/sw.js — offline shell for the field instrument. Same-origin GETs are served network-first and cached,
// so a reload with no network (or a flaky school Wi-Fi) still opens the page. The SMART WDK script is cross-origin
// and is never cached: scenario B must measure the real network.
// The relay POST (G2 channel 3) is cross-origin and non-GET: this worker never touches it (AC23). The only POST it
// handles is the H6 share_target, which is same-origin and gets its own branch before the early return.
const CACHE = 'smart-board-probe-v1';

// describeSharedFile lives in probe-core.js (UMD: self.ProbeCore here). If the import fails the share still reports size.
try { importScripts('probe-core.js'); } catch (_) { /* metadata falls back to mime and byte size */ }

const SHELL = [
  './', 'index.html', 'probe.css', 'app.js', 'probe-core.js', 'manifest.json',
  '../design-system/styles.css',
  ...['fonts', 'colors', 'typography', 'spacing', 'radii', 'elevation', 'roles', 'icons', 'base'].map((n) => `../design-system/tokens/${n}.css`),
  ...['primitives', 'forms', 'feedback', 'navigation', 'board', 'course'].map((n) => `../design-system/components/${n}.css`),
  ...['FiraSans-400-italic', 'FiraSans-400', 'FiraSans-500', 'FiraSans-700', 'PatrickHand-400'].map((n) => `../design-system/assets/fonts/${n}.woff2`),
  ...['arrow-left', 'arrow-right', 'check', 'chevron-down', 'chevron-right', 'circle', 'circle-alert', 'circle-check', 'clipboard-list', 'clock', 'download',
    'eraser', 'external-link', 'eye', 'file-text', 'file-up', 'hand', 'image', 'info', 'layout-grid', 'link', 'lock', 'maximize', 'minus', 'pen', 'play', 'plus',
    'rotate-cw', 'save', 'settings', 'trash-2', 'triangle-alert', 'undo-2', 'upload', 'x', 'zoom-in', 'zoom-out'].map((n) => `../design-system/assets/icons/${n}.svg`)
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// H6: read the shared file, keep only metadata (MIME, byte size, pixel size, hasAlpha), discard the content, and hand the
// metadata to the page in the redirect URL. Nothing is stored or sent.
async function receiveShare(req) {
  let meta;
  try {
    const form = await req.formData();
    const file = form.get('file');
    const bytes = new Uint8Array(await file.arrayBuffer());
    meta = self.ProbeCore && self.ProbeCore.describeSharedFile
      ? self.ProbeCore.describeSharedFile(bytes, file.type)
      : { mime: file.type, byteSize: bytes.length, width: null, height: null, hasAlpha: null };
  } catch (_) {
    meta = { error: 'unreadable' };
  }
  const packed = btoa(JSON.stringify(meta)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return Response.redirect(new URL('index.html?share=' + packed, self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
