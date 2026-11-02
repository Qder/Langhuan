# 项目预览的支持边界（兼容性检测与如实说明）

> 主题：项目 / 预览　状态：已实现（本期只做「检测 + 说明」，不做 ESM bundler）
> 前置：[STATUS-project-import.md](./STATUS-project-import.md)（整目录导入 + 样式脚本内联）、
> [STATUS-asset-inline.md](./STATUS-asset-inline.md)（图片 / 字体 → data URL）

## 1. 问题

预览的执行环境是一个 `srcDoc` 字符串，沙箱只有 `allow-scripts allow-popups allow-forms`
（**没有** `allow-same-origin`），也没有真实的 base URL。这带来几条硬边界：

- `type="module"` 里的相对 `import` 解析不了（`about:srcdoc` 不是可解析的基址）；
- 裸模块名（`vue`、`lodash`）要 import map / 打包器，浏览器原生不认；
- `import(变量)` 要运行起来才知道加载什么，静态分析无从下手；
- 内联脚本时 `defer` / `async` 会被去掉（`renderAttrs` 的 drop 列表），执行时机随之改变；
- 外站 CSS / JS 保留原标签、需要联网；
- 缺文件、资源超限、外站 / 环 `@import` → 预览里少东西。

这些失效都是**静默**的：页面只是「看起来没样式 / 点了没反应」。使用者第一反应是
「定位功能坏了」，而实际上源码、样式面板、行为面板都还是好的。本期的目标就是把这层边界
**提前、具体、按类**说清楚。

## 2. 支持边界一览

| 情况 | 预览里的实际行为 | 报告里的类型 | 影响标签 |
| --- | --- | --- | --- |
| 普通 HTML + 本地 CSS/JS/图片（无模块） | 完整运行 | —（不报） | — |
| `type="module"` 且无 import / 只有 `export` | 能跑（内联模块脚本仍在解析后执行） | —（不报） | — |
| `type="module"` + 相对 `import` / `export … from` | 整支模块加载失败 | `module-relative-import` | 可能不运行 |
| 裸模块名 `import "vue"` | 加载失败（需 import map / 打包） | `module-bare-import` | 可能不运行 |
| `import(变量)` / 模板拼路径 | 预览不会执行这类加载 | `dynamic-module-load` | 可能不运行 |
| 本地脚本带 `defer` / `async` | **属性被去掉**，原地同步执行 | `defer-async` | 执行时机可能改变 |
| 外链脚本带 `defer` / `async` | 标签保留，但与内联内容的相对顺序可能变 | `defer-async` | 执行时机可能改变 |
| http(s) / 协议相对的 CSS、JS、图片、字体 | 保留原标签，需要联网 | `network-dependency` | 需要联网 |
| 缺本地 CSS / 图片 / 字体 | 保留原引用，样式或内容缺一块 | `missing-resource` | 预览会失真 |
| 缺本地 JS | 不执行，行为面板也索引不到 | `missing-resource` | 无法定位 |
| CSS `@import`（本地文件存在） | 按被导入文件目录展平进预览 | —（不报） | — |
| CSS `@import`（本地缺文件） | 保留原句 | `missing-resource` | 预览会失真 |
| 单文件 > 1.5MB / 整页 > 12MB / 类型不认识 | 保留原引用 | `inline-degraded` | 预览会失真 |

`预览会失真` 是本期新增的第五个影响标签：像「少一张图」「`@import` 没生效」这种，
既不是「不运行」也不是「无法定位」，硬套原来的四个标签会说不准。

## 3. 实现

### 3.1 报告是纯函数，在生成预览时算

`src/lib/projectCompat.ts`

```ts
analyzeProjectCompat({
  html, htmlPath, baseDir,
  files,        // 已知存在的项目内相对路径（文本快照 ∪ 资源表 ∪ 导入清单）
  readText,     // css / js 正文
  mapPath,      // 项目内路径 → 库内路径（报告里显示用）
  oversized,    // 太大了、没内联的
  budgetDropped // 整页超上限、后来放弃的
}) → { issues: CompatIssue[], groups: CompatGroup[], total: number }
```

- **不存进 `project.json`**：报告在预览生成时按当前源码现算，改一行 HTML 提示立刻跟着变，
  也不用为它做 schema 迁移。`HtmlReader` 里 `useMemo` 兜住重复计算。
- **单项** `CompatIssue = { kind, file, line?, target, message, impact }`：
  类型、所在文件、能定就给的 1-based 行号、一句人话、当前影响。
- **分组** `CompatGroup`：按类型汇总，`impact` 取组里最严重的那条
  （可能不运行 > 无法定位 > 执行时机可能改变 > 需要联网 > 预览会失真）。
- **去重**：外站资源按 URL 全局去重（同一个 CDN 被两处引用只报一次）；
  其余按「类型 + 文件 + 目标」去重，保留先出现的那一行。

### 3.2 行号从哪来

- HTML 里的东西：`inventoryProjectRefs(html, { baseDir })`（`inlineProject.ts` 新增导出）
  复用现有的 `scanTags` / `parseAttrs` / `resolveProjectRef`，每个引用带回标签起始偏移 →
  `lineAtOffset` 得行号。它和内联流程共用同一套解析，所以「报的路径」和「真正去读的路径」
  不会出现两套口径。
- 内联 `<script>` / `<style>` 的正文：正文起点偏移 + 正文内偏移 → 再换算 HTML 行号。
- CSS 里的 `@import` / `url()`：`scanCssUrls` 新增 `importRefs: { raw, start }[]`
  （原来的 `imports: string[]` 保留，不动现有调用方），用载荷起点算行号。
