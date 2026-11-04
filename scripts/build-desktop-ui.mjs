#!/usr/bin/env node
/**
 * Build the static UI that ships inside the Tauri bundle.
 *
 * `npm run dev` / `next build` keep the server build (browser is the full
 * product). This script flips `next.config.ts` into desktop-export mode, which
 * drops the Route Handlers (`src/app/api/**\/route.ts`) and emits a plain
 * static site into `out/`. `src-tauri/tauri.conf.json#build.frontendDist`
 * points at that folder.
 *
 * Why dropping the API is safe: the packaged app reads and writes the library
 * through Rust `invoke` commands, see `src/lib/storage/contentApi.ts`
 * (`isTauriRuntime()` branches).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "out");

/** Minimal `npm` invocation that works on Windows without a POSIX shell. */
function npmRun(args, env) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npm, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // npm.cmd is a batch file; without a shell Windows refuses to spawn it.
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(`\n[desktop-ui] 失败：npm ${args.join(" ")} (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

npmRun(["run", "gen:bridge"]);
npmRun(["exec", "--", "next", "build"], { LANGHUAN_DESKTOP_EXPORT: "1" });

if (!existsSync(join(outDir, "index.html"))) {
  console.error("[desktop-ui] 构建后没有 out/index.html —— 检查 next.config.ts 的 desktop export 分支");
  process.exit(1);
}

const fileCount = readdirSync(outDir, { recursive: true }).length;
console.log(`[desktop-ui] 静态 UI 就绪：${outDir}（${fileCount} 个条目）`);
