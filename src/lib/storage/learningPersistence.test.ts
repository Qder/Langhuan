// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
const legacy = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({ get: vi.fn(async (key: string) => legacy.get(key)), set: vi.fn(async (key: string, value: unknown) => { legacy.set(key, value); }), del: vi.fn(async (key: string) => { legacy.delete(key); }), keys: vi.fn(async () => [...legacy.keys()]) }));
vi.mock("./contentApi", async (original) => {
  const real = await original<typeof import("./contentApi")>();
  const disk = await import("./contentFs");
  return { ...real, fetchLearningFile: disk.readLearningFile, putLearningFile: disk.writeLearningFile };
});
import { idbJSONStorage } from "./idbPersist";
import { createAnnotation } from "../annotations";
import { LEARNING_PATHS as P, versionPath } from "./learningData";
import { readLearningFile, writeLearningFile, absFromRel } from "./contentFs";
import { installLearningPersistence, hydrateLearningState } from "./learningPersistence";
import { libraryLearningIO, setLearningErrorHandler } from "./learningIO";
import { listVersions, pushVersion, clearVersions } from "./versions";
import { configureScrollMemoryLibrary, readScrollMemoryMap, writeScrollMemory, renameScrollMemory, forgetScrollMemory, flushScrollMemoryLibrary } from "../scrollMemory";
import type { LanghuanState } from "../store/types";
import { createAssetsSlice } from "../store/slices/assetsSlice";
type State = Pick<LanghuanState, "annotations" | "savedSearches" | "quizDocs" | "documents" | "trash"> & { theme: string };
const makeStore = () => createStore<State>()(persist((): State => ({ annotations: [], savedSearches: [], quizDocs: [], documents: [], trash: [], theme: "xuan" }), { name: "langhuan-store", storage: idbJSONStorage, skipHydration: true, partialize: (s) => ({ annotations: s.annotations, savedSearches: s.savedSearches, quizDocs: s.quizDocs, theme: s.theme }) }));
async function hydrate(store: ReturnType<typeof makeStore>) {
  await store.persist.rehydrate();
  installLearningPersistence(store as unknown as Parameters<typeof installLearningPersistence>[0]);
  await hydrateLearningState(store.getState as () => LanghuanState, store.setState);
}
let seq = 0;
describe("learning integration: simulated IDB + localStorage and real content files", () => {
  const cwd = process.cwd(); let root = ""; let id = ""; const errors: string[] = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lh-learning-store-")); process.chdir(root); legacy.clear(); localStorage.clear(); errors.length = 0; id = `doc-${++seq}`;
    setLearningErrorHandler((s) => errors.push(s));
    const annotation = { ...createAnnotation({ docId: id, path: "old.md", quote: "text", start: 0, end: 4 }, 1), id: "old-ann" };
    legacy.set("langhuan-store", JSON.stringify({ state: { annotations: [annotation], savedSearches: [{ id: "old-search", name: "saved", query: "text", createdAt: 1 }], quizDocs: [{ docId: id, updatedAt: 1, items: [{ id: "q", stem: "question", state: "know", updatedAt: 1 }] }], theme: "songyan" }, version: 0 }));
    legacy.set(`langhuan-versions:${id}`, [{ id: "old-version", docId: id, path: "old.md", content: "old body", savedAt: 1 }]);
    localStorage.setItem("lh.mdScroll", JSON.stringify({ "old.md": { top: 30, ratio: 0.3, savedAt: 1 } }));
  });
  afterEach(async () => {
    await flushScrollMemoryLibrary().catch(() => {});
    configureScrollMemoryLibrary(async () => {}, () => {});
    vi.restoreAllMocks(); process.chdir(cwd); await fs.rm(root, { recursive: true, force: true });
  });
  it("migrates all old sources, keeps their keys, and rehydrates library extras after relaunch", async () => {
    const first = makeStore(); await hydrate(first);
    expect((await readLearningFile(P.annotations))?.format).toBe("langhuan-annotations");
    expect((await readLearningFile(versionPath(id)))?.format).toBe("langhuan-versions");
    expect((await readLearningFile(P.progress))?.format).toBe("langhuan-reading-progress");
    const libraryOnly = { ...first.getState().annotations[0], id: "library-only", updatedAt: 3 };
    await writeLearningFile(P.annotations, { format: "langhuan-annotations", version: 1, annotations: [...first.getState().annotations, libraryOnly] });
    await writeLearningFile(P.progress, { format: "langhuan-reading-progress", version: 1, progress: { ...readScrollMemoryMap(), "file-only.html": { top: 75, ratio: 0.75, savedAt: 3 } } });
    const second = makeStore(); await hydrate(second); // fresh in-memory state, old stores still present
    expect(second.getState().annotations.map((a) => a.id).sort()).toEqual(["library-only", "old-ann"]);
    expect(second.getState().theme).toBe("songyan");
    expect(readScrollMemoryMap()["old.md"].top).toBe(30);
    expect(readScrollMemoryMap()["file-only.html"].top).toBe(75);
    expect(legacy.has("langhuan-store")).toBe(true); expect(legacy.has(`langhuan-versions:${id}`)).toBe(true); expect(localStorage.getItem("lh.mdScroll")).not.toBeNull();
    const third = makeStore(); await hydrate(third);
    expect(third.getState().annotations).toHaveLength(2);
    expect(errors).toEqual([]);
    expect((await fs.readdir(absFromRel(".langhuan"))).sort()).toEqual(["annotations.json", "quiz.json", "reading-progress.json", "saved-searches.json", "versions"]);
  });
  it("copying a legacy localStorage store into IDB never deletes the old key", async () => {
    const name = "old-store-rollback";
    const raw = JSON.stringify({ state: { annotations: [{ id: "legacy" }] }, version: 0 });
    localStorage.setItem(name, raw);
    expect(await idbJSONStorage!.getItem(name)).toEqual(JSON.parse(raw));
    expect(legacy.get(name)).toBe(raw);
    expect(localStorage.getItem(name)).toBe(raw);
  });
  it("a failed library write preserves in-memory and IDB data; rehydrate retries", async () => {
    const write = vi.spyOn(libraryLearningIO, "write").mockRejectedValue(new Error("disk full"));
    const store = makeStore(); await hydrate(store);
    expect(store.getState().annotations[0].id).toBe("old-ann"); expect(legacy.get(`langhuan-versions:${id}`)).toBeTruthy();
    expect(errors.join(" ")).toContain("disk full");
    write.mockRestore(); await hydrateLearningState(store.getState as () => LanghuanState, store.setState);
    expect((await readLearningFile(P.annotations))?.format).toBe("langhuan-annotations");
    expect(store.getState().quizDocs[0].items[0].state).toBe("know");
  });
  it("corruption falls back without overwriting bytes, including later annotation edits", async () => {
    await fs.mkdir(path.dirname(absFromRel(P.annotations)), { recursive: true }); await fs.writeFile(absFromRel(P.annotations), "broken annotation file");
    const store = makeStore(); await hydrate(store);
    expect(store.getState().annotations[0].id).toBe("old-ann");
    store.setState({ annotations: store.getState().annotations.map((a) => ({ ...a, note: "new local note" })) });
    await vi.waitFor(() => expect(errors.join(" ")).toContain("不完整旧副本"));
    expect(await fs.readFile(absFromRel(P.annotations), "utf8")).toBe("broken annotation file");
    expect(JSON.parse(String(legacy.get("langhuan-store"))).state.annotations[0].note).toBe("new local note");
  });
  it("ongoing annotations/searches/quiz update their files and legacy rollback state", async () => {
    const store = makeStore(); await hydrate(store);
    store.setState({ annotations: store.getState().annotations.map((a) => ({ ...a, note: "edited", updatedAt: 3 })), savedSearches: [], quizDocs: [] });
    await vi.waitFor(async () => {
      const file = await readLearningFile(P.annotations); expect(file?.format === "langhuan-annotations" && file.annotations[0].note).toBe("edited");
      const searches = await readLearningFile(P.searches); expect(searches?.format === "langhuan-saved-searches" && searches.searches).toEqual([]);
      const quiz = await readLearningFile(P.quiz); expect(quiz?.format === "langhuan-quiz" && quiz.docs).toEqual([]);
    });
    expect(JSON.parse(String(legacy.get("langhuan-store"))).state.annotations[0].note).toBe("edited");
  });
  it("progress is debounced, then rename/delete persist the remapped map", async () => {
    const store = makeStore(); await hydrate(store);
    const spy = vi.spyOn(libraryLearningIO, "write");
    for (let i = 1; i <= 10; i++) writeScrollMemory("new.html", i, 100);
    expect(spy).not.toHaveBeenCalled();
    await flushScrollMemoryLibrary();
    expect(spy.mock.calls.filter(([p]) => p === P.progress)).toHaveLength(1);
    renameScrollMemory("new.html", "renamed.html"); await flushScrollMemoryLibrary();
    const file = await readLearningFile(P.progress);
    expect(file?.format === "langhuan-reading-progress" && file.progress["new.html"]).toBeUndefined();
    expect(file?.format === "langhuan-reading-progress" && file.progress["renamed.html"].top).toBe(10);
    forgetScrollMemory("renamed.html"); await flushScrollMemoryLibrary();
    expect(readScrollMemoryMap()["renamed.html"]).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("lh.mdScroll")!)["renamed.html"]).toBeUndefined();
  });
  it("a failed progress read blocks incomplete writes; rehydrate cancels the stale pending snapshot", async () => {
    const store = makeStore(); await hydrate(store);
    await writeLearningFile(P.progress, { format: "langhuan-reading-progress", version: 1, progress: { ...readScrollMemoryMap(), "remote-only.html": { top: 90, ratio: 0.9, savedAt: 9 } } });
    const read = libraryLearningIO.read;
    const spy = vi.spyOn(libraryLearningIO, "read").mockImplementation((p) => p === P.progress ? Promise.reject(new Error("temporary read failure")) : read(p));
    await hydrateLearningState(store.getState as () => LanghuanState, store.setState);
    writeScrollMemory("local-new.md", 20, 100);
    await expect(flushScrollMemoryLibrary()).rejects.toThrow("不完整旧副本");
    spy.mockRestore();
    await hydrateLearningState(store.getState as () => LanghuanState, store.setState);
    await flushScrollMemoryLibrary();
    const file = await readLearningFile(P.progress);
    expect(file?.format === "langhuan-reading-progress" && file.progress["remote-only.html"].top).toBe(90);
    expect(file?.format === "langhuan-reading-progress" && file.progress["local-new.md"].top).toBe(20);
  });
  it("version writes touch only one doc file, serialize snapshots, cap at twenty and keep rollback keys", async () => {
    const store = makeStore(); await hydrate(store);
    const other = `other-${id}`; await pushVersion({ docId: other, path: "other.md", content: "other" });
    const untouched = await fs.readFile(absFromRel(versionPath(other)), "utf8");
    await Promise.all(Array.from({ length: 25 }, (_, i) => pushVersion({ docId: id, path: "renamed.md", content: `body-${i}` })));
    const list = await listVersions(id); expect(list).toHaveLength(20); expect(new Set(list.map((v) => v.id)).size).toBe(20);
    expect(await fs.readFile(absFromRel(versionPath(other)), "utf8")).toBe(untouched);
    await clearVersions(id); expect(legacy.has(`langhuan-versions:${id}`)).toBe(true);
    expect((await listVersions(id)).length).toBe(20);
  });
  it("version library failure keeps IDB snapshots and later listing retries", async () => {
    const spy = vi.spyOn(libraryLearningIO, "write").mockRejectedValue(new Error("version write failed"));
    const snap = await pushVersion({ docId: id, path: "old.md", content: "new snapshot" });
    expect(snap).not.toBeNull(); expect((legacy.get(`langhuan-versions:${id}`) as unknown[]).length).toBe(2);
    expect(errors.join(" ")).toContain("version write failed");
    spy.mockRestore(); await listVersions(id);
    const file = await readLearningFile(versionPath(id)); expect(file?.format === "langhuan-versions" && file.versions).toHaveLength(2);
  });
  it("library-only history returns alongside an older IDB history after rehydrate", async () => {
    await writeLearningFile(versionPath(id), { format: "langhuan-versions", version: 1, docId: id, versions: [{ id: "file-only-version", docId: id, content: "from library", path: "moved.md", savedAt: 3 }] });
    const store = makeStore(); await hydrate(store);
    expect((await listVersions(id)).map((v) => v.id)).toEqual(["file-only-version", "old-version"]);
    expect(legacy.has(`langhuan-versions:${id}`)).toBe(true);
  });
  it("corrupt per-document history retains raw bytes and old IDB snapshots", async () => {
    await fs.mkdir(path.dirname(absFromRel(versionPath(id))), { recursive: true });
    await fs.writeFile(absFromRel(versionPath(id)), "corrupt history");
    expect((await listVersions(id))[0].id).toBe("old-version");
    await pushVersion({ docId: id, content: "retryable snapshot", path: "old.md" });
    expect(await fs.readFile(absFromRel(versionPath(id)), "utf8")).toBe("corrupt history");
    expect((legacy.get(`langhuan-versions:${id}`) as unknown[]).length).toBe(2);
    expect(errors.join(" ")).toContain("旧数据已保留");
  });
  it("persistQuizStore rejects visibly and leaves quiz state available to retry", async () => {
    const store = makeStore(); await hydrate(store);
    let status = "";
    const quizStore = createStore<LanghuanState>()((...args) => ({ ...createAssetsSlice(...args), setStatus: (s: string) => { status = s; } }) as LanghuanState);
    const docs = store.getState().quizDocs; quizStore.setState({ quizDocs: docs });
    const spy = vi.spyOn(libraryLearningIO, "write").mockRejectedValue(new Error("quiz disk full"));
    await expect(quizStore.getState().persistQuizStore()).rejects.toThrow("quiz disk full");
    expect(quizStore.getState().quizDocs).toBe(docs); expect(status).toContain("本机记录已保留");
    spy.mockRestore(); await quizStore.getState().persistQuizStore();
  });
});
