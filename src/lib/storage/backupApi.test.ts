/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchBackupSnapshot,
  stageLibraryBackup,
  applyLibraryBackup,
} from "./backupApi";
import { isTauriRuntime } from "./contentApi";
import { invoke } from "@tauri-apps/api/core";
vi.mock("./contentApi", () => ({ isTauriRuntime: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
});
describe("backup platform facade", () => {
  it("uses existing Next transport and preserves stage fingerprint / apply errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ files: [], fingerprint: "f", root: "root" }),
      });
    vi.stubGlobal("fetch", fetch);
    expect((await fetchBackupSnapshot()).fingerprint).toBe("f");
    await stageLibraryBackup({ files: [] }, "replace", "f");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      action: "stage",
      tree: { files: [] },
      mode: "replace",
      expectedFingerprint: "f",
    });
    fetch.mockResolvedValueOnce({ ok: false, text: async () => "disk full" });
    await expect(applyLibraryBackup("id")).rejects.toThrow("disk full");
  });
  it("uses the same typed request through the native command without browser fetch", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue({ id: "id" });
    await stageLibraryBackup({ files: [] }, "merge", "hash");
    expect(invoke).toHaveBeenCalledWith("library_backup", {
      request: {
        action: "stage",
        tree: { files: [] },
        mode: "merge",
        expectedFingerprint: "hash",
      },
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("native failure"));
    await expect(applyLibraryBackup("id")).rejects.toThrow("native failure");
  });
});
