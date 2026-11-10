/**
 * 预览阅读位置的跨会话记忆（Markdown 与 HTML 共用，按 path 隔离）。
 *
 * 存在 localStorage，与主题（`langhuan-theme`）同一层级：这是一份「本机偏好」，
 * 不是文档数据，所以不进 content/，也不进 zustand 的持久化子树——那里每次
 * 结构性改动都要同步 `store.behavior.test.ts` 的键快照，为一个滚动数字不值得。
 *
 * 键名：`lh.mdScroll`，值是 `{ [docPath]: Entry }`。HTML 也走同一份 map，
 * 不另开键，这样改名 / 删除已经接在 docs/trash 上的迁移对两种文档都生效。
 * 用 path 而不是 id：路径变了就不会错跳到旧坐标。应用内改名 / 移动由
 * {@link renameScrollMemory} 把记录迁到新 path，删除由
 * {@link forgetScrollMemory} 清掉，所以孤儿条目只剩「应用外改了文件名」这一种。
 */
export const MD_SCROLL_STORAGE_KEY = "lh.mdScroll";

/** 最多记住多少篇；超出按 savedAt 丢最旧的。 */
export const MD_SCROLL_MAX_DOCS = 300;

export type ScrollMemoryEntry = {
  /** 上次的 scrollTop（px），作为 ratio 算不出时的兜底。 */
  top: number;
  /** scrollTop / (scrollHeight - clientHeight)，0–1；内容高度变化时按比例还原。 */
  ratio: number;
  savedAt: number;
};

type ScrollMemoryMap = Record<string, ScrollMemoryEntry>;

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Safari 隐私模式等会直接抛
    return null;
  }
}

function isEntry(v: unknown): v is ScrollMemoryEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.top === "number" &&
    Number.isFinite(e.top) &&
    typeof e.ratio === "number" &&
    Number.isFinite(e.ratio) &&
    typeof e.savedAt === "number"
  );
}

function readMap(): ScrollMemoryMap {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(MD_SCROLL_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ScrollMemoryMap = {};
    for (const [path, entry] of Object.entries(parsed as Record<string, unknown>)) {
      // 坏数据静默丢弃，不留半条记录。
      if (!path || !isEntry(entry)) continue;
      out[path] = {
        top: Math.max(0, entry.top),
        ratio: Math.min(1, Math.max(0, entry.ratio)),
        savedAt: entry.savedAt,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: ScrollMemoryMap): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(MD_SCROLL_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 配额满 / 隐私模式：阅读位置丢了不影响阅读，静默放弃。
  }
}

/** 读某篇的阅读位置；没有或数据坏了都返回 null。 */
export function readScrollMemory(path: string): ScrollMemoryEntry | null {
  if (!path) return null;
  const entry = readMap()[path];
  return entry ?? null;
}

/**
 * 记下某篇的阅读位置。`max <= 0`（内容比视口短、或面板正被隐藏）时不写，
 * 避免用 0 覆盖掉真实进度。
 */
export function writeScrollMemory(
  path: string,
  scrollTop: number,
  max: number
): void {
  if (!path) return;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(max) || max <= 0) return;
  const ratio = Math.min(1, Math.max(0, scrollTop / max));
  const map = readMap();
  map[path] = {
    top: Math.max(0, Math.round(scrollTop)),
    ratio,
    savedAt: Date.now(),
  };
  const paths = Object.keys(map);
  if (paths.length > MD_SCROLL_MAX_DOCS) {
    paths
      .sort((a, b) => (map[a]!.savedAt ?? 0) - (map[b]!.savedAt ?? 0))
      .slice(0, paths.length - MD_SCROLL_MAX_DOCS)
      .forEach((p) => delete map[p]);
  }
  writeMap(map);
}

/** 清掉某篇。删除、或路径被应用外改掉时调用。 */
export function forgetScrollMemory(path: string): void {
  if (!path) return;
  const map = readMap();
  if (!(path in map)) return;
  delete map[path];
  writeMap(map);
}

/**
 * 批量忘掉（删文件夹：一次读一次写，别每篇都 parse 整个 map）。
 * 返回真正删掉的条数，便于调用方判断要不要写。
 */
export function forgetScrollMemoryMany(paths: Iterable<string>): number {
  const map = readMap();
  let removed = 0;
  for (const p of paths) {
    if (!p || !(p in map)) continue;
    delete map[p];
    removed += 1;
  }
  if (removed) writeMap(map);
  return removed;
}

/**
 * 改名 / 移动后把阅读位置搬到新 path，保留 `top`/`ratio`/`savedAt`。
 *
 * 旧 path 没有记录时什么都不做。新 path 已有记录则保留新的那份——它属于
 * 当前占着这个名字的文件，不能被一个路过用户的旧位置覆盖。
 */
export function renameScrollMemory(oldPath: string, newPath: string): void {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const map = readMap();
  const entry = map[oldPath];
  if (!entry) return;
  delete map[oldPath];
  if (!(newPath in map)) map[newPath] = entry;
  writeMap(map);
}

/** 批量迁移（文件夹改名 / 移动）。键是 `[oldPath, newPath]`。 */
export function renameScrollMemoryMany(
  pairs: Iterable<readonly [string, string]>
): void {
  const map = readMap();
  let touched = false;
  for (const [from, to] of pairs) {
    if (!from || !to || from === to) continue;
    const entry = map[from];
    if (!entry) continue;
    delete map[from];
    if (!(to in map)) map[to] = entry;
    touched = true;
  }
  if (touched) writeMap(map);
}


/**
 * 记下 0–100 的阅读百分比。HTML 预览在无 same-origin 时只能拿到百分比，
 * 按 `max = 100` 写入，ratio 仍是 0–1。
 */
export function writeScrollMemoryPercent(path: string, percent: number): void {
  if (!Number.isFinite(percent)) return;
  writeScrollMemory(path, percent, 100);
}

/** 读出 0–100 的百分比；没有记录或数据坏了返回 null。 */
export function readScrollMemoryPercent(path: string): number | null {
  const entry = readScrollMemory(path);
  if (!entry || !Number.isFinite(entry.ratio)) return null;
  return Math.min(100, Math.max(0, entry.ratio * 100));
}

/**
 * 目标 scrollTop：优先按比例（正文高度会随图片/公式变化），并夹在当前可滚范围内。
 * 返回 null 表示当前不可滚，调用方应当放弃这次恢复。
 */
export function scrollTargetFor(
  entry: ScrollMemoryEntry,
  scrollHeight: number,
  clientHeight: number
): number | null {
  const max = scrollHeight - clientHeight;
  if (!Number.isFinite(max) || max <= 0) return null;
  const byRatio = entry.ratio * max;
  // ratio 是主依据；top 只在 ratio 恰好缺失时才用（isEntry 已保证存在，这里留作语义）。
  const target = Number.isFinite(byRatio) ? byRatio : entry.top;
  return Math.min(max, Math.max(0, target));
}
