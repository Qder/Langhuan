import { describe, expect, it } from "vitest";
import type { AssetMeta, Document, TrashItem } from "../types";
import {
  computeStorageUsage,
  measureLearningBytes,
  measureLibraryBytes,
  mergeAttachmentBytes,
} from "./usage";

const doc = (id: string, content: string): Document => ({
  id,
  path: `notes/${id}.md`,
  content,
  type: "md",
  starred: false,
  createdAt: 1,
  updatedAt: 1,
});

describe("storage usage categories", () => {
  it("sums only measured categories and does not invent attachment or sandbox sizes", async () => {
    const documents = [doc("a", "hello library")];
    const drafts = { a: "hello library (draft)" };
    const trash: TrashItem[] = [];
    const assets: AssetMeta[] = [
      { id: "img", path: "notes/assets/p.png", mime: "image/png", size: 40, createdAt: 1 },
    ];
    const extras = {
      assets,
      annotations: [{ id: "ann" }],
      savedSearches: [{ id: "s1" }],
      quizDocs: [],
      learningTopics: [{ id: "t1", title: "入门", noteIds: ["a"], citations: [] }],
      readingProgress: { "notes/a.md": { top: 1, ratio: 0.2, savedAt: 1 } },
    };
    const usage = await computeStorageUsage(documents, drafts, trash, extras, {
      estimateVersionsBytes: async () => 17,
      estimateAttachmentBytes: async () => ({
        bytes: mergeAttachmentBytes(new Map([["img", 40]]), assets),
        measured: true,
      }),
      estimateSandboxBytes: async () => ({ bytes: 128, measured: true }),
    });

    const byId = Object.fromEntries(usage.categories.map((c) => [c.id, c]));
    expect(byId.library?.measured).toBe(true);
    expect(byId.library?.bytes).toBe(measureLibraryBytes(documents, drafts, trash));
    expect(byId.attachments?.bytes).toBe(40);
    expect(byId.learning?.bytes).toBe(measureLearningBytes(extras).bytes);
    expect(byId.versions?.bytes).toBe(17);
    expect(byId.importedProjects?.bytes).toBe(128);
    expect(usage.usedBytes).toBe(
      byId.library!.bytes + 40 + byId.learning!.bytes + 17 + 128
    );
    expect(usage.versionsBytes).toBe(17);
  });

  it("omits unmeasured categories from usedBytes instead of filling in a guess", async () => {
    const usage = await computeStorageUsage([doc("a", "x")], {}, [], {}, {
      estimateVersionsBytes: async () => {
        throw new Error("no idb");
      },
      estimateAttachmentBytes: async () => ({ bytes: 0, measured: false }),
      estimateSandboxBytes: async () => ({ bytes: 0, measured: false }),
    });
    const unmeasured = usage.categories.filter((c) => !c.measured).map((c) => c.id);
    expect(unmeasured.sort()).toEqual(["attachments", "importedProjects", "learning", "versions"]);
    expect(usage.usedBytes).toBe(measureLibraryBytes([doc("a", "x")], {}, []));
    expect(usage.versionsBytes).toBe(0);
  });

  it("counts an IDB blob once even when asset metadata also has a size", () => {
    const bytes = mergeAttachmentBytes(
      new Map([["img", 12]]),
      [{ id: "img", path: "p.png", mime: "image/png", size: 99, createdAt: 1 }]
    );
    expect(bytes).toBe(12);
  });

  it("uses metadata size only when the blob itself was not measured", () => {
    expect(
      mergeAttachmentBytes(new Map(), [
        { id: "img", path: "p.png", mime: "image/png", size: 99, createdAt: 1 },
      ])
    ).toBe(99);
  });
});
