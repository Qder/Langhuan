import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { readLearningFile, writeLearningFile, absFromRel, writeTextDoc, readIndex } from "./contentFs";
import { LEARNING_PATHS as P, mergeSearches, mergeVersions, parseLearningFile, versionPath } from "./learningData";
import { migrateLearningData, type LearningState } from "./learningMigration";
import { createAnnotation } from "../annotations";
const io = { read: readLearningFile, write: writeLearningFile };
const ann = (id: string, time = 1) => ({ ...createAnnotation({ docId: "doc", path: "a.md", quote: "quote", start: 0, end: 5 }, time), id });
const search = (id: string, time = 1) => ({ id, name: id, query: id, createdAt: time });
const progress = (savedAt: number) => ({ top: 10, ratio: 0.5, savedAt });
const topic = (id: string, time = 1) => ({ id, title: id, description: "", noteIds: ["doc"], citations: [], createdAt: time, updatedAt: time });
const initial = (): LearningState => ({ annotations: [ann("old")], savedSearches: [search("old")], progress: { "a.md": progress(1) }, quizDocs: [{ docId: "doc", updatedAt: 1, items: [{ id: "old", stem: "question", state: "know", updatedAt: 1 }] }], topics: [topic("old")] });
describe("learning file migration in an isolated real library", () => {
  const cwd = process.cwd(); let root = "";
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "lh-learning-")); process.chdir(root); });
  afterEach(async () => { vi.restoreAllMocks(); process.chdir(cwd); await fs.rm(root, { recursive: true, force: true }); });
  it("migrates old-only records, unions library extras, and is idempotent", async () => {
    await writeLearningFile(P.annotations, { format: "langhuan-annotations", version: 1, annotations: [ann("library"), { ...ann("old", 2), note: "newer library note" }] });
    await writeLearningFile(P.progress, { format: "langhuan-reading-progress", version: 1, progress: { "b.html": progress(2) } });
    let state = initial(); const old = structuredClone(state);
    expect((await migrateLearningData(() => state, io, (s) => { state = s; })).errors).toEqual([]);
    expect(state.annotations.map((a) => a.id).sort()).toEqual(["library", "old"]);
    expect(state.annotations.find((a) => a.id === "old")?.note).toBe("newer library note");
    expect(Object.keys(state.progress).sort()).toEqual(["a.md", "b.html"]);
    const once = structuredClone(state);
    await migrateLearningData(() => state, io, (s) => { state = s; });
    expect(state).toEqual(once);
    expect(old.annotations[0].id).toBe("old"); // Migration does not mutate the old-store object.
    expect((await readLearningFile(P.searches))?.format).toBe("langhuan-saved-searches");
    expect((await readLearningFile(P.quiz))?.format).toBe("langhuan-quiz");
  });
  it("a simulated relaunch recovers file-only records while old stores remain", async () => {
    let state = initial();
    await migrateLearningData(() => state, io, (s) => { state = s; });
    await writeLearningFile(P.searches, { format: "langhuan-saved-searches", version: 1, searches: [...state.savedSearches, search("file-only", 3)] });
    state = initial();
    await migrateLearningData(() => state, io, (s) => { state = s; });
    expect(state.savedSearches.map((s) => s.id)).toEqual(["file-only", "old"]);
  });
  it("write failure preserves the merged state and old input; retry succeeds", async () => {
    const old = initial(); let current = old;
    const failed = await migrateLearningData(() => old, { ...io, write: async () => { throw new Error("disk full"); } }, (s) => { current = s; });
    expect(failed.errors).toHaveLength(5);
    expect(current.annotations).toEqual(old.annotations); expect(current.progress).toEqual(old.progress);
    expect(old.quizDocs[0].items[0].state).toBe("know");
    expect((await migrateLearningData(() => current, io, (s) => { current = s; })).errors).toEqual([]);
  });
  it("corrupt bytes stay untouched, even when a later write tries to replace them", async () => {
    await fs.mkdir(path.dirname(absFromRel(P.annotations)), { recursive: true });
    await fs.writeFile(absFromRel(P.annotations), "{broken");
    let state = initial();
    const result = await migrateLearningData(() => state, io, (s) => { state = s; });
    expect(result.blocked).toContain(P.annotations);
    expect(state.annotations[0].id).toBe("old");
    await expect(writeLearningFile(P.annotations, { format: "langhuan-annotations", version: 1, annotations: [] })).rejects.toThrow();
    expect(await fs.readFile(absFromRel(P.annotations), "utf8")).toBe("{broken");
  });
  it("unreadable existing files do not become empty files", async () => {
    await fs.mkdir(absFromRel(P.progress), { recursive: true }); // EISDIR, not ENOENT.
    let state = initial(); const result = await migrateLearningData(() => state, io, (s) => { state = s; });
    expect(result.blocked).toContain(P.progress);
    expect(state.progress["a.md"].savedAt).toBe(1);
    expect((await fs.stat(absFromRel(P.progress))).isDirectory()).toBe(true);
  });
  it("metadata and note saves share the lock, without indexing learning files", async () => {
    await Promise.all([writeTextDoc({ id: "a", path: "a.md", content: "body" }), writeLearningFile(P.annotations, { format: "langhuan-annotations", version: 1, annotations: [ann("a")] }), writeLearningFile(P.searches, { format: "langhuan-saved-searches", version: 1, searches: [search("a")] })]);
    expect(Object.keys((await readIndex()).documents)).toEqual(["a.md"]);
    expect((await readLearningFile(P.annotations))?.format).toBe("langhuan-annotations");
  });
  it("merge keeps the newer progress and extra quiz items, ties prefer library", async () => {
    const local = initial();
    await writeLearningFile(P.progress, { format: "langhuan-reading-progress", version: 1, progress: { "a.md": { ...progress(1), top: 99 } } });
    await writeLearningFile(P.quiz, { format: "langhuan-quiz", version: 1, updatedAt: 2, docs: [{ docId: "doc", updatedAt: 2, items: [{ id: "library", stem: "second", state: "peeked", updatedAt: 2 }] }] });
    await migrateLearningData(() => local, io, (s) => { expect(s.progress["a.md"].top).toBe(99); expect(s.quizDocs[0].items.map((i) => i.id).sort()).toEqual(["library", "old"]); });
  });
  it("enforces caps, schema version, and doc-specific version path", () => {
    expect(mergeSearches(Array.from({ length: 40 }, (_, i) => search(String(i), i)), [])).toHaveLength(30);
    expect(mergeVersions(Array.from({ length: 25 }, (_, i) => ({ id: String(i), docId: "doc", content: "body", path: "a.md", savedAt: i })), [])).toHaveLength(20);
    expect(() => parseLearningFile(P.annotations, '{"format":"langhuan-annotations","version":2,"annotations":[]}')).toThrow();
    expect(() => parseLearningFile(versionPath("a"), '{"format":"langhuan-versions","version":1,"docId":"b","versions":[]}')).toThrow();
  });

  it("topics union by id, newer timestamp wins, ties prefer library, corrupt file is not wiped", async () => {
    const local = initial();
    await writeLearningFile(P.topics, { format: "langhuan-topics", version: 1, topics: [topic("library", 3), { ...topic("old", 1), title: "library-title" }] });
    let state = local;
    await migrateLearningData(() => state, io, (s) => { state = s; });
    expect(state.topics.map((t) => t.id).sort()).toEqual(["library", "old"]);
    expect(state.topics.find((t) => t.id === "old")?.title).toBe("library-title");
    await fs.mkdir(path.dirname(absFromRel(P.topics)), { recursive: true });
    await fs.writeFile(absFromRel(P.topics), "{broken-topics");
    state = initial();
    const result = await migrateLearningData(() => state, io, (s) => { state = s; });
    expect(result.blocked).toContain(P.topics);
    expect(state.topics[0].id).toBe("old");
    expect(await fs.readFile(absFromRel(P.topics), "utf8")).toBe("{broken-topics");
  });
});
