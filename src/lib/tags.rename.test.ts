import { describe, expect, it } from "vitest";
import {
  normalizeTagRenameName,
  renameTagAcrossLibrary,
  renameTagInContent,
  renameTagList,
} from "./tags";
import type { Document } from "./types";

function md(id: string, content: string): Document {
  return {
    id,
    path: `${id}.md`,
    type: "md",
    content,
    starred: false,
    createdAt: 1,
    updatedAt: 2,
  };
}

function html(id: string, content: string): Document {
  return {
    id,
    path: `${id}.html`,
    type: "html",
    content,
    starred: false,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("renameTagList / normalize", () => {
  it("rejects empty and comma names", () => {
    expect(normalizeTagRenameName("  ")).toBeNull();
    expect(normalizeTagRenameName("a,b")).toBeNull();
    expect(normalizeTagRenameName("初稿")).toBe("初稿");
  });

  it("merges duplicates after rename", () => {
    expect(renameTagList(["草稿", "初稿", "草稿"], "草稿", "初稿")).toEqual(["初稿"]);
  });
});

describe("renameTagInContent / across library", () => {
  it("renames md YAML and html keywords; leaves unrelated bytes alone; merges dups", () => {
    const mdDoc = md(
      "a",
      `---\ntitle: "Note"\ntags: ["草稿", "读书"]\nstatus: draft\n---\nbody\n`
    );
    const htmlDoc = html(
      "b",
      `<!doctype html><html><head><meta name="keywords" content="草稿, 随笔" /><title>H</title></head><body>x</body></html>`
    );
    const plain = md("c", `# no tags\n`);
    const plainBytes = plain.content;

    const mdNext = renameTagInContent(mdDoc.content, "md", "草稿", "初稿");
    expect(mdNext).toContain('tags: ["初稿", "读书"]');
    expect(mdNext).toContain('title: "Note"');
    expect(mdNext).toContain("status: draft");
    expect(mdNext.indexOf("title:")).toBeLessThan(mdNext.indexOf("tags:"));
    expect(mdNext.indexOf("tags:")).toBeLessThan(mdNext.indexOf("status:"));

    const htmlNext = renameTagInContent(htmlDoc.content, "html", "草稿", "初稿");
    expect(htmlNext).toContain('content="初稿, 随笔"');

    const lib = renameTagAcrossLibrary([mdDoc, htmlDoc, plain], "草稿", "初稿");
    expect(lib.changedIds.sort()).toEqual(["a", "b"]);
    expect(lib.documents.find((d) => d.id === "c")?.content).toBe(plainBytes);

    // duplicate merge in one doc
    const dup = md("d", `---\ntags: ["草稿", "初稿"]\n---\n`);
    const merged = renameTagInContent(dup.content, "md", "草稿", "初稿");
    expect(merged).toContain('tags: ["初稿"]');
    expect(merged.match(/初稿/g)?.length).toBe(1);
  });
});
