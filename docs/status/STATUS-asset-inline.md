# 项目资源内联（图片 / 图标 / 字体进 srcDoc）

> 主题：导入的静态站点在预览里「图全是破图」。原因是 iframe 是
> `allow-scripts allow-popups allow-forms` 的沙箱（**没有** `allow-same-origin`），
> 相对路径 `img/a.png` 没有可解析的 base，也读不到库内文件。所以预览前把项目内的资源
> 换成 `data:` URL 塞进 srcDoc —— 用户源文件一个字节都不改，只改生成的那份预览。
>
> 实现：`src/lib/projectAssets.ts`（MIME 表 / 限额 / srcset 与 CSS `url()` 扫描）、
> `src/lib/inlineProject.ts`（改写 HTML 属性与 CSS `url()`）、
> `src/lib/projectAssetCache.ts`（取字节 + 会话内缓存）、
> `src/lib/storage/contentApi.ts` 的 `fetchProjectAsset`（读库内二进制）、
> `src/components/HtmlReader.tsx`（先要清单、再取字节、最后生成 srcDoc；降级说明后来并入兼容性横条）。
> 试玩：`examples/资源内联验收/`。

## 本期范围

| 位置 | 处理 |
| --- | --- |
| `<img src>` | 项目内 → data URL |
| `<img srcset>` | **逐候选**处理，描述符（`1x` / `2x` / `640w`）原样保留 |
| `<source src>` / `<source srcset>` | 同上 |
| `<video poster>` | 项目内 → data URL |
| CSS `background` / `background-image` | 项目内 → data URL |
| CSS `@font-face` 的 `src` | 项目内 → data URL，MIME 用 `font/woff*` / `font/ttf` / `font/otf` |
| 其它合法 `url(...)` | 同样处理（不区分属性，凡是 CSS 里的 url() 都按同一规则） |
| 页面内联 `<style>` 里的 `url()` | 按文档目录解析（与浏览器一致） |

明确**不在**本期：JS 运行时拼出来的 URL、ESM `import`、Service Worker、`<link rel=icon>`。（`@import` 展平已做，见下。）

`http(s)` / `//` / `data:` / `blob:` / `#` 一律原样保留。MIME 至少覆盖
`png` `jpg/jpeg` `gif` `webp` `svg` `ico` `avif` `woff` `woff2` `ttf` `otf`（外加 `bmp`）。

## 路径怎么解析

**按「引用它的那个文件」所在目录**，不是按入口 HTML 的目录：

- `index.html` 里的 `img/a.png` → 项目根下 `img/a.png`
- `css/style.css` 里的 `url(../img/a.png)` → 项目根下 `img/a.png`（相对 `css/`）
- `pages/about.html` 里的 `../fonts/x.woff2` → 相对 `pages/`

同一套 `joinProjectPath` 负责：去掉 `?v=2#x`、`decodeURIComponent` 解百分号编码、
归一 `.` / `..` 并夹住越界。所以 `img/hero%20背景.png`、`img/封面 图.png` 都能命中磁盘上的
`img/hero 背景.png`。`<base href>` 的影响沿用之前的口径：相对 base 会整体搬移基准目录，
绝对 base 让所有相对引用变成外链（不内联）。

## CSS 为什么不用 postcss 改写

要求里说「优先复用 postcss」，这里给的是「用了但换了个位置」的方案，理由三条：

1. **字节保真**。预览里的样式是**原文件的文本**内联进 `<style>` 的，样式面板靠「行号」回索引
   （`content/.langhuan/index/css/`）。postcss 一旦改 `decl.value` 就按 `raws` 重新序列化整条声明，
   空白 / 换行 / 注释位置都有被动过的可能；行号一挪，样式段就会指错行。
   现在的实现只在 `url()` 的**载荷字符区间**上做替换，别处一个字节不动 —— 有测试卡住行数不变。
2. **体积与依赖**。`postcss` 目前是传递依赖（`node_modules/postcss` 8.5.31，服务端建索引时用），
   没有进 `package.json`；把它拉进客户端首屏为这一件事不值。
3. **同步契约**。`inlineProjectHtml` 是纯同步函数（srcDoc 在 `useMemo` 里生成）；postcss 解析要
   `await import()`，会把整条预览链路改成异步。

所以**运行时**用 `scanCssUrls`（自己写的状态机），**测试里**用 postcss 当标准答案交叉验证：
`src/lib/projectAssets.test.ts` 的「给 postcss 当标准答案交叉验证」把同一份 CSS 分别喂给两边，
断言 `url()` 集合完全一致、`@import` 参数一致。这样既享受了 postcss 的权威性，又不把它带进运行时。

扫描器的边界（都写了用例）：

- 跳过注释 `/* url(x) */` 与字符串 `content: "url(x)"`；
- 支持 `url(x)` / `url("x")` / `url('x')` / `URL( X )`，反斜杠转义不会提前结束；
- 解 CSS 转义（`a\ b.png`、`\31 0.png`）后再当路径解析；
- `@import` **不**改写，单独收进 warnings（见下）。

## 缺文件 / 超限：保留原引用 + 说清楚

`InlineResult` 新增 `assets` 与 `warnings`（`missing` 保持原义：样式表 / 脚本找不到）：

| 字段 | 含义 |
| --- | --- |
| `assets` | 这一页引用到的资源路径（去重，含没内联成功的），供调用方预取 |
| `warnings` | 给人看的一句话：`缺少资源：img/a.png（引用自 index.html），保留原引用` |

