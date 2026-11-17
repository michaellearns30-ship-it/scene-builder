/* Scene Builder service worker — caches the app shell and, after the first visit, the Three.js
   modules it loads from unpkg, so the editor opens with no signal. Recorded videos never leave
   the phone: they are made by MediaRecorder on a canvas and saved straight to downloads. */
const CACHE = "scene-builder-v1";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-512.png"
];

const CDN = [
  "https://unpkg.com/three@0.160.0/build/three.module.js",
  "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Opaque cross-origin responses cannot go through cache.addAll, so each one is stored
    // on its own and a CDN hiccup never breaks the install.
    await Promise.all(CDN.map(async (url) => {
      try {
        const response = await fetch(url, { mode: "no-cors" });
        if (response) await cache.put(url, response);
      } catch (err) { /* retried on the next visit */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((hit) => hit || fetch(request).catch(() => caches.match("./")))
    );
    return;
  }

  // Cached copy first, refreshed in the background when there is a network.
  event.respondWith(
    caches.match(request, { ignoreSearch: url.origin !== location.origin }).then((hit) => {
      const network = fetch(request).then((response) => {
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
