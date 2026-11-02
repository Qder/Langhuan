import { beforeEach, describe, expect, it, vi } from "vitest";

const writeTextDoc = vi.fn(
  async (input: { path: string; content: string; id: string }) => ({
    id: input.id,
    path: input.path.replace(/^\/+/, ""),
    type: "md" as const,
    content: input.content,
    starred: false,
    createdAt: 1,
    updatedAt: 1,
  })
);
const ensureContentTree = vi.fn(async () => undefined);
const ensureLibraryDir = vi.fn(async () => undefined);
const hardDeletePath = vi.fn(async () => true);
const readFileBytes = vi.fn(async () => null);
const softDeleteDoc = vi.fn(async () => null);
const writeCssIndex = vi.fn();
const writeJsIndex = vi.fn();
const writeQuizStore = vi.fn();
const writeRawBase64File = vi.fn();
const writeRawTextFile = vi.fn();

vi.mock("@/lib/storage/contentFs", () => ({
  ensureContentTree: (...a: unknown[]) => ensureContentTree(...(a as [])),
  ensureLibraryDir: (...a: unknown[]) => ensureLibraryDir(...(a as [])),
  hardDeletePath: (...a: unknown[]) => hardDeletePath(...(a as [])),
  readFileBytes: (...a: unknown[]) => readFileBytes(...(a as [])),
  softDeleteDoc: (...a: unknown[]) => softDeleteDoc(...(a as [])),
  writeCssIndex: (...a: unknown[]) => writeCssIndex(...(a as [])),
  writeJsIndex: (...a: unknown[]) => writeJsIndex(...(a as [])),
  writeQuizStore: (...a: unknown[]) => writeQuizStore(...(a as [])),
  writeRawBase64File: (...a: unknown[]) => writeRawBase64File(...(a as [])),
  writeRawTextFile: (...a: unknown[]) => writeRawTextFile(...(a as [])),
  writeTextDoc: (...a: unknown[]) => writeTextDoc(...(a as [Parameters<typeof writeTextDoc>[0]])),
  QUIZ_INDEX_FILE: "quiz.json",
}));

vi.mock("@/lib/locate/cssLocate", () => ({
  buildCssIndex: vi.fn(),
}));
vi.mock("@/lib/locate/jsIndex", () => ({
  buildJsIndex: vi.fn(),
}));

import { PUT } from "./route";
import type { NextRequest } from "next/server";

function putReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/library/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("PUT /api/library/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a legal document path", async () => {
    const res = await PUT(
      putReq({
        path: "notes/hello.md",
        content: "# hi\n",
        id: "doc1",
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; document: { path: string } };
    expect(json.ok).toBe(true);
    expect(writeTextDoc).toHaveBeenCalled();
    const arg = writeTextDoc.mock.calls[0]?.[0] as { path: string };
    expect(arg.path).toBe("notes/hello.md");
  });

  it("rejects .. traversal with 4xx and does not write", async () => {
    const res = await PUT(
      putReq({
        path: "../outside.md",
        content: "nope",
        id: "evil",
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/越界/);
    expect(writeTextDoc).not.toHaveBeenCalled();
    expect(writeRawTextFile).not.toHaveBeenCalled();
  });

  it("rejects nested traversal in raw writes", async () => {
    const res = await PUT(
      putReq({
        path: "proj/../../etc/passwd",
        content: "x",
        raw: true,
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(writeRawTextFile).not.toHaveBeenCalled();
    expect(writeTextDoc).not.toHaveBeenCalled();
  });

  it("returns 4xx when writeTextDoc fails", async () => {
    writeTextDoc.mockRejectedValueOnce(new Error("路径越界"));
    const res = await PUT(
      putReq({
        path: "ok.md",
        content: "x",
        id: "d",
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toMatch(/路径越界/);
  });
});
