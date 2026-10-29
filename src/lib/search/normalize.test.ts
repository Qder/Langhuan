import { describe, expect, it } from "vitest";
import {
  bodyForIndex,
  normalizeText,
  stripFrontMatter,
  stripHtmlForIndex,
  stripMarkdownMarkup,
} from "./normalize";

describe("normalizeText", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeText("  Hello   WORLD  ")).toBe("hello world");
  });

  it("maps fullwidth ASCII to halfwidth", () => {
    expect(normalizeText("ＡＢＣ１２３")).toBe("abc123");
  });
});

describe("strip helpers", () => {
  it("strips front matter", () => {
    expect(stripFrontMatter("---\ntags: [a]\n---\n\nBody")).toBe("\nBody");
  });

  it("strips script/style/tags", () => {
    const html = '<p>Hi</p><script>secret</script><style>.x{}</style>';
    expect(stripHtmlForIndex(html)).toBe("Hi");
    expect(stripHtmlForIndex(html)).not.toContain("secret");
  });

  it("keeps markdown link text", () => {
    expect(stripMarkdownMarkup("[hello](http://x.test)")).toContain("hello");
    expect(stripMarkdownMarkup("[hello](http://x.test)")).not.toContain("http");
  });

  it("bodyForIndex picks html vs md", () => {
    expect(bodyForIndex("<b>X</b>", "html")).toBe("X");
    expect(bodyForIndex("---\ntags: [t]\n---\n# Hi", "md")).toContain("Hi");
  });
});
