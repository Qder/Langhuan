import type { ReadingPrefs } from "../readingPrefs";
import { normalizeReadingPrefs } from "../readingPrefs";

/**
 * zustand `persist` 的 merge 钩子默认只做浅合并：本地存档里的
 * `readingPrefs` 会整块盖掉当前默认值。
 *
 * 只要以后给 `readingPrefs` 加字段，老存档的 version 已经是最新的，
 * 就不会走 migrate —— 于是 state 里那几个字段是 undefined，
 * 预览的行高失效、弹层里也没有任何档位高亮。这里统一兜一次归一化。
 *
 * 泛型只要求带 readingPrefs，方便给整个 store 的 state 用。
 */
export function mergePersistedState<
  S extends { readingPrefs: ReadingPrefs },
>(persisted: unknown, current: S): S {
  const merged = {
    ...current,
    ...((persisted || {}) as Partial<S>),
  };
  merged.readingPrefs = normalizeReadingPrefs(merged.readingPrefs);
  return merged;
}
