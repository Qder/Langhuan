import { describe, expect, it, vi } from "vitest";
import type { IdeFsEntry } from "./ideFs";
import {
  formatExplainMissStatus,
  formatExplainOpenedStatus,
  runExplainCitationJump,
} from "./explainJump";

function tree(files: string[]): Record<string, IdeFsEntry[]> {
  const children: Record<string, IdeFsEntry[]> = { "": [] };
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    const parts = norm.split("/");
    const name = parts[parts.length - 1]!;
    const dir = parts.slice(0, -1).join("/");
    if (!children[dir]) children[dir] = [];
    children[dir].push({ name, path: norm, kind: "file" });
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const parent = acc;
      const seg = parts[i]!;
      acc = acc ? `${acc}/${seg}` : seg;
      if (!children[parent]) children[parent] = [];
      if (!children[parent].some((e) => e.path === acc && e.kind === "directory")) {
        children[parent].push({ name: seg, path: acc, kind: "directory" });
      }
    }
  }
  return children;
}

const eureka =
  "merchant-service/src/main/java/com/campus/food/EurekaServerApplication.java";

describe("formatExplainOpenedStatus", () => {
  it("names the file and line", () => {
    expect(formatExplainOpenedStatus(eureka, 1)).toBe(`已打开 ${eureka}:1`);
    expect(formatExplainOpenedStatus(eureka, 1, 5)).toBe(`已打开 ${eureka}:1-5`);
  });
});

describe("runExplainCitationJump", () => {
  it("calls openFile with the scanned Eureka path (basename chip)", async () => {
    const openFile = vi.fn(async () => true);
    const result = await runExplainCitationJump(
      { path: "EurekaServerApplication.java", line: 1, endLine: 5 },
      { children: tree([eureka]), openFile }
    );
    expect(openFile).toHaveBeenCalledWith(eureka, {
      line: 1,
      endLine: 5,
    });
    expect(result).toEqual({
      ok: true,
      path: eureka,
      line: 1,
      endLine: 5,
    });
    if (result.ok) {
      expect(formatExplainOpenedStatus(result.path, result.line, result.endLine)).toContain(
        "EurekaServerApplication.java:1-5"
      );
    }
  });

  it("non-path token is miss without opening", async () => {
    const openFile = vi.fn(async () => true);
    const result = await runExplainCitationJump(
      { path: "java.util.List", line: 1 },
      { children: tree(["src/A.java"]), openFile }
    );
    expect(openFile).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(formatExplainMissStatus("java.util.List", []));
    expect(result.candidates).toEqual([]);
  });

  it("try-exact openFile miss is still a visible result", async () => {
    const openFile = vi.fn(async () => false);
    const result = await runExplainCitationJump(
      { path: "Missing.java", line: 1 },
      { children: tree(["src/A.java"]), openFile }
    );
    expect(openFile).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("找不到");
  });

  it("ambiguous basename lists candidates instead of opening the wrong file", async () => {
    const openFile = vi.fn(async () => true);
    const result = await runExplainCitationJump(
      { path: "Main.java" },
      { children: tree(["a/Main.java", "b/Main.java"]), openFile }
    );
    expect(openFile).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.candidates).toEqual(expect.arrayContaining(["a/Main.java", "b/Main.java"]));
    expect(result.message).toContain("同名候选");
  });
});
