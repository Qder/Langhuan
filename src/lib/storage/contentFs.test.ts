import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { safeRelPath } from "./pathSanitize";
import {
  absFromRel,
  contentRoot,
  emptyIndex,
  mergeIndexEntry,
  writeRawTextFile,
  writeTextDoc,
  readIndex, readTrashIndex, readAssetsIndex, softDeleteDoc, restoreTrashItem,
  writeAssetBinary, scanLibrary, hardDeletePath,
} from "./contentFs";

describe("safeRelPath (content)", () => {
  it("strips traversal and leading slashes", () => {
    expect(safeRelPath("../a/b.md")).toBe("a/b.md");
    expect(safeRelPath("/notes/x.md")).toBe("notes/x.md");
    expect(safeRelPath("a\\b\\c.md")).toBe("a/b/c.md");
    expect(safeRelPath("a/./b/../c.md")).toBe("a/c.md");
  });
});

describe("absFromRel", () => {
  it("resolves under content root", () => {
    const abs = absFromRel("notes/a.md");
    const root = path.resolve(contentRoot());
    expect(abs === root || abs.startsWith(root + path.sep)).toBe(true);
    expect(abs.endsWith(path.join("notes", "a.md"))).toBe(true);
  });

  it("throws 路径无效 for empty / pure traversal", () => {
    expect(() => absFromRel("")).toThrow(/路径无效/);
    expect(() => absFromRel("..")).toThrow(/路径无效/);
    expect(() => absFromRel("./..")).toThrow(/路径无效/);
  });

  it("throws 路径越界 when resolve escapes content root", () => {
    const root = path.resolve(contentRoot());
    const realResolve = path.resolve.bind(path);
    const spy = vi.spyOn(path, "resolve").mockImplementation((...args: string[]) => {
      if (
        args.length >= 2 &&
        realResolve(args[0]!) === root &&
        String(args[1]).includes("escape-probe")
      ) {
        return realResolve(root, "..", "OUTSIDE_LANGHUAN.md");
      }
      return realResolve(...(args as [string, ...string[]]));
    });
    try {
      expect(() => absFromRel("escape-probe.md")).toThrow(/路径越界/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("write failure (contentFs)", () => {
  const prevCwd = process.cwd();
  let tmp = "";

  afterEach(async () => {
    process.chdir(prevCwd);
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      tmp = "";
    }
  });

  it("writeTextDoc rejects empty path", async () => {
    await expect(
      writeTextDoc({ path: "", content: "x", id: "d1" })
    ).rejects.toThrow(/路径无效/);
  });

  it("writeRawTextFile rejects library .langhuan meta path", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "langhuan-cf-"));
    process.chdir(tmp);
    await expect(writeRawTextFile(".langhuan/evil.txt", "x")).rejects.toThrow(
      /不能写入库元数据/
    );
  });

  it("writeTextDoc succeeds for nested path under temp content/", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "langhuan-cf-"));
    process.chdir(tmp);
    const written = await writeTextDoc({
      path: "notes/hi.md",
      content: "# hi\n",
      id: "d2",
    });
    expect(written.path).toBe("notes/hi.md");
    const abs = path.join(tmp, "content", "notes", "hi.md");
    const body = await fs.readFile(abs, "utf8");
    expect(body).toBe("# hi\n");
  });
});

describe("mergeIndexEntry", () => {
  it("upserts by sanitized path", () => {
    const idx = emptyIndex();
    const next = mergeIndexEntry(
      idx,
      {
        id: "1",
        path: "/notes/hi.md",
        starred: true,
        createdAt: 10,
        updatedAt: 20,
      },
      99
    );
    expect(next.documents["notes/hi.md"]).toEqual({
      id: "1",
      starred: true,
      createdAt: 10,
      updatedAt: 20,
      lastSyncedAt: 99,
    });
    expect(next.updatedAt).toBe(99);
  });
});


