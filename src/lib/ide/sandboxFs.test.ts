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
  keys: async () => [...memory.keys()],
}));

import {
  IDE_SANDBOX_ID_PREFIX,
  importEntriesToSandbox,
  importZipToSandbox,
  listSandboxDir,
  listSandboxProjects,
  estimateSandboxBytes,
  estimateSandboxProjectBytes,
  storeSandboxProject,
  loadSandboxProject,
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

describe("ZIP 中文名与逐文件导入报告", () => {
  it("UTF-8 标志与 Unicode extra field 下中文文件名不被 GBK 回退破坏", async () => {
    const zip = new JSZip(); zip.file("作业/中文.java", "class Example {}");
    const result = await importZipToSandbox(await zip.generateAsync({ type: "uint8array" }), "作业.zip");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.files["中文.java"]).toBe("class Example {}");
  });

  it("无 UTF-8 标志、无 Unicode extra 的 CP936/GBK 中文名正确导入", async () => {
    const zip = new JSZip(); zip.file("abcd.java", "class Legacy {}");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    // ASCII ZIP has neither UTF-8 flag nor Unicode path extra. Replace both names
    // in local/central headers with equal-length GBK bytes for 中文 (D6 D0 CE C4).
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 97 && bytes[i+1] === 98 && bytes[i+2] === 99 && bytes[i+3] === 100) bytes.set([0xd6, 0xd0, 0xce, 0xc4], i);
    }
    const result = await importZipToSandbox(bytes, "legacy.zip");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.files["中文.java"]).toBe("class Legacy {}");
  });

  it("列出真实跳过路径/原因，JSZip 清洗过的 traversal 也不能绕过验证", async () => {
    const zip = new JSZip();
    zip.file("good.ts", "ok"); zip.file("image.png", "binary"); zip.file("nul.ts", "a\0b");
    zip.file("huge.txt", "x".repeat(2 * 1024 * 1024 + 1));
    zip.file("node_modules/skip.js", "ignore"); zip.file("../evil.ts", "unsafe");
    zip.file("损坏�.ts", "unrecoverable name");
    const result = await importZipToSandbox(await zip.generateAsync({ type: "uint8array" }), "report.zip");
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.project.files).toEqual({ "good.ts": "ok" });
    expect(result.skipped).toBe(6);
    const reasons = Object.fromEntries(result.skippedFiles.map((item) => [item.path, item.reason]));
    expect(reasons["image.png"]).toContain("非文本");
    expect(reasons["nul.ts"]).toContain("NUL");
    expect(reasons["huge.txt"]).toContain("2 MiB");
    expect(reasons["node_modules/skip.js"]).toContain("忽略");
    expect(reasons["../evil.ts"]).toContain("不安全");
    expect(reasons["损坏�.ts"]).toContain("无法可靠恢复");
  });

  it("拒绝绝对路径、驱动器路径、控制字符和对象原型路径", () => {
    for (const path of ["/etc/config.ts", "C:/src/a.ts", "src/../a.ts", "a\0.ts", "__proto__/a.ts", "�.ts"]) expect(normalizeZipEntryPath(path)).toBeNull();
  });

  it("完全失败也保留跳过原因供详情显示", async () => {
    const zip = new JSZip(); zip.file("image.png", "binary");
    const result = await importZipToSandbox(await zip.generateAsync({ type: "uint8array" }), "no-text.zip");
    expect(result.ok).toBe(false);
    expect(result.skippedFiles).toEqual([{ path: "image.png", reason: "非文本文件类型" }]);
  });
});

describe("importEntriesToSandbox", () => {
  it("imports text files, strips a single root, and reports skips", async () => {
    const result = await importEntriesToSandbox(
      [
        { path: "campus-food/src/Main.java", content: "class Main {}" },
        { path: "campus-food/README.md", content: "# food" },
        { path: "campus-food/logo.png", content: "not-text" },
        { path: "campus-food/node_modules/pkg/index.js", content: "ignored" },
      ],
      "campus-food",
      { priorSkipped: [{ path: "campus-food/build/out.js", reason: "忽略目录或文件规则" }] }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.name).toBe("campus-food");
    expect(Object.keys(result.project.files).sort()).toEqual([
      "README.md",
      "src/Main.java",
    ]);
    expect(result.project.pathLabel).toContain("文件夹");
    expect(result.skippedFiles).toEqual(
      expect.arrayContaining([
        { path: "campus-food/build/out.js", reason: "忽略目录或文件规则" },
        { path: "logo.png", reason: "非文本文件类型" },
        { path: "campus-food/node_modules/pkg/index.js", reason: "忽略目录或文件规则" },
      ])
    );
  });

  it("fails honestly when nothing usable remains", async () => {
    const result = await importEntriesToSandbox(
      [{ path: "app/logo.png", content: "bin" }],
      "app"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/没有可预览的文本源码/);
  });
});

describe("listSandboxProjects / estimateSandboxBytes", () => {
  it("lists stored sandboxes and measures their JSON size, not a guessed number", async () => {
    const project: IdeSandboxProject = {
      id: "sandbox:demo",
      name: "demo",
      pathLabel: "导入 zip · demo.zip",
      sourceName: "demo.zip",
      importedAt: 1,
      files: { "src/a.ts": "export const n = 1;\n" },
    };
    await storeSandboxProject(project);
    const listed = await listSandboxProjects();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("sandbox:demo");
    expect(await loadSandboxProject("sandbox:demo")).toEqual(project);
    const bytes = estimateSandboxProjectBytes(project);
    expect(bytes).toBeGreaterThan(0);
    expect(await estimateSandboxBytes()).toBe(bytes);
  });
});
