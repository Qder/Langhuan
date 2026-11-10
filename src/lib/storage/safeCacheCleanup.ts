/**
 * 只清理可再生成的缓存。唯一副本一律留下：content/ 笔记与回收站、
 * 附件二进制、读码沙箱、版本 / 专题 / 批注 / 练习、以及未读过的备份回滚。
 * 拿不准的键也不删。
 */
import { ASSET_BLOB_PREFIX, ASSET_META_KEY } from "../assets/store";
import { IDE_SANDBOX_KEY_PREFIX } from "../ide/sandboxFs";
import { MD_SCROLL_STORAGE_KEY } from "../scrollMemory";
import { THEME_STORAGE_KEY } from "../theme";
import { STORE_KEY, VERSIONS_KEY_PREFIX } from "./constants";

export const BACKUP_ROLLBACK_KEY_PREFIX = "langhuan-backup-local-rollback:";
export const RELEASE_NOTES_CACHE_PREFIX = "langhuan-release-notes:";

export type SafeCleanupKind =
  | "asset-object-urls"
  | "project-asset-memory-cache"
  | "release-notes-download-cache";

export const SAFE_CLEANUP_KIND_LABELS: Record<SafeCleanupKind, string> = {
  "asset-object-urls": "附件预览用的临时地址（可重新生成）",
  "project-asset-memory-cache": "项目资源的内存预览缓存（可重新生成）",
  "release-notes-download-cache": "已下载的更新说明缓存（可再获取；内置说明仍在）",
};

export type StorageKeyClass = "disposable" | "protected" | "leave";

const PROTECTED_KEY_RULES: Array<{
  label: string;
  reason: string;
  test: (key: string) => boolean;
}> = [
  {
    label: "导入的读码沙箱",
    reason: "往往是导入工程的唯一副本",
    test: (key) => key.startsWith(IDE_SANDBOX_KEY_PREFIX),
  },
  {
    label: "附件二进制",
    reason: "可能是附件的唯一副本，不能当缓存删",
    test: (key) => key === ASSET_META_KEY || key.startsWith(ASSET_BLOB_PREFIX),
  },
  {
    label: "笔记库与偏好持久化",
    reason: "应用主存储，不是可再生缓存",
    test: (key) => key === STORE_KEY || key === THEME_STORAGE_KEY || key === MD_SCROLL_STORAGE_KEY,
  },
  {
    label: "版本历史",
    reason: "历史正文是唯一回滚路径",
    test: (key) => key.startsWith(VERSIONS_KEY_PREFIX),
  },
  {
    label: "备份回滚副本",
    reason: "可能是恢复原库的唯一路径",
    test: (key) =>
      key.startsWith(BACKUP_ROLLBACK_KEY_PREFIX) ||
      key.startsWith("langhuan-backup-"),
  },
];

export function classifyStorageKey(key: string): StorageKeyClass {
  if (key.startsWith(RELEASE_NOTES_CACHE_PREFIX)) return "disposable";
  if (PROTECTED_KEY_RULES.some((rule) => rule.test(key))) return "protected";
  return "leave";
}

export function isProtectedStorageKey(key: string): boolean {
  return classifyStorageKey(key) === "protected";
}

export type SafeCleanupPlanItem = {
  kind: SafeCleanupKind;
  label: string;
  count: number;
  keys?: string[];
};

export type SafeCleanupKept = { label: string; reason: string };

export type SafeCleanupPlan = {
  willDelete: SafeCleanupPlanItem[];
  willKeep: SafeCleanupKept[];
};

export type SafeCleanupResult = {
  confirmed: true;
  revokedObjectUrls: number;
  clearedProjectAssetEntries: number;
  removedReleaseNoteKeys: string[];
  refused: string[];
};

export type SafeCleanupIO = {
  objectUrlCount: () => number;
  revokeObjectUrls: () => number;
  projectAssetCacheCount: () => number;
  clearProjectAssetCache: () => void;
  listLocalKeys: () => string[];
  removeLocalKey: (key: string) => void;
  /** If a test (or a mistaken caller) asks to drop specific IDB/local keys. */
  deleteRequestedKeys?: string[];
};

