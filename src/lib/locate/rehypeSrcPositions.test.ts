import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";
import { rehypeSrcPositions } from "./rehypeSrcPositions";
import { frontmatterLineOffset, frontmatterOffset } from "./frontmatter";
import { srcAttrs } from "./dom";

async function runPositions(body: string, fmOff: number, fmLines: number): Promise<Root> {
  const mdast = unified().use(remarkParse).parse(body);
  const hast = (await unified().use(remarkRehype).run(mdast)) as Root;
  const plugin = rehypeSrcPositions(fmOff, fmLines)();
  plugin(hast);
  return hast;
}

describe("frontmatterLineOffset", () => {
  it("counts newlines in YAML fence", () => {
    const src = "---\ntitle: x\n---\n\nHello";
    expect(frontmatterOffset(src)).toBeGreaterThan(0);
    expect(frontmatterLineOffset(src)).toBe(3);
  });
});

describe("rehypeSrcPositions", () => {
  it("stamps data-src-* with fm char + line offsets; code lines present", async () => {
    const body = "Para one.\n\n## Heading\n\n```js\nline1\nline2\nline3\n```\n";
    const fm = "---\ntitle: t\n---\n";
    const full = fm + body;
    const fmOff = frontmatterOffset(full);
    const fmLines = frontmatterLineOffset(full);

    const tree = await runPositions(body, fmOff, fmLines);
    const stamped: Array<{ tag: string; start: number; line?: number }> = [];
    visit(tree, "element", (node: Element) => {
      const s = node.properties?.["data-src-start"];
      if (typeof s === "number") {
        stamped.push({
          tag: node.tagName,
          start: s,
          line:
            typeof node.properties?.["data-src-line"] === "number"
              ? (node.properties["data-src-line"] as number)
              : undefined,
        });
      }
    });
    expect(stamped.length).toBeGreaterThan(0);
    for (const s of stamped) {
      expect(s.start).toBeGreaterThanOrEqual(fmOff);
    }
    const h2 = stamped.find((s) => s.tag === "h2");
    expect(h2).toBeTruthy();
    expect(h2!.line!).toBeGreaterThanOrEqual(1 + fmLines);

    const codeLines = stamped.filter((s) => s.tag === "span");
    expect(codeLines.length).toBeGreaterThanOrEqual(3);
  });

  it("srcAttrs prefers existing properties (no double fmOffset)", () => {
    const node = {
      properties: { "data-src-start": 100, "data-src-end": 110, "data-src-line": 5 },
      position: { start: { offset: 0 }, end: { offset: 10 } },
    };
    const attrs = srcAttrs(50, node);
    expect(attrs["data-src-start"]).toBe(100);
    expect(attrs["data-src-end"]).toBe(110);
    expect(attrs["data-src-line"]).toBe(5);
  });
});