`warnings` 的来源：缺文件、单文件超限、本页总量超限、不认识的类型；外加 `@import` 找不到 / 外站 / 循环。
这些**不会**被静默吞掉：它们后来被 [STATUS-project-compat.md](./STATUS-project-compat.md) 的兼容性
报告结构化重述，在预览顶部的一条横条里按类汇总（点开是逐条 `文件:行` + 原因）。
`warnings` 字符串本身保留（测试仍覆盖），另有 `InlineResult.dropped` 专门给出「整页超上限后放弃内联」的资源。

限额口径（明确写出，不复用导入的 8MB）：

| 常量 | 值 | 理由 |
| --- | --- | --- |
| `MAX_PROJECT_FILE_BYTES`（导入，既有） | 8 MB | 落盘尺度，防一个 200MB 的 `dist/` 被拖进来 |
| `MAX_INLINE_ASSET_BYTES`（本期新增） | 1.5 MB | srcDoc 是内存里的字符串，data URL 再胖 1/3；超过就保留原引用 |
| `MAX_INLINE_TOTAL_BYTES`（本期新增） | 12 MB | 一页的资源预算，超过后**剩余**不再内联（已内联的不回滚），避免几十 MB 的 srcDoc 卡死预览 |

同一张图被引多次只取一次、只计一次体积（`ctx.done` 缓存）。

## 取字节的时机（为什么是异步 + 缓存）

srcDoc 在 `useMemo` 里同步生成，取字节是 `fetch`。两者的衔接：

```
HtmlReader
  ① inlineProjectHtml(html, { readFile })         ← 不传 readAsset：只解析、不改写，拿到 assets 清单
  ② loadProjectAssets(root, assets)               ← 并发取（6 路），命中会话缓存则跳过
  ③ inlineProjectHtml(html, { readFile, readAsset }) ← 查表命中 → data URL；还没到 → "pending"
```

`"pending"` 不是错误：不改写、不报警，等表齐了再重算一次 srcDoc。
模块级 `Map`（键 `<root>/<rel>`）在整个会话里有效，切换文档 / 来回点预览都不重取；
换项目时资源表按 `root` 隔离，避免两个项目同名文件串用。
代价是首次打开某个项目时会多一次 srcDoc 重载（图会「弹」出来一下），第二次打开就不会了。

## 边界与已知行为

1. **Chrome 的 srcset + data URL**：候选是 `data:` URL 时，Chrome **总是选密度最高的候选**
   （实测 DPR=1 下 `<img srcset="<data 1x>, <data 2x>">` 渲染的是 2x；换回普通 URL 就正常选 1x）。
   影响仅限「预览用了更高分辨率那张」，显示正确、内存略高。我们仍然逐候选内联、保留描述符
   （要求如此），这个选择行为不归我们管。
2. **`@import` 已展平**：扫描 `url()` 之前，按被导入文件自己的目录递归展开本地 `@import`，
   再改写其中的 `url()`。环 / 缺文件 / 外站 import **保留原句**并写入 warnings / 兼容性报告
  （缺文件文案含「找不到」；外站不抓 CDN）。注释与字符串里的 `@import` 不动。
   `data-lh-inline` 仍是单文件标识；「段 → 文件 + 起始行」的行号映射仍是后续升级。
   试玩：`examples/import展平验收/`。
3. **`<link rel=icon>` / `manifest` / `src` 在 `<script type=module>`**：不在本期，仍是原样。
4. **桌面版（Tauri）**：`fetchProjectAsset` 走 `library_read_file`（Rust 侧返回 base64），
   路径与 MIME 规则一致；Rust 侧尚未扫描项目，所以桌面版暂时没有项目预览这条路径。

## 验收

- 单测：`src/lib/projectAssets.test.ts`（19）、`src/lib/inlineProject.assets.test.ts`（27）、
  `src/lib/inlineProject.example.test.ts`（6）、`src/lib/projectAssetCache.test.ts`（10），合计 62，
  覆盖要求里的每一条：普通图 / 中文 / 空格 / `../` / 查询串 / 锚点、srcset 多候选、CSS 相对图与字体、
  `data:` 与外链不动、缺文件与超限降级、内联后 `data-lh` 锚点仍有效、CSS 行号与原文件来源仍正确；
  取字节那一层（404 / content-length 超限 / 实际体积超限 / 按项目隔离的缓存）也单测了，
  免得「不静默丢图」在 fetch 这一层被漏掉。
- 真示例：`examples/资源内联验收/`（真 PNG / SVG / WebP / JPEG / TTF），
  `inlineProject.example.test.ts` 把每个 data URL 解回字节与磁盘文件逐字节比对。
- **实际渲染核对**（不只看「生成了 data URL」）：用 headless Chrome 把同一页渲染两遍 ——
  一遍走 `file://` 的真项目（浏览器自己解相对路径），一遍走我们的 srcDoc（只有 data URL），
  逐像素比对：
  - DPR=2：**0 / 8,600,000 像素差异**（完全一致）；
  - DPR=1：差异 3613 / 2,150,000（0.168%），且差异区域正好是 `srcset` 那张 logo 的矩形
    —— 即上文第 1 条 Chrome 行为，不是资源没画出来。
  这项核对是手动跑的（仓库里没有浏览器依赖），命令与结论记在这里备查：
  `chrome --headless=new --screenshot=… --window-size=860,2500 file:///…`。
