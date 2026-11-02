# Markdown 预览的纸面（`.prose-langhuan` 收口）

> 主题：把阅读态的 Markdown 预览从「网站排版」收成「藏书阁纸面」——代码块跟着纸走、
> 表格 / 插图 / 图表当插页、标题与列表收一收。**只改呈现**，点选编辑、HTML 沙箱、
> 分屏定位、测验一律不动。
> 对应实现：`src/app/globals.css`（`.prose-langhuan` 与 `--code-*` / `--syn-*` 派生 token）、
> `src/components/MarkdownReader.tsx`（`CodeBlock` / `p`→`figure` / `table` 外壳）、
> `src/components/MermaidBlock.tsx`、`src/components/editor/InlineCodeFenceEditor.tsx`、
> `src/lib/mermaidTheme.ts`、`src/lib/mdFigure.ts`、`src/lib/export/standalone.ts`。
> 验收：`src/lib/proseStyleContract.test.ts`（CSS 契约）、`src/lib/proseContrast.test.ts`
> （五套主题的对比度）、`src/lib/mermaidTheme.test.ts`、`src/lib/mdFigure.test.ts`、
> `src/lib/mdVisualSerializeImage.test.ts`（插图块往返）。

## 一条规矩：颜色只有主题给的十一个

`--bg --bg-elevated --fg --muted --accent --teal --gold --border --hover --card`。
新增样式一律用它们或它们的混色，不再出现 `#1a1814` / `#ece4d2`，也不再有 mac 红黄绿灯。

代码块需要「比纸略深一点的底」，于是派生了一组 token（写在各主题块里，随主题变）：

| token | 纸色主题（宣/竹/绛） | 深色主题（松烟/赛博） |
|------|------|------|
| `--code-bg` | `bg-elevated` 掺 6% 墨 | `bg` 掺 5–6% 墨（深底） |
| `--code-fg` | `--fg` | `--fg` |
| `--code-muted` | `--muted` | `--muted` |
| `--code-border` | 墨 12% | 墨 14%（赛博用青 22%） |
| `--code-gutter-bg/fg` | 代码底上再压一点 / `--muted` 62% | 同左 |

混色一律写满 100%（`94% + 6%`）。`color-mix()` 的百分比不足 100% 时会**带透明度**
（缺的部分当透明黑），代码块压在图上就会漏色——写满才是实底。

语法高亮是唯一的例外：八个色相（关键字 / 标题 / 常量 / 字符串 / 内置名 / 注释 /
名字 / 项目符号）没法从十一个 token 里推出来还彼此可分，只能一套主题一组十六进制，
**但只出现在主题块里**（浅色组 / 松烟 / 赛博各一份，紧挨着注释说明）。规则本身只写
`color: var(--syn-*)`。原来 `MarkdownReader` 引的 `highlight.js/styles/github-dark.css`
已删——那份深色主题在宣纸上就是一块黑砖。

## 代码块：一块纸，不是一台终端

- 外壳 `.lh-codeblock`：`--code-bg` 底 + `--code-border` 一像素 + 14px 圆角，`overflow: hidden`。
- 顶栏 `.lh-codeblock-chrome`：左边 mono 语言名，右边「复制」（`data-copied="1"` 时变
  `--syn-name` 绿）。交通灯删除，高度压到 `.4rem`，不再抢视线。
- 行号 `.lh-code-gutter`：`--code-gutter-bg/fg`，右侧一条 `--code-border` 竖线。
- **预览与编辑同一个壳**：`InlineCodeFenceEditor` 也用 `.lh-codeblock` + `.lh-codeblock-chrome`
  （只多一个 `lh-code-editing`），点进代码块不会「换一张皮」。
- 行内 `code` 一动没动。

## 插页：表格 / 插图 / 公式 / 图表都不许撑破 740px

