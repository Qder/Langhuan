/**
 * 索引新鲜度：手上的索引还对不对得上当前源码。
 *
 * 索引里本来就写了源码指纹（`buildCssIndex` / `buildJsIndex` 都写 `fnv1a:<长度>:<shortHash>`），
 * 但以前没人读它 —— 索引只在「缺失」时补建，源码改过之后照样按旧行号跳。
 * 这里把指纹真正用起来：拿当前源码再算一遍，一致就复用，不一致就重建。
 *
 * 为什么不必发请求：项目内 css/js 的当前内容已经在 `projectTexts` 里（预览内联用的同一份
 * 缓存），本地比一下就知道，不用为每次点击重读整个项目。拿不到文本（文件超限、桌面版、
 * 老快照）时判 "unknown" —— 宁可用现有索引，也不要在每次点击都盲目重建。
 */
import { findProjectForPath, projectRelPath, type ProjectMeta } from "../project";
import { hashCss } from "./cssLocate";
import { hashJs } from "./jsIndex";

export type IndexKind = "css" | "js";

/**
 * - `fresh`：指纹一致，可以直接复用；
 * - `stale`：没有索引 / 指纹不一致 / 老索引没写指纹 → 该重建；
 * - `unknown`：不知道当前源码，无法判断 → 先按现有索引用（总比每次点击都重建强）。
 */
export type FreshnessVerdict = "fresh" | "stale" | "unknown";

/** 判断新鲜度需要的全部外部信息：项目列表 + 预览用的源码缓存。 */
export type SourceSnapshot = {
  projects: ProjectMeta[];
  projectTexts: Record<string, Record<string, string>>;
};

/** 只看 hash 的最小形状（CSS / JS 索引都有）。 */
export type HashedIndex = { file: string; hash?: string };

/**
 * 库内路径 → 这个文件当前的源码。
 * 拿不到就返回 null：可能不是项目里的文件、超过内联上限、或者快照里没有它。
 */
export function projectTextFor(snapshot: SourceSnapshot, file: string): string | null {
  const project = findProjectForPath(file, snapshot.projects || []);
  if (!project) return null;
  const rel = projectRelPath(file, project.root);
  if (!rel) return null;
  const text = snapshot.projectTexts?.[project.root]?.[rel];
  return typeof text === "string" ? text : null;
}

/** 当前源码的指纹，与索引里的 `hash` 同一套算法。 */
export function sourceHash(kind: IndexKind, text: string): string {
  return kind === "css" ? hashCss(text) : hashJs(text);
}

/**
 * 算过的指纹记一下：`projectTexts` 里的字符串在两次快照刷新之间是同一个引用，
 * 所以 `===` 命中是 O(1)，省掉「每次点击把项目里所有 js 重新扫一遍」。
 */
const hashMemo = new Map<string, { text: string; hash: string }>();

export function currentSourceHash(kind: IndexKind, file: string, text: string): string {
  const key = `${kind}:${file}`;
  const hit = hashMemo.get(key);
  if (hit && hit.text === text) return hit.hash;
  const hash = sourceHash(kind, text);
  hashMemo.set(key, { text, hash });
  return hash;
}

/** 测试用：清掉指纹缓存。 */
export function clearIndexHashMemo(): void {
  hashMemo.clear();
}

/**
 * 这份索引还能用吗。
 *
 * `hash` 一律重算（不信索引里那份），源码指纹算法两侧相同 —— bridge 那边也是同一套。
 */
export function checkIndex(
  kind: IndexKind,
  index: HashedIndex | null | undefined,
  file: string,
  text: string | null
): FreshnessVerdict {
  if (!index) return "stale";
  const hash = typeof index.hash === "string" ? index.hash : "";
  // 老索引没写指纹：下次读到时重建一次，换来确定性
  if (!hash) return "stale";
  if (text == null) return "unknown";
  return hash === currentSourceHash(kind, file, text) ? "fresh" : "stale";
}

/**
 * 快照刷新（从 content/ 重新载入）之后调用：把明显对不上的索引剔掉。
 * 与读时校验是同一把尺子，只是把「第一次点击才发现过期」提前到了载入时。
 */
export function pruneStaleIndexes<T extends HashedIndex>(
  kind: IndexKind,
  indexes: T[],
  snapshot: SourceSnapshot
): T[] {
  return indexes.filter(
    (index) => checkIndex(kind, index, index.file, projectTextFor(snapshot, index.file)) !== "stale"
  );
}

export type SingleFlight = {
  /** 同一个 key 的在途任务只跑一次：并发调用复用同一个 Promise。 */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** 在途任务数（测试用）。 */
  size(): number;
};

/**
 * 单飞：连续点同一个元素会同时触发多次「补建索引」，不能每个点击各发一份请求。
 * 任务落地（成功或失败）后把 key 删掉 —— 失败不留缓存，下次点击还能重试。
 */
export function createSingleFlight(): SingleFlight {
  const inflight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) return existing as Promise<T>;
      const p = fn().then(
        (value) => {
          inflight.delete(key);
          return value;
        },
        (err: unknown) => {
          inflight.delete(key);
          throw err;
        }
      );
      inflight.set(key, p);
      return p;
    },
    size: () => inflight.size,
  };
}
