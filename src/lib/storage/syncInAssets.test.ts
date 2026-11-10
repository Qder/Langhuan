import { describe, expect, it } from "vitest";
import {
  classifySyncAsset,
  collectReferencedAssetPaths,
  extractReferencedAssetPaths,
  formatAssetSkipSummary,
  isIgnoredSyncPath,
  mimeForSyncAsset,
  planIngestibleDiskAssets,
  SYNC_ASSET_MAX_FILE_BYTES,
  SYNC_ASSET_MAX_FILES,
} from "./syncInAssets";

describe("isIgnoredSyncPath", () => {
  it("skips node_modules, vcs, junk and .langhuan", () => {
    expect(isIgnoredSyncPath("node_modules/left-pad/index.js")).toBe(true);
    expect(isIgnoredSyncPath("src/.git/config")).toBe(true);
    expect(isIgnoredSyncPath("__MACOSX/._a.png")).toBe(true);
    expect(isIgnoredSyncPath(".langhuan/index.json")).toBe(true);
    expect(isIgnoredSyncPath("notes/.DS_Store")).toBe(true);
    expect(isIgnoredSyncPath("notes/assets/shot.png")).toBe(false);
  });
});

describe("extractReferencedAssetPaths", () => {
  it("resolves markdown and html local links against the note path", () => {
    const paths = extractReferencedAssetPaths(
      "notes/guide.md",
      [
        "![shot](./assets/shot.png)",
        "[pdf](../files/spec.pdf)",
        '<img src="assets/logo.ico">',
        "[ext](https://cdn.example/a.png)",
        "[[wiki]]",
        "![abs](/absolute.png)",
      ].join("\n")
    );
    expect(paths).toEqual([
      "notes/assets/shot.png",
      "files/spec.pdf",
      "absolute.png",
      "notes/assets/logo.ico",
    ]);
  });
});

describe("classifySyncAsset / planIngestibleDiskAssets", () => {
  it("ingests ordinary images even when not referenced", () => {
    const referenced = collectReferencedAssetPaths([]);
    expect(classifySyncAsset("notes/assets/shot.png", referenced).ingest).toBe(true);
    expect(classifySyncAsset("icon.ico", referenced).ingest).toBe(true);
  });

  it("only ingests pdf when referenced or under a reasonable folder", () => {
    const none = new Set<string>();
    expect(classifySyncAsset("random/report.pdf", none)).toEqual({
      ingest: false,
      reason: "未在笔记中引用，也不在 assets 等合理目录",
    });
    expect(classifySyncAsset("notes/assets/report.pdf", none).ingest).toBe(true);
    expect(classifySyncAsset("random/report.pdf", new Set(["random/report.pdf"])).ingest).toBe(
      true
    );
  });

  it("does not vacuum node_modules, documents, or unrelated binaries", () => {
    const refs = new Set(["node_modules/pkg/x.png", "tools/setup.exe", "notes/readme.md"]);
    expect(classifySyncAsset("node_modules/pkg/x.png", refs).ingest).toBe(false);
    expect(classifySyncAsset("tools/setup.exe", refs).ingest).toBe(false);
    expect(classifySyncAsset("notes/readme.md", refs).ingest).toBe(false);
    expect(classifySyncAsset("notes/chart.svg", new Set()).ingest).toBe(false);
  });

  it("pulls a referenced pdf and a new image, skipping oversized and out-of-scope files", () => {
    const docs = [
      {
        path: "notes/guide.md",
        content: "见 [说明](./assets/spec.pdf) 和 ![](./assets/shot.png)",
      },
    ];
    const planned = planIngestibleDiskAssets(
      [
        { path: "notes/assets/shot.png", size: 12, mtime: 1 },
        { path: "notes/assets/spec.pdf", size: 40, mtime: 2 },
        { path: "loose/orphan.pdf", size: 10, mtime: 3 },
        { path: "notes/assets/huge.png", size: SYNC_ASSET_MAX_FILE_BYTES + 1, mtime: 4 },
        { path: "node_modules/pkg/x.png", size: 8, mtime: 5 },
        { path: "notes/guide.md", size: 20, mtime: 6 },
      ],
      docs
    );
    expect(planned.accepted.map((a) => a.path)).toEqual([
      "notes/assets/shot.png",
      "notes/assets/spec.pdf",
    ]);
    expect(planned.truncated).toBe(false);
    expect(planned.skipped).toEqual(
      expect.arrayContaining([
        { path: "loose/orphan.pdf", reason: "未在笔记中引用，也不在 assets 等合理目录" },
        { path: "notes/assets/huge.png", reason: "单文件超过 8 MiB 上限" },
      ])
    );
    expect(planned.skipped.some((s) => s.path.includes("node_modules"))).toBe(false);
    expect(planned.skipped.some((s) => s.path.endsWith("guide.md"))).toBe(false);
  });

  it("stops honestly when the total size budget is exhausted", () => {
    const files = Array.from({ length: 9 }, (_, i) => ({
      path: `img/${String(i).padStart(2, "0")}.png`,
      size: SYNC_ASSET_MAX_FILE_BYTES,
      mtime: i,
    }));
    const planned = planIngestibleDiskAssets(files, []);
    expect(planned.accepted).toHaveLength(8);
    expect(planned.truncated).toBe(true);
    expect(planned.skipped).toEqual([
      { path: "img/08.png", reason: "超过附件合计 64 MiB 上限" },
    ]);
  });

  it("stops honestly when the file-count budget is exhausted", () => {
    const many = Array.from({ length: SYNC_ASSET_MAX_FILES + 2 }, (_, i) => ({
      path: `img/p${String(i).padStart(4, "0")}.png`,
      size: 1,
      mtime: i,
    }));
    const planned = planIngestibleDiskAssets(many, []);
    expect(planned.accepted).toHaveLength(SYNC_ASSET_MAX_FILES);
    expect(planned.truncated).toBe(true);
    expect(planned.skipped.every((s) => s.reason.includes("数量上限"))).toBe(true);
  });

  it("formats a short skip summary", () => {
    expect(formatAssetSkipSummary([], false)).toBe("");
    const text = formatAssetSkipSummary(
      [
        { path: "a.pdf", reason: "未在笔记中引用，也不在 assets 等合理目录" },
        { path: "b.png", reason: "单文件超过 8 MiB 上限" },
        { path: "c.png", reason: "超过附件合计 64 MiB 上限" },
        { path: "d.png", reason: "超过附件合计 64 MiB 上限" },
      ],
      true,
      2
    );
    expect(text).toContain("扫描已截断");
    expect(text).toContain("跳过附件 4");
    expect(text).toContain("a.pdf");
    expect(text).toContain("等 4 项");
  });

  it("derives mime for pdf and ico", () => {
    expect(mimeForSyncAsset("a.pdf")).toBe("application/pdf");
    expect(mimeForSyncAsset("a.ico")).toBe("image/x-icon");
    expect(mimeForSyncAsset("a.png")).toBe("image/png");
  });
});
