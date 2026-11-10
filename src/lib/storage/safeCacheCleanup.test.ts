import { describe, expect, it } from "vitest";
import { ASSET_BLOB_PREFIX, ASSET_META_KEY } from "../assets/store";
import { IDE_SANDBOX_KEY_PREFIX } from "../ide/sandboxFs";
import { STORE_KEY, VERSIONS_KEY_PREFIX } from "./constants";
import {
  BACKUP_ROLLBACK_KEY_PREFIX,
  classifyStorageKey,
  planSafeCacheCleanup,
  runSafeCacheCleanup,
} from "./safeCacheCleanup";

function memoryIO(init?: {
  urls?: number;
  assets?: number;
  local?: Record<string, string>;
  deleteRequestedKeys?: string[];
}) {
  let urls = init?.urls ?? 0;
  let assets = init?.assets ?? 0;
  const local = { ...(init?.local ?? {}) };
  return {
    objectUrlCount: () => urls,
    revokeObjectUrls: () => {
      const n = urls;
      urls = 0;
      return n;
    },
    projectAssetCacheCount: () => assets,
    clearProjectAssetCache: () => {
      assets = 0;
    },
    listLocalKeys: () => Object.keys(local),
    removeLocalKey: (key: string) => {
      delete local[key];
    },
    deleteRequestedKeys: init?.deleteRequestedKeys,
    local,
    remainingUrls: () => urls,
    remainingAssets: () => assets,
  };
}

describe("safe cache cleanup", () => {
  it("classifies unique library, sandbox, attachment, version and rollback keys as protected", () => {
    expect(classifyStorageKey(`${IDE_SANDBOX_KEY_PREFIX}sandbox:demo`)).toBe("protected");
    expect(classifyStorageKey(`${ASSET_BLOB_PREFIX}image`)).toBe("protected");
    expect(classifyStorageKey(ASSET_META_KEY)).toBe("protected");
    expect(classifyStorageKey(`${VERSIONS_KEY_PREFIX}d1`)).toBe("protected");
    expect(classifyStorageKey(`${BACKUP_ROLLBACK_KEY_PREFIX}gen-1`)).toBe("protected");
    expect(classifyStorageKey(STORE_KEY)).toBe("protected");
    expect(classifyStorageKey("langhuan-release-notes:android:1:1")).toBe("disposable");
    expect(classifyStorageKey("lh.mdScroll")).toBe("protected");
    expect(classifyStorageKey("some-unknown-cache")).toBe("leave");
  });

  it("plans to clear only disposable caches and lists unique copies as kept", async () => {
    const io = memoryIO({
      urls: 2,
      assets: 3,
      local: {
        "langhuan-release-notes:web:1": "notes",
        [STORE_KEY]: "stay",
        [`${IDE_SANDBOX_KEY_PREFIX}sandbox:demo`]: "project",
      },
    });
    const plan = await planSafeCacheCleanup(io);
    const byKind = Object.fromEntries(plan.willDelete.map((i) => [i.kind, i]));
    expect(byKind["asset-object-urls"]?.count).toBe(2);
    expect(byKind["project-asset-memory-cache"]?.count).toBe(3);
    expect(byKind["release-notes-download-cache"]?.keys).toEqual([
      "langhuan-release-notes:web:1",
    ]);
    expect(plan.willKeep.some((k) => k.label.includes("读码沙箱"))).toBe(true);
    expect(plan.willKeep.some((k) => k.label.includes("附件"))).toBe(true);
    expect(plan.willKeep.some((k) => k.label.includes("content/"))).toBe(true);
  });

  it("refuses to run without confirmation and leaves every key in place", async () => {
    const io = memoryIO({
      urls: 1,
      local: { "langhuan-release-notes:web:1": "notes", [STORE_KEY]: "stay" },
    });
    await expect(runSafeCacheCleanup({ confirmed: false }, io)).rejects.toThrow(/确认/);
    expect(io.remainingUrls()).toBe(1);
    expect(io.local[STORE_KEY]).toBe("stay");
    expect(io.local["langhuan-release-notes:web:1"]).toBe("notes");
  });

  it("after confirmation removes only disposable caches and refuses unique keys", async () => {
    const io = memoryIO({
      urls: 4,
      assets: 5,
      local: {
        "langhuan-release-notes:web:1": "notes",
        [STORE_KEY]: "stay",
        [`${IDE_SANDBOX_KEY_PREFIX}sandbox:demo`]: "project",
        [`${ASSET_BLOB_PREFIX}image`]: "blob",
        [`${VERSIONS_KEY_PREFIX}d1`]: "history",
        [`${BACKUP_ROLLBACK_KEY_PREFIX}gen-1`]: "rollback",
      },
      deleteRequestedKeys: [
        `${IDE_SANDBOX_KEY_PREFIX}sandbox:demo`,
        `${ASSET_BLOB_PREFIX}image`,
        "content/notes/a.md",
      ],
    });
    const result = await runSafeCacheCleanup({ confirmed: true }, io);
    expect(result.revokedObjectUrls).toBe(4);
    expect(io.remainingUrls()).toBe(0);
    expect(io.remainingAssets()).toBe(0);
    expect(result.removedReleaseNoteKeys).toEqual(["langhuan-release-notes:web:1"]);
    expect(io.local["langhuan-release-notes:web:1"]).toBeUndefined();
    expect(io.local[STORE_KEY]).toBe("stay");
    expect(io.local[`${IDE_SANDBOX_KEY_PREFIX}sandbox:demo`]).toBe("project");
    expect(io.local[`${ASSET_BLOB_PREFIX}image`]).toBe("blob");
    expect(io.local[`${VERSIONS_KEY_PREFIX}d1`]).toBe("history");
    expect(io.local[`${BACKUP_ROLLBACK_KEY_PREFIX}gen-1`]).toBe("rollback");
    expect(result.refused).toEqual([
      `${IDE_SANDBOX_KEY_PREFIX}sandbox:demo`,
      `${ASSET_BLOB_PREFIX}image`,
      "content/notes/a.md",
    ]);
  });
});
