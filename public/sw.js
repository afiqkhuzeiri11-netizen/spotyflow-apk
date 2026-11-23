const SHELL_CACHE = 'spotyflow-shell-v78';
const RUNTIME_CACHE = 'spotyflow-runtime-v78';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  const validCaches = new Set([SHELL_CACHE, RUNTIME_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !validCaches.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'CLEAR_OFFLINE_CACHE') {
    event.waitUntil(
      caches.delete(RUNTIME_CACHE).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ cleared: true });
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // WAJIB: Lewati (JANGAN intercept/cache) seluruh stream audio/video & range request
  const isAudioOrVideoDest = req.destination === 'audio' || req.destination === 'video';
  const isMediaExt = /\.(mp3|m4a|aac|webm|ogg|wav|flac|mp4|m3u8|ts|apk)$/i.test(url.pathname);
  const isExternalAudioHost =
    /googlevideo\.com|audius\.co|dzcdn\.net|audio-ssl\.itunes\.apple\.com|saavncdn\.com|piped|invidious|yewtu/i.test(
      url.hostname
    );

  if (
    isAudioOrVideoDest ||
    isMediaExt ||
    isExternalAudioHost ||
    req.headers.has('range') ||
    url.pathname.startsWith('/api/audio/') ||
    url.pathname.startsWith('/api/auth/') ||
    url.pathname.startsWith('/api/user/') ||
    url.pathname.startsWith('/api/jam/') ||
    url.pathname.startsWith('/api/v1/') ||
    url.pathname.startsWith('/api/health') ||
    url.pathname.startsWith('/api/app-version') ||
    url.pathname.startsWith('/api/proxy-image')
  ) {
    return;
  }

  // Halaman HTML utama: Network-First dengan fallback cache untuk mode offline PWA
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/spotyflow.html') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((m) => m || caches.match('/')))
    );
    return;
  }

  // Manifest & Ikon PWA: Network-First agar pembaruan langsung terbaca
  if (
    url.pathname === '/manifest.json' ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png'
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Endpoint API publik (Katalog, Pencarian, Profil, Lirik, Charts): Network-First dengan fallback cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: 'Sedang offline. Periksa koneksi internet Anda.' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
              })
          )
        )
    );
    return;
  }

  // Aset statis lain: Network-First ringan dengan fallback cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
