#!/usr/bin/env node
/**
 * Compose android-latest.json for 琅嬛 Android in-app update.
 *
 *   node scripts/write-android-latest-json.mjs \
 *     --version-code 3 \
 *     --version-name 0.1.1 \
 *     --apk src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk \
 *     --notes "安卓应用内更新" \
 *     --url-base https://github.com/Qder/Langhuan/releases/download/v0.1.1
 *
 * Uploads (Yang): android-latest.json + the APK (keep filename or set --apk-name).
 * App fetches: …/releases/latest/download/android-latest.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const versionCode = Number(arg("version-code"));
const versionName = arg("version-name");
const apkPath = arg("apk");
if (!Number.isFinite(versionCode) || versionCode < 1) {
  console.error("需要 --version-code <正整数>");
  process.exit(1);
}
if (!versionName) {
  console.error("需要 --version-name 0.1.1");
  process.exit(1);
}
if (!apkPath || !fs.existsSync(apkPath)) {
  console.error(`需要存在的 --apk 路径（当前：${apkPath || "(空)"}）`);
  process.exit(1);
}

const urlBase = arg("url-base").replace(/\/$/, "");
if (!urlBase) {
  console.error("需要 --url-base（GitHub 资源目录或本机 http://127.0.0.1:17861）");
  process.exit(1);
}
if (!/^https:\/\//i.test(urlBase) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(urlBase)) {
  console.error("url-base 必须是 HTTPS（或本机 http://127.0.0.1 测试）");
  process.exit(1);
}

const apkName = arg("apk-name", path.basename(apkPath));
const buf = fs.readFileSync(apkPath);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
const notes = arg("notes", `琅嬛 Android ${versionName} (${versionCode})`);
const pubDate = arg("pub-date", new Date().toISOString());
const apkUrl = `${urlBase}/${encodeURIComponent(apkName)}`;

const latest = {
  versionCode: Math.floor(versionCode),
  versionName,
  notes,
  pubDate,
  apkUrl,
  sha256,
};

const out = arg(
  "out",
  path.join(root, "src-tauri", "gen", "android", "app", "build", "outputs", "apk", "arm64", "release", "android-latest.json")
);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
console.log(`wrote ${out}`);
console.log(`  versionCode ${latest.versionCode}  versionName ${latest.versionName}`);
console.log(`  apkUrl      ${apkUrl}`);
console.log(`  sha256      ${sha256}`);
console.log(`  size        ${(buf.length / (1024 * 1024)).toFixed(1)} MB`);