- JS 里的 `import`：`jsModuleScan.ts` 的 token 起始偏移 → 行号。

### 3.3 为什么不用 acorn

`jsIndex.ts` 里的 acorn 是 `await import("acorn")` 的异步路径；兼容性报告要在渲染时同步算完，
而且上一期已经因为体积把 ~60KB 的 parser 从首屏拿掉了。这里只要判断三件事：
「是不是相对路径」「是不是裸名字」「实参是不是字面量」，一个跳过注释 / 字符串的 tokenizer
就够了（`src/lib/jsModuleScan.ts`，约 240 行）。

它明确**不做**的事：不解析 AST、不判断类型、不追 `export *` 的再导出；
正则字面量 `/…/` 里的关键字理论上可能被当成代码（要求 `import` + `from` + 字符串连着出现，
误报概率可忽略）。

### 3.4 措辞的三条硬规矩

1. **不说「属性已保留」**：本地脚本内联时 `defer` / `async` 是**被删掉**的，
   文案必须说「会被去掉（属性不再保留）」「变成原地同步执行」。外链脚本才说「原样保留」。
2. **不说「完全支持 / 已完整导入」**：只有「可能不运行」「预览可能不完整」这一档。
   `ProjectCompatNotice.test.tsx` 里有一条断言专门盯着这几个词。
3. **模块问题必须留后路**：`module-relative-import` 的文案固定包含
   「预览可能不完整，源码定位仍可使用」。

## 4. UI

`src/components/ProjectCompatNotice.tsx`，挂在 `HtmlReader` 预览列的**第一个**子元素：

- **没有问题就什么都不渲染**（简单项目不会被提示打扰）。
- 收起时只有一行：`预览可能不完整 · K 类 N 处` + 各类标题 + 「展开」。
- 展开后按类列：标题 + 影响标签 + 处数，再逐条 `文件:行 — 一句解释`，最多 `42vh` 滚动。
- **在流内**（`shrink-0`，无 `absolute` / `fixed` / `z-` / `role="dialog"`）：
  它只把预览往下推，不盖住页面内容，也不参与元素检视抽屉的开合与焦点管理。
- 底部一句话：这些是预览环境的限制，源文件一个字节没改。

本期**合并**了原来的两个提示面：

| 旧 | 新 |
| --- | --- |
| 预览顶栏「项目引用了 N 个外链资源，未内联」 | 并入 `network-dependency` 分组 |
| 预览左下角 `<details>`「有 N 处资源没能内联」 | 并入 `missing-resource` / `inline-degraded` 分组 |

`InlineResult.warnings`（字符串）仍然保留并继续被测试，只是 UI 改用结构化报告；
另外新增 `InlineResult.dropped`（整页超上限而放弃内联的资源），
让「为什么少了几张图」也能进报告而不是只存在于字符串里。

## 5. 验收

```bash
npm run check && npm run build
```

- `npm run check`：77 个测试文件、850 passed + 1 expected fail、lint 0 error（62 warning 为基线）。
- `npm run build`：通过。

新增测试：

| 文件 | 覆盖 |
| --- | --- |
| `src/lib/projectCompat.test.ts`（15） | 无问题普通项目 / module + 相对 import（含行号、含「源码定位仍可使用」）/ module 无 import 不报 / head 里 defer（断言「会被去掉」且不含「已保留」）/ async / 外链 defer / CDN + 本地缺失同时存在（分类、影响、组内取最严重）/ 去重 / 内联 module 脚本行号按 HTML 算 / 裸模块名与字面量·非字面量动态 import / 无 `type=module` 的 import / CSS `@import` + `url()` 三类归口 / 超限与整页超上限 / 未知类型 / 类型顺序与行号 |
| `src/lib/jsModuleScan.test.ts`（9） | 多行 import、`export … from`、注释与字符串里的假 import、`import.meta` 与 `obj.import()`、字面量 vs 运行时动态 import、函数体里的动态 import、模板 `${}`、空实参、转义引号 |
| `src/components/ProjectCompatNotice.test.tsx`（7，jsdom + `renderToStaticMarkup`） | 无问题不渲染 / 收起只有一行摘要 / 展开后类型·文件行号·解释·影响都读得到 / 多组分一条横条汇总 / 无 `absolute`·`fixed`·`z-`·`role="dialog"` 且 `shrink-0` / 不做过度承诺 / 真分析器的报告能直接渲染 |

手动验收现场：`examples/兼容性验收/`（`index.html` 里 5 类问题各一处，README 有逐条清单）。
反例：`examples/资源内联验收/` 打开时**不应**出现提示条。

版面量测（headless Chrome，把构建产物里的 Tailwind CSS 直接套在组件真实标记上）：
预览列宽 340px 与 240px 两种情况下，收起态横条高 26px、只有一行、无横向溢出
（`scrollWidth === clientWidth`）；展开态面板 177px，且被 `max-h-[42vh]` 兜住可滚动。
窄到这个程度时摘要文字让位、截断成省略号，「N 类 M 处」与「展开」始终可见。

## 6. 已知限制 / 下一期

- 相对 `import` 的目标文件**不递归分析**（只报第一层）；也不判断被 import 的模块是否真的存在。
- 不认 import map（`<script type="importmap">`），哪怕写了也照报「建议用 import map」——
  因为预览本身没有 base URL，import map 也救不了。
- 不抓 CDN 快照（本期明确不做），外站资源只提示需要联网。
- CSS `@import` 仍未展平；展平要按被导入文件自己的目录重解析 `url()`，留到下一期。
- `@import` 后面如果跟 `media` 查询或 `layer()`，报告只关心路径，不区分条件。
