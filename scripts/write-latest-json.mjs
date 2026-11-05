#!/usr/bin/env node
/**
 * Compose Tauri updater latest.json from a built NSIS installer + .sig.
 *
 *   node scripts/write-latest-json.mjs \
 *     --version 0.1.1 \
 *     --notes "修复说明" \
 *     --url-base https://github.com/Qder/Langhuan/releases/download/v0.1.1
 *
 * Looks under src-tauri/target/release/bundle/nsis/ unless --setup is given.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function nsisDirs() {
  const dirs = [];
  const fromEnv = process.env.CARGO_TARGET_DIR;
  if (fromEnv) dirs.push(path.join(fromEnv, "release", "bundle", "nsis"));
  dirs.push(path.join("E:\\tmp\\langhuan-android-target", "release", "bundle", "nsis"));
  dirs.push(path.join(root, "src-tauri", "target", "release", "bundle", "nsis"));
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function findSetup(version) {
  const explicit = arg("setup");
  if (explicit) return path.resolve(explicit);
  const dirs = nsisDirs().filter((d) => fs.existsSync(d));
  if (dirs.length === 0) {
    throw new Error(`没有 NSIS 目录。先 npm run tauri:build（或设 CARGO_TARGET_DIR）`);
  }
  const hits = [];
  for (const dir of dirs) {
    const names = fs.readdirSync(dir).filter((n) => n.endsWith("-setup.exe") && !n.endsWith(".sig"));
    const match = version
      ? names.find((n) => n.includes(`_${version}_`))
      : names.sort().at(-1);
    if (match) hits.push(path.join(dir, match));
  }
  if (hits.length === 0) {
    throw new Error(`找不到 setup.exe（version=${version || "*"}）。搜过：${dirs.join("; ")}`);
  }
  return hits[0];
}

const version = arg("version");
if (!version) {
  console.error("需要 --version 0.1.1");
  process.exit(1);
}

const setup = findSetup(version);
const sigPath = arg("sig") ? path.resolve(arg("sig")) : `${setup}.sig`;
if (!fs.existsSync(sigPath)) {
  throw new Error(`缺少签名文件：${sigPath}。构建时要设 TAURI_SIGNING_PRIVATE_KEY，且 createUpdaterArtifacts=true`);
}

const fileName = path.basename(setup);
const urlBase = arg("url-base").replace(/\/$/, "");
if (!urlBase) {
  console.error("需要 --url-base（GitHub 资源目录或本机 http://127.0.0.1:17861）");
  process.exit(1);
}

const notes = arg("notes", `琅嬛 ${version}`);
const pubDate = arg("pub-date", new Date().toISOString());
const url = `${urlBase}/${encodeURIComponent(fileName)}`;

const latest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(sigPath, "utf8").trim(),
      url,
    },
  },
};

const out = arg("out", path.join(path.dirname(setup), "latest.json"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
console.log(`wrote ${out}`);
console.log(`  version ${version}`);
console.log(`  url     ${url}`);
