import { describe, expect, it } from "vitest";
import {
  buildNoteSourceCitation,
  formatNoteSourceCitationBlock,
  parseNoteSourceCitationBody,
  parseNoteSourceCitations,
} from "./noteSourceCitation";

const input = {
  projectId: "sandbox:demo",
  projectName: "demo",
  path: "src/foo.ts",
  fromLine: 12,
  toLine: 20,
  snapshot: "export function foo() {\n  return 1;\n}",
  note: "看清这段循环",
  capturedAt: Date.parse("2026-11-10T09:41:00.000Z"),
};

describe("buildNoteSourceCitation", () => {
  it("builds a citation from a code selection", () => {
    const c = buildNoteSourceCitation(input);
    expect(c.projectId).toBe("sandbox:demo");
    expect(c.path).toBe("src/foo.ts");
    expect(c.fromLine).toBe(12);
    expect(c.toLine).toBe(20);
    expect(c.snapshot).toBe(input.snapshot);
    expect(c.note).toBe("看清这段循环");
    expect(c.capturedAt).toBe(input.capturedAt);
    expect(c.projectName).toBe("demo");
  });

  it("normalizes paths and line order", () => {
    const c = buildNoteSourceCitation({
      ...input,
      path: "\\src\\foo.ts",
      fromLine: 20,
      toLine: 12,
    });
    expect(c.path).toBe("src/foo.ts");
    expect(c.fromLine).toBe(20);
    expect(c.toLine).toBe(20);
  });
});

describe("note source citation round-trip", () => {
  it("parses back the same citation after format (save/reload)", () => {
    const formatted = formatNoteSourceCitationBlock(input);
    expect(formatted).toContain("```lh-cite");
    expect(formatted).toContain("project: sandbox:demo");
    expect(formatted).toContain("path: src/foo.ts");
    expect(formatted).toContain("lines: 12-20");
    expect(formatted).toContain(input.snapshot);
    const parsed = parseNoteSourceCitations(
      `# 笔记\n\n正文\n\n${formatted}\n\n后记\n`
    );
    expect(parsed).toHaveLength(1);
    const c = parsed[0]!.citation;
    expect(c.projectId).toBe(input.projectId);
    expect(c.path).toBe(input.path);
    expect(c.fromLine).toBe(12);
    expect(c.toLine).toBe(20);
    expect(c.snapshot).toBe(input.snapshot);
    expect(c.note).toBe(input.note);
    expect(c.capturedAt).toBe(input.capturedAt);
    expect(c.projectName).toBe("demo");
  });

  it("round-trips a comment that contains newlines and backslashes", () => {
    const block = formatNoteSourceCitationBlock({
      ...input,
      note: "第一行\\还要\n第二行",
    });
    const c = parseNoteSourceCitationBody(
      parseNoteSourceCitations(block)[0]!.raw.replace(/^```lh-cite\n/, "").replace(/\n```$/, "")
    );
    expect(c?.note).toBe("第一行\\还要\n第二行");
  });

  it("ignores a fence that is missing required fields", () => {
    const raw = "```lh-cite\npath: src/a.ts\nlines: 1\n\ncode\n```";
    expect(parseNoteSourceCitations(raw)).toEqual([]);
  });
});
