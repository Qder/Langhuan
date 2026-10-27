import { describe, expect, it } from "vitest";
import {
  HTML_LOCATE_BRIDGE,
  buildInstrumentedSrcDoc,
  fragmentIdsToTry,
  injectLocateBridge,
  isDarkCssColor,
  isFragmentHref,
  parseBridgeMessage,
  wouldNavigateAwayFromSrcDoc,
} from "./bridge";
import { BRIDGE_MAX_MESSAGE_CHARS } from "./types";

describe("injectLocateBridge", () => {
  it("injects before the last </body>, not one inside a <script> string", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>ref</title></head>
<body>
<header>HTML Elements</header>
<script>
const DATA = {
  "example": "<!DOCTYPE html><html><body><p>hi</p></body></html>",
  "more": "still in script"
};
</script>
<main>content</main>
</body>
</html>`;

    const out = injectLocateBridge(html);

    const bridgeIdx = out.indexOf('data-lh-bridge="1"');
    expect(bridgeIdx).toBeGreaterThan(-1);
    expect(out.indexOf('data-lh-bridge="1"', bridgeIdx + 1)).toBe(-1);

    const scriptOpen = out.indexOf("<script>\nconst DATA");
    const scriptClose = out.indexOf("</script>", scriptOpen);
    expect(scriptOpen).toBeGreaterThan(-1);
    expect(scriptClose).toBeGreaterThan(scriptOpen);

    const dataRegion = out.slice(scriptOpen, scriptClose + "</script>".length);
    expect(dataRegion).toContain("</body></html>");
    expect(dataRegion).toContain('"more": "still in script"');
    expect(dataRegion).not.toContain("data-lh-bridge");

    const lastBody = out.toLowerCase().lastIndexOf("</body>");
    expect(lastBody).toBeGreaterThan(bridgeIdx);
    const beforeLastBody = out.slice(Math.max(0, lastBody - HTML_LOCATE_BRIDGE.length - 20), lastBody);
    expect(beforeLastBody).toContain("data-lh-bridge");
  });

  it("appends when there is no </body>", () => {
    const html = "<html><div>hi</div></html>";
    const out = injectLocateBridge(html);
    expect(out.endsWith(HTML_LOCATE_BRIDGE) || out.trimEnd().endsWith(HTML_LOCATE_BRIDGE)).toBe(true);
    expect(out).toContain("data-lh-bridge");
  });

  it("strips a previous bridge before re-injecting", () => {
    const once = injectLocateBridge("<html><body>a</body></html>");
    const twice = injectLocateBridge(once);
    expect(twice.split('data-lh-bridge="1"').length - 1).toBe(1);
  });

  it("preserves original casing of the closing body tag", () => {
    const html = "<html><body>x</BODY></html>";
    const out = injectLocateBridge(html);
    expect(out).toMatch(/data-lh-bridge="1"[\s\S]*<\/BODY>/);
    expect(out).not.toMatch(/<\/body>/);
  });

  it("includes preview-only scrollbar chrome and scroll/bg reporters", () => {
    expect(HTML_LOCATE_BRIDGE).toContain("data-lh-preview-chrome");
    expect(HTML_LOCATE_BRIDGE).toContain("lh-bg");
    expect(HTML_LOCATE_BRIDGE).toContain("lh-scroll");
    expect(HTML_LOCATE_BRIDGE).toContain("lh-keydown");
    expect(HTML_LOCATE_BRIDGE).toContain("scrollbar-width");
  });

  it("includes click-to-locate and skips interactive targets", () => {
    expect(HTML_LOCATE_BRIDGE).toContain("isInteractive");
    expect(HTML_LOCATE_BRIDGE).toContain("closestLh");
    expect(HTML_LOCATE_BRIDGE).toContain("data-lh");
    expect(HTML_LOCATE_BRIDGE).toContain('addEventListener("click"');
    expect(HTML_LOCATE_BRIDGE).toContain('type: "lh-locate"');
    expect(HTML_LOCATE_BRIDGE).toContain('type: "lh-contextmenu"');
    // 框选 alone must not auto-edit; locate is via context menu.
    expect(HTML_LOCATE_BRIDGE).not.toContain('type: "lh-edit-selection"');
    expect(HTML_LOCATE_BRIDGE).toContain('tag === "button"');
    expect(HTML_LOCATE_BRIDGE).toContain("lh-scroll-anchors");
    expect(HTML_LOCATE_BRIDGE).toContain("spanBottom");
    expect(HTML_LOCATE_BRIDGE).toContain("capture: true");
    expect(HTML_LOCATE_BRIDGE).toContain("resolveScrollRoot");
    expect(HTML_LOCATE_BRIDGE).toContain("scrollToRange");
    expect(HTML_LOCATE_BRIDGE).toContain("highlightRange");
    expect(HTML_LOCATE_BRIDGE).toContain("LH_POINT_MAX_SPAN");
    expect(HTML_LOCATE_BRIDGE).toContain("pointQuery");
  });

  it("plain left-click clears overlay and never draws 朱砂 box", () => {
    // Plain click must clear stale overlay and return before any showOverlayFor / lh-locate.
    expect(HTML_LOCATE_BRIDGE).toContain("explicitLocate");
    expect(HTML_LOCATE_BRIDGE).toContain("clearOverlay()");
    expect(HTML_LOCATE_BRIDGE).toMatch(/if \(!explicitLocate\) \{[\s\S]*?clearOverlay\(\);[\s\S]*?return;/);
    // Click path must not call showOverlayFor — only highlightRange / scrollToRange / legacy lh-highlight.
    const clickIdx = HTML_LOCATE_BRIDGE.indexOf('addEventListener("click"');
    const msgIdx = HTML_LOCATE_BRIDGE.indexOf('window.addEventListener("message"');
    expect(clickIdx).toBeGreaterThan(-1);
    expect(msgIdx).toBeGreaterThan(clickIdx);
    const clickRegion = HTML_LOCATE_BRIDGE.slice(clickIdx, msgIdx);
    expect(clickRegion).not.toContain("showOverlayFor");
    expect(clickRegion).toContain('type: "lh-locate"');
    // Overlay draw remains for source→preview sync
    const msgRegion = HTML_LOCATE_BRIDGE.slice(msgIdx);
    expect(msgRegion).toContain("showOverlayFor(el)");
  });

  it("intercepts same-document hash clicks so srcDoc does not go blank", () => {
    expect(HTML_LOCATE_BRIDGE).toContain("handleSrcDocNavClick");
    expect(HTML_LOCATE_BRIDGE).toContain("findHashTarget");
    expect(HTML_LOCATE_BRIDGE).toContain("closestAnchor");
    expect(HTML_LOCATE_BRIDGE).toContain('charAt(0) === "#"');
    expect(HTML_LOCATE_BRIDGE).toContain("preventDefault");
    expect(HTML_LOCATE_BRIDGE).toContain("decodeURIComponent");
    // Must run before the interactive early-return so <a href="#..."> never navigates.
    const navIdx = HTML_LOCATE_BRIDGE.indexOf("handleSrcDocNavClick(e)");
    const interactiveIdx = HTML_LOCATE_BRIDGE.indexOf("isInteractive(target)");
    expect(navIdx).toBeGreaterThan(-1);
    expect(interactiveIdx).toBeGreaterThan(navIdx);
  });
});

describe("isFragmentHref / fragmentIdsToTry / wouldNavigateAwayFromSrcDoc", () => {
  it("detects fragment hrefs including non-ASCII ids", () => {
    expect(isFragmentHref("#svg-和-mathml")).toBe(true);
    expect(isFragmentHref("#")).toBe(true);
    expect(isFragmentHref("  #foo")).toBe(true);
    expect(isFragmentHref("/page")).toBe(false);
    expect(isFragmentHref("https://example.com#x")).toBe(false);
    expect(isFragmentHref(null)).toBe(false);
  });

  it("yields raw + decoded fragment id candidates", () => {
    expect(fragmentIdsToTry("#")).toEqual([]);
    expect(fragmentIdsToTry("#svg-和-mathml")).toEqual(["svg-和-mathml"]);
    const encoded = "#svg-%E5%92%8C-mathml";
    const ids = fragmentIdsToTry(encoded);
    expect(ids[0]).toBe("svg-%E5%92%8C-mathml");
    expect(ids).toContain("svg-和-mathml");
  });

  it("flags in-frame navigations that would wipe about:srcdoc", () => {
    expect(wouldNavigateAwayFromSrcDoc("#x")).toBe(false);
    expect(wouldNavigateAwayFromSrcDoc("https://ex.com", "_blank")).toBe(false);
    expect(wouldNavigateAwayFromSrcDoc("https://ex.com")).toBe(true);
    expect(wouldNavigateAwayFromSrcDoc("./other.html")).toBe(true);
    expect(wouldNavigateAwayFromSrcDoc("javascript:void(0)")).toBe(false);
  });
});

describe("parseBridgeMessage", () => {
  it("accepts whitelisted types", () => {
    expect(parseBridgeMessage({ type: "lh-edit-selection", text: "hi", before: "", after: "", tagPath: "" })?.type).toBe(
      "lh-edit-selection"
    );
    expect(parseBridgeMessage({ type: "lh-bg", color: "rgb(0,0,0)" })).toEqual({
      type: "lh-bg",
      color: "rgb(0,0,0)",
    });
    expect(parseBridgeMessage({ type: "lh-scroll", percent: 12 })).toEqual({
      type: "lh-scroll",
      percent: 12,
    });
    expect(
      parseBridgeMessage({
        type: "lh-keydown",
        key: "f",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      })?.type
    ).toBe("lh-keydown");
  });

  it("rejects unknown types and oversized payloads", () => {
    expect(parseBridgeMessage({ type: "evil" })).toBeNull();
    expect(parseBridgeMessage(null)).toBeNull();
    const huge = { type: "lh-selection", text: "x".repeat(BRIDGE_MAX_MESSAGE_CHARS) };
    expect(parseBridgeMessage(huge)).toBeNull();
  });
});

describe("isDarkCssColor", () => {
  it("detects dark rgb backgrounds", () => {
    expect(isDarkCssColor("rgb(18, 17, 14)")).toBe(true);
    expect(isDarkCssColor("rgb(245, 239, 226)")).toBe(false);
    expect(isDarkCssColor("rgba(0,0,0,1)")).toBe(true);
  });
});

describe("buildInstrumentedSrcDoc", () => {
  it("instruments and injects bridge without mutating markers into a strip-clean export", () => {
    const src = "<!DOCTYPE html><html><body><h2>标题</h2><p>段</p></body></html>";
    const out = buildInstrumentedSrcDoc(src);
    expect(out).toContain("data-lh=");
    expect(out).toContain("data-lh-bridge");
    expect(src).not.toContain("data-lh");
  });

  it("accepts lh-scroll-anchors messages", () => {
    const msg = parseBridgeMessage({
      type: "lh-scroll-anchors",
      viewportTop: 10,
      anchors: [{ range: { start: 1, end: 5 }, top: 8 }],
    });
    expect(msg?.type).toBe("lh-scroll-anchors");
  });
});
