// @ts-check
/**
 * HTML preview locate bridge — runs inside sandbox iframe (no allow-same-origin).
 * Source of truth for the injected IIFE. Do not edit bridge.generated.ts;
 * run `npm run gen:bridge` after changing this file.
 *
 * Keep this file ES5-friendly (var, function, no import/export) so it can be
 * injected as a raw <script> without a bundler.
 */
(function () {
  if (window.__lhBridge) return;
  window.__lhBridge = true;

  try {
    var style = document.createElement("style");
    style.setAttribute("data-lh-preview-chrome", "1");
    style.textContent = "html{scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.45) transparent;} ::-webkit-scrollbar{width:6px;height:6px;} ::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4);border-radius:3px;} ::-webkit-scrollbar-track{background:transparent;}";
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
    var m = String(v).match(/^(\d+)-(\d+)$/);
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
      // Messaging only: true when the selection's start element itself has data-lh
      // (not merely nested inside an annotated ancestor).
      annotatedSelf: !!(function () {
        var n = range.startContainer;
        var el = n && n.nodeType === 1 ? n : (n && n.parentElement);
        return !!(el && el.getAttribute && el.getAttribute("data-lh"));
      })()
    };
  }

  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  /**
   * Text the DOM does not render as text — mirrors RAW_TEXT_TAGS in htmlPlainMap.ts
   * and must stay identical on both sides or offsets drift.
   */
  var SKIP_TEXT_TAGS = { script: 1, style: 1, noscript: 1, template: 1, textarea: 1 };

  function insideSkippedText(node, root) {
    var el = node && node.parentElement;
    while (el && el !== root) {
      var t = (el.tagName || "").toLowerCase();
      if (SKIP_TEXT_TAGS[t]) return true;
      el = el.parentElement;
    }
    return false;
  }

  /** Caret position under a viewport point, or null when the API is unavailable. */
  function caretAt(x, y) {
    try {
      if (document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (p && p.offsetNode) return { node: p.offsetNode, offset: p.offset };
      }
    } catch (e1) {}
    try {
      if (document.caretRangeFromPoint) {
        var r = document.caretRangeFromPoint(x, y);
        if (r && r.startContainer) return { node: r.startContainer, offset: r.startOffset };
      }
    } catch (e2) {}
    return null;
  }

  /**
   * Character offset of the caret inside `root`'s rendered text (source of truth:
   * htmlPlainMap.buildHtmlPlainMap). Returns null when unknown — the parent then
   * keeps the tag-level behaviour instead of guessing.
   */
  function plainOffsetIn(root, node, offset) {
    if (!root || !node) return null;
    try {
      if (node !== root && root.contains && !root.contains(node)) return null;
      var total = 0;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        if (n === node) {
          var len = (n.nodeValue || "").length;
          return total + Math.max(0, Math.min(offset, len));
        }
        if (insideSkippedText(n, root)) continue;
        total += (n.nodeValue || "").length;
      }
    } catch (e) {}
    return null;
  }

  function clickPlainOffset(lhEl, x, y) {
    var cm = caretAt(x, y);
    if (!cm || !cm.node) return null;
    var root = lhEl || (cm.node.nodeType === 3 ? cm.node.parentElement : cm.node);
    if (!root) return null;
    return plainOffsetIn(root, cm.node, cm.offset);
  }

  var ATTR_CANDIDATES = ["alt", "aria-label", "title", "placeholder"];
  /**
   * Attribute value to locate when the clicked element renders no text
   * (img alt, area alt, svg title-less, …). Never walks past the annotated node.
   */
  function attrNear(el, lhEl) {
    var node = el && el.nodeType !== 1 ? el.parentElement : el;
    var root = lhEl || node;
    var depth = 0;
    while (node && depth < 12) {
      if (node.getAttribute) {
        for (var i = 0; i < ATTR_CANDIDATES.length; i++) {
          var name = ATTR_CANDIDATES[i];
          var v = "";
          try { v = String(node.getAttribute(name) || "").trim(); } catch (e0) { v = ""; }
          if (v) return { name: name, value: v };
        }
      }
      if (node === root) break;
      node = node.parentElement;
      depth++;
    }
    return null;
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

  function _reportScrollPercent(se) {
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
  // Track which details already emitted lh-quiz-peeked (open edge only).
  var quizPeekedIds = Object.create(null);

  function quizDetailId(el) {
    if (!el) return "";
    var lh = parseLh(el);
    if (lh) return String(lh.start) + "-" + String(lh.end);
    var sum = el.querySelector && el.querySelector("summary");
    var stem = sum
      ? String(sum.textContent || "").replace(/\s+/g, " ").trim()
      : String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    // FNV-1a 32-bit, mirror stemHashId in quiz.ts
    var h = 2166136261;
    for (var i = 0; i < stem.length; i++) {
      h ^= stem.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "stem_" + ((h >>> 0).toString(36));
  }

  function quizListItems() {
    var nodes = document.querySelectorAll("details");
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var sum = el.querySelector("summary");
      var stem = sum
        ? String(sum.textContent || "").replace(/\s+/g, " ").trim()
        : String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
      items.push({
        id: quizDetailId(el),
        stem: stem,
        open: !!el.open
      });
    }
    return items;
  }

  function quizSetOpen(payload) {
    var open = !!(payload && payload.open);
    var all = !!(payload && payload.all);
    var id = payload && typeof payload.id === "string" ? payload.id : "";
    var nodes = document.querySelectorAll("details");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (all) {
        el.open = open;
      } else if (id && quizDetailId(el) === id) {
        el.open = open;
        break;
      }
    }
    setTimeout(function () { reportScrollAnchors(null); }, 30);
  }

  document.addEventListener("toggle", function (e) {
    setTimeout(function () { reportScrollAnchors(null); }, 30);
    try {
      var t = e && e.target;
      if (!t || !t.tagName || String(t.tagName).toLowerCase() !== "details") return;
      if (!t.open) return; // open edge only
      var id = quizDetailId(t);
      if (!id || quizPeekedIds[id]) return;
      quizPeekedIds[id] = true;
      parent.postMessage({ type: "lh-quiz-peeked", id: id }, "*");
    } catch (errPeek) {}
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
    if (p) {
      e.preventDefault();
      parent.postMessage({
        type: "lh-contextmenu",
        text: p.text,
        textSnippet: p.text,
        before: p.before,
        after: p.after,
        tagPath: p.tagPath,
        x: e.clientX,
        y: e.clientY,
        rect: p.rect,
        range: p.range,
        tag: p.tag,
        annotatedSelf: p.annotatedSelf
      }, "*");
      return;
    }
    // No text selection: still offer locate when right-clicking a data-lh node.
    var lhEl = closestLh(e.target);
    var lh = parseLh(lhEl);
    if (!lh) return;
    e.preventDefault();
    var snippet = textSnippetOf(e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement) || lhEl);
    var selfAnnotated = !!(lhEl && lhEl.getAttribute && lhEl.getAttribute("data-lh"));
    var ctxAttr = attrNear(e.target, lhEl);
    var ctxPlain = clickPlainOffset(lhEl, e.clientX, e.clientY);
    parent.postMessage({
      type: "lh-contextmenu",
      text: "",
      textSnippet: snippet,
      before: "",
      after: "",
      tagPath: "",
      x: e.clientX,
      y: e.clientY,
      range: lh,
      tag: lhEl && lhEl.tagName ? lhEl.tagName.toLowerCase() : "",
      annotatedSelf: selfAnnotated,
      plainOffset: ctxPlain == null ? undefined : ctxPlain,
      attrName: ctxAttr ? ctxAttr.name : undefined,
      attrValue: ctxAttr ? ctxAttr.value : undefined
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

  /**
   * True only for real controls (align Markdown: a/button/input/textarea/summary).
   * Do NOT treat bare label/option/onclick/ARIA roles as interactive — quiz cards
   * often wrap stems in <label> or role=button; that silently blocked split click locate.
   * Short answer-toggle chrome text is still skipped.
   */
  function isInteractive(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (!el.tagName) break;
      var tag = el.tagName.toLowerCase();
      if (tag === "a" || tag === "button" || tag === "input" || tag === "textarea" ||
          tag === "select" || tag === "summary" ||
          tag === "video" || tag === "audio") return true;
      if (el.isContentEditable) return true;
      if (el.getAttribute) {
        // Short chrome labels (e.g. 「显示答案」) — do not locate, let page handle.
        try {
          var short = String(el.textContent || "").replace(/\s+/g, "").trim();
          if (short === "显示答案" || short === "隐藏答案" || short === "查看答案" || short === "收起答案") return true;
        } catch (eAns) {}
      }
      el = el.parentElement;
    }
    return false;
  }

  function stripChromeClone(el) {
    if (!el || !el.cloneNode) return el;
    try {
      var clone = el.cloneNode(true);
      var kill = clone.querySelectorAll
        ? clone.querySelectorAll("button, input, select, textarea, label, summary, a, [role='button'], .badge, .tag, .chip")
        : [];
      for (var i = 0; i < kill.length; i++) {
        var n = kill[i];
        if (n && n.parentNode) n.parentNode.removeChild(n);
      }
      // Remove short answer-toggle text nodes / spans
      var walk = clone.querySelectorAll ? clone.querySelectorAll("*") : [];
      for (var j = 0; j < walk.length; j++) {
        var w = walk[j];
        var wt = String(w.textContent || "").replace(/\s+/g, "").trim();
        if (wt === "显示答案" || wt === "隐藏答案" || wt === "查看答案" || wt === "收起答案") {
          if (w.parentNode) w.parentNode.removeChild(w);
        }
      }
      return clone;
    } catch (e) {
      return el;
    }
  }

  /**
   * Blocks whose own text is a good click-locate needle. Wider than the original
   * paragraph / heading / list-item set: table cells, code blocks and quotes were
   * silently un-locatable.
   */
  var TEXT_BLOCK_TAGS = {
    td: 1, th: 1, pre: 1, code: 1, blockquote: 1,
    dt: 1, dd: 1, figcaption: 1, caption: 1
  };
  var PREFER_SELECTOR =
    ".stem, .desc, .title, .question-stem, [data-stem], [data-desc], " +
    "p, h1, h2, h3, h4, h5, h6, li, td, th, pre, code, blockquote, dt, dd, figcaption, caption";

  function textSnippetOf(el) {
    if (!el) return "";
    try {
      var desc = el.getAttribute && el.getAttribute("data-desc");
      if (desc && String(desc).trim()) return String(desc).trim().replace(/\s+/g, " ").slice(0, 160);
    } catch (e0) {}
    // Prefer stem / desc / title / heading / paragraph near the click.
    try {
      var prefer = null;
      var tag = (el.tagName || "").toLowerCase();
      if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "li" || TEXT_BLOCK_TAGS[tag]) prefer = el;
      if (!prefer && el.closest) {
        prefer = el.closest(PREFER_SELECTOR);
      }
      if (!prefer && el.querySelector) {
        prefer = el.querySelector(PREFER_SELECTOR);
      }
      if (prefer) el = prefer;
    } catch (e1) {}
    var src = stripChromeClone(el);
    var t = String((src && (src.innerText || src.textContent)) || "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
    // Drop leading badge / 题号 chrome
    t = t.replace(/^(常用|进阶\/少用|已弃用|示例)\s*/u, "");
    t = t.replace(/^0*\d{1,3}[\.、\s]+/, "");
    t = t.replace(/^第\s*\d+\s*题[\s:：]*/u, "");
    if (t.length > 160) t = t.slice(0, 160);
    return t;
  }

  /** 1-based card / question index near click (题号 02 → 2). 0 = unknown. */
  function cardIndexNear(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body && el !== document.documentElement) {
      try {
        if (el.getAttribute) {
          var di = el.getAttribute("data-index") || el.getAttribute("data-i") ||
            el.getAttribute("data-q") || el.getAttribute("data-no") || el.getAttribute("data-num");
          if (di != null && String(di).trim() !== "") {
            var n = parseInt(String(di).trim(), 10);
            if (Number.isFinite(n) && n >= 0) return n === 0 ? 1 : n;
          }
        }
        var badge = el.querySelector && el.querySelector(
          ".no, .num, .index, .q-no, .question-no, [class*='index'], [class*='number']"
        );
        if (badge) {
          var bt = String(badge.textContent || "").trim();
          var m = bt.match(/0*([1-9]\d{0,2})/);
          if (m) return parseInt(m[1], 10);
        }
        // Leading text "02" / "2." / "第2题" on first chrome child
        for (var c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) {
            var tt = String(c.textContent || "").trim();
            var mm = tt.match(/^0*([1-9]\d{0,2})(?:[\.、\s]|$)/) || tt.match(/^第\s*([1-9]\d{0,2})\s*题/);
            if (mm) return parseInt(mm[1], 10);
          } else if (c.nodeType === 1) {
            var ct = (c.tagName || "").toLowerCase();
            if (ct === "span" || ct === "b" || ct === "strong" || ct === "em" || ct === "i" || ct === "label" || ct === "small") {
              var st = String(c.textContent || "").trim();
              var m2 = st.match(/^0*([1-9]\d{0,2})$/) || st.match(/^0*([1-9]\d{0,2})[\.、]/) || st.match(/^第\s*([1-9]\d{0,2})\s*题/);
              if (m2) return parseInt(m2[1], 10);
            }
            break;
          }
        }
      } catch (eCard) {}
      el = el.parentElement;
    }
    return 0;
  }

  /** Thin 1–2px outline flash — not the 朱砂 overlay box. */
  function flashClickOutline(el) {
    if (!el || !el.style) return;
    try {
      var prevOutline = el.style.outline;
      var prevOffset = el.style.outlineOffset;
      var prevTransition = el.style.transition;
      el.style.outline = "1px solid rgba(179,56,42,0.55)";
      el.style.outlineOffset = "1px";
      el.style.transition = "outline-color 0.8s ease-out";
      window.setTimeout(function () {
        try {
          el.style.outline = prevOutline;
          el.style.outlineOffset = prevOffset;
          el.style.transition = prevTransition;
        } catch (e2) {}
      }, 800);
    } catch (e1) {}
  }

  var downX = 0, downY = 0, downBtn = 0;
  document.addEventListener("mousedown", function (e) {
    downX = e.clientX;
    downY = e.clientY;
    downBtn = e.button;
  }, true);

  /**
   * Selection alone does NOT auto-locate. User right-clicks → parent shows
   * 「定位源码」 in the context menu. Keep mousedown tracking for click-vs-drag.
   */

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
          el = document.querySelector('[name="' + id.replace(/"/g, '\\"') + '"]');
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

    if (/^\s*javascript:/i.test(trimmed)) return false;

    var targetAttr = (a.getAttribute("target") || "").toLowerCase();
    if (targetAttr === "_blank" || a.hasAttribute("download")) return false;

    // Relative / absolute navigations would wipe srcDoc — block them.
    e.preventDefault();
    if (/^https?:\/\//i.test(trimmed) || /^\/\//.test(trimmed)) {
      try { window.open(trimmed, "_blank", "noopener,noreferrer"); } catch (errOpen) {}
    }
    return true;
  }

  /* ---------- CSS 命中采集（父窗口点元素 → 这里遍历 styleSheets） ---------- */

  // 最近一次点击的元素：即便这次点击被 locate 的种种门禁挡掉（无文本、交互元素…），
  // 「元素」面板仍然要能回答「刚点的这个元素被哪些规则命中 / 谁给它绑了事件」。
  // 所以每次点击都先给父窗口报一次身份（lh-element），由父窗口决定要不要追问（lh-css-query）；
  // lh-locate 只负责「定位源码」，交互元素（button/a/input）照旧不发。
  // range 是 data-lh 标注的源码区间：抽屉的 HTML 段靠它给精确行号（点了按钮也能定位）。
  var lastClickEl = null;
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      lastClickEl = t && t.nodeType === 1 ? t : (t && t.parentElement) || null;
      if (!lastClickEl) return;
      var lhEl = closestLh(lastClickEl);
      var ownText = "";
      try {
        ownText = String(lastClickEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      } catch (eTxt) {}
      parent.postMessage(
        {
          type: "lh-element",
          element: elementIdentity(lastClickEl),
          ancestors: elementAncestors(lastClickEl, 6),
          range: (lhEl && parseLh(lhEl)) || null,
          text: ownText,
        },
        "*"
      );
    },
    true
  );

  /**
   * specificity（与 src/lib/locate/cssLocate.ts 同一算法，测试里逐条比对防漂移）。
   * [id, class/attr/伪类, 类型/伪元素]
   */
  function cssSpecificity(selector) {
    var total = [0, 0, 0];
    var s = String(selector || "");
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (/[\s,>+~|]/.test(ch)) {
        i++;
        continue;
      }
      if (ch === "*") {
        i++;
        continue;
      }
      if (ch === "#") {
        total[0] += 1;
        i = cssSkipIdent(s, i + 1);
        continue;
      }
      if (ch === ".") {
        total[1] += 1;
        i = cssSkipIdent(s, i + 1);
        continue;
      }
      if (ch === "[") {
        total[1] += 1;
        i = cssSkipBracket(s, i);
        continue;
      }
      if (ch === ":") {
        var isDouble = s.charAt(i + 1) === ":";
        var nameStart = i + (isDouble ? 2 : 1);
        var nameEnd = cssSkipIdent(s, nameStart);
        var name = s.slice(nameStart, nameEnd).toLowerCase();
        var k = nameEnd;
        while (k < s.length && /\s/.test(s.charAt(k))) k++;
        if (isDouble) {
          total[2] += 1;
          i = s.charAt(k) === "(" ? cssSkipParen(s, k) : k;
          continue;
        }
        if (s.charAt(k) === "(") {
          var end = cssSkipParen(s, k);
          var args = s.slice(k + 1, Math.max(k + 1, end - 1));
          if (name === "where") {
            // 恒为 0
          } else if (
            name === "is" ||
            name === "not" ||
            name === "has" ||
            name === "matches" ||
            name === "-webkit-any" ||
            name === "-moz-any"
          ) {
            var sub = cssMaxSpecificity(cssSplitList(args));
            total[0] += sub[0];
            total[1] += sub[1];
            total[2] += sub[2];
          } else if (name === "nth-child" || name === "nth-last-child") {
            total[1] += 1;
            var of = args.toLowerCase().indexOf(" of ");
            if (of >= 0) {
              var subOf = cssMaxSpecificity(cssSplitList(args.slice(of + 4)));
              total[0] += subOf[0];
              total[1] += subOf[1];
              total[2] += subOf[2];
            }
          } else {
            total[1] += 1;
          }
          i = end;
          continue;
        }
        if (name === "before" || name === "after" || name === "first-line" || name === "first-letter") {
          total[2] += 1;
        } else {
          total[1] += 1;
        }
        i = k;
        continue;
      }
      if (/[-_a-zA-Z0-9\u00a0-\uffff\\]/.test(ch)) {
        total[2] += 1;
        i = cssSkipIdent(s, i);
        continue;
      }
      i++;
    }
    return total;
  }

  function cssMaxSpecificity(list) {
    var best = [0, 0, 0];
    for (var i = 0; i < list.length; i++) {
      var s = cssSpecificity(list[i]);
      if (cssCompareSpec(s, best) > 0) best = s;
    }
    return best;
  }

  function cssCompareSpec(a, b) {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  }

  function cssSkipIdent(s, from) {
    var i = from;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (!/[-_a-zA-Z0-9\u00a0-\uffff]/.test(ch)) break;
      i++;
    }
    return i;
  }

  function cssSkipBracket(s, from) {
    var quote = "";
    for (var i = from + 1; i < s.length; i++) {
      var ch = s.charAt(i);
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "]") return i + 1;
    }
    return s.length;
  }

  function cssSkipParen(s, from) {
    var depth = 0;
    var quote = "";
    for (var i = from; i < s.length; i++) {
      var ch = s.charAt(i);
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return s.length;
  }

  function cssSplitList(text) {
    var out = [];
    var depth = 0;
    var quote = "";
    var cur = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (quote) {
        cur += ch;
        if (ch === "\\") {
          cur += text.charAt(i + 1);
          i++;
        } else if (ch === quote) {
          quote = "";
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /** 与 cssLocate.normalizeSelector 同一算法：折叠空白、去掉组合符两侧空白。 */
  function cssNormalizeSelector(selector) {
    return String(selector || "")
      .replace(/\s+/g, " ")
      .replace(/\s*([>+~,])\s*/g, "$1")
      .trim();
  }

  /** 与 cssLocate.atRulesSignature 同一算法：去空白 + 小写 + >> 连接。 */
  function cssAtRulesSignature(list) {
    if (!list || !list.length) return "";
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push(String(list[i]).replace(/\s+/g, "").toLowerCase());
    }
    return out.join(">>");
  }

  /** 样式表来源：内联时由 data-lh-inline 标明原文件；外部/未知为空。 */
  function cssSheetSource(sheet) {
    try {
      var owner = sheet.ownerNode || sheet.owningElement;
      if (owner && owner.getAttribute) return owner.getAttribute("data-lh-inline") || "";
    } catch (e) {}
    return "";
  }

  function cssConditionText(rule) {
    try {
      if (rule.media && typeof rule.media.mediaText === "string") {
        return "@media " + rule.media.mediaText;
      }
      if (typeof rule.conditionText === "string" && rule.conditionText) {
        if (rule.type === 12) return "@supports " + rule.conditionText;
        if (rule.name) return "@" + rule.name + " " + rule.conditionText;
        return "@condition " + rule.conditionText;
      }
      if (rule.name && typeof rule.name === "string") return "@layer " + rule.name;
    } catch (e) {}
    return "";
  }

  /**
   * 遍历 styleSheets，用 el.matches(selectorText) 判断命中。
   * 跨源样式表读 cssRules 会抛 SecurityError —— 直接跳过（内联后不存在这个问题）。
   *
   * 每条命中除了选择器/文件/条件，还回传两样「来源信息」，让父窗口能唯一对上索引里那条规则：
   * - occurrence：同一「选择器 + @ 条件」在本样式表里的第几条（0 起）——
   *   同文件重复写同一个选择器时，只按选择器查会永远跳第一条；
   * - matchedBranches + specificity：逗号列表里真正命中的是哪几支，
   *   特异性按命中的那几支算（顶层列表等价于多条独立规则，取命中最高的那支；
   *   :is()/:not()/:has() 的参数仍按规范取全部参数的最大值，见 cssSpecificity）。
   */
  function collectCssHits(el) {
    var hits = [];
    if (!el || !el.matches) return hits;
    var sheets = [];
    try {
      sheets = document.styleSheets || [];
    } catch (e0) {
      return hits;
    }
    var order = 0;

    function walkRules(list, conds, file, active, occMap) {
      if (!list) return;
      for (var j = 0; j < list.length; j++) {
        var rule = list[j];
        if (!rule) continue;
        if (typeof rule.selectorText === "string") {
          var sel = rule.selectorText;
          var key = cssNormalizeSelector(sel) + "|" + cssAtRulesSignature(conds);
          var occurrence = occMap[key] || 0;
          occMap[key] = occurrence + 1;

          var parts = cssSplitList(sel);
          var matchedParts = [];
          var matched = false;
          if (parts.length > 1) {
            // 逐支试：既判断命中，也记录命中的是哪几支
            for (var p = 0; p < parts.length; p++) {
              var ok = false;
              try {
                ok = el.matches(parts[p]);
              } catch (ePart) {
                ok = false;
              }
              if (ok) matchedParts.push(parts[p]);
            }
            matched = matchedParts.length > 0;
          } else {
            try {
              matched = el.matches(sel);
            } catch (eMatch) {
              matched = false;
            }
          }

          if (matched) {
            var entry = {
              selector: sel,
              // cssText 只为面板兜底展示，截断以免大页面把 postMessage 撑爆
              cssText: String(rule.cssText || "").slice(0, 500),
              file: file,
              conditions: conds.slice(),
              // 条件当前是否成立（@media (max-width: 520px) 在宽屏上不生效）
              active: active,
              specificity: matchedParts.length
                ? cssMaxSpecificity(matchedParts)
                : cssSpecificity(sel),
              occurrence: occurrence,
              order: order,
            };
            // 只命中一部分时才值得标（全部命中就没什么可说明的）
            if (matchedParts.length && matchedParts.length < parts.length) {
              entry.matchedBranches = matchedParts;
            }
            hits.push(entry);
          }
          order++;
          continue;
        }
        if (rule.cssRules) {
          var cond = cssConditionText(rule);
          var next = conds.slice();
          var nextActive = active;
          if (cond) {
            next.push(cond);
            if (rule.media && typeof rule.media.mediaText === "string") {
              try {
                nextActive = active && window.matchMedia(rule.media.mediaText).matches;
              } catch (eMedia) {}
            }
          }
          walkRules(rule.cssRules, next, file, nextActive, occMap);
        }
      }
    }

    for (var i = 0; i < sheets.length; i++) {
      var rules = null;
      try {
        rules = sheets[i].cssRules;
      } catch (e1) {
        continue; // 跨源：读不到规则
      }
      if (!rules) continue;
      // 每个样式表各数一套：同一个文件被内联两次时，两份都指向索引里同一条规则
      walkRules(rules, [], cssSheetSource(sheets[i]), true, {});
    }

    // specificity 从高到低；相同则源码靠后的优先（后者覆盖前者）
    hits.sort(function (a, b) {
      return (
        cssCompareSpec(b.specificity, a.specificity) || b.order - a.order
      );
    });
    return hits.slice(0, 30);
  }

  function cssElementLabel(el) {
    if (!el) return "";
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    var id = el.id ? "#" + el.id : "";
    var cls = "";
    try {
      var list = el.classList || [];
      for (var i = 0; i < list.length && i < 3; i++) cls += "." + list[i];
    } catch (e) {}
    return tag + id + cls;
  }

  /**
   * 元素身份（元素检视用）：tag / id / class 列表 + 打开标签要显示的属性。
   * 只回传 DOM 上直接读得到的属性，不做任何推断——静态分析在父窗口里做。
   */
  function elementAttrs(el) {
    var out = [];
    try {
      var list = el.attributes || [];
      for (var i = 0; i < list.length && out.length < 12; i++) {
        var a = list[i];
        var name = String(a.name || "").toLowerCase();
        if (!name || name === "data-lh" || name.indexOf("data-lh-") === 0) continue;
        var v = String(a.value == null ? "" : a.value).replace(/\s+/g, " ").trim();
        if (v.length > 80) v = v.slice(0, 80) + "…";
        out.push({ name: name, value: v });
      }
    } catch (e) {}
    return out;
  }

  function elementIdentity(el) {
    if (!el || !el.tagName) return null;
    var out = { tag: el.tagName.toLowerCase(), id: el.id || "", classes: [], attrs: [] };
    try {
      var list = el.classList || [];
      for (var i = 0; i < list.length && i < 8; i++) out.classes.push(list[i]);
    } catch (e) {}
    out.attrs = elementAttrs(el);
    return out;
  }

  /**
   * 祖先链（最多 6 层，到 body 为止）。事件委托只能定位到父元素上的绑定，
   * 所以链要短、要够用：点 <li> 时必须能看到 <ul id="list">。
   */
  function elementAncestors(el, depth) {
    var out = [];
    var node = el ? el.parentElement : null;
    while (node && out.length < depth) {
      var tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (!tag || tag === "html") break;
      out.push(elementIdentity(node));
      node = node.parentElement;
    }
    return out;
  }

  /**
   * 点击元素自己没有规则时，向上找几层（点到卡片里的标题，看到的是卡片的样式）。
   * 最多 4 层，且不算 html/body/:root 这种「哪都命中」的规则——否则每次都只会
   * 停在 body 的 margin 上，既没用又会把面板顶出来。
   */
  function cssGenericHit(hit) {
    var sel = String((hit && hit.selector) || "").replace(/\s+/g, "");
    return sel === "html" || sel === "body" || sel === ":root" || sel === "*";
  }

  function resolveCssTarget(el) {
    var node = el;
    var depth = 0;
    while (node && depth < 4) {
      var hits = [];
      var all = collectCssHits(node);
      for (var i = 0; i < all.length; i++) {
        if (!cssGenericHit(all[i])) hits.push(all[i]);
      }
      if (hits.length) return { el: node, hits: hits };
      node = node.parentElement;
      depth++;
    }
    return { el: el, hits: [] };
  }

  function reportCssHits(nonce) {
    var resolved = lastClickEl
      ? resolveCssTarget(lastClickEl)
      : { el: null, hits: [] };
    var el = resolved.el;
    var text = "";
    try {
      text = String((el && el.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 80);
    } catch (eText) {}
    parent.postMessage(
      {
        type: "lh-css-hits",
        nonce: nonce,
        label: cssElementLabel(el),
        text: text,
        hits: resolved.hits,
        // 行为面板要的是「真正点到的那个元素」：样式面板会往上找祖先，行为不该跟着走
        element: elementIdentity(lastClickEl),
        ancestors: elementAncestors(lastClickEl, 6),
      },
      "*"
    );
  }

  document.addEventListener("click", function (e) {
    if (downBtn !== 0 || e.button !== 0) return;
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
    if (e.altKey || e.shiftKey) return;
    var navHandled = handleSrcDocNavClick(e);
    var target = e.target;
    var explicitLocate = !!(e.metaKey || e.ctrlKey) || (e.detail >= 2);
    // Clear stale 朱砂 overlay from source→preview sync; click itself never draws it.
    clearOverlay();
    // Hash / blocked nav / interactive: skip locate (plain and explicit).
    if (navHandled) return;
    if (isInteractive(target)) return;
    // Skip locate only when the click sits inside an existing drag-selection.
    // A leftover non-collapsed selection elsewhere must not block split click jump.
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim() && e.detail < 2 && sel.rangeCount > 0) {
      try {
        var sRange = sel.getRangeAt(0);
        var sNode = target && target.nodeType ? target : null;
        if (sNode && sRange.intersectsNode(sNode)) return;
      } catch (eSel) {
        return;
      }
    }

    var lhEl = closestLh(target);
    var selfAnnotated = false;
    if (lhEl && target && target.closest) {
      try {
        var direct = (target.nodeType === 1 ? target : target.parentElement);
        selfAnnotated = !!(direct && direct.getAttribute && direct.getAttribute("data-lh"));
      } catch (e1) {}
    }

    var clickEl = target && target.nodeType === 1 ? target : (target && target.parentElement) || lhEl;
    var snippet = textSnippetOf(clickEl);
    var hasText = !!(snippet && String(snippet).trim());
    // Attributes are source text too: <img alt> has no visible text to match.
    var attr = attrNear(clickEl, lhEl);
    var hasAttr = !!(attr && attr.value);
    // Plain click on blank / no-text chrome: do not locate or jump.
    if (!explicitLocate && !hasText && !(hasAttr && lhEl)) return;
    // Explicit with no text still needs a data-lh anchor.
    if (explicitLocate && !hasText && !hasAttr && !lhEl) return;

    var lh = parseLh(lhEl);
    // Prefer card/题号 index for script disambiguation; else Nth equal snippet.
    var occurrence = cardIndexNear(clickEl);
    if (!occurrence) {
      occurrence = 1;
      try {
        if (snippet && lhEl) {
          var scope = document.body || document.documentElement;
          var all = scope.querySelectorAll("*");
          var seen = 0;
          var wantTag = lhEl.tagName ? lhEl.tagName.toLowerCase() : "";
          for (var oi = 0; oi < all.length; oi++) {
            var cand = all[oi];
            if ((cand.tagName || "").toLowerCase() !== wantTag) continue;
            var ct = (cand.innerText || cand.textContent || "").trim();
            if (ct !== snippet) continue;
            seen++;
            if (cand === lhEl || cand.contains(target)) { occurrence = seen; break; }
          }
        }
      } catch (eOcc) {}
    }

    // Preview-side: thin outline only (not 朱砂 box). Source highlight is primary.
    try {
      flashClickOutline(clickEl || lhEl);
    } catch (eFlash) {}

    // Word-level offset; undefined (not null) when unknown so old payload shapes stay equal.
    var plainOff = lhEl ? clickPlainOffset(lhEl, e.clientX, e.clientY) : null;

    parent.postMessage({
      type: "lh-locate",
      text: snippet,
      textSnippet: snippet,
      before: "",
      after: "",
      tagPath: tagPath(lhEl || target),
      range: lh || undefined,
      tag: lhEl && lhEl.tagName ? lhEl.tagName.toLowerCase() : undefined,
      id: (lhEl && lhEl.id) || (target && target.id) || undefined,
      annotatedSelf: selfAnnotated,
      occurrence: occurrence,
      // Word-level: caret offset inside the annotated element's rendered text.
      plainOffset: plainOff == null ? undefined : plainOff,
      attrName: hasAttr ? attr.name : undefined,
      attrValue: hasAttr ? attr.value : undefined,
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
    if (d.type === "lh-quiz-list") {
      parent.postMessage({ type: "lh-quiz-list", items: quizListItems() }, "*");
      return;
    }
    if (d.type === "lh-quiz-set-open") {
      quizSetOpen(d);
      return;
    }
    if (d.type === "lh-css-query") {
      reportCssHits(d.nonce);
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
