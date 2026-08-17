import type { NextConfig } from "next";

// Next config — v1
//
// Stamps the build so the running app can say what it is. Vercel supplies
// the commit itself as NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, but it has no
// build-time variable, so that one is generated here. This file is
// evaluated once per build, which is exactly when the stamp should be
// taken.
//
// Why this exists at all: a failed Vercel build is silent. The previous
// deployment stays live and nothing errors, so a push that never shipped
// looks identical to one that did. The badge in TopNav reads these two
// values, and unlike a hand-typed version number it cannot be wrong —
// nobody types it.
//
// Changelog:
//   v1  Adds NEXT_PUBLIC_BUILD_TIME. Was the untouched create-next-app
//       scaffold before this.

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
