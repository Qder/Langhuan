import { describe, expect, it } from "vitest";
import {
  applyFindReplace,
  hitKey,
  scanFindReplace,
  type FindReplaceQuery,
} from "./findReplace";
import type { Document } from "./types";

function doc(
  partial: Partial<Document> & Pick<Document, "id" | "path" | "type" | "content">
): Document {
  return {
    starred: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const baseQuery = (
  over: Partial<FindReplaceQuery> & Pick<FindReplaceQuery, "find">
): FindReplaceQuery => ({
  replaceWith: "",
  caseSensitive: false,
  wholeWord: false,
  scope: "library",
  fileTypes: "all",
  includeFrontMatter: false,
  ...over,
});
describe("applyFindReplace", () => {
  it("pushVersion gets saved body before rewrite; draft base is used", async () => {
    const docs = [
      doc({
        id: "1",
        path: "a.md",
        type: "md",
        content: "---\ntags: [foo]\n---\nsaved foo",
      }),
    ];
    const drafts: Record<string, string> = {
      "1": "---\ntags: [foo]\n---\ndraft foo extra",
    };
    const versions: { docId: string; content: string }[] = [];
    const savedMap = Object.fromEntries(docs.map((d) => [d.id, d.content]));
    const liveMap = { ...savedMap, ...drafts };

    const results = scanFindReplace(
      docs,
      (id) => liveMap[id]!,
      baseQuery({ find: "foo", replaceWith: "bar", caseSensitive: true }),
      { activeId: "1", activePath: "a.md" }
    );
    expect(results[0]!.totalCount).toBe(1);

    const keys = new Set(results[0]!.hits.map((h) => hitKey(h)));
    const out = await applyFindReplace(
      {
        query: baseQuery({ find: "foo", replaceWith: "bar", caseSensitive: true }),
        results,
        selectedKeys: keys,
        replaceAllInTruncatedDocs: false,
        dirtyPolicy: "replace",
      },
      {
        getContent: (id) => liveMap[id]!,
        getSavedContent: (id) => savedMap[id],
        getPath: (id) => docs.find((d) => d.id === id)?.path,
        isDirty: (id) => id in drafts,
        pushVersion: (input) => {
          versions.push({ docId: input.docId, content: input.content });
        },
        setDraft: (id, content) => {
          liveMap[id] = content;
          drafts[id] = content;
        },
        saveDoc: (id) => {
          savedMap[id] = liveMap[id]!;
          delete drafts[id];
        },
      }
    );

    expect(out.replaced).toBe(1);
    expect(out.dirtyReplaced).toBe(1);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.content).toBe("---\ntags: [foo]\n---\nsaved foo");
    expect(savedMap["1"]).toBe("---\ntags: [foo]\n---\ndraft bar extra");
  });

  it("dirtyPolicy skip leaves dirty docs untouched", async () => {
    const docs = [
      doc({ id: "1", path: "a.md", type: "md", content: "foo" }),
    ];
    const live = { "1": "foo draft" };
    const results = scanFindReplace(
      docs,
      (id) => live[id as "1"]!,
      baseQuery({ find: "foo", replaceWith: "bar", caseSensitive: true }),
      { activeId: "1" }
    );
    const keys = new Set(results.flatMap((r) => r.hits.map((h) => hitKey(h))));
    let saved = false;
    const out = await applyFindReplace(
      {
        query: baseQuery({ find: "foo", replaceWith: "bar", caseSensitive: true }),
        results,
        selectedKeys: keys,
        replaceAllInTruncatedDocs: false,
        dirtyPolicy: "skip",
      },
      {
        getContent: (id) => live[id as "1"]!,
        getSavedContent: () => "foo",
        getPath: () => "a.md",
        isDirty: () => true,
        pushVersion: () => undefined,
        setDraft: () => undefined,
        saveDoc: () => {
          saved = true;
        },
      }
    );
    expect(out.replaced).toBe(0);
    expect(out.skippedDocs).toBe(1);
    expect(saved).toBe(false);
  });
});
