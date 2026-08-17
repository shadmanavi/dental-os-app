import type { MetadataRoute } from "next";

// Web app manifest — v1
//
// This is what turns the Vercel URL into something a tablet can install to
// its home screen and launch without browser chrome around it. Next serves
// this route as /manifest.webmanifest and injects the <link rel="manifest">
// itself, so nothing has to be added to <head> by hand.
//
// Why each field is here, rather than as decoration:
//
//   display: "standalone"   Removes the address bar. Without it the app
//                           launches inside Safari/Chrome and staff can
//                           navigate away from it, which is the whole
//                           problem on a shared operatory tablet.
//   start_url / scope       Anchored at "/". Scope is what keeps a link tap
//                           inside the installed window instead of bouncing
//                           out to the browser.
//   id                      Fixed, so a later change to start_url updates the
//                           installed app instead of creating a second one.
//   icons                   Chrome requires both a 192 and a 512 before it
//                           will offer Install at all. The maskable copy is
//                           the one Android crops into its own shape; without
//                           it the launcher shrinks the square icon and pads
//                           it with white.
//   orientation: "any"      The charting screen gets used both ways.
//
// Changelog:
//   v1  New. The app had no manifest, so Android never offered Install and
//       iPad added a bookmark that opened in Safari.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dental OS",
    short_name: "Dental OS",
    description: "Practice tools for Greenwood Dental Services.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F7F6F3",
    theme_color: "#2C4E54",
    categories: ["medical", "productivity", "business"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
