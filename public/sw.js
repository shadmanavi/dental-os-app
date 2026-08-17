/* Dental OS service worker — v1
 *
 * Deliberately the smallest worker that does the job.
 *
 * What it does:
 *   - Caches one file, /offline.html, so a tablet that loses Wi-Fi in an
 *     operatory gets a branded "no connection" page instead of Chrome's
 *     dinosaur or Safari's blank grey.
 *   - Handles fetch, which is the actual requirement for Chrome to offer
 *     "Install app".
 *
 * What it deliberately does not do: cache the application. This app reads
 * live from OpenDental through Edge Functions and the whole point of the
 * build badge is that stale-versus-live must never be ambiguous. A caching
 * worker would serve yesterday's JavaScript against today's Edge Function
 * with nothing failing and nothing visibly wrong — exactly the class of
 * silent drift this project has already been bitten by. So every request
 * goes to the network, always.
 *
 * skipWaiting + clients.claim mean a new worker takes over on the next
 * launch rather than waiting for every tab to close. On a shared tablet
 * nobody closes tabs.
 *
 * Changelog:
 *   v1  New.
 */

const CACHE = "dental-os-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only page navigations get the offline fallback. Everything else — API
  // calls, Edge Function calls, scripts, images — passes straight through
  // untouched, so a network error stays a network error and the app's own
  // error handling sees it.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => {
        if (cached) return cached;
        return new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        });
      })
    )
  );
});
