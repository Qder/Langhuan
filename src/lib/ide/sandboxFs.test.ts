import { describe, expect, it, vi, beforeEach } from "vitest";
import JSZip from "jszip";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => memory.get(key),
  set: async (key: string, value: unknown) => {
    memory.set(key, value);
  },
  del: async (key: string) => {
    memory.delete(key);
  },
}));

import {
  IDE_SANDBOX_ID_PREFIX,
  importZipToSandbox,
  listSandboxDir,
  normalizeZipEntryPath,
  readSandboxFile,
  sessionFromSandbox,
  stripSingleRootPrefix,
  type IdeSandboxProject,
} from "./sandboxFs";

beforeEach(() => {
  memory.clear();
});

describe("normalizeZipEntryPath", () => {
  it("drops traversal and ignored segments", () => {
    expect(normalizeZipEntryPath("../x.ts")).toBeNull();
    expect(normalizeZipEntryPath("node_modules/x.ts")).toBeNull();
    expect(normalizeZipEntryPath("src/App.tsx")).toBe("src/App.tsx");
    expect(normalizeZipEntryPath("./src\\\\Main.java")).toBe("src/Main.java");
  });
});

describe("stripSingleRootPrefix", () => {
  it("strips a single coursework root folder", () => {
    const { paths, rootName } = stripSingleRootPrefix([
      "campus-food/pom.xml",
      "campus-food/src/Main.java",
    ]);
    expect(rootName).toBe("campus-food");
    expect(paths).toEqual(["pom.xml", "src/Main.java"]);
  });

  it("keeps multi-root zips as-is", () => {
    const { paths, rootName } = stripSingleRootPrefix([
      "a/x.ts",
      "b/y.ts",
    ]);
    expect(rootName).toBeNull();
    expect(paths).toEqual(["a/x.ts", "b/y.ts"]);
  });
});

describe("listSandboxDir / readSandboxFile", () => {
  const project: IdeSandboxProject = {
    id: `${IDE_SANDBOX_ID_PREFIX}demo`,
    name: "demo",
    pathLabel: "已导入 · demo.zip",
    sourceName: "demo.zip",
    importedAt: 1,
    files: {
      "README.md": "# hi",
      "src/Main.java": "class Main {}",
      "src/util/Helper.java": "class Helper {}",
    },
  };

  it("lists root dirs before files", () => {
    const entries = listSandboxDir(project, "");
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "directory:src",
      "file:README.md",
    ]);
  });

  it("lists nested directory", () => {
    const entries = listSandboxDir(project, "src");
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "directory:util",
      "file:Main.java",
    ]);
  });

  it("reads file text", () => {
    expect(readSandboxFile(project, "README.md")).toBe("# hi");
  });

  it("sessionFromSandbox marks backend", () => {
    const s = sessionFromSandbox(project);
    expect(s.backend).toBe("sandbox");
    expect(s.handle).toBeNull();
    expect(s.id.startsWith("sandbox:")).toBe(true);
  });
});

describe("importZipToSandbox", () => {
  it("imports text files and strips single root", async () => {
    const zip = new JSZip();
    zip.file("campus/README.md", "# campus");
    zip.file("campus/src/App.java", "class App {}");
    zip.file("campus/node_modules/left-pad/index.js", "module.exports=1");
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const result = await importZipToSandbox(buf, "campus.zip");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.name).toBe("campus");
    expect(result.project.files["README.md"]).toBe("# campus");
    expect(result.project.files["src/App.java"]).toContain("class App");
    expect(result.project.files["node_modules/left-pad/index.js"]).toBeUndefined();
    expect(Object.keys(result.project.files).some((p) => p.includes("node_modules"))).toBe(
      false
    );
  });

  it("rejects empty / non-zip", async () => {
    const bad = await importZipToSandbox(new Uint8Array([1, 2, 3]), "x.zip");
    expect(bad.ok).toBe(false);
  });
});
