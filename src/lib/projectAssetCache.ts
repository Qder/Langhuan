/**
 * 项目资源的取用与缓存（客户端）。
 *
 * 预览要在 srcDoc 里把图片 / 图标 / 字体换成 data URL，所以得先拿到字节。取用是异步的，
 * 而生成 srcDoc 是同步的 —— 两者用一个「当前这一页的资源表」衔接：
 *
 *   assetReaderFrom(map) 是同步查表，表里没有的路径返回 "pending"（不改写、不报警）
 *   取不到 / 超限 / 没有这个文件 → 表里记 missing / too-large，由 inlineProject 转成 warning
 *
 * 模块级 Map 按 `<root>/<rel>` 缓存，切换文档、来回点预览都不用重取；进程内一直有效。
 */

import { MAX_INLINE_ASSET_BYTES } from "./projectAssets";
import { fetchProjectAsset } from "./storage/contentApi";
import type { AssetReadResult, AssetReader } from "./inlineProject";

export type AssetEntry =
  | { kind: "ok"; mime: string; base64: string }
  | { kind: "missing" }
  | { kind: "too-large" };

/** 当前页的资源表：项目内相对路径 → 取用结果。 */
export type AssetMap = Record<string, AssetEntry>;

const cache = new Map<string, AssetEntry>();
/** 同一个资源同时被抓两次（打字中重算 + 上一个请求还没回）时只发一次。 */
const inflight = new Map<string, Promise<AssetEntry>>();
/** 缓存被清空的代数：清空时把还在飞的请求结果丢掉，别把旧字节写回去。 */
let generation = 0;

function cacheKey(root: string, rel: string): string {
  return `${root}/${rel}`;
}

/** 已经取过的资源（测试 / 调试用）。 */
export function peekAsset(root: string, rel: string): AssetEntry | undefined {
  return cache.get(cacheKey(root, rel));
}

/** 清掉缓存（测试用；也用于「重新导入项目」后避免拿到旧字节）。 */
export function projectAssetCacheSize(): number {
  return cache.size;
}

export function clearProjectAssetCache(root?: string): void {
  generation += 1;
  if (!root) {
    cache.clear();
    inflight.clear();
    return;
  }
  const prefix = `${root}/`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/** 取一个资源：命中缓存直接给；正在取就复用同一个请求；否则发一次请求。 */
function loadOne(root: string, rel: string): Promise<AssetEntry> {
  const key = cacheKey(root, rel);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const gen = generation;
  const task = (async (): Promise<AssetEntry> => {
    const got = await fetchProjectAsset(key, { maxBytes: MAX_INLINE_ASSET_BYTES });
    const entry: AssetEntry = !got
      ? { kind: "missing" }
      : got === "too-large"
        ? { kind: "too-large" }
        : { kind: "ok", mime: got.mime, base64: got.base64 };
    if (gen === generation) cache.set(key, entry);
    return entry;
  })().finally(() => {
    if (inflight.get(key) === task) inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

/**
 * 把一页需要的资源取齐（并发取，已在缓存里的跳过）。
 * 单个资源失败不影响其它；返回的表总是包含全部 rels。
 */
export async function loadProjectAssets(
  root: string,
  rels: string[],
  opts?: { fresh?: boolean }
): Promise<AssetMap> {
  if (opts?.fresh) clearProjectAssetCache(root);
  const out: AssetMap = {};
  const CONCURRENCY = 6;
  for (let i = 0; i < rels.length; i += CONCURRENCY) {
    const slice = rels.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (rel): Promise<[string, AssetEntry]> => [rel, await loadOne(root, rel)])
    );
    for (const [rel, entry] of results) out[rel] = entry;
  }
  return out;
}

/** 同步查表 → AssetReader（表里没有 = 还在取，返回 "pending"）。 */
export function assetReaderFrom(map: AssetMap): AssetReader {
  return (rel: string): AssetReadResult => {
    const hit = map[rel];
    if (!hit) return "pending";
    if (hit.kind === "missing") return "missing";
    if (hit.kind === "too-large") return "too-large";
    return { mime: hit.mime, base64: hit.base64 };
  };
}