function defaultLocalKeys(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

function defaultRemoveLocalKey(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function defaultIO(): Promise<SafeCleanupIO> {
  const { assetObjectUrlCacheSize, revokeAllAssetObjectUrls } = await import("../assets/store");
  const { clearProjectAssetCache, projectAssetCacheSize } = await import("../projectAssetCache");
  return {
    objectUrlCount: assetObjectUrlCacheSize,
    revokeObjectUrls: revokeAllAssetObjectUrls,
    projectAssetCacheCount: projectAssetCacheSize,
    clearProjectAssetCache: () => clearProjectAssetCache(),
    listLocalKeys: defaultLocalKeys,
    removeLocalKey: defaultRemoveLocalKey,
  };
}

export const SAFE_CLEANUP_KEEP_POLICY: SafeCleanupKept[] = PROTECTED_KEY_RULES.map((rule) => ({
  label: rule.label,
  reason: rule.reason,
})).concat([
  {
    label: "content/ 笔记、回收站与 .langhuan 学习文件",
    reason: "主库与批注/专题/练习/搜索/进度都是唯一数据，清理不会触碰磁盘库",
  },
  {
    label: "拿不准的其它键",
    reason: "无法判断是否可再生时一律保留",
  },
]);

async function resolvePlanIO(
  io?: Partial<SafeCleanupIO>
): Promise<Pick<SafeCleanupIO, "objectUrlCount" | "projectAssetCacheCount" | "listLocalKeys">> {
  if (io?.objectUrlCount && io.projectAssetCacheCount && io.listLocalKeys) {
    return io as Pick<SafeCleanupIO, "objectUrlCount" | "projectAssetCacheCount" | "listLocalKeys">;
  }
  return { ...(await defaultIO()), ...io };
}

async function resolveRunIO(io?: Partial<SafeCleanupIO>): Promise<SafeCleanupIO> {
  if (
    io?.objectUrlCount &&
    io.revokeObjectUrls &&
    io.projectAssetCacheCount &&
    io.clearProjectAssetCache &&
    io.listLocalKeys &&
    io.removeLocalKey
  ) {
    return io as SafeCleanupIO;
  }
  return { ...(await defaultIO()), ...io };
}

export async function planSafeCacheCleanup(io?: Partial<SafeCleanupIO>): Promise<SafeCleanupPlan> {
  const resolved = await resolvePlanIO(io);
  const releaseKeys = resolved.listLocalKeys().filter((key) => classifyStorageKey(key) === "disposable");
  const willDelete: SafeCleanupPlanItem[] = [
    {
      kind: "asset-object-urls",
      label: SAFE_CLEANUP_KIND_LABELS["asset-object-urls"],
      count: resolved.objectUrlCount(),
    },
    {
      kind: "project-asset-memory-cache",
      label: SAFE_CLEANUP_KIND_LABELS["project-asset-memory-cache"],
      count: resolved.projectAssetCacheCount(),
    },
    {
      kind: "release-notes-download-cache",
      label: SAFE_CLEANUP_KIND_LABELS["release-notes-download-cache"],
      count: releaseKeys.length,
      keys: releaseKeys,
    },
  ];
  return { willDelete, willKeep: SAFE_CLEANUP_KEEP_POLICY };
}

export async function runSafeCacheCleanup(
  opts: { confirmed: boolean },
  io?: Partial<SafeCleanupIO>
): Promise<SafeCleanupResult> {
  if (!opts.confirmed) {
    throw new Error("需先确认后再清理缓存");
  }
  const base = await resolveRunIO(io);

  const refused: string[] = [];
  for (const key of base.deleteRequestedKeys ?? []) {
    if (classifyStorageKey(key) !== "disposable") {
      refused.push(key);
    }
  }

  const revokedObjectUrls = base.revokeObjectUrls();
  const clearedProjectAssetEntries = base.projectAssetCacheCount ? base.projectAssetCacheCount() : 0;
  base.clearProjectAssetCache();

  const removedReleaseNoteKeys: string[] = [];
  for (const key of base.listLocalKeys()) {
    if (classifyStorageKey(key) === "disposable") {
      base.removeLocalKey(key);
      removedReleaseNoteKeys.push(key);
    } else if ((base.deleteRequestedKeys ?? []).includes(key) && classifyStorageKey(key) !== "disposable") {
      /* already recorded in refused; never delete */
    }
  }
  // If requested keys are not in listLocalKeys (e.g. IDB sandbox), still refuse.
  return {
    confirmed: true,
    revokedObjectUrls,
    clearedProjectAssetEntries,
    removedReleaseNoteKeys,
    refused,
  };
}
