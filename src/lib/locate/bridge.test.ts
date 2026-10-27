import { describe, expect, it } from "vitest";
import {
  HTML_LOCATE_BRIDGE,
  injectLocateBridge,
  isDarkCssColor,
  parseBridgeMessage,
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
});

describe("parseBridgeMessage", () => {
  it("accepts whitelisted types", () => {
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
