/** Injected into HTML srcDoc for preview only — never saved/exported. */

import {
  BRIDGE_INBOUND_TYPES,
  BRIDGE_MAX_MESSAGE_CHARS,
  type BridgeInboundMessage,
  type BridgeInboundType,
} from "./types";

const BRIDGE_TYPE_SET = new Set<string>(BRIDGE_INBOUND_TYPES);

/** Thin scrollbar only — preview chrome, never written to source/export. */
const PREVIEW_SCROLLBAR_CSS = `
html{scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.45) transparent;}
::-webkit-scrollbar{width:6px;height:6px;}
::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4);border-radius:3px;}
::-webkit-scrollbar-track{background:transparent;}
`.replace(/\s+/g, " ").trim();

export const HTML_LOCATE_BRIDGE = `
<script data-lh-bridge="1">
(function () {
  if (window.__lhBridge) return;
  window.__lhBridge = true;

  try {
    var style = document.createElement("style");
    style.setAttribute("data-lh-preview-chrome", "1");
    style.textContent = ${JSON.stringify(PREVIEW_SCROLLBAR_CSS)};
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  function tagPath(node) {
    var parts = [];
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    var depth = 0;
    while (el && el !== document.body && depth < 12) {
      var parent = el.parentElement;
      var idx = 0;
      if (parent) {
        var sibs = parent.children;
        var same = 0;
        for (var j = 0; j < sibs.length; j++) {
          if (sibs[j].tagName === el.tagName) {
            if (sibs[j] === el) { idx = same; break; }
            same++;
          }
        }
      }
      parts.unshift(el.tagName.toLowerCase() + "[" + idx + "]");
      el = parent;
      depth++;
    }
    return parts.join(">");
  }

  function selPayload() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var text = String(sel);
    if (!text || !text.trim()) return null;
    var range = sel.getRangeAt(0);
    var before = "";
    var after = "";
    try {
      var pre = range.cloneRange();
      pre.selectNodeContents(document.body);
      pre.setEnd(range.startContainer, range.startOffset);
      before = String(pre).slice(-30);
      var post = range.cloneRange();
      post.selectNodeContents(document.body);
      post.setStart(range.endContainer, range.endOffset);
      after = String(post).slice(0, 30);
    } catch (e) {}
    var rect = range.getBoundingClientRect();
    return {
      text: text,
      before: before,
      after: after,
      tagPath: tagPath(range.startContainer),
      rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }
    };
  }

  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function reportBg() {
    var color = "";
    try {
      if (document.body) color = getComputedStyle(document.body).backgroundColor || "";
    } catch (e) {}
    parent.postMessage({ type: "lh-bg", color: color }, "*");
  }

  function reportScroll() {
    var se = document.scrollingElement || document.documentElement;
    var max = (se.scrollHeight || 0) - (se.clientHeight || 0);
    var pct = max > 0 ? (se.scrollTop / max) * 100 : 0;
    parent.postMessage({ type: "lh-scroll", percent: pct }, "*");
  }

  function onReady() {
    reportBg();
    reportScroll();
    parent.postMessage({ type: "lh-ready" }, "*");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
  window.addEventListener("load", function () { reportBg(); reportScroll(); });
  window.addEventListener("scroll", reportScroll, { passive: true });

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey) {
      var p = selPayload();
      if (!p) {
        parent.postMessage({ type: "lh-locate", text: "", before: "", after: "", tagPath: "" }, "*");
        return;
      }
      e.preventDefault();
      parent.postMessage({ type: "lh-locate", text: p.text, before: p.before, after: p.after, tagPath: p.tagPath }, "*");
      return;
    }

    var key = e.key;
    var meta = e.metaKey || e.ctrlKey;
    var forward = false;
    if (meta && (key === "k" || key === "K" || key === "e" || key === "E")) forward = true;
    if (!meta && (key === "f" || key === "F") && !isTypingTarget(e.target)) forward = true;
    if (key === "Escape") forward = true;
    if (!forward) return;
    e.preventDefault();
    parent.postMessage({
      type: "lh-keydown",
      key: key,
      metaKey: !!e.metaKey,
      ctrlKey: !!e.ctrlKey,
      altKey: !!e.altKey,
      shiftKey: !!e.shiftKey
    }, "*");
  }, true);

  document.addEventListener("contextmenu", function (e) {
    var p = selPayload();
    if (!p) return;
    e.preventDefault();
    parent.postMessage({
      type: "lh-contextmenu",
      text: p.text,
      before: p.before,
      after: p.after,
      tagPath: p.tagPath,
      x: e.clientX,
      y: e.clientY,
      rect: p.rect
    }, "*");
  }, true);

  document.addEventListener("selectionchange", function () {
    var p = selPayload();
    if (!p) {
      parent.postMessage({ type: "lh-selection", text: "", before: "", after: "", tagPath: "" }, "*");
      return;
    }
    parent.postMessage({
      type: "lh-selection",
      text: p.text,
      before: p.before,
      after: p.after,
      tagPath: p.tagPath,
      rect: p.rect
    }, "*");
  });

  function isInteractive(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (!el.tagName) break;
      var tag = el.tagName.toLowerCase();
      if (tag === "a" || tag === "button" || tag === "input" || tag === "textarea" ||
          tag === "select" || tag === "label" || tag === "summary" || tag === "option" ||
          tag === "video" || tag === "audio") return true;
      if (el.isContentEditable) return true;
      if (el.getAttribute) {
        if (el.getAttribute("onclick") != null) return true;
        var role = el.getAttribute("role");
        if (role === "button" || role === "link" || role === "textbox" || role === "checkbox" ||
            role === "radio" || role === "switch" || role === "tab" || role === "menuitem") return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function climbLocateEl(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    if (!el) return null;
    var cur = el;
    for (var i = 0; i < 8 && cur && cur !== document.body; i++) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : "";
      if (/^(h[1-6]|p|li|td|th|pre|blockquote|figcaption|dt|dd|article|section|header|footer|main|aside)$/.test(tag)) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  function flashEl(el) {
    if (!el || !el.style) return;
    try {
      var prev = el.getAttribute("data-lh-outline") || "";
      el.setAttribute("data-lh-outline", "1");
      el.style.outline = "2px solid rgba(179,56,42,0.75)";
      el.style.outlineOffset = "2px";
      setTimeout(function () {
        el.style.outline = "";
        el.style.outlineOffset = "";
        if (prev) el.setAttribute("data-lh-outline", prev);
        else el.removeAttribute("data-lh-outline");
      }, 700);
    } catch (err) {}
  }

  function elementLocatePayload(el) {
    if (!el) return null;
    var range = document.createRange();
    try {
      range.selectNodeContents(el);
    } catch (err) {
      return null;
    }
    var text = String(range).replace(/\u00a0/g, " ");
    if (!text || !text.trim()) return null;
    var needle = text.trim().replace(/\\s+/g, " ");
    if (needle.length > 160) needle = needle.slice(0, 160);
    var before = "";
    var after = "";
    try {
      var pre = range.cloneRange();
      pre.selectNodeContents(document.body);
      pre.setEnd(range.startContainer, range.startOffset);
      before = String(pre).slice(-30);
      var post = range.cloneRange();
      post.selectNodeContents(document.body);
      post.setStart(range.endContainer, range.endOffset);
      after = String(post).slice(0, 30);
    } catch (e2) {}
    return {
      text: needle,
      before: before,
      after: after,
      tagPath: tagPath(el)
    };
  }

  var downX = 0, downY = 0, downBtn = 0;
  document.addEventListener("mousedown", function (e) {
    downX = e.clientX;
    downY = e.clientY;
    downBtn = e.button;
  }, true);

  document.addEventListener("click", function (e) {
    if (downBtn !== 0 || e.button !== 0) return;
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    var target = e.target;
    if (isInteractive(target)) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    var el = climbLocateEl(target);
    var p = elementLocatePayload(el);
    if (!p || !p.text || !p.text.trim()) return;
    flashEl(el);
    parent.postMessage({
      type: "lh-locate",
      text: p.text,
      before: p.before,
      after: p.after,
      tagPath: p.tagPath
    }, "*");
  }, true);

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "lh-highlight" || typeof d.text !== "string") return;
    var needle = d.text;
    if (!needle) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node, found = null, idx = -1;
    while ((node = walker.nextNode())) {
      var t = node.textContent || "";
      var i = t.indexOf(needle);
      if (i >= 0) { found = node; idx = i; break; }
    }
    if (!found) return;
    var range = document.createRange();
    range.setStart(found, idx);
    range.setEnd(found, Math.min(idx + needle.length, found.textContent.length));
    var rect = range.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: "smooth" });
    var mark = document.createElement("span");
    mark.setAttribute("data-lh-flash", "1");
    mark.style.background = "rgba(179,56,42,0.28)";
    mark.style.borderRadius = "2px";
    mark.style.transition = "opacity 1.2s ease-out";
    try {
      range.surroundContents(mark);
      setTimeout(function () {
        mark.style.opacity = "0";
        setTimeout(function () {
          var parentEl = mark.parentNode;
          if (!parentEl) return;
          while (mark.firstChild) parentEl.insertBefore(mark.firstChild, mark);
          parentEl.removeChild(mark);
        }, 1200);
      }, 40);
    } catch (err) {}
  });
})();
</script>
`.trim();

