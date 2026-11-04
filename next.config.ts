import type { NextConfig } from "next";

/**
 * Desktop export mode (`npm run desktop:ui`, invoked by `tauri build`).
 *
 * The Tauri shell reads/writes the library through Rust `invoke` commands
 * (`src-tauri/src/content.rs`), so the packaged UI never calls the Next Route
 * Handlers. That lets us ship a pure static export:
 *
 * - `output: "export"` — emit HTML/CSS/JS into `out/`, which
 *   `src-tauri/tauri.conf.json#build.frontendDist` points at.
 * - `pageExtensions` without `ts` — drops `src/app/api/**\/route.ts` from the
 *   build. Those handlers are `force-dynamic` and cannot coexist with
 *   `output: "export"`; the desktop app must not depend on them.
 * - no `headers()` — header rules are a server feature and are unsupported in
 *   a static export.
 */
const desktopExport = process.env.LANGHUAN_DESKTOP_EXPORT === "1";

const nextConfig: NextConfig = {
  // Box browser / computerUse hit 127.0.0.1 while Next advertises localhost — allow both for HMR/_next.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(desktopExport
    ? {
        output: "export" as const,
        // Static export writes to `out/` (next uses `distDir` as the export
        // target). A separate dir from `.next` keeps `npm run desktop:ui` from
        // clobbering a running `npm run dev` / a browser `next build`.
        distDir: "out",
        pageExtensions: ["tsx"],
        images: { unoptimized: true },
      }
    : {
        headers: async () => [
          {
            source: "/sw.js",
            headers: [
              { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
              { key: "Service-Worker-Allowed", value: "/" },
            ],
          },
          {
            source: "/manifest.webmanifest",
            headers: [{ key: "Content-Type", value: "application/manifest+json" }],
          },
        ],
      }),
};

export default nextConfig;
