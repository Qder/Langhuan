#!/usr/bin/env node
/**
 * Tiny static file server for updater test channel (HTTP).
 * Production apps must use HTTPS GitHub Releases — this is only for local overlay builds.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const dir = path.resolve(arg("dir", path.join(root, "src-tauri", "target", "release", "bundle", "nsis")));
const port = Number(arg("port", "17861"));

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const rel = decodeURIComponent(url.pathname.replace(/^\//, "")) || "latest.json";
  if (rel.includes("..")) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  const file = path.join(dir, rel);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const type = rel.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`updater fixture http://127.0.0.1:${port}/  dir=${dir}`);
});
