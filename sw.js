// Minimal service worker — required by Chrome's install/"Add to desktop"
// criteria. It doesn't cache anything; every request just passes through to
// the network, so this app always sees fresh guide/stream data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
