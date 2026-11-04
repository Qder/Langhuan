import { describe, expect, it } from "vitest";
import { extractFileOutline } from "./fileOutline";

describe("extractFileOutline — TypeScript / JS", () => {
  const ts = [
    "import x from 'y';",
    "",
    "export interface Foo {",
    "  a: string;",
    "}",
    "",
    "export class Bar {",
    "  run() {",
    "    return 1;",
    "  }",
    "}",
    "",
    "export function helper(a: number) {",
    "  return a;",
    "}",
    "",
    "export const arrow = (n: number) => n + 1;",
    "const plain = 3;",
  ].join("\n");

  it("finds interfaces, classes, functions and arrow consts", () => {
    const out = extractFileOutline("src/a.ts", ts);
    expect(out.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "interface:Foo",
      "class:Bar",
      "function:helper",
      "function:arrow",
    ]);
    expect(out[0]!.line).toBe(3);
    expect(out[3]!.line).toBe(17);
  });

  it("keeps nested methods out of the JS rule set (no false positives)", () => {
    const out = extractFileOutline("src/a.ts", ts);
    expect(out.some((s) => s.name === "plain")).toBe(false);
  });
});

describe("extractFileOutline — Java", () => {
  const java = [
    "package com.demo;",
    "",
    "import java.util.List;",
    "",
    "/*",
    " * class FakeInComment {",
    " */",
    "public class DemoService {",
    "  private final Repo repo;",
    "",
    "  public List<String> findAll(int page) {",
    "    return null;",
    "  }",
    "",
    "  private static void log(String msg) {",
    "    System.out.println(msg);",
    "  }",
    "",
    "  if (x) {",
    "    call();",
    "  }",
    "}",
  ].join("\n");

  it("finds the class and methods, skipping comments and control flow", () => {
    const out = extractFileOutline("src/DemoService.java", java);
    expect(out.map((s) => s.name)).toEqual([
      "DemoService",
      "findAll",
      "log",
    ]);
    expect(out[0]!.kind).toBe("class");
    expect(out[1]!.kind).toBe("method");
    expect(out[1]!.line).toBe(11);
  });
});

describe("extractFileOutline — Python", () => {
  it("finds classes and defs with indentation depth", () => {
    const py = [
      "class Repo:",
      "    def __init__(self):",
      "        self.x = 1",
      "",
      "    async def load(self):",
      "        pass",
      "",
      "def main():",
      "    pass",
    ].join("\n");
    const out = extractFileOutline("app/repo.py", py);
    expect(out.map((s) => s.name)).toEqual([
      "Repo",
      "__init__",
      "load",
      "main",
    ]);
    expect(out[1]!.depth).toBeGreaterThan(0);
    expect(out[3]!.depth).toBe(0);
  });
});

describe("extractFileOutline — Markdown", () => {
  it("collects headings with levels and ignores code fences", () => {
    const md = ["# 标题", "", "正文", "", "## 小节一", "### 细分", ""].join("\n");
    const out = extractFileOutline("note.md", md);
    expect(out.map((s) => `${s.level}:${s.name}`)).toEqual([
      "1:标题",
      "2:小节一",
      "3:细分",
    ]);
    expect(out[0]!.kind).toBe("heading");
    expect(out[0]!.depth).toBe(0);
  });

  it("does not treat a # inside a fence as a heading", () => {
    const md = ["# 真标题", "```sh", "# 注释", "```"].join("\n");
    const out = extractFileOutline("note.md", md);
    expect(out.map((s) => s.name)).toEqual(["真标题"]);
  });
});

describe("extractFileOutline — other languages & edge cases", () => {
  it("finds Go and Rust declarations", () => {
    expect(
      extractFileOutline("main.go", "func main() {}\ntype Server struct{}")
        .map((s) => s.name)
    ).toEqual(["main", "Server"]);
    expect(
      extractFileOutline(
        "lib.rs",
        "pub struct S;\npub async fn go() {}\nfn hidden() {}"
      ).map((s) => s.name)
    ).toEqual(["S", "go", "hidden"]);
  });

  it("returns [] for unknown languages and empty input", () => {
    expect(extractFileOutline("data.json", "{\"a\":1}")).toEqual([]);
    expect(extractFileOutline("a.ts", "")).toEqual([]);
    expect(extractFileOutline("a.ts", "\n\n")).toEqual([]);
  });

  it("respects the max budget", () => {
    const body = Array.from({ length: 20 }, (_, i) => `export function f${i}() {}`).join("\n");
    expect(extractFileOutline("a.ts", body, { max: 5 })).toHaveLength(5);
  });

  it("handles CRLF bodies", () => {
    const out = extractFileOutline("a.ts", "export function a() {}\r\nexport function b() {}\r\n");
    expect(out.map((s) => s.name)).toEqual(["a", "b"]);
  });
});

describe("extractFileOutline — line accuracy on real shapes", () => {
  it("reports the 1-based line of the declaration, not of a comment above it", () => {
    const src = [
      "// header comment",
      "",
      "/**",
      " * docs for run",
      " */",
      "export function run() {}",
      "",
      "// trailing comment",
      "export class Box {}",
    ].join("\n");
    const out = extractFileOutline("src/a.ts", src);
    expect(out).toEqual([
      { name: "run", kind: "function", line: 6, depth: 0 },
      { name: "Box", kind: "class", line: 9, depth: 0 },
    ]);
  });

  it("keeps every line number inside the file", () => {
    const src = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0 ? `export function f${i}() {}` : `const v${i} = ${i};`
    ).join("\n");
    const total = src.split("\n").length;
    const out = extractFileOutline("src/a.ts", src);
    expect(out.length).toBeGreaterThan(0);
    for (const sym of out) {
      expect(sym.line).toBeGreaterThanOrEqual(1);
      expect(sym.line).toBeLessThanOrEqual(total);
      // The reported line really is the declaration.
      expect(src.split("\n")[sym.line - 1]).toContain(sym.name);
    }
  });

  it("stops at the symbol budget instead of walking a huge file", () => {
    const src = Array.from({ length: 5000 }, (_, i) => `export function f${i}() {}`).join("\n");
    expect(extractFileOutline("src/a.ts", src, { max: 10 })).toHaveLength(10);
  });
});

describe("extractFileOutline — cost on large files", () => {
  const big = (() => {
    const lines: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      lines.push(
        i % 7 === 0
          ? `export function fn${i}(a: number) { return a + ${i}; }`
          : `const value${i} = compute(${i}, "some typical body text");`
      );
    }
    return lines.join("\n");
  })();

  it("a 20k-line file is scanned well under one frame budget", () => {
    const started = performance.now();
    const out = extractFileOutline("src/big.ts", big);
    const elapsed = performance.now() - started;
    expect(out).toHaveLength(400); // OUTLINE_MAX_SYMBOLS budget
    // Generous on CI, still far below the ~16ms a keystroke could afford.
    expect(elapsed).toBeLessThan(150);
  });

  it("does not allocate a symbol per line", () => {
    const out = extractFileOutline("src/big.ts", big);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.every((s) => s.name && s.line >= 1)).toBe(true);
  });
});
