/**
 * Prompt 4: reproduce missed wiki rewrites on rename / folder rename.
 * Gaps start as it.fails; flip to it when map-based rewrite + batch folder land.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "./types";

vi.mock("idb-keyval", () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));

const pushVersion = vi.fn(async (...args: unknown[]) => {
  void args;
});
vi.mock("./storage/versions", () => ({
  pushVersion: (...args: unknown[]) => pushVersion(...args),
  clearVersions: vi.fn(async () => undefined),
}));

vi.mock("./storage/contentApi", () => ({
  blobToBase64: vi.fn(async () => "YmFzZTY0"),
  bulkWriteLibrary: vi.fn(async (x: { documents?: unknown[] }) => ({
    documents: x?.documents ?? [],
    assets: [],
    trash: [],
  })),
  deleteLibraryAsset: vi.fn(async () => undefined),
  deleteLibraryDoc: vi.fn(async () => undefined),
  ensureContentFolder: vi.fn(async () => undefined),
  fetchLibrary: vi.fn(async () => ({ documents: [], assets: [], trash: [] })),
  putLibraryAsset: vi.fn(async () => undefined),
  putLibraryDoc: vi.fn(async () => undefined),
  purgeLibraryTrash: vi.fn(async () => undefined),
  restoreLibraryTrash: vi.fn(async () => {
    throw new Error("force fallback persist");
  }),
}));

vi.mock("./storage/fsSync", () => ({
  ensureLibraryDir: vi.fn(async () => undefined),
  writeThroughDoc: vi.fn(async () => false),
}));

vi.mock("./storage/usage", () => ({
  computeStorageUsage: vi.fn(async () => ({
    usedBytes: 12,
    quotaBytes: null,
    breakdown: {},
  })),
  measureLibraryBytes: vi.fn(() => 12),
}));

vi.mock("./assets/store", () => ({
  deleteAssetBlob: vi.fn(async () => undefined),
  putAssetBlob: vi.fn(async () => undefined),
  saveAssetMetaList: vi.fn(async () => undefined),
  getAssetBlob: vi.fn(async () => null),
}));

vi.mock("./storage/contentMigration", () => ({
  stashIdbLibrary: vi.fn(),
  takeIdbLibrary: vi.fn(() => null),
}));

/** Counts rewrite entry points used by renameDoc / renameFolder. */
export const rewriteCallCount = { onRename: 0, withMap: 0 };

vi.mock("./wikilink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wikilink")>();
  return {
    ...actual,
    rewriteWikiLinksOnRename: (
      content: string,
      oldNames: string[],
      newTitle: string
    ) => {
      rewriteCallCount.onRename += 1;
      return actual.rewriteWikiLinksOnRename(content, oldNames, newTitle);
    },
    rewriteWikiLinksWithMap: (content: string, mappings: unknown[]) => {
      rewriteCallCount.withMap += 1;
      const fn = (actual as { rewriteWikiLinksWithMap?: (c: string, m: unknown[]) => { content: string; count: number } }).rewriteWikiLinksWithMap;
      if (typeof fn === "function") {
        return fn(content, mappings);
      }
      // Until WithMap ships, callers still use OnRename.
      throw new Error("rewriteWikiLinksWithMap not implemented");
    },
  };
});

import {
  docLinkNames,
  extractWikiLinks,
  pathTargetOf,
  rewriteWikiLinksOnRename,
  rewriteWikiLinksWithMap,
} from "./wikilink";
import { getDocMeta } from "./docMeta";
import { resolveWikiTarget } from "./search";
import { useStore } from "./store";

function resetStore() {
  useStore.setState({
    documents: [],
    drafts: {},
    emptyFolders: [],
    trash: [],
    activeId: null,
    openTabs: [],
    pinnedTabs: [],
    status: null,
    viewMode: "preview",
    quizDocs: [],
    quizReviewOpen: false,
    pendingQuizReveal: null,
  } as never);
  pushVersion.mockClear();
  rewriteCallCount.onRename = 0;
  rewriteCallCount.withMap = 0;
}