| 元素 | 做法 |
|------|------|
| 表格 | `MarkdownReader` 把 `<table>` 包进 `.lh-md-table-wrap`（`overflow-x: auto` + `max-width: 100%` + 圆角边框）；`table` 本身 `min-width: max-content`，宽表在里面横向滚，页面不滚。表头 `--hover` 底 + 发丝线，**无斑马纹、无整行 hover** |
| 插图 | 段落里只有一张图且 `alt` 非空 → `<figure class="lh-md-figure">` + `<figcaption>`（`src/lib/mdFigure.ts` 判定）；`img` 限高 `min(70vh, 720px)`、`object-fit: contain`、`margin-inline: auto`；`alt` 为空**不生成**空图注 |
| 公式 | KaTeX 显示模式本来就横向滚，未改 |
| 图表 | Mermaid 不再写死深色主题：`themeVariables` 由 `src/lib/mermaidTheme.ts` 从 CSS 变量算（混色在 JS 里算成 `rgb()`，因为 mermaid 把颜色写进 SVG 属性，`color-mix()` 在那里不生效）；`darkMode` 跟 `data-theme` / `.dark` 走，主题切换时 MutationObserver 触发重画；SVG 容器 `overflow-x: auto` |

为什么要包一层：`<figure>` 放在 `<p>` 里浏览器会把 `<p>` 提前闭合（React 也会警告），
所以是**段落级判定**——让 `p` 组件在「整段就一张图」时自己变成 `figure`，
`data-src-*` 由 `withSrc` 一起带过去，点选编辑照旧锚在这个元素上。

## 顺带修掉的一个坑：点一下图，图没了

可视化编辑是**克隆锚点元素**做 contenteditable 的，提交时按 DOM 反序列化。
`serializeInlineNode` 原先没有 `img` 分支——于是图片段落（`classifyMdBlock` 判成
「段落」）一旦提交，图会被写没，只剩空行；`figure` 之后更会多出一行图注文字。

现在：`img` 用 `matchImageFromOriginal` 把源码里的 `![](…)` 原样搬回来（预览里的 `src`
可能已被改写成资源 URL，不能反着拼），`figcaption` 直接跳过（图注是 alt 的呈现，
不属于正文）。顺手把 `img` 加进 `serializeParagraph` 的「走 DOM」判定，
`![](a.png)`（空 alt）这种 `hasInlineSyntax` 认不出的也能保住。
`src/lib/mdVisualSerializeImage.test.ts` 钉住往返。

## 标题、列表、callout

- `h3` 的 `::before { content: "◆" }` 删除，h3 只靠字号与间距；`h2` 的 28px 短下划线保留；
  `h1` 略放大（1.95rem）。
- 列表：一层 `1.25em` 缩进、实心点；二层缩进 `1.45em`、5px **空心环**；三层 2px `--muted` 实心。
- 三种 callout（tip / note / warn）保持原样，仍是青 / 金 / 朱砂淡底。

## 导出（`src/lib/export/standalone.ts`）

导出的单文件 HTML 只有一种「浅纸」形态，所以只做最小同步：`--code-bg/fg/border` 换成
浅纸值（不再是深色砖）、`figcaption` / 图片限高 / 表格宽度跟上。**没有**把
`globals.css` 搬过去——那边要独立可分发，不能变成第二份真相。

## 验收怎么跑

```bash
npm run check   # 85 files / 984 passed + 1 expected fail / 62 warnings 0 errors
npm run build   # ✓ Compiled successfully
```

样式没法在 node 里算，所以分两层钉：

1. **契约测试**（`proseStyleContract.test.ts`）：读完 `globals.css` 断言「不许出现的东西」——
   深色砖配色、交通灯、`github-dark` 引用、`h3::before`、◆；以及「必须有」——
   `.lh-md-table-wrap` / `.lh-md-figure` / `.lh-mermaid-svg`、三组 `--code-*`、24 条 `--syn-*`。
2. **对比度测试**（`proseContrast.test.ts`）：把主题块按层叠顺序拼成每套主题的实际取值
   （含 `color-mix()` 解析、半透明前景压底色），算 WCAG：正文代码 ≥ 4.5、八个语法色 ≥ 3、
   行号 ≥ 2、代码底与纸面差 ≥ 3。改坏任意一套纸都会红。

外加一次真浏览器量（Tailwind CLI 编出 `globals.css`，无头 Chrome 量几何，热修时用）：

- 五套主题代码块：浅纸底对比 9.5–13.1，松烟/赛博 12.8–13.9；代码底不透明（alpha = 1）。
- 12 列 1849px 宽表：外层 `scrollWidth > clientWidth`（横向滚），`article` 仍 740，
  `body.scrollWidth` 不溢出。
- `h3::before` 计算值 `none`；`h2::before` 宽 28px；二层列表 5px 空心环；
  图注 `--muted` / 12.48px / 居中。
