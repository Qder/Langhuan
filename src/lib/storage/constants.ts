/** Max snapshots kept per document. */
export const MAX_VERSIONS_PER_DOC = 20;

/** Soft-deleted docs retained this many days. */
export const TRASH_RETENTION_DAYS = 30;

/** Remind user to export if last backup older than this. */
export const BACKUP_REMIND_DAYS = 7;

/** Debounce for autosave (ms). */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** Soft warning when library payload exceeds this many bytes (~4MB). */
export const STORAGE_WARN_BYTES = 4 * 1024 * 1024;

/** Stronger warning near this size (~8MB of content). */
export const STORAGE_CRIT_BYTES = 8 * 1024 * 1024;

export const STORE_KEY = "langhuan-store";
export const VERSIONS_KEY_PREFIX = "langhuan-versions:";
export const MIGRATION_FLAG = "langhuan-idb-migrated";

/** IndexedDB key for persisted FileSystemDirectoryHandle. */
export const FS_HANDLE_KEY = "langhuan-fs-dir-handle";

/** Bound-folder meta directory (not imported as notes). */
export const FS_INDEX_DIR = ".langhuan";

export const FS_INDEX_FILE = "index.json";
