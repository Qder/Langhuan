# 导出的离线可读性（单篇 HTML / 整库静态站 zip）

> 主题：导出物要能在**没有琅嬛**的机器上打开——图片不是死链、callout 不是字面量、
> 双链不是 `[[方括号]]`。只补导出链路，不改预览、不改编辑、不碰主题体系。
> 对应实现：`src/lib/export/renderMarkdown.ts`（新）、`src/lib/export/standalone.ts`、
> `src/lib/export/staticSite.ts`、`src/components/ExportDialog.tsx`。
> 验收：`src/lib/export/renderMarkdown.test.ts`、`staticSite.test.ts`、`standalone.test.ts`。

## 改之前的三个洞（实测，不是推测）

旧实现里 `standalone.ts` / `staticSite.ts` 都是 `marked.parse(body)` 一把梭，
用真实库的 `Callout验收.md`、`基础sql语句.md` 跑一遍，产物是这样：

```
$ vitest → mdBodyToHtml(...)

<blockquote><p>[!note] 提示        ← callout 标记原样漏成正文
这是一条提示。</p></blockquote>
<p>正文里有 [[双链Peek]] 。</p>    ← 双链是字面量方括号
<p><img src="assets/seal.svg" alt="章"></p>   ← src 还在，但导出物里没有这个文件
```

（上面是摘出来的示意行，不是逐字 diff；关键是四个问题都在。）

| 洞 | 旧行为 | 后果 |
|----|--------|------|
| callout | `marked` 不认 `[!kind]`，整块退化成普通 blockquote | 卡片变纯文本，标记行留在正文里 |
| 双链 | 没有 pass，`[[x]]` 原样输出 | 读者看到编辑语法，点不了 |
| 图片 | 只保留原始相对路径，不落文件、不内联 | 单篇发出去必裂；zip 里也没有对应文件 |
| 代码高亮 | 导出没跑 `rehype-highlight` | 代码块是纯灰文本（`--syn-*` 全白搭） |

## 做法：把预览那条 rehype 链搬进导出

新文件 `renderMarkdown.ts`，一条 `unified` 流水线，**插件顺序刻意跟预览对齐**：

```ts
remarkParse → remarkGfm → remarkRehype(allowDangerousHtml)
  → rehypeRaw
  → rehypeSlug        // 先给标题 id，双链的 #标题 才落得到同一个锚点
  → rehypeCallout     // 直接复用预览的同一个插件，不写第二套 callout 逻辑
  → rehypeWikilinks   // 导出专有
  → rehypeExportMedia // 导出专有
  → rehypeExportLinks // 导出专有
  → rehypeHighlight   // 与预览同一套 hljs 类名
  → rehypeStringify
```

复用 `rehypeCallout` 是关键决定：callout 的 kind 表、标题回落、嵌套 post-order 都在
`src/lib/callout.ts` + `src/lib/rehypeCallout.ts` 里，导出再抄一份就是第二份真相。
测试直接断言导出产物里出现 `class="callout callout-note note"` —— 与预览同一串 class。

### 双链：能跳就跳，跳不了就明说

`[[目标#标题|别名]]` 的三种落法：

| 情况 | 产物 |
|------|------|
| 目标在本次导出范围内，且调用方给了 href | `<a class="export-wiki export-wiki-link" href="…">别名</a>` |
| 目标在库里，但不在这份导出里（单篇 HTML 的常态） | `<span class="export-wiki export-wiki-outside" title="目标不在本次导出范围内">` 虚线胶囊 |
| 库里没有这篇 | `<span class="export-wiki export-wiki-missing" title="库内没有这篇笔记">` 虚线胶囊 |

**不做死链**是这里的取舍：单篇 HTML 里写 `功能验收.html` 只会 404，不如保留文字并说清原因。
代码块（`code` / `pre` / `kbd` / `samp`）里的 `[[...]]` 一律跳过——
`Callout验收.md` 里就有一段专门演示「代码块里的不算 callout」，双链同理。

`![[嵌入]]` 目前**不展开**，输出原文 + tooltip「嵌入未展开」。嵌入语义（图？整页？段落？）
导出侧还没有共识，硬凑一种反而会误导读者。

### 图片：两种产物，两种落法

调用方注入 `resolveAsset(path) → string | null`，因为「内联」和「落盘」是两件事：

- **单篇独立 HTML**：读二进制 → `data:image/png;base64,…` 内联。发一个文件出去就能看。
  超过 20 MB 不内联（`ExportDialog` 里的 `INLINE_ASSET_LIMIT`），否则文件打不开。
- **整库 zip**：读二进制 → 写进 `<root>/assets/<短哈希>-<文件名>.<ext>`，页面里写
  相对路径。同一张图被多篇引用只落一份（`written` 表按库路径去重）。

