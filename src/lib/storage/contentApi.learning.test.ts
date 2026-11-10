import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { GET, PUT } from "../../app/api/library/file/route";
import { fetchLearningFile, putLearningFile, fetchQuizStore, putQuizStore } from "./contentApi";
import { LEARNING_PATHS as P } from "./learningData";
import { absFromRel } from "./contentFs";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
describe("learning metadata through the existing contentApi facade", () => {
  const cwd = process.cwd(); let root = "";
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lh-learning-api-")); process.chdir(root); invoke.mockReset();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new NextRequest(new URL(String(input), "http://localhost"), init as ConstructorParameters<typeof NextRequest>[1]);
      return init?.method === "PUT" ? PUT(req) : GET(req);
    }));
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); process.chdir(cwd); await fs.rm(root, { recursive: true, force: true }); });
  it("browser round-trip preserves Unicode, and missing is null rather than corruption", async () => {
    expect(await fetchLearningFile(P.searches)).toBeNull();
    const value = { format: "langhuan-saved-searches" as const, version: 1 as const, searches: [{ id: "s", name: "认证流程", query: "登录", createdAt: 1 }] };
    await putLearningFile(P.searches, value); expect(await fetchLearningFile(P.searches)).toEqual(value);
  });
  it("corrupt browser files are visible errors and cannot be replaced by an empty payload", async () => {
    await fs.mkdir(path.dirname(absFromRel(P.quiz)), { recursive: true }); await fs.writeFile(absFromRel(P.quiz), "invalid quiz bytes");
    await expect(fetchQuizStore()).rejects.toThrow();
    await expect(putQuizStore({ format: "langhuan-quiz", version: 1, updatedAt: 1, docs: [] })).rejects.toThrow();
    expect(await fs.readFile(absFromRel(P.quiz), "utf8")).toBe("invalid quiz bytes");
  });
  it("quiz write failures propagate through the browser API and retain previous bytes", async () => {
    const payload = { format: "langhuan-quiz" as const, version: 1 as const, updatedAt: 1, docs: [] };
    await putQuizStore(payload);
    vi.spyOn(fs, "rename").mockRejectedValue(new Error("injected disk failure"));
    await expect(putQuizStore({ ...payload, updatedAt: 2 })).rejects.toThrow("injected disk failure");
    expect((await fetchQuizStore()).updatedAt).toBe(1);
  });
  it("rejects invalid learning paths and schemas instead of treating them as note bodies", async () => {
    const invalid = await PUT(new NextRequest("http://localhost/api/library/file", { method: "PUT", body: JSON.stringify({ path: P.annotations, content: '{"format":"langhuan-annotations","version":1,"annotations":[{}]}' }) }));
    expect(invalid.ok).toBe(false);
    const traversal = await GET(new NextRequest("http://localhost/api/library/file?learning=1&path=../.langhuan/quiz.json")); expect(traversal.ok).toBe(false);
  });
  it("Tauri uses registered learning commands with Unicode strings, not lossy atob", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const value = { format: "langhuan-saved-searches" as const, version: 1 as const, searches: [{ id: "s", name: "中文", query: "讲解", createdAt: 1 }] };
    invoke.mockResolvedValueOnce(JSON.stringify(value));
    expect(await fetchLearningFile(P.searches)).toEqual(value); expect(invoke).toHaveBeenLastCalledWith("library_read_learning", { path: P.searches });
    invoke.mockResolvedValueOnce(undefined); await putLearningFile(P.searches, value);
    expect(invoke).toHaveBeenLastCalledWith("library_write_learning", { path: P.searches, content: JSON.stringify(value, null, 2) + "\n" });
  });
  it("native missing is null; native read/write failures are never silently empty", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValueOnce(null); expect(await fetchLearningFile(P.quiz)).toBeNull();
    invoke.mockRejectedValueOnce(new Error("permission denied")); await expect(fetchQuizStore()).rejects.toThrow("permission denied");
    invoke.mockRejectedValueOnce(new Error("native disk full")); await expect(putQuizStore({ format: "langhuan-quiz", version: 1, updatedAt: 1, docs: [] })).rejects.toThrow("native disk full");
  });
});
