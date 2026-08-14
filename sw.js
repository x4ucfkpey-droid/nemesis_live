/* NEMESIS LIVE — Service Worker (オフライン動作用) */
const CACHE = "nemesis-live-v5";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./js/store.js", "./js/engine.js", "./js/export.js", "./js/gtolink.js", "./js/stats.js", "./js/reads.js",
  "./js/ui.js", "./js/review.js", "./js/recorder.js", "./js/views.js", "./js/app.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネット優先・失敗時キャッシュ(更新が届きやすく、オフラインでも動く)
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