describe("durable library mutations (real isolated content directory)", () => {
  const cwd = process.cwd();
  let root = "";
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "langhuan-durable-"));
    process.chdir(root);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    await fs.rm(root, { recursive: true, force: true });
  });
  const note = (p = "old.md", id = "old", content = "original") => writeTextDoc({ path: p, id, content });
  function failReplacement(target: string) {
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === absFromRel(target)) throw new Error("injected replacement failure");
      return rename(from, to);
    });
  }
  async function noTempFiles(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      expect(entry.name.endsWith(".tmp")).toBe(false);
      if (entry.isDirectory()) await noTempFiles(path.join(dir, entry.name));
    }
  }
  it("failed replacement leaves the previous body readable and removes temporary files", async () => {
    await note();
    failReplacement("old.md");
    await expect(note("old.md", "old", "new")).rejects.toThrow("injected");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    expect((await readIndex()).documents["old.md"].id).toBe("old");
    await noTempFiles(contentRoot());
  });
  it("a partial temp write failure never truncates the live body", async () => {
    await note();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (String(args[0]).includes(".old.md.")) {
        vi.spyOn(handle, "writeFile").mockImplementation(async () => { throw new Error("disk full"); });
      }
      return handle;
    });
    await expect(note("old.md", "old", "new")).rejects.toThrow("disk full");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    await noTempFiles(contentRoot());
  });
  it("failed move target write keeps the original file and index", async () => {
    await note();
    failReplacement("folder/new.md");
    await expect(writeTextDoc({ path: "folder/new.md", id: "old", content: "moved", previousPath: "old.md" })).rejects.toThrow("injected");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    expect((await readIndex()).documents["old.md"].id).toBe("old");
    expect((await readIndex()).documents["folder/new.md"]).toBeUndefined();
  });
  it("failed move index commit keeps the old file/index and permits an orphan new file", async () => {
    await note();
    failReplacement(".langhuan/index.json");
    await expect(writeTextDoc({ path: "new.md", id: "old", content: "moved", previousPath: "old.md" })).rejects.toThrow("injected");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    expect(await fs.readFile(absFromRel("new.md"), "utf8")).toBe("moved");
    expect((await readIndex()).documents["old.md"].id).toBe("old");
  });
  it("successful move commits the new file and index before removing the old file", async () => {
    await note();
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (String(file) === absFromRel("old.md")) {
        expect(await fs.readFile(absFromRel("new.md"), "utf8")).toBe("moved");
        expect((await readIndex()).documents["new.md"].id).toBe("old");
      }
      return unlink(file);
    });
    await writeTextDoc({ path: "new.md", id: "old", content: "moved", previousPath: "old.md" });
    await expect(fs.stat(absFromRel("old.md"))).rejects.toThrow();
  });
  it("trash write failure does not delete the live file or change its index", async () => {
    await note();
    failReplacement(".langhuan/trash.json");
    await expect(softDeleteDoc("old.md")).rejects.toThrow("injected");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    expect((await readIndex()).documents["old.md"].id).toBe("old");
  });
  it("unlink failure leaves both recoverable trash and the live file", async () => {
    await note();
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (String(file) === absFromRel("old.md")) {
        expect((await readTrashIndex())[0].doc.content).toBe("original");
        throw new Error("denied");
      }
      return unlink(file);
    });
    await expect(softDeleteDoc("old.md")).rejects.toThrow("denied");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    expect((await readIndex()).documents["old.md"]).toBeDefined();
  });
  it("restore does not overwrite a live note or an unindexed file", async () => {
    await note();
    await softDeleteDoc("old.md");
    await note("old.md", "other", "other body");
    await fs.writeFile(absFromRel("old (1).md"), "external file");
    const restored = await restoreTrashItem("old");
    expect(restored?.path).toBe("old (2).md");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("other body");
    expect(await fs.readFile(absFromRel("old (1).md"), "utf8")).toBe("external file");
    expect(await fs.readFile(absFromRel("old (2).md"), "utf8")).toBe("original");
    expect(await readTrashIndex()).toEqual([]);
  });
  it("failed restore keeps the recoverable trash entry", async () => {
    await note(); await softDeleteDoc("old.md");
    failReplacement("old.md");
    await expect(restoreTrashItem("old")).rejects.toThrow("injected");
    expect((await readTrashIndex())[0].doc.content).toBe("original");
  });
  it("concurrent different-note writes and scan rebuilds never drop index entries", async () => {
    const tasks = [];
    for (let i = 0; i < 20; i++) {
      tasks.push(note(`notes/${i}.md`, `id-${i}`, `body-${i}`));
      if (i % 3 === 0) tasks.push(scanLibrary());
    }
    await Promise.all(tasks);
    const index = await readIndex();
    expect(Object.keys(index.documents)).toHaveLength(20);
    for (let i = 0; i < 20; i++) expect(index.documents[`notes/${i}.md`].id).toBe(`id-${i}`);
  });
  it("concurrent soft deletes retain both trash entries", async () => {
    await Promise.all([note("a.md", "a"), note("b.md", "b")]);
    await Promise.all([softDeleteDoc("a.md"), softDeleteDoc("b.md")]);
    expect((await readTrashIndex()).map((t) => t.doc.id).sort()).toEqual(["a", "b"]);
    expect((await readIndex()).documents).toEqual({});
  });
  it("concurrent attachment writes retain both metadata entries", async () => {
    await Promise.all(["a", "b"].map((id) => writeAssetBinary({ path: `${id}.png`, id, data: Buffer.from(id) })));
    expect((await readAssetsIndex()).map((a) => a.id).sort()).toEqual(["a", "b"]);
  });
  it("corrupt shared metadata fails closed instead of rebuilding an empty index", async () => {
    await note();
    await fs.writeFile(absFromRel(".langhuan/index.json"), "broken-json");
    await expect(scanLibrary()).rejects.toThrow();
    expect(await fs.readFile(absFromRel(".langhuan/index.json"), "utf8")).toBe("broken-json");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
  });
  it.each([true, false])("move refuses an occupied target (indexed=%s)", async (indexed) => {
    await note();
    if (indexed) await note("new.md", "other", "other body");
    else await fs.writeFile(absFromRel("new.md"), "other body");
    await expect(writeTextDoc({ path: "new.md", id: "old", content: "original", previousPath: "old.md" })).rejects.toThrow("占用");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("original");
    expect(await fs.readFile(absFromRel("new.md"), "utf8")).toBe("other body");
  });
  it("failed attachment metadata removal keeps its binary and metadata for retry", async () => {
    await writeAssetBinary({ path: "a.png", id: "asset-a", data: Buffer.from("unique bytes") });
    failReplacement(".langhuan/assets.json");
    await expect(hardDeletePath("a.png")).rejects.toThrow("injected");
    expect(await fs.readFile(absFromRel("a.png"), "utf8")).toBe("unique bytes");
    expect((await readAssetsIndex())[0].id).toBe("asset-a");
  });
  it("an unreadable directory scan never replaces the complete index", async () => {
    await note();
    const before = await fs.readFile(absFromRel(".langhuan/index.json"), "utf8");
    vi.spyOn(fs, "readdir").mockRejectedValue(new Error("directory unreadable"));
    await expect(scanLibrary()).rejects.toThrow("directory unreadable");
    expect(await fs.readFile(absFromRel(".langhuan/index.json"), "utf8")).toBe(before);
  });
  it("restoring a duplicate trash ID keeps the live note independently addressable", async () => {
    await note(); await softDeleteDoc("old.md");
    await note("old.md", "old", "new live body");
    const restored = await restoreTrashItem("old");
    expect(restored?.path).toBe("old (1).md");
    expect(restored?.id).not.toBe("old");
    expect((await readIndex()).documents["old.md"].id).toBe("old");
    expect(await fs.readFile(absFromRel("old.md"), "utf8")).toBe("new live body");
  });

});