`src` 的解析顺序先看「库内文档」再看 `resolveAsset`：预览也是这么做的
（`resolveLibraryPath.ts` 的 `resolveMediaSrc`），所以库内那个
`assets/seal.svg`（以 HTML 文档形式存着 SVG 文本）导出时会直接变成
`data:image/svg+xml`，不依赖资产表。

读不到就渲染占位块：

```html
<span class="export-missing-media" data-missing-src="笔记/assets/none.png">
  图片未找到：笔记/assets/none.png（章）
</span>
```

比留一个默默碎裂的 `<img>` 诚实——读者知道是缺文件，不是网络慢。

### zip 的路径：文件名保留中文，href 才编码

这是个一开始写错、被测试抓住的地方：

```ts
htmlOutPath(doc)   // → "笔记/数据库/基础sql语句.html"   ← zip 里的条目名
encodeHref(path)   // → "%E7%AC%94%E8%AE%B0/…"          ← 页面里的 href
```

zip 条目名用原文，解压出来就是能读的中文文件名；HTML 属性按 URL 规则百分号编码。
两者混用会导致 `zip.file("欢迎.html")` 取不到文件（文件名被编码了）。

相对链接是**按每篇页面的位置算**的，不是写死 `../assets/`：

```
langhuan-site/欢迎.html              → src="assets/xxx.svg"
langhuan-site/笔记/数据库/x.html      → src="../../../assets/xxx.svg"
```

`relativeHref(fromOut, toOut)` 逐段比共同前缀再补 `..`；写死一层在深层目录必然错。

## 文件级改动

| 文件 | 改动 |
|------|------|
| `src/lib/export/renderMarkdown.ts` | **新增**。unified 流水线 + 双链/媒体/普通链接三道改写 + `anchorId` |
| `src/lib/export/escape.ts` | **新增**。`escapeHtml` 从 `standalone.ts` 抽出来，两个模块共用，避免循环依赖 |
| `src/lib/export/standalone.ts` | `documentToStandaloneHtml` 改成 async；接 `{content, docs, readAsset}`；`EXPORT_CSS` 补 callout 卡片 / hljs 语义色 / 双链胶囊 / 占位块 / `@media print` 分页 |
| `src/lib/export/staticSite.ts` | `assets/` 落盘 + 去重；`relativeHref` / `encodeHref`；页面互链改导出路径 |
| `src/components/ExportDialog.tsx` | 走 `fetchProjectAsset`（浏览器 API / Tauri 双通）；选中多篇也走同一套静态站构建，图片共用 `assets/` 而不是各自内联 |

## 验收清单（逐条实测）

两个层面各跑一遍：

1. `npm run check`（typecheck + lint + 1493 项测试）
2. 真实库导出：24 篇文档 / 26 个媒体文件，导出产物落到 `.export-check/`，
   用 `python -m http.server` 起静态服务，在浏览器里打开核对（跑完即删，不进仓库）

- [x] **callout 变卡片**：`Callout验收.md` 导出后 10 个 `.callout` 节点，
      kind 依次 `note / tip / important / warning / caution / note / tip / note / warning / tip`；
      标题依次「自定义标题：说明 / 提示 / 重要的事 / 注意 / 小心 / 大写 kind 也认 / 折叠标记 /
      卡片里的富文本 / 嵌套 / 内层」（最后一个是嵌套 callout，在内层卡片里）。
      正文里 `[!note]` 只剩 4 处，全在 `<code>` / `hljs-quote` 里——那是笔记自己演示语法的示例。
- [x] **默认标题回落**：没有标题的 `> [!tip]` → 卡片标题「提示」。
- [x] **卡片有真实色相**：浏览器 `getComputedStyle` 读到 10 张卡片左边框分别是
      `rgb(168,122,44)`（note 金）/ `rgb(61,107,122)`（tip 青）/ `rgb(179,56,42)`（warn 朱砂），
      底色是对应色相 8% 混合。不是「class 有了但没样式」。
- [x] **双链可点（跨页）**：库里 24 篇只有 1 处双链，且指向不存在的页，
      所以另建两篇（`wiki演示/甲.md` → `wiki演示/深/乙.md`）单独验：
      `[[乙#第二节|乙的那一节]]` 导出成 `href="深/乙.html#第二节"`，
      浏览器点进去落在 `乙.html#第二节`，`document.getElementById("第二节")` 命中；
      乙页的 `[[甲]]` 回指 `../甲.html`（多层目录向上）。
- [x] **双链降级**：`[[不存在]]` → `span.export-wiki-missing`，
      `title="库内没有这篇笔记"`；真实库里那条 `[[双链Peek]]` 走的就是这条路径。
- [x] **单篇不做假链接**：单篇 `Callout验收.html` 里 `a.export-wiki` 数量 = 0，
      跨文件目标全部是 `export-wiki-outside` 胶囊。
