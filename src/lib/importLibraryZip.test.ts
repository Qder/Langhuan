import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  normalizeLibraryZipPath,
  parseLibraryNotesZip,
} from "./importLibraryZip";

describe("normalizeLibraryZipPath", () => {
  it("keeps nested note paths", () => {
    expect(normalizeLibraryZipPath("课堂笔记/第一章.md")).toBe("课堂笔记/第一章.md");
  });

  it("drops traversal and junk", () => {
    expect(normalizeLibraryZipPath("../x.md")).toBeNull();
    expect(normalizeLibraryZipPath("__MACOSX/._foo.md")).toBeNull();
    expect(normalizeLibraryZipPath("a/node_modules/x.md")).toBeNull();
    expect(normalizeLibraryZipPath(".DS_Store")).toBeNull();
  });
});

describe("parseLibraryNotesZip", () => {
  it("imports md/html/txt and images; normalizes txt to md", async () => {
    const zip = new JSZip();
    zip.file("笔记/readme.md", "# hi");
    zip.file("笔记/page.html", "<p>x</p>");
    zip.file("笔记/draft.txt", "plain");
    zip.file("笔记/pic.png", "fakepng");
    zip.file("笔记/skip.pdf", "%PDF");
    zip.file("__MACOSX/._readme.md", "junk");
    const blob = await zip.generateAsync({ type: "blob" });
    const res = await parseLibraryNotesZip(blob);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.docs.map((d) => d.path).sort()).toEqual([
      "笔记/draft.md",
      "笔记/page.html",
      "笔记/readme.md",
    ]);
    expect(res.docs.find((d) => d.path === "笔记/readme.md")?.content).toBe("# hi");
    expect(res.assets).toHaveLength(1);
    expect(res.assets[0].path).toBe("笔记/pic.png");
    expect(res.skipped).toBeGreaterThanOrEqual(1);
  });

  it("rejects empty / non-importable zip", async () => {
    const zip = new JSZip();
    zip.file("a.pdf", "x");
    const blob = await zip.generateAsync({ type: "blob" });
    const res = await parseLibraryNotesZip(blob);
    expect(res.ok).toBe(false);
  });

  it("rejects corrupt zip", async () => {
    const res = await parseLibraryNotesZip(new Blob(["not-a-zip"]));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/打不开/);
  });
});
