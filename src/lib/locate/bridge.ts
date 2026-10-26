/** Injected into HTML srcDoc for preview only — never saved/exported. */
export const HTML_LOCATE_BRIDGE = `
<script data-lh-bridge="1">
(function () {
  if (window.__lhBridge) return;
  window.__lhBridge = true;

  function tagPath(node) {
    var parts = [];
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    var depth = 0;
    while (el && el !== document.body && depth < 12) {
      var parent = el.parentElement;
      var idx = 0;
      if (parent) {
        var sibs = parent.children;
        for (var i = 0; i < sibs.length; i++) {
          if (sibs[i].tagName === el.tagName) {
            if (sibs[i] === el) { idx = i; break; }
          }
        }
        // count same-tag index
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

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey) {
      var p = selPayload();
      if (!p) {
        parent.postMessage({ type: "lh-locate", text: "", before: "", after: "", tagPath: "" }, "*");
        return;
      }
      e.preventDefault();
      parent.postMessage({ type: "lh-locate", text: p.text, before: p.before, after: p.after, tagPath: p.tagPath }, "*");
    }
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
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${HTML_LOCATE_BRIDGE}\n</body>`);
  }
  return html + "\n" + HTML_LOCATE_BRIDGE;
}
