import { describe, expect, it } from "vitest";
import { HTML_LOCATE_BRIDGE, injectLocateBridge } from "./bridge";

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

    // Bridge should appear only once, and after the script data region.
    const bridgeIdx = out.indexOf('data-lh-bridge="1"');
    expect(bridgeIdx).toBeGreaterThan(-1);
    expect(out.indexOf('data-lh-bridge="1"', bridgeIdx + 1)).toBe(-1);

    const scriptOpen = out.indexOf("<script>\nconst DATA");
    const scriptClose = out.indexOf("</script>", scriptOpen);
    expect(scriptOpen).toBeGreaterThan(-1);
    expect(scriptClose).toBeGreaterThan(scriptOpen);

    // The page's own script must stay intact: no bridge </script> closing it early.
    const dataRegion = out.slice(scriptOpen, scriptClose + "</script>".length);
    expect(dataRegion).toContain('</body></html>');
    expect(dataRegion).toContain('"more": "still in script"');
    expect(dataRegion).not.toContain("data-lh-bridge");

    // Bridge sits just before the final body close (preserve original casing via slice).
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
    expect(out).not.toMatch(/<\/body>/); // lower-case original was </BODY>
  });
});
