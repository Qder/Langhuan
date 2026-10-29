/**
 * Frozen recall sets from the pre-index implementation (search.ts substring scorer).
 * After the index/ranking refactor, every listed id MUST still appear (old ⊆ new).
 */
export const BASELINE_RECALL: Record<string, string[]> = {
  "": [],
  "   ": [],
  双链: ["cn-title", "html-page"],
  双链笔记: ["cn-title", "html-page"],
  "binary search": ["body-only-hit", "en-body"],
  "Binary Search": ["body-only-hit", "en-body"],
  useState: ["mixed"],
  hello: ["code-fence"],
  验收: ["html-page", "cn-title"],
  "tag:验收": ["cn-title", "html-page"],
  "tag:验收 双链": ["cn-title", "html-page"],
  "path:页面/": ["html-page"],
  "type:html": ["html-page"],
  "type:md binary": ["body-only-hit", "en-body"],
  UniqueNeedle: ["long-doc"],
  "🚀": [],
  相关性排序: ["path-deep"],
  "hidden-token": [],
  knowledge: [],
  Zettel: ["cn-title"],
  "!!!": [],
  "前端 React": ["mixed"],
  天气预报: ["fm-only-tags"],
};
