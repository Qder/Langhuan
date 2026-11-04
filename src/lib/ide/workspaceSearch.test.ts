import { describe, expect, it } from "vitest";
import type { IdeFsEntry } from "./ideFs";
import {
  buildContextLine,
  looksBinary,
  parseWorkspaceQueryPattern,
  searchTextInFile,
  searchWorkspace,
} from "./workspaceSearch";

type Entry = { name: string; path: string; kind: "file" | "directory" };

function makeIo(tree: Record<string, Entry[]>, bodies: Record<string, string>) {
  return {
    listDir: async (relDir: string) => (tree[relDir] ?? []) as IdeFsEntry[],
    readFile: async (relPath: string) => {
      const body = bodies[relPath];
      if (body == null) throw new Error("missing");
      return { content: body, bytes: body.length };
    },
  };
}

describe("parseWorkspaceQueryPattern", () => {
  it("defaults to a case-insensitive literal", () => {
    const p = parseWorkspaceQueryPattern("  Hello ");
    expect(p).toEqual({ kind: "literal", needle: "hello" });
  });

  it("supports /re/ and re: forms", () => {
    const a = parseWorkspaceQueryPattern("/foo\\d+/i");
    expect(a.kind).toBe("regex");
    const b = parseWorkspaceQueryPattern("re:bar(baz)?");
    expect(b.kind).toBe("regex");
  });

  it("falls back to literal on a broken regex instead of throwing", () => {
    expect(parseWorkspaceQueryPattern("re:([").kind).toBe("literal");
    expect(parseWorkspaceQueryPattern("/[/").kind).toBe("literal");
  });
});

describe("buildContextLine", () => {
  it("trims indentation and reports the match offset", () => {
    const r = buildContextLine("    const total = 42;", 18, 2);
    expect(r.context).toBe("const total = 42;");
    expect(r.context.slice(r.matchStart, r.matchStart + r.matchLength)).toBe("42");
  });

  it("expands tabs and remaps the match offset", () => {
    const r = buildContextLine("\t\tfoo(1)", 2, 3);
    expect(r.context).toBe("foo(1)");
    expect(r.context.slice(r.matchStart, r.matchStart + r.matchLength)).toBe("foo");
  });

  it("windows very long lines around the match", () => {
    const line = `${"a".repeat(400)}NEEDLE${"b".repeat(400)}`;
    const r = buildContextLine(line, 400, 6, 80);
    expect(r.context.length).toBeLessThanOrEqual(82);
    expect(r.context).toContain("NEEDLE");
    expect(r.context.startsWith("…")).toBe(true);
    expect(r.context.slice(r.matchStart, r.matchStart + 6)).toBe("NEEDLE");
  });
});

describe("searchTextInFile", () => {
  const body = [
    "import x from 'y';",
    "export function loadFile() {",
    "  return readFile();",
    "}",
  ].join("\n");

  it("finds literal matches with 1-based lines", () => {
    const hits = searchTextInFile("src/a.ts", body, "readfile");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(3);
    expect(hits[0]!.path).toBe("src/a.ts");
    expect(hits[0]!.context).toContain("readFile()");
  });

  it("returns nothing for a blank query", () => {
    expect(searchTextInFile("src/a.ts", body, "   ")).toEqual([]);
  });

  it("caps matches per file", () => {
    const many = Array.from({ length: 50 }, () => "hit").join("\n");
    expect(searchTextInFile("a.txt", many, "hit", { maxMatches: 5 })).toHaveLength(5);
  });

  it("skips absurdly long minified lines", () => {
    const minified = `${"x".repeat(5000)}needle`;
    expect(searchTextInFile("a.js", minified, "needle")).toEqual([]);
  });
});

describe("looksBinary", () => {
  it("detects NUL bytes", () => {
    expect(looksBinary("abc\u0000def")).toBe(true);
    expect(looksBinary("plain text")).toBe(false);
  });
});

describe("searchWorkspace", () => {
  const tree = {
    "": [
      { name: "src", path: "src", kind: "directory" as const },
      { name: "README.md", path: "README.md", kind: "file" as const },
      { name: "node_modules", path: "node_modules", kind: "directory" as const },
    ],
    src: [
      { name: "a.ts", path: "src/a.ts", kind: "file" as const },
      { name: "b.ts", path: "src/b.ts", kind: "file" as const },
      { name: "logo.png", path: "src/logo.png", kind: "file" as const },
    ],
    node_modules: [
      { name: "x.js", path: "node_modules/x.js", kind: "file" as const },
    ],
  };
  const bodies = {
    "README.md": "# demo\nreadFile is documented here\n",
    "src/a.ts": "export function readFile() {}\n",
    "src/b.ts": "const other = 1;\n",
    "node_modules/x.js": "readFile();\n",
    "src/logo.png": "readFile-binary",
  };

  it("greps text files, skipping ignored dirs and non-text extensions", async () => {
    const result = await searchWorkspace({
      query: "readfile",
      io: makeIo(tree, bodies),
    });
    expect(result.hits.map((h) => h.path)).toEqual(["README.md", "src/a.ts"]);
    expect(result.hits.every((h) => h.line === 2 || h.line === 1)).toBe(true);
    expect(result.skippedFiles).toBeGreaterThan(0);
  });

  it("reports an empty result without throwing", async () => {
    const result = await searchWorkspace({
      query: "zzz-nope",
      io: makeIo(tree, bodies),
    });
    expect(result.hits).toEqual([]);
    expect(result.scannedFiles).toBeGreaterThan(0);
  });

  it("respects the hit budget and flags truncation", async () => {
    const result = await searchWorkspace({
      query: "readfile",
      io: makeIo(tree, bodies),
      maxHits: 1,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("stops when the depth budget is exhausted", async () => {
    const result = await searchWorkspace({
      query: "readfile",
      io: makeIo(tree, bodies),
      maxDepth: 0,
    });
    // Root files are still read; `src/` is not entered.
    expect(result.hits.map((h) => h.path)).toEqual(["README.md"]);
    expect(result.truncated).toBe(true);
  });

  it("counts unreadable files as skipped", async () => {
    const io = {
      listDir: async (relDir: string) =>
        relDir === ""
          ? [{ name: "bad.ts", path: "bad.ts", kind: "file" as const }]
          : [],
      readFile: async () => {
        throw new Error("denied");
      },
    };
    const result = await searchWorkspace({ query: "x", io });
    expect(result.hits).toEqual([]);
    expect(result.skippedFiles).toBe(1);
  });

  it("honors the cancel signal", async () => {
    const signal = { cancelled: true };
    const result = await searchWorkspace({
      query: "readfile",
      io: makeIo(tree, bodies),
      signal,
    });
    expect(result.hits).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("reports progress callbacks", async () => {
    const seen: number[] = [];
    await searchWorkspace({
      query: "readfile",
      io: makeIo(tree, bodies),
      onProgress: (s) => seen.push(s.scanned),
    });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("ignores an empty query entirely", async () => {
    const result = await searchWorkspace({
      query: "  ",
      io: makeIo(tree, bodies),
    });
    expect(result).toEqual({
      hits: [],
      scannedFiles: 0,
      skippedFiles: 0,
      truncated: false,
    });
  });
});
