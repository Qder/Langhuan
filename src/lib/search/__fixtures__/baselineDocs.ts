import type { Document } from "../../types";

function doc(
  partial: Partial<Document> & Pick<Document, "id" | "path" | "content">
): Document {
  return {
    type: "md",
    starred: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...partial,
  };
}

/** Stable corpus for search recall baselines (do not mutate in tests). */
export const BASELINE_DOCS: Document[] = [
  doc({
    id: "cn-title",
    path: "笔记/双链笔记.md",
    content: "---\ntags: [知识管理, 验收]\naliases: [Zettel]\n---\n\n正文里谈知识图谱与笔记方法。\n",
    updatedAt: 1_700_000_100_000,
  }),
  doc({
    id: "en-body",
    path: "notes/algorithms.md",
    content: "# Algorithms\n\nThis note covers binary search and dynamic programming.\n",
    updatedAt: 1_700_000_050_000,
  }),
  doc({
    id: "mixed",
    path: "学习/React hooks 指南.md",
    content:
      "---\ntags: [前端, React]\n---\n\n使用 useState 与 useEffect 管理状态。Also covers memo.\n",
  }),
  doc({
    id: "code-fence",
    path: "dev/snippets.md",
    content: "Example:\n\n```ts\nfunction hello() { return 'world'; }\n```\n\nCall hello after load.\n",
  }),
  doc({
    id: "html-page",
    path: "页面/验收清单.html",
    type: "html",
    content:
      '<!doctype html><html><head><meta name="keywords" content="验收, HTML" /><title>验收清单</title></head><body><h1>清单</h1><p>检查双链与搜索。</p><script>var secret="hidden-token"</script><style>.x{color:red}</style></body></html>',
  }),
  doc({
    id: "fm-only-tags",
    path: "meta/frontmatter.md",
    content: "---\ntags: [归档]\nstatus: archived\n---\n\n只有 front matter 标签，正文写的是完全不同的主题：天气预报。\n",
  }),
  doc({
    id: "long-doc",
    path: "长文/重复词.md",
    content:
      "---\ntags: [长文]\n---\n\n" +
      ("重复词 ".repeat(200) + "唯一点缀词 UniqueNeedle 在中间附近。\n" + "填充填充 ".repeat(200)),
  }),
  doc({
    id: "special-emoji",
    path: "杂项/emoji🎉.md",
    content: "标题外正文：火箭 🚀 与星星 ⭐ 以及 &amp; 实体。\n",
  }),
  doc({
    id: "path-deep",
    path: "项目/琅嬛/设计/搜索.md",
    content: "谈相关性排序与倒排索引。\n",
  }),
  doc({
    id: "body-only-hit",
    path: "其他/无关标题.md",
    content: "这里偶然出现 binary search 字样，标题完全不相关。\n",
  }),
];
