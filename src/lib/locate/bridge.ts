/** Injected into HTML srcDoc for preview only — never saved/exported. */

import {
  BRIDGE_INBOUND_TYPES,
  BRIDGE_MAX_MESSAGE_CHARS,
  type BridgeInboundMessage,
  type BridgeInboundType,
} from "./types";

import { instrumentHtmlSrcDoc } from "./htmlInstrument";

const BRIDGE_TYPE_SET = new Set<string>(BRIDGE_INBOUND_TYPES);

/** Thin scrollbar only — preview chrome, never written to source/export. */
const PREVIEW_SCROLLBAR_CSS = `
html{scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.45) transparent;}
::-webkit-scrollbar{width:6px;height:6px;}
::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4);border-radius:3px;}
::-webkit-scrollbar-track{background:transparent;}
`.replace(/\s+/g, " ").trim();


/**
 * True for same-document fragment hrefs (`#`, `#id`, `#/path` style hashes).
 * Used by tests and mirrored in the injected bridge (srcDoc must not navigate).
 */
export function isFragmentHref(href: string | null | undefined): boolean {
  if (href == null) return false;
  const t = String(href).trim();
  return t.startsWith("#");
}

/**
 * Candidate element ids for a fragment href (raw + decodeURIComponent).
 * Empty fragment (`#` / `# `) yields [].
 */
export function fragmentIdsToTry(hashHref: string): string[] {
  const raw = String(hashHref).trim().replace(/^#/, "");
  if (!raw) return [];
  const ids = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) ids.push(decoded);
  } catch {
    /* ignore malformed escape */
  }
  return ids;
}