- [x] **代码块双链不动**：```md 围栏里的 `[[乙]]` 在导出产物里原样保留。
- [x] **单篇图片内联**：`基础sql语句.md` 3 张图全部 `data:image/png;base64,…`，
      浏览器里 `naturalWidth` = 948 / 976 / 941（真的解码出来了），文件 641,330 字节；
      页面上外部资源引用（`http(s)://`）数量 = 0。
- [x] **zip 图片落盘**：26 个媒体文件里 15 个被正文引用，进 `langhuan-site/assets/`；
      `笔记/数据库/基础sql语句/基础sql语句.html` 的 3 张全写成
      `src="../../../assets/<hash>-image.png"`，浏览器里 `naturalWidth` 三个都 > 0；
      `数据库设计方案` 一篇吃掉 11 张，同样全部相对路径可达。
- [x] **重复图片只落一份**：单元测试里两篇引用同一张图，`assets/` 只有一条，`readAsset` 只调 1 次。
- [x] **索引页**：`langhuan-site/index.html` 列出 24 条，点「基础sql语句」跳到
      `%E7%AC%94%E8%AE%B0/.../基础sql语句.html`，页面真的打开了。
- [x] **读不到资源**：`离散数学_第5章_图的基本概念_笔记.md` 里 8 张 `figs/*.png` 库内没有，
      导出成 8 个 `span.export-missing-media`（`border-style: dashed`），
      文字是「图片未找到：笔记/离散数学/figs/fig5_1_undirected.png（无向图：…）」——
      把图注也带上了，读者知道缺的是哪张图、本来画的是什么。该页 `<img>` 数量 = 0。
- [x] **没给 `readAsset`**：单测断言不假装有图，同样走占位，`assets/` 为空。
- [x] **中文路径**：zip 条目名保留中文（`langhuan-site/Callout验收.html`），
      href 百分号编码（`%E7%AC%94%E8%AE%B0/...`），两者不混。
- [x] **深层相对路径**：`笔记/数据库/基础sql语句/x.html` 向外跳用 `../../../`，不是写死一层。
- [x] **代码高亮**：整库产物 2,513 个 `.hljs-*` 节点；`基础sql语句` 页 421 个，
      `.hljs-keyword` 计算色 `rgb(168, 67, 74)`，`pre` 底色 `rgb(239, 231, 214)`（浅纸）。
- [x] **带样式的独立分发**：`EXPORT_CSS` 含 `.prose .callout` / `.hljs-keyword` /
      `.export-missing-media` / `.export-wiki-missing`；两页产物里 `style` 标签存在，
      `body` 计算底色 `rgb(245, 239, 226)`，不依赖任何外部样式表。
- [x] **UI 真跑过**：在 `next dev` 里打开导出对话框，
      点「独立 HTML」→ toast「已导出独立 HTML：Callout验收.html（图片已内联）」；
      点「整库静态站点 zip」→ toast「已导出静态站点 langhuan-site-2026-11-05.zip（24 篇，含离线资源）」。

没有失败项。

## 回归（同一轮验证）

- [x] **备份入口仍在**：侧栏「备份与恢复」按钮在，底部还有「该备份藏书阁了 / 立即备份」提示条。
- [x] **读码壳能进**：点「读码」标签切到代码阅读壳，标题「读码」、最近工程 `qa-goto`、
      最近文件列表、讲解面板都在。
- [x] **随机开一篇 md 不崩**：开 `笔记/数据库/关系代数笔记.md`，预览正常渲染
      （标题 / 列表 / 表格 / 例题全在），无报错浮层。
- [x] **`npm run check`**：`tsc --noEmit` 0 error，`eslint` 0 error（81 条 warning 全是既有的
      `react-hooks/set-state-in-effect` 一类），`vitest` 128 文件 / 1493 通过 + 1 expected fail。

## 已知边界

- `![[嵌入]]` 不展开（原文 + tooltip「嵌入未展开」）。
- callout 卡片**不带图标**：预览的图标是 React 组件（`MarkdownReader` 里按 kind 选 SVG），
  导出是纯 HTML 字符串，塞内联 SVG 会让产物变肥。目前靠色相 + 标题区分。
- 单篇 HTML 里跨文件双链不可点（设计如此，不做假链接）。
- `assets/` 是平铺的；相同库路径的图只有一个条目，但不同目录同名图靠短哈希前缀区分。
  哈希是 FNV-1a 截 6 位，只用来命名，不做安全用途。
- 单篇内联有 20 MB 上限（`INLINE_ASSET_LIMIT`），超了走占位而不是把 HTML 撑到打不开。
- 导出是**浅纸单形态**，不跟应用里的九套主题联动。
- `marked` 仍留在依赖里给别处用；导出这条链路已经完全不经过它。
