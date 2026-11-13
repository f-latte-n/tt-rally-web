// Service Worker：アプリ本体（HTML・JS・CSS）を端末にしまい、通信がなくても開けるようにする。
// 動画は扱わない（動画は blob: / OPFS なので、ここを通らない）。
// 版は登録時の ?v=（app.js の VER）。版が変わると新しい SW が入り、古いしまい場所を消す。
'use strict';
const VER = new URL(location.href).searchParams.get('v') || '0';
const CACHE = 'rally-' + VER;
const q = '?v=' + VER;
const FILES = [
  'app.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/mp4box.all.min.js', 'vendor/fonts/barlow-400.woff2', 'vendor/fonts/barlow-700.woff2', 'vendor/fonts/barlow-condensed-600.woff2',
  'opfs-write.js',
  'app.css' + q, 'source.js' + q, 'remux.js' + q, 'store.js' + q, 'platform.js' + q, 'app.js' + q,
  'worker.js' + q, 'detect.js' + q,
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))); // HTTP キャッシュを通さず最新を取る
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rally-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// app.html：通信できれば最新を取る（更新をすぐ届けるため）（3秒で返らなければ、しまってある版）。それ以外：しまってあればそれ、なければ通信。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    if (!/\/app\.html$/.test(url.pathname)) return;
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});

async function networkFirst(req) {
  const cached = () => caches.match(req, { ignoreSearch: true });
  // no-cache：HTTP キャッシュ（GitHub Pages は10分）に古い HTML が残っていても、サーバーに確かめる
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }); // しまう版は install で入れたものだけ（JS・CSS と版をそろえるため）
  net.catch(() => {});
  const timeout = new Promise((ok) => setTimeout(ok, 3000));
  try {
    const r = await Promise.race([net, timeout]);
    if (r) return r;
    return (await cached()) || (await net);
  } catch (e) {
    const c = await cached();
    if (c) return c;
    throw e;
  }
}