export function injectLocateBridge(srcDoc: string): string {
  // strip any previous bridge
  let html = srcDoc.replace(/<script[^>]*data-lh-bridge=["']1["'][^>]*>[\s\S]*?<\/script>/gi, "");

  // Prefer the last </body>: pages may embed "</body>" inside <script> JSON/examples
  // (e.g. html-elements-reference). Replacing the first one injects our </script>
  // mid-script and dumps the rest of the data as visible text.
  const lower = html.toLowerCase();
  const marker = "</body>";
  const idx = lower.lastIndexOf(marker);
  if (idx >= 0) {
    return html.slice(0, idx) + `${HTML_LOCATE_BRIDGE}\n` + html.slice(idx);
  }
  return html + "\n" + HTML_LOCATE_BRIDGE;
}

/**
 * Validate an inbound postMessage from the preview iframe.
 * Caller must still check `event.source === iframe.contentWindow`.
 */
export function parseBridgeMessage(data: unknown): BridgeInboundMessage | null {
  if (data == null || typeof data !== "object") return null;
  let size = 0;
  try {
    size = JSON.stringify(data).length;
  } catch {
    return null;
  }
  if (size > BRIDGE_MAX_MESSAGE_CHARS) return null;
  const type = (data as { type?: unknown }).type;
  if (typeof type !== "string" || !BRIDGE_TYPE_SET.has(type)) return null;
  return data as BridgeInboundMessage;
}

export function isBridgeInboundType(type: string): type is BridgeInboundType {
  return BRIDGE_TYPE_SET.has(type);
}

/** Rough luminance check for dark page backgrounds (rgb/rgba). */
export function isDarkCssColor(color: string): boolean {
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return false;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  // relative luminance approx
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.45;
}
