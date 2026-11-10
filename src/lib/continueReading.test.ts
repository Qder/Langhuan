import { describe, expect, it } from "vitest";
import {
  pickContinueReading,
  recentNotesByUpdatedAt,
} from "./continueReading";

const docs = [
  { id: "edited-recently", path: "notes/new.md", updatedAt: 9000 },
  { id: "read-later", path: "notes/old.md", updatedAt: 1000 },
  { id: "also-read", path: "notes/mid.md", updatedAt: 5000 },
];

describe("pickContinueReading", () => {
  it("picks the document with the newest reading savedAt, not updatedAt", () => {
    const picked = pickContinueReading(docs, {
      "notes/new.md": { savedAt: 2000, ratio: 0.9, top: 800 },
      "notes/old.md": { savedAt: 8000, ratio: 0.4, top: 200 },
    });
    expect(picked?.id).toBe("read-later");
  });

  it("skips progress for missing or renamed documents and uses the next newest", () => {
    const picked = pickContinueReading(docs, {
      "gone/deleted.md": { savedAt: 99000, ratio: 0.5, top: 10 },
      "notes/mid.md": { savedAt: 3000, ratio: 0.2, top: 40 },
      "notes/old.md": { savedAt: 1000, ratio: 0.8, top: 400 },
    });
    expect(picked?.id).toBe("also-read");
  });

  it("returns null when there is no last-read progress (does not fall back to updatedAt)", () => {
    expect(pickContinueReading(docs, {})).toBeNull();
    expect(
      pickContinueReading(docs, {
        "notes/new.md": { ratio: 0.9, top: 10 },
      })
    ).toBeNull();
  });

  it("returns null for an empty library even if progress exists", () => {
    expect(
      pickContinueReading([], { "notes/old.md": { savedAt: 1, ratio: 0.3, top: 1 } })
    ).toBeNull();
  });
});

describe("recentNotesByUpdatedAt", () => {
  it("orders by updatedAt and keeps the honest recent-edit list", () => {
    const recent = recentNotesByUpdatedAt(docs, 2);
    expect(recent.map((d) => d.id)).toEqual(["edited-recently", "also-read"]);
  });

  it("is not influenced by last-read timestamps", () => {
    const reshuffled = [
      { id: "a", path: "a.md", updatedAt: 1 },
      { id: "b", path: "b.md", updatedAt: 3 },
      { id: "c", path: "c.md", updatedAt: 2 },
    ];
    expect(recentNotesByUpdatedAt(reshuffled).map((d) => d.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});
