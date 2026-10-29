import { describe, expect, it } from "vitest";
import type { Document } from "./types";
import {
  extractHtmlImages,
  extractMarkdownImages,
  findOrphanDocs,
  findTitleClashes,
  formatLinkHealthReportMarkdown,
  headingAnchors,
  headingExists,
  scanLinkHealthSync,
} from "./linkHealth";

function doc(
  partial: Partial<Document> & Pick<Document, "id" | "path" | "content">
): Document {
  return {
    type: partial.path.endsWith(".html") ? "html" : "md",
    starred: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("extract images", () => {
  it("extracts markdown images but not wikilink embeds", () => {
    const md = "![a](./x.png)\n![[page]]\n![b](https://ex.com/y.png)";
    const imgs = extractMarkdownImages(md);
    expect(imgs).toHaveLength(2);
    expect(imgs[0].src).toBe("./x.png");
    expect(imgs[1].src).toBe("https://ex.com/y.png");
  });

  it("extracts html img src", () => {
    const html = `<img src="./a.png" alt="x"><img src='https://e.com/b.jpg'>`;
    const imgs = extractHtmlImages(html);
    expect(imgs.map((i) => i.src)).toEqual(["./a.png", "https://e.com/b.jpg"]);
  });
});

describe("heading anchors", () => {
  it("matches md headings by text and slug", () => {
    const d = doc({
      id: "1",
      path: "a.md",
      content: "# Hello World\n\n## 大纲\n",
    });
    const a = headingAnchors(d, d.content);
    expect(headingExists(a, "大纲")).toBe(true);
    expect(headingExists(a, "hello-world")).toBe(true);
    expect(headingExists(a, "missing")).toBe(false);
  });

  it("matches html heading ids", () => {
    const d = doc({
      id: "1",
      path: "a.html",
      content: `<h2 id="sec-1">Section</h2>`,
    });
    const a = headingAnchors(d, d.content);
    expect(headingExists(a, "sec-1")).toBe(true);
    expect(headingExists(a, "Section")).toBe(true);
  });
});

describe("scanLinkHealthSync", () => {
  it("reports dangling wiki in md and html", () => {
    const docs = [
      doc({ id: "a", path: "notes/a.md", content: "see [[nope]] and ![[gone]]\n" }),
      doc({
        id: "b",
        path: "notes/b.html",
        content: `<p>link [[missing-page]] here</p>`,
      }),
      doc({ id: "ok", path: "notes/ok.md", content: "# ok\n" }),
    ];
    const report = scanLinkHealthSync(docs);
    const dangling = report.issues.filter((i) => i.type === "dangling-wiki");
    expect(dangling.length).toBeGreaterThanOrEqual(3);
    expect(dangling.some((i) => i.path === "notes/a.md" && i.snippet.includes("nope"))).toBe(
      true
    );
    expect(dangling.some((i) => i.path === "notes/b.html")).toBe(true);
  });

  it("does not flag resolveWikiTarget aliases / path targets", () => {
    const docs = [
      doc({
        id: "t",
        path: "日记/2026-10-29.md",
        content: "---\naliases: [今日]\n---\n# 日记\n",
      }),
      doc({
        id: "x",
        path: "index.md",
        content: "[[今日]] [[日记/2026-10-29]] [[2026-10-29]]\n",
      }),
    ];
    const report = scanLinkHealthSync(docs);
    const dangling = report.issues.filter((i) => i.type === "dangling-wiki");
    expect(dangling).toHaveLength(0);
  });

  it("reports missing-heading when target exists but heading does not", () => {
    const docs = [
      doc({ id: "t", path: "target.md", content: "# Real\n\n## OnlyThis\n" }),
      doc({
        id: "s",
        path: "src.md",
        content: "[[target#OnlyThis]] [[target#NoSuchHeading]]\n",
      }),
    ];
    const report = scanLinkHealthSync(docs);
    const miss = report.issues.filter((i) => i.type === "missing-heading");
    expect(miss).toHaveLength(1);
    expect(miss[0].detail).toContain("NoSuchHeading");
    expect(
      report.issues.filter((i) => i.type === "dangling-wiki")
    ).toHaveLength(0);
  });

  it("reports missing relative image; external images stay separate", () => {
    const docs = [
      doc({
        id: "a",
        path: "folder/note.md",
        content:
          "![ok-missing](./assets/nope.png)\n![ext](https://cdn.example/x.png)\n![]()\n![bad](file:///tmp/x.png)\n",
      }),
    ];
    const report = scanLinkHealthSync(docs, {
      assets: [], // none in vault
    });
    const missing = report.issues.filter((i) => i.type === "missing-image");
    expect(missing.length).toBeGreaterThanOrEqual(3); // nope, empty, file:
    expect(report.issues.filter((i) => i.type === "external-image")).toHaveLength(0);
    expect(report.externalImages.length).toBe(1);
    expect(report.externalImages[0].detail).toContain("https://");
  });

  it("resolves relative image against asset paths", () => {
    const docs = [
      doc({
        id: "a",
        path: "folder/note.md",
        content: "![shot](./assets/shot.png)\n",
      }),
    ];
    const report = scanLinkHealthSync(docs, {
      assets: [{ id: "asset1", path: "folder/assets/shot.png" }],
    });
    expect(report.issues.filter((i) => i.type === "missing-image")).toHaveLength(0);
  });

  it("reports html missing img src", () => {
    const docs = [
      doc({
        id: "h",
        path: "p.html",
        content: `<img src="./missing.jpg"><img src="https://x.com/a.png">`,
      }),
    ];
    const report = scanLinkHealthSync(docs);
    expect(report.issues.some((i) => i.type === "missing-image")).toBe(true);
    expect(report.externalImages.length).toBe(1);
  });

  it("finds orphan md docs using graph definition", () => {
    const docs = [
      doc({ id: "a", path: "a.md", content: "[[b]]\n" }),
      doc({ id: "b", path: "b.md", content: "hi\n" }),
      doc({ id: "c", path: "c.md", content: "lonely\n" }),
      doc({ id: "h", path: "h.html", content: "<p>x</p>" }),
    ];
    const orphans = findOrphanDocs(docs);
    expect(orphans.map((o) => o.path)).toContain("c.md");
    expect(orphans.map((o) => o.path)).not.toContain("a.md");
    expect(orphans.map((o) => o.path)).not.toContain("b.md");
    // html never orphan under graph.ts
    expect(orphans.map((o) => o.path)).not.toContain("h.html");
  });

  it("finds title clashes for same basename title", () => {
    const docs = [
      doc({ id: "1", path: "日记/foo.md", content: "# a\n" }),
      doc({ id: "2", path: "笔记/foo.md", content: "# b\n" }),
      doc({ id: "3", path: "unique.md", content: "# c\n" }),
    ];
    const clashes = findTitleClashes(docs);
    expect(clashes).toHaveLength(2);
    expect(clashes.every((c) => c.snippet === "foo")).toBe(true);
  });

  it("untagged only when opted in", () => {
    const docs = [
      doc({
        id: "1",
        path: "t.md",
        content: "---\ntags: [x]\n---\n# t\n",
      }),
      doc({ id: "2", path: "u.md", content: "# u\n" }),
    ];
    expect(
      scanLinkHealthSync(docs).issues.filter((i) => i.type === "untagged")
    ).toHaveLength(0);
    expect(
      scanLinkHealthSync(docs, { includeUntagged: true }).issues.filter(
        (i) => i.type === "untagged"
      )
    ).toHaveLength(1);
  });

  it("formats markdown report", () => {
    const docs = [
      doc({ id: "a", path: "a.md", content: "[[zzz]]\n" }),
    ];
    const report = scanLinkHealthSync(docs);
    const md = formatLinkHealthReportMarkdown(report);
    expect(md).toContain("链接体检报告");
    expect(md).toContain("失效双链");
    expect(md).toContain("a.md");
  });

  it("empty library reports no problems", () => {
    const report = scanLinkHealthSync([]);
    expect(report.issues).toHaveLength(0);
    expect(formatLinkHealthReportMarkdown(report)).toContain("未发现问题");
  });
});