/** Whether an <a> click would leave about:srcdoc if allowed to default. */
export function wouldNavigateAwayFromSrcDoc(
  href: string | null | undefined,
  targetAttr?: string | null
): boolean {
  if (href == null) return false;
  const t = String(href).trim();
  if (!t || t.startsWith("#")) return false;
  if (/^\s*javascript:/i.test(t)) return false;
  if (/^\s*mailto:/i.test(t) || /^\s*tel:/i.test(t)) return false;
  const target = String(targetAttr || "").toLowerCase();
  if (target === "_blank") return false;
  return true;
}

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

  var overlay = null;
  function ensureOverlay() {
    if (overlay && overlay.parentNode) return overlay;
    overlay = document.createElement("div");
    overlay.setAttribute("data-lh-overlay", "1");
    overlay.style.cssText = "position:absolute;pointer-events:none;z-index:2147483646;border:2px solid rgba(179,56,42,0.85);background:rgba(179,56,42,0.08);border-radius:2px;box-sizing:border-box;display:none;";
    (document.documentElement || document.body).appendChild(overlay);
    return overlay;
  }

  function parseLh(el) {
    if (!el || !el.getAttribute) return null;
    var v = el.getAttribute("data-lh");
    if (!v) return null;
    var m = String(v).match(/^(\\d+)-(\\d+)$/);
    if (!m) return null;
    return { start: +m[1], end: +m[2] };
  }

  function closestLh(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute("data-lh")) return el;
      el = el.parentElement;
    }
    return null;
  }

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
    var lhEl = closestLh(range.startContainer);
    var lh = parseLh(lhEl);
    return {
      text: text,
      before: before,
      after: after,
      tagPath: tagPath(range.startContainer),
      rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
      range: lh || undefined,
      tag: lhEl && lhEl.tagName ? lhEl.tagName.toLowerCase() : undefined,
      annotatedSelf: !!(lhEl && range.startContainer && lhEl.contains(range.startContainer))
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

  function resolveScrollRoot(hint) {
    try {
      if (hint && hint.nodeType === 1) {
        var el = hint;
        if (el === document || el === document.documentElement || el === document.body) {
          return document.scrollingElement || document.documentElement;
        }
        if ((el.scrollHeight || 0) > (el.clientHeight || 0) + 1) return el;
      }
    } catch (e0) {}
    return document.scrollingElement || document.documentElement;
  }

  function contentYFor(el, se) {
    try {
      var er = el.getBoundingClientRect();
      var sr = se.getBoundingClientRect ? se.getBoundingClientRect() : { top: 0 };
      return er.top - (sr.top || 0) + (se.scrollTop || 0);
    } catch (e1) {
      return 0;
    }
  }

  function reportScrollPercent(se) {
    var root = se || resolveScrollRoot(null);
    var max = (root.scrollHeight || 0) - (root.clientHeight || 0);
    var pct = max > 0 ? ((root.scrollTop || 0) / max) * 100 : 0;
    parent.postMessage({ type: "lh-scroll", percent: pct }, "*");
    return pct;
  }

  var scrollRaf = 0;
  var lastScrollRoot = null;
  /**
   * Send bracket anchors around viewportTop (sorted by Y), plus percent.
   * Parent falls back to percent when spanTop/spanBottom do not cover the view
   * (typical for script-generated pages whose data-lh only mark the shell).
   */
  function reportScrollAnchors(hint) {
    var se = resolveScrollRoot(hint || lastScrollRoot);
    lastScrollRoot = se;
    var viewportTop = se.scrollTop || 0;
    var scrollHeight = se.scrollHeight || 0;
    var clientHeight = se.clientHeight || 0;
    var max = scrollHeight - clientHeight;
    var pct = max > 0 ? (viewportTop / max) * 100 : 0;

    var nodes = document.querySelectorAll("[data-lh]");
    var all = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var lh = parseLh(el);
      if (!lh) continue;
      all.push({ range: lh, top: contentYFor(el, se) });
    }
    all.sort(function (a, b) { return a.top - b.top; });

    var spanTop = all.length ? all[0].top : 0;
    var spanBottom = all.length ? all[all.length - 1].top : 0;

    // Binary search: largest index with top <= viewportTop
    var lo = 0, hi = all.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (all[mid].top <= viewportTop) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    var from = 0, to = 0;
    if (!all.length) {
      from = 0; to = 0;
    } else if (idx < 0) {
      from = 0; to = Math.min(4, all.length);
    } else if (idx >= all.length - 1) {
      from = Math.max(0, all.length - 4); to = all.length;
    } else {
      from = Math.max(0, idx - 1);
      to = Math.min(all.length, idx + 3);
    }
    var anchors = all.slice(from, to);

    parent.postMessage({
      type: "lh-scroll-anchors",
      viewportTop: viewportTop,
      percent: pct,
      scrollHeight: scrollHeight,
      clientHeight: clientHeight,
      spanTop: spanTop,
      spanBottom: spanBottom,
      anchors: anchors
    }, "*");
    parent.postMessage({ type: "lh-scroll", percent: pct }, "*");
  }

  function onScroll(e) {
    if (scrollRaf) return;
    var hint = e && e.target ? e.target : null;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      reportScrollAnchors(hint);
    });
  }

  // Point caret queries (end-start <= 2) must not match giant shells
  // (layout/main/body) — those yanked the editor to #empty via scroll sync.
  var LH_POINT_MAX_SPAN = 1200;
  function findElByRange(range) {
    if (!range) return null;
    var pointQuery = (range.end - range.start) <= 2;
    var nodes = document.querySelectorAll("[data-lh]");
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var lh = parseLh(el);
      if (!lh) continue;
      if (lh.start === range.start && lh.end === range.end) return el;
      if (lh.start <= range.start && lh.end >= range.end) {
        var span = lh.end - lh.start;
        if (pointQuery && span > LH_POINT_MAX_SPAN) continue;
        var tag = (el.tagName || "").toLowerCase();
        if (pointQuery && (tag === "html" || tag === "head" || tag === "body")) continue;
        if (!best) best = el;
        else {
          var bl = parseLh(best);
          if (bl && span < (bl.end - bl.start)) best = el;
        }
      }
    }
    return best;
  }

  function showOverlayFor(el) {
    if (!el) return;
    var ov = ensureOverlay();
    var se = document.scrollingElement || document.documentElement;
    var r = el.getBoundingClientRect();
    var top = r.top + (se.scrollTop || 0);
    var left = r.left + (se.scrollLeft || 0);
    ov.style.display = "block";
    ov.style.top = top + "px";
    ov.style.left = left + "px";
    ov.style.width = Math.max(2, r.width) + "px";
    ov.style.height = Math.max(2, r.height) + "px";
  }

  function clearOverlay() {
    if (overlay) overlay.style.display = "none";
  }

  function scrollToEl(el, center) {
    if (!el) return;
    try {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || 1;
      var wellInView = r.top >= vh * 0.15 && r.bottom <= vh * 0.85;
      if (!wellInView) {
        var se = document.scrollingElement || document.documentElement;
        var y = (se.scrollTop || 0) + r.top - (center ? vh / 3 : 40);
        se.scrollTop = Math.max(0, y);
      }
    } catch (e) {}
  }

  function onReady() {
    reportBg();
    reportScrollAnchors();
    parent.postMessage({ type: "lh-ready" }, "*");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
  window.addEventListener("load", function () { reportBg(); reportScrollAnchors(); });
  // Capture phase so nested overflow:auto scrollers also drive sync.
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("toggle", function () {
    setTimeout(function () { reportScrollAnchors(null); }, 30);
  }, true);
  window.addEventListener("load", function () {
    var imgs = document.images;
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].addEventListener("load", function () { reportScrollAnchors(null); }, { once: true });
    }
  });

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey) {
      var p = selPayload();
      if (!p) {
        parent.postMessage({ type: "lh-locate", text: "", before: "", after: "", tagPath: "" }, "*");
        return;
      }
      e.preventDefault();
      parent.postMessage({
        type: "lh-locate",
        text: p.text,
        before: p.before,
        after: p.after,
        tagPath: p.tagPath,
        range: p.range,
        tag: p.tag,
        annotatedSelf: p.annotatedSelf,
        metaKey: !!e.metaKey,
        ctrlKey: !!e.ctrlKey,
        detail: 1
      }, "*");
      return;
    }

    var key = e.key;
    var meta = e.metaKey || e.ctrlKey;
    var forward = false;
    if (meta && (key === "k" || key === "K" || key === "e" || key === "E")) forward = true;
    if (!meta && (key === "f" || key === "F") && !isTypingTarget(e.target)) forward = true;
    if (key === "Escape") {
      clearOverlay();
      forward = true;
    }
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
      rect: p.rect,
      range: p.range,
      tag: p.tag
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
      rect: p.rect,
      range: p.range,
      tag: p.tag
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

  function textSnippetOf(el) {
    if (!el) return "";
    try {
      var desc = el.getAttribute && el.getAttribute("data-desc");
      if (desc && String(desc).trim()) return String(desc).trim().replace(/\\s+/g, " ").slice(0, 160);
    } catch (e0) {}
    var t = String(el.textContent || "").replace(/\\u00a0/g, " ").trim().replace(/\\s+/g, " ");
    if (t.length > 160) t = t.slice(0, 160);
    return t;
  }

  var downX = 0, downY = 0, downBtn = 0;
  document.addEventListener("mousedown", function (e) {
    downX = e.clientX;
    downY = e.clientY;
    downBtn = e.button;
  }, true);

  /**
   * Drag-select (or any non-empty selection finalized on mouseup) → parent
   * focuses source CM6 and selects the matched range for immediate edit.
   * Plain click with collapsed selection does nothing here (click handler locates).
   */
  document.addEventListener("mouseup", function (e) {
    if (downBtn !== 0 || e.button !== 0) return;
    if (isTypingTarget(e.target)) return;
    var p = selPayload();
    if (!p) return;
    parent.postMessage({
      type: "lh-edit-selection",
      text: p.text,
      textSnippet: p.text,
      before: p.before,
      after: p.after,
      tagPath: p.tagPath,
      rect: p.rect,
      range: p.range,
      tag: p.tag,
      annotatedSelf: p.annotatedSelf,
      metaKey: !!e.metaKey,
      ctrlKey: !!e.ctrlKey,
      detail: e.detail || 1
    }, "*");
  }, true);

  function closestAnchor(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.documentElement) {
      if (el.tagName && el.tagName.toLowerCase() === "a" && el.getAttribute) return el;
      el = el.parentElement;
    }
    return null;
  }

  function findHashTarget(hashHref) {
    var raw = String(hashHref || "").replace(/^#/, "");
    if (!raw) return null;
    var candidates = [raw];
    try {
      var decoded = decodeURIComponent(raw);
      if (decoded !== raw) candidates.push(decoded);
    } catch (errDec) {}
    for (var ci = 0; ci < candidates.length; ci++) {
      var id = candidates[ci];
      var el = null;
      try { el = document.getElementById(id); } catch (errId) {}
      if (el) return el;
      try {
        if (typeof CSS !== "undefined" && CSS.escape) {
          el = document.querySelector('[id="' + CSS.escape(id) + '"], [name="' + CSS.escape(id) + '"]');
        } else {
          el = document.querySelector('[name="' + id.replace(/"/g, '\\\\"') + '"]');
        }
      } catch (errQ) {}
      if (el) return el;
    }
    return null;
  }

  /**
   * srcDoc + sandbox(without allow-same-origin): default <a href="#..."> navigation
   * clears the document (blank preview). Intercept, preventDefault, scroll in-place.
   * Also block in-frame navigations that would leave about:srcdoc.
   * Returns true when the click was a handled navigation (caller may skip locate).
   */
  function handleSrcDocNavClick(e) {
    var a = closestAnchor(e.target);
    if (!a) return false;
    var href = a.getAttribute("href");
    if (href == null) return false;
    var trimmed = String(href).trim();
    if (!trimmed) return false;

    if (trimmed.charAt(0) === "#") {
      e.preventDefault();
      if (trimmed === "#" || trimmed === "#top") {
        var seTop = document.scrollingElement || document.documentElement;
        seTop.scrollTop = 0;
        return true;
      }
      var targetEl = findHashTarget(trimmed);
      if (targetEl) scrollToEl(targetEl, false);
      return true;
    }

    if (/^\\s*javascript:/i.test(trimmed)) return false;

    var targetAttr = (a.getAttribute("target") || "").toLowerCase();
    if (targetAttr === "_blank" || a.hasAttribute("download")) return false;

    // Relative / absolute navigations would wipe srcDoc — block them.
    e.preventDefault();
    if (/^https?:\\/\\//i.test(trimmed) || /^\\/\\//.test(trimmed)) {
      try { window.open(trimmed, "_blank", "noopener,noreferrer"); } catch (errOpen) {}
    }
    return true;
  }

  document.addEventListener("click", function (e) {
    if (downBtn !== 0 || e.button !== 0) return;
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
    if (e.altKey || e.shiftKey) return;
    var navHandled = handleSrcDocNavClick(e);
    var target = e.target;
    // Hash / blocked nav: still allow ⌘/Ctrl / double-click locate; skip plain click locate.
    if (navHandled && !(e.metaKey || e.ctrlKey) && e.detail < 2) return;
    if (isInteractive(target) && !(e.metaKey || e.ctrlKey) && e.detail < 2) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim() && e.detail < 2) return;

    var lhEl = closestLh(target);
    var selfAnnotated = !!(target && target.getAttribute && target.getAttribute("data-lh"));
    if (!selfAnnotated && target && target.nodeType === 3) {
      selfAnnotated = !!(target.parentElement && target.parentElement.getAttribute && target.parentElement.getAttribute("data-lh"));
    }
    // Also treat direct element with data-lh
    if (!selfAnnotated && lhEl && (lhEl === target || (target.nodeType === 1 && lhEl === target))) {
      selfAnnotated = true;
    }
    if (lhEl && target && target.closest) {
      try {
        var direct = (target.nodeType === 1 ? target : target.parentElement);
        selfAnnotated = !!(direct && direct.getAttribute && direct.getAttribute("data-lh"));
      } catch (e1) {}
    }

    var lh = parseLh(lhEl);
    var snippet = textSnippetOf(target && target.nodeType === 1 ? target : (target && target.parentElement) || lhEl);
    if (lhEl) showOverlayFor(lhEl);

    parent.postMessage({
      type: "lh-locate",
      text: snippet,
      textSnippet: snippet,
      before: "",
      after: "",
      tagPath: tagPath(lhEl || target),
      range: lh || undefined,
      tag: lhEl && lhEl.tagName ? lhEl.tagName.toLowerCase() : undefined,
      annotatedSelf: selfAnnotated,
      metaKey: !!e.metaKey,
      ctrlKey: !!e.ctrlKey,
      detail: e.detail || 1
    }, "*");
  }, true);

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "clearHighlight") {
      clearOverlay();
      return;
    }
    if (d.type === "scrollToRange" || d.type === "highlightRange") {
      var range = d.range;
      if (!range || typeof range.start !== "number") return;
      var el = findElByRange(range);
      if (!el) return;
      if (d.type === "scrollToRange") scrollToEl(el, true);
      showOverlayFor(el);
      return;
    }
    // legacy text highlight
    if (d.type !== "lh-highlight" || typeof d.text !== "string") return;
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
    var rg = document.createRange();
    rg.setStart(found, idx);
    rg.setEnd(found, Math.min(idx + needle.length, found.textContent.length));
    var rect = rg.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: "smooth" });
    try {
      var markParent = found.parentElement;
      if (markParent) showOverlayFor(markParent);
    } catch (err) {}
  });
})();
</script>
`.trim();

export function injectLocateBridge(srcDoc: string): string {
  // strip any previous bridge
  let html = srcDoc.replace(/<script[^>]*data-lh-bridge=["']1["'][^>]*>[\s\S]*?<\/script>/gi, "");

  // Prefer the last </body>: pages may embed "</body>" inside <script> JSON/examples
  const lower = html.toLowerCase();
  const marker = "</body>";
  const idx = lower.lastIndexOf(marker);
  if (idx >= 0) {
    return html.slice(0, idx) + `${HTML_LOCATE_BRIDGE}\n` + html.slice(idx);
  }
  return html + "\n" + HTML_LOCATE_BRIDGE;
}

/**
 * Build preview srcDoc: instrument data-lh on a copy, then inject bridge.
 * `rawSource` must be the user's original HTML (offsets relative to it).
 * `prepared` is optionally already run through prepareHtmlPreview; if omitted,
 * instrumentation runs on rawSource directly.
 */
export function buildInstrumentedSrcDoc(rawSource: string, prepared?: string): string {
  // Instrument the prepared markup when helpers were rewritten, but offsets must
  // still match rawSource. If prepareHtmlPreview only replaces colorize bodies,
  // offsets after the replacement shift — so we instrument rawSource first when
  // prepared === rawSource, otherwise instrument prepared and accept that
  // dynamic pages with colorize rewrites are rare for locate.
  const base = prepared ?? rawSource;
  // Prefer instrumenting the same string that will be shown, BUT rewrite
  // data-lh values only from parse of the same string. Callers should pass
  // the string whose offsets they will use for locate (typically raw).
  const { html } = instrumentHtmlSrcDoc(base);
  return injectLocateBridge(html);
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
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.45;
}
