import { describe, expect, it } from "vitest";
import {
  findExportLineOrNull,
  importSpecAtOffset,
  importSpecsInLine,
  isRelativeSpec,
  planTsImport,
  resolveRelativePath,
} from "./tsImports";

const FILES = [
  "src/app/page.tsx",
  "src/components/Foo.tsx",
  "src/components/Bar.ts",
  "src/lib/util.ts",
  "src/lib/index.ts",
  "src/legacy/thing.js",
  "src/only-index/index.tsx",
];

describe("isRelativeSpec", () => {
  it("accepts ./ and ../", () => {
    expect(isRelativeSpec("./Foo")).toBe(true);
    expect(isRelativeSpec("../lib/util")).toBe(true);
    expect(isRelativeSpec(".")).toBe(true);
    expect(isRelativeSpec("..")).toBe(true);
  });

  it("rejects packages and aliases", () => {
    expect(isRelativeSpec("react")).toBe(false);
    expect(isRelativeSpec("@/components/Foo")).toBe(false);
    expect(isRelativeSpec("~/lib/util")).toBe(false);
  });

  it("does not treat a dotfile-ish name as relative", () => {
    expect(isRelativeSpec(".config")).toBe(false);
  });
});

describe("resolveRelativePath", () => {
  it("resolves same-dir and parent imports", () => {
    expect(resolveRelativePath("src/app/page.tsx", "./Foo")).toBe("src/app/Foo");
    expect(resolveRelativePath("src/app/page.tsx", "../components/Foo")).toBe(
      "src/components/Foo"
    );
    expect(resolveRelativePath("src/app/page.tsx", "../lib/util")).toBe("src/lib/util");
  });

  it("normalizes redundant segments", () => {
    expect(resolveRelativePath("src/a/b/c.ts", ".././d")).toBe("src/a/d");
    expect(resolveRelativePath("src/a/b/c.ts", "././d")).toBe("src/a/b/d");
  });

  it("returns null when escaping the project root", () => {
    expect(resolveRelativePath("src/a.ts", "../../foo")).toBeNull();
    expect(resolveRelativePath("src/a.ts", "./../../foo")).toBeNull();
  });

  it("returns null for bare packages", () => {
    expect(resolveRelativePath("src/a.ts", "react")).toBeNull();
  });
});

describe("importSpecsInLine / importSpecAtOffset", () => {
  it("reads default / named / side-effect imports", () => {
    expect(importSpecsInLine(`import Foo from "./Foo";`).map((s) => s.spec)).toEqual(["./Foo"]);
    expect(importSpecsInLine(`import { a, b } from "./lib/util";`).map((s) => s.spec)).toEqual([
      "./lib/util",
    ]);
    expect(importSpecsInLine(`import "./global.css";`).map((s) => s.spec)).toEqual([
      "./global.css",
    ]);
    expect(importSpecsInLine(`export * from "./util";`).map((s) => s.spec)).toEqual(["./util"]);
    expect(importSpecsInLine(`const x = require("./legacy")`).map((s) => s.spec)).toEqual([
      "./legacy",
    ]);
    expect(importSpecsInLine(`const m = await import("./lazy")`).map((s) => s.spec)).toEqual([
      "./lazy",
    ]);
  });

  it("returns nothing for plain code", () => {
    expect(importSpecsInLine("const x = 1;")).toEqual([]);
  });

  it("detects the cursor inside the specifier only", () => {
    const line = `import Foo from "./Foo";`;
    const specAt = line.indexOf("./Foo");
    expect(importSpecAtOffset(line, specAt)?.spec).toBe("./Foo");
    expect(importSpecAtOffset(line, specAt + 3)?.spec).toBe("./Foo");
    expect(importSpecAtOffset(line, 0)).toBeNull();
  });
});

describe("planTsImport", () => {
  it("opens the unique relative file", () => {
    expect(
      planTsImport({ fromPath: "src/app/page.tsx", spec: "../components/Foo", fileIndex: FILES })
    ).toEqual({ kind: "open", path: "src/components/Foo.tsx" });
  });

  it("opens a directory index entry", () => {
    expect(
      planTsImport({ fromPath: "src/app/page.tsx", spec: "../only-index", fileIndex: FILES })
    ).toEqual({ kind: "open", path: "src/only-index/index.tsx" });
  });

  it("accepts an explicit extension", () => {
    expect(
      planTsImport({ fromPath: "src/app/page.tsx", spec: "../legacy/thing.js", fileIndex: FILES })
    ).toEqual({ kind: "open", path: "src/legacy/thing.js" });
  });

  it("does not resolve node_modules or path aliases", () => {
    const plan = planTsImport({
      fromPath: "src/app/page.tsx",
      spec: "@/components/Foo",
      fileIndex: FILES,
    });
    expect(plan.kind).toBe("miss");
    if (plan.kind === "miss") expect(plan.reason).toContain("node_modules");
  });

  it("refuses to pick when two plausible files match", () => {
    const plan = planTsImport({
      fromPath: "src/app/page.tsx",
      spec: "../components/Foo",
      fileIndex: [...FILES, "src/components/Foo.ts"],
    });
    expect(plan.kind).toBe("ambiguous");
    if (plan.kind === "ambiguous") {
      expect(plan.candidates).toEqual(["src/components/Foo.ts", "src/components/Foo.tsx"]);
      expect(plan.reason).toContain("非 LSP");
    }
  });

  it("misses when the file is absent", () => {
    const plan = planTsImport({
      fromPath: "src/app/page.tsx",
      spec: "../components/Nope",
      fileIndex: FILES,
    });
    expect(plan.kind).toBe("miss");
  });

  it("misses when the explicit extension is not in the index", () => {
    const plan = planTsImport({
      fromPath: "src/app/page.tsx",
      spec: "../components/Foo.js",
      fileIndex: FILES,
    });
    expect(plan.kind).toBe("miss");
  });
});

describe("findExportLineOrNull", () => {
  it("finds exported declarations", () => {
    const body = `import x from "x";

export function Foo() {}
export class Bar {}
const Baz = 1;
`;
    expect(findExportLineOrNull(body, "Foo")).toBe(3);
    expect(findExportLineOrNull(body, "Bar")).toBe(4);
    expect(findExportLineOrNull(body, "Baz")).toBe(5);
  });

  it("returns null when absent", () => {
    expect(findExportLineOrNull("export const A = 1;", "B")).toBeNull();
  });
});
