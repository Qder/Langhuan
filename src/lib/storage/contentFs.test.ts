import { afterEach, describe, expect, it, vi } from "vitest";
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