function doc(partial: Partial<Document> & Pick<Document, "path" | "content" | "type">): Document {
  return {
    id: partial.id || `id_${partial.path}`,
    path: partial.path,
    type: partial.type,
    content: partial.content,
    starred: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("wiki rename gaps (reproduce)", () => {
  describe("pure rewriteWikiLinksOnRename", () => {
    it("rewrites title / heading / alias / embed forms (existing)", () => {
      const src = "[[旧名]] ![[旧名#节]] [[旧名|别名]] [[别的]]";
      const { content, count } = rewriteWikiLinksOnRename(src, ["旧名"], "新名");
      expect(count).toBe(3);
      expect(content).toBe("[[新名]] ![[新名#节]] [[新名|别名]] [[别的]]");
    });

    it("preserves path-style target via rewriteWikiLinksWithMap", () => {
      const src = "见 [[日记/2026-10-29]] 与 [[日记/2026-10-29#焦点|今天]] 和 [[2026-10-29]]";
      const oldDoc = doc({ path: "日记/2026-10-29.md", type: "md", content: "" });
      const oldNames = docLinkNames(oldDoc, []);
      const { content, count } = rewriteWikiLinksWithMap(src, [
        {
          oldNames,
          newTarget: "2026-10-29",
          newPathTarget: pathTargetOf("journals/2026-10-29.md"),
        },
      ]);
      // Title-form [[2026-10-29]] already equals newTarget — no rewrite needed.
      expect(count).toBe(2);
      expect(content).toBe(
        "见 [[journals/2026-10-29]] 与 [[journals/2026-10-29#焦点|今天]] 和 [[2026-10-29]]"
      );
    });

    it("OnRename wrapper still title-rewrites for back-compat", () => {
      const src = "[[旧名]] ![[旧名#节|显示]]";
      const { content, count } = rewriteWikiLinksOnRename(src, ["旧名"], "新名");
      expect(count).toBe(2);
      expect(content).toBe("[[新名]] ![[新名#节|显示]]");
    });
  });

  describe("store renameDoc / renameFolder", () => {
    beforeEach(() => resetStore());

    it("rewrites [[]] inside HTML documents", () => {
      const target = useStore.getState().createDoc({
        type: "md",
        path: "旧名.md",
        content: "# 旧名\n",
        open: false,
      });
      useStore.getState().createDoc({
        type: "html",
        path: "page.html",
        content: "<p>见 [[旧名]] 与 ![[旧名#节]]</p>",
        open: false,
      });
      useStore.getState().renameDoc(target.id, "新名.md");
      const html = useStore.getState().documents.find((d) => d.path === "page.html");
      expect(html?.content).toContain("[[新名]]");
      expect(html?.content).toContain("![[新名#节]]");
      expect(html?.content).not.toContain("[[旧名]]");
    });

    it("path-style links follow folder rename", () => {
      useStore.getState().createDoc({
        type: "md",
        path: "日记/2026-10-29.md",
        content: "# day\n",
        open: false,
      });
      const other = useStore.getState().createDoc({
        type: "md",
        path: "inbox.md",
        content: "打开 [[日记/2026-10-29]] 与 [[2026-10-29]]\n",
        open: false,
      });
      useStore.getState().renameFolder("日记", "journals");
      const body = useStore.getState().documents.find((d) => d.id === other.id)?.content || "";
      expect(body).toContain("[[journals/2026-10-29]]");
      expect(body).toContain("[[2026-10-29]]");
      expect(body).not.toContain("[[日记/2026-10-29]]");
      const day = useStore.getState().documents.find((d) => d.path === "journals/2026-10-29.md");
      expect(day).toBeTruthy();
      expect(resolveWikiTarget(useStore.getState().documents, "journals/2026-10-29")?.id).toBe(
        day?.id
      );
    });

    it("appends old title to aliases so missed [[旧名]] still resolves", () => {
      const target = useStore.getState().createDoc({
        type: "md",
        path: "旧名.md",
        content: "hello\n",
        open: false,
      });
      useStore.getState().renameDoc(target.id, "新名.md");
      const renamed = useStore.getState().documents.find((d) => d.id === target.id)!;
      expect(getDocMeta(renamed).aliases).toContain("旧名");
      expect(resolveWikiTarget(useStore.getState().documents, "旧名")?.id).toBe(target.id);
    });

    it("folder rename with 3 docs rewrites each library body once (not N²)", () => {
      useStore.getState().createDoc({
        type: "md",
        path: "pack/a.md",
        content: "A [[b]]\n",
        open: false,
      });
      useStore.getState().createDoc({
        type: "md",
        path: "pack/b.md",
        content: "B [[a]]\n",
        open: false,
      });
      useStore.getState().createDoc({
        type: "md",
        path: "pack/c.md",
        content: "C\n",
        open: false,
      });
      useStore.getState().createDoc({
        type: "md",
        path: "outside.md",
        content: "见 [[a]] [[b]] [[c]]\n",
        open: false,
      });
      rewriteCallCount.onRename = 0;
      rewriteCallCount.withMap = 0;
      useStore.getState().renameFolder("pack", "box");
      const calls = rewriteCallCount.withMap + rewriteCallCount.onRename;
      const docCount = useStore.getState().documents.length;
      // Desired: one pass (≤ one rewrite call per body), not renameDoc×N scans.
      expect(calls).toBeLessThanOrEqual(docCount);
      expect(calls).toBeGreaterThan(0);
    });

    it("pushVersion before rewriting other documents", () => {
      const target = useStore.getState().createDoc({
        type: "md",
        path: "旧名.md",
        content: "t\n",
        open: false,
      });
      const other = useStore.getState().createDoc({
        type: "md",
        path: "ref.md",
        content: "[[旧名]]\n",
        open: false,
      });
      pushVersion.mockClear();
      useStore.getState().renameDoc(target.id, "新名.md");
      const rewritten = pushVersion.mock.calls.some((c) => {
        const arg = c[0] as { docId?: string; content?: string };
        return arg?.docId === other.id && arg?.content === "[[旧名]]\n";
      });
      expect(rewritten).toBe(true);
    });
  });

  describe("docLinkNames coverage", () => {
    it("includes title, basename, path, no-ext, aliases", () => {
      const d = doc({
        path: "日记/2026-10-29.md",
        type: "md",
        content: "---\naliases: [今日]\n---\n\nx\n",
      });
      const names = docLinkNames(d, getDocMeta(d).aliases);
      expect(names).toEqual(
        expect.arrayContaining([
          "2026-10-29",
          "2026-10-29.md",
          "日记/2026-10-29.md",
          "日记/2026-10-29",
          "今日",
        ])
      );
    });
  });
});

describe("extractWikiLinks in HTML", () => {
  it("finds wikilinks in HTML bodies", () => {
    const refs = extractWikiLinks("<p>见 [[旧名]] 与 ![[旧名#节|显]]</p>");
    expect(refs).toHaveLength(2);
    expect(refs[0]?.target).toBe("旧名");
    expect(refs[1]).toMatchObject({ embed: true, heading: "节", alias: "显" });
  });
});
