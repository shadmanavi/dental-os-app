"use client";

// Service worker registrar — v1
//
// Renders nothing. Its only job is to register /sw.js once, in the browser,
// after the page has settled.
//
// Why it exists: Chrome will not offer "Install app" on Android unless the
// site has a service worker with a fetch handler. The manifest alone gets you
// a plain home-screen shortcut. iOS does not require this at all, but it does
// no harm there.
//
// Registration is deliberately late and deliberately quiet. It waits for
// window load so it never competes with the first render, and a failure is
// logged rather than surfaced — a tablet that cannot register a worker should
// still be a working app, just an uninstallable one.
//
// Development is skipped outright. A service worker that caches a dev build
// is a debugging trap, and the whole reason the build badge exists is that
// stale-versus-live is the failure mode that does not announce itself.
//
// Changelog:
//   v1  New.

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((error: unknown) => {
          console.warn("Service worker registration failed:", error);
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
