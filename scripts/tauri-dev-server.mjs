#!/usr/bin/env node
/**
 * `beforeDevCommand` for `tauri dev`.
 *
 * The WebView always loads `devUrl` (http://localhost:3000), so Next must own
 * exactly that port. Without an explicit `-p`, `next dev` silently moves to
 * 3001 when 3000 is taken and the desktop window then loads whatever else is
 * listening — a blank page or a foreign app.
 *
 * Behaviour:
 * - 3000 free            → start `next dev -p 3000`
 * - 3000 already Langhuan → reuse it (a browser dev server is running); don't
 *                           start a second one, just wait for the window
 * - 3000 taken by another → fail loudly instead of showing the wrong UI
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
// Must match `build.devUrl` in src-tauri/tauri.conf.json. Not configurable on
// purpose: an override here without also editing devUrl gives a blank window.
const PORT = 3000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function probePort(host, port) {
  return new Promise((ok) => {
    const sock = createConnection({ host, port });
    sock.setTimeout(1200);
    sock.once("connect", () => {
      sock.destroy();
      ok(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      ok(false);
    });
    sock.once("error", () => ok(false));
  });
}

async function isLanghuan(port) {
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const html = await res.text();
    return html.includes("琅嬛") || html.includes("langhuan");
  } catch {
    return false;
  }
}

const busy = await probePort(HOST, PORT);
if (busy) {
  if (await isLanghuan(PORT)) {
    console.log(
      `[tauri:dev] 复用已在 ${PORT} 运行的琅嬛 dev server（不再启动第二个 Next）。`
    );
    // Keep the process alive: tauri kills beforeDevCommand on exit, and a
    // detached Next server would otherwise look like a crash.
    await new Promise(() => setInterval(() => {}, 1 << 30));
  } else {
    console.error(
      `[tauri:dev] ${PORT} 端口被其他程序占用，且不是琅嬛。\n` +
        `  WebView 固定加载 http://localhost:${PORT}，继续下去会打开别人的页面。\n` +
        `  处理：结束占用者，或换端口后同步改 src-tauri/tauri.conf.json 的 devUrl。`
    );
    process.exit(1);
  }
}

const next = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "-p", String(PORT)],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
);

const stop = () => {
  next.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => process.exit(code ?? 0));
