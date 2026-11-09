// probe/sw.js — offline shell for the field instrument. Same-origin GETs are served network-first and cached,
// so a reload with no network (or a flaky school Wi-Fi) still opens the page. The SMART WDK script is cross-origin
// and is never cached: scenario B must measure the real network.
const CACHE = 'smart-board-probe-v1';

const SHELL = [
  './', 'index.html', 'probe.css', 'app.js', 'probe-core.js', 'manifest.json',
  '../design-system/styles.css',
  ...['fonts', 'colors', 'typography', 'spacing', 'radii', 'elevation', 'roles', 'icons', 'base'].map((n) => `../design-system/tokens/${n}.css`),
  ...['primitives', 'forms', 'feedback', 'navigation', 'board', 'course'].map((n) => `../design-system/components/${n}.css`),
  ...['FiraSans-400-italic', 'FiraSans-400', 'FiraSans-500', 'FiraSans-700', 'PatrickHand-400'].map((n) => `../design-system/assets/fonts/${n}.woff2`),
  ...['arrow-right', 'check', 'chevron-down', 'chevron-right', 'circle', 'circle-alert', 'circle-check', 'clipboard-list', 'clock', 'download',
    'eraser', 'eye', 'file-text', 'hand', 'info', 'layout-grid', 'lock', 'maximize', 'minus', 'pen', 'play', 'plus', 'save', 'triangle-alert',
    'undo-2', 'x', 'zoom-in'].map((n) => `../design-system/assets/icons/${n}.svg`)
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
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
