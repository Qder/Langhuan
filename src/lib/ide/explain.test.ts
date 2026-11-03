import { describe, expect, it } from "vitest";
import {
  assembleExplainUserContent,
  buildExplainFilePayloads,
  buildMockExplainMarkdown,
  collectScannedFileIndex,
  mockExplainHasCitationTo,
  IDE_EXPLAIN_MAX_FULL_LINES,
} from "./explain";
import { parseIdeCitations } from "./citations";
import type { IdeFsEntry } from "./ideFs";

describe("buildExplainFilePayloads", () => {
  it("sends whole small file", () => {
    const content = Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join("\n");
    const files = buildExplainFilePayloads({
      path: "src/A.java",
      content,
      includeFile: true,
      includeSelection: false,
    });
    expect(files).toEqual([{ path: "src/A.java", content, startLine: 1 }]);
  });

  it("truncates large file without selection", () => {
    const content = Array.from(
      { length: IDE_EXPLAIN_MAX_FULL_LINES + 50 },
      (_, i) => `L${i + 1}`
    ).join("\n");
    const files = buildExplainFilePayloads({
      path: "src/A.java",
      content,
      includeFile: true,
      includeSelection: false,
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.startLine).toBe(1);
    expect(files[0]!.content.split("\n").length).toBeLessThan(
      IDE_EXPLAIN_MAX_FULL_LINES
    );
    expect(files[0]!.content).toContain("已截断");
  });

  it("sends selection±pad for large file", () => {
    const content = Array.from({ length: 500 }, (_, i) => `L${i + 1}`).join("\n");
    const files = buildExplainFilePayloads({
      path: "src/A.java",
      content,
      includeFile: true,
      includeSelection: true,
      selection: { fromLine: 200, toLine: 205 },
    });
    expect(files[0]!.startLine).toBe(120);
    expect(files[0]!.content.startsWith("L120")).toBe(true);
  });
});

describe("collectScannedFileIndex / assembleExplainUserContent", () => {
  it("assembles fileIndex paths without bodies", () => {
    const children: Record<string, IdeFsEntry[]> = {
      "": [
        { name: "src", path: "src", kind: "directory" },
        { name: "README.md", path: "README.md", kind: "file" },
      ],
      src: [
        { name: "A.java", path: "src/A.java", kind: "file" },
        { name: "B.java", path: "src/B.java", kind: "file" },
        { name: "node_modules", path: "src/node_modules", kind: "directory" },
      ],
      "src/node_modules": [
        { name: "x.js", path: "src/node_modules/x.js", kind: "file" },
      ],
    };
    const index = collectScannedFileIndex(children);
    expect(index).toEqual(["README.md", "src/A.java", "src/B.java"]);
    expect(index).not.toContain("src/node_modules/x.js");

    const body = assembleExplainUserContent(
      "这个类和哪个文件有关",
      [{ path: "src/A.java", content: "class A {}", startLine: 1 }],
      index
    );
    expect(body).toContain("工程已扫描文件路径");
    expect(body).toContain("- src/A.java");
    expect(body).toContain("- src/B.java");
    expect(body).toContain("class A {}");
    // index entries are paths only — no accidental dump of ignored bodies
    expect(body).not.toContain("node_modules/x.js");
  });
});

describe("buildMockExplainMarkdown", () => {
  it("cites the real current file path with a line", () => {
    const md = buildMockExplainMarkdown({
      question: "这个类干什么",
      files: [
        {
          path: "src/A.java",
          content: "package demo;\n\npublic class A {\n  void run() {}\n}\n",
          startLine: 1,
        },
      ],
    });
    expect(mockExplainHasCitationTo(md, "src/A.java")).toBe(true);
    const hits = parseIdeCitations(md);
    expect(hits.some((h) => h.path === "src/A.java" && h.line != null)).toBe(
      true
    );
  });

  it("cites a second index file at line 1 when present", () => {
    const md = buildMockExplainMarkdown({
      question: "这个类和哪个文件有关",
      files: [
        {
          path: "src/A.java",
          content: "public class A {}\n",
          startLine: 1,
        },
      ],
      fileIndex: ["src/A.java", "src/B.java"],
    });
    const hits = parseIdeCitations(md);
    expect(hits.some((h) => h.path === "src/A.java")).toBe(true);
    expect(
      hits.some((h) => h.path === "src/B.java" && h.line === 1)
    ).toBe(true);
    expect(mockExplainHasCitationTo(md, "src/B.java")).toBe(true);
  });
});
