import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const generatedPath = path.join(here, "bridge.generated.ts");
const clientPath = path.join(here, "bridge.client.js");
const genScript = path.join(root, "scripts/gen-bridge.mjs");

describe("bridge.generated sync", () => {
  it("matches regenerating from bridge.client.js (run: npm run gen:bridge)", async () => {
    const { buildGeneratedFile } = await import(pathToFileURL(genScript).href);
    const client = fs.readFileSync(clientPath, "utf8");
    const expected = buildGeneratedFile(client);
    const committed = fs.readFileSync(generatedPath, "utf8");
    expect(
      committed,
      "bridge.generated.ts is out of sync with bridge.client.js — run: npm run gen:bridge"
    ).toBe(expected);
  });

  it("escapes </script in client body so srcDoc injection cannot truncate", async () => {
    const { buildGeneratedFile } = await import(pathToFileURL(genScript).href);
    const client = fs.readFileSync(clientPath, "utf8");
    const poisoned = `${client}\n  var _sentinel = "</script><script>alert(1)</script>";\n`;
    const generated = buildGeneratedFile(poisoned);
    // Evaluate the exported string value
    const m = generated.match(/export const HTML_LOCATE_BRIDGE = ("[\s\S]*");\s*$/);
    expect(m).toBeTruthy();
    const value = JSON.parse(m![1]) as string;
    expect(value.startsWith("<script data-lh-bridge=\"1\">")).toBe(true);
    expect(value.endsWith("</script>")).toBe(true);
    const inner = value.slice(value.indexOf(">") + 1, value.lastIndexOf("</script>"));
    // HTML parser must not see a raw </script sequence inside the body
    expect(inner.toLowerCase().includes("</script")).toBe(false);
    expect(inner).toContain("<\\/script>");
    // And the string still parses as JS
    expect(() => new Function(inner)).not.toThrow();
  });

  it("HTML_LOCATE_BRIDGE is a script element whose body parses", () => {
    const m = HTML_LOCATE_BRIDGE.match(/<script[^>]*>([\s\S]*)<\/script>/i);
    expect(m).toBeTruthy();
    expect(() => new Function(m![1])).not.toThrow();
  });
});
