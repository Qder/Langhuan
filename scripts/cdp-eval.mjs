#!/usr/bin/env node
/** Evaluate JS in a WebView2 page exposed on --remote-debugging-port (Node 22 WebSocket). */
import fs from "node:fs";
const port = Number(process.env.CDP_PORT || "9222");
const fileIdx = process.argv.indexOf("--file");
const expression =
  fileIdx >= 0
    ? fs.readFileSync(process.argv[fileIdx + 1], "utf8")
    : process.argv.slice(2).join(" ").trim();
if (!expression && !process.argv.includes("--click")) {
  console.error("usage: node scripts/cdp-eval.mjs <javascript> | --file path.js | --click css");
  process.exit(1);
}

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page =
  pages.find((p) => /tauri\.localhost|localhost:3000|琅嬛/.test(`${p.url} ${p.title}`)) ||
  pages.find((p) => p.type === "page") ||
  pages[0];
if (!page?.webSocketDebuggerUrl) {
  console.error("no cdp page", pages);
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("ws error")));
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cdp timeout ${method}`)), 60_000);
    const onMsg = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMsg);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

if (process.argv.includes("--click")) {
  const sel = process.argv[process.argv.indexOf("--click") + 1];
  const loc = await send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height }; })()`,
    returnByValue: true,
  });
  const box = loc.result?.value;
  if (!box) {
    console.error(`no element ${sel}`);
    process.exit(4);
  }
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  console.log(JSON.stringify({ clicked: sel, ...box }));
  ws.close();
  process.exit(0);
}

const result = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
  timeout: 55_000,
});
if (result.exceptionDetails) {
  const d = result.exceptionDetails;
  const text = d.exception?.description || d.text || JSON.stringify(d);
  console.error(text);
  process.exit(3);
}
const value = result.result?.value;
console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
ws.close();
