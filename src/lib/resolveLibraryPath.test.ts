import { describe, expect, it } from "vitest";
import type { Document } from "./types";
import {
  findDocByLibraryPath,
  mediaSrcFromDocContent,
  resolveAgainstDocPath,
  resolveLibraryHref,
  resolveMediaSrc,
} from "./resolveLibraryPath";

const docs: Document[] = [
  {
    id: "1",
    path: "笔记/a.md",
    type: "md",
    content: "# A",
    starred: false,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "2",
    path: "笔记/assets/dot.svg",
    type: "html",
    content: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>',
    starred: false,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "3",
    path: "笔记/logo.data",
    type: "html",
    content: "data:image/png;base64,abc",
    starred: false,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe("resolveAgainstDocPath", () => {
  it("resolves same-folder and parent paths", () => {
    expect(resolveAgainstDocPath("笔记/a.md", "./assets/dot.svg")).toBe("笔记/assets/dot.svg");
    expect(resolveAgainstDocPath("笔记/a.md", "assets/dot.svg")).toBe("笔记/assets/dot.svg");
    expect(resolveAgainstDocPath("笔记/子/b.md", "../a.md")).toBe("笔记/a.md");
    expect(resolveAgainstDocPath("笔记/a.md", "../../x.md")).toBe("x.md");
  });

  it("leaves absolute urls alone when joining is skipped by callers", () => {
    expect(resolveAgainstDocPath("笔记/a.md", "https://ex.com/x.png")).toBe("https://ex.com/x.png");
  });
});

describe("resolveMediaSrc", () => {
  it("passes through http(s) and data", () => {
    expect(resolveMediaSrc("https://ex.com/a.png", "笔记/a.md", docs)).toEqual({
      kind: "external",
      src: "https://ex.com/a.png",
    });
    expect(resolveMediaSrc("data:image/png;base64,xx", "笔记/a.md", docs).kind).toBe("external");
  });

  it("resolves SVG / data docs in library", () => {
    const svg = resolveMediaSrc("./assets/dot.svg", "笔记/a.md", docs);
    expect(svg.kind).toBe("data");
    if (svg.kind === "data") expect(svg.src.startsWith("data:image/svg+xml")).toBe(true);

    const data = resolveMediaSrc("./logo.data", "笔记/a.md", docs);
    expect(data).toMatchObject({ kind: "data", src: "data:image/png;base64,abc" });
  });

  it("returns missing placeholder for binary-looking paths not in library", () => {
    const miss = resolveMediaSrc("./foo.png", "笔记/a.md", docs);
    expect(miss.kind).toBe("missing");
    if (miss.kind === "missing") {
      expect(miss.path).toBe("笔记/foo.png");
      expect(miss.reason).toMatch(/未入库/);
    }
  });
});

describe("resolveLibraryHref / findDoc", () => {
  it("finds md by relative path", () => {
    expect(findDocByLibraryPath(docs, "笔记/a.md")?.id).toBe("1");
    const link = resolveLibraryHref("../a.md", "笔记/子/x.md", docs);
    expect(link.kind).toBe("doc");
  });
});

describe("mediaSrcFromDocContent", () => {
  it("detects data url and svg", () => {
    expect(mediaSrcFromDocContent("data:image/gif;base64,qq")).toBe("data:image/gif;base64,qq");
    expect(mediaSrcFromDocContent("<svg></svg>")?.startsWith("data:image/svg+xml")).toBe(true);
    expect(mediaSrcFromDocContent("# not image")).toBeNull();
  });
});
