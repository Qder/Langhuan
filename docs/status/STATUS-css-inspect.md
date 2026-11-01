# 样式定位（点元素 → 这条 CSS 从哪来）

> 主题：预览里点任意元素，右侧列出命中它的 CSS 规则，点规则跳到 `.css` 对应行并高亮整条。
> 对应实现：`src/lib/locate/cssLocate.ts`、`src/lib/locate/bridge.client.js`（`lh-css-query`）、
> `src/lib/store/slices/elementInspectSlice.ts`、`src/components/ElementInspector.tsx`（「样式」段）。
> 示例：`examples/项目示例/`（`div.card` 被 4 条规则命中）。
> 注：面板后来先扩成「样式 / 行为」两页，再合并成三合一抽屉（＋HTML 段），slice 与组件已定名
> `elementInspect` / `ElementInspector`；本文只讲样式那一段，行为见
> [STATUS-js-behavior.md](./STATUS-js-behavior.md)，三段合一的交互见
> [STATUS-element-inspector.md](./STATUS-element-inspector.md)。

## 为什么不能沿用文本搜索

现有的 HTML 定位是「拿元素的可见文本回源文件里搜」。CSS 里没有这些文本：`.card` 规则里
一个「卡片」字样都没有，搜索必然落空。CSS 只能换一个思路 —— **选择器匹配**：

- 谁匹配？只有浏览器知道（`element.matches(selectorText)`，含 `:hover`、`:nth-child`、
  伪元素边界等所有真实语义）。
- 匹配完的行号在哪？只有源码知道（postcss 解析出的 `source.start/end.line`）。

所以两半分开做：**浏览器判定命中 → 源码索引查行号**。

## 数据结构

索引落在库级目录，一个 css 一个文件（源文件不动）：

```
content/.langhuan/index/css/<hash>.json
{
  "file": "项目示例/css/style.css",
  "hash": "fnv1a:4096:0a1b2c3d",
  "rules": [
    {
      "selector": ".card:hover",
      "startLine": 110,
      "endLine": 114,
      "specificity": [0, 2, 0],
      "atRules": [],
      "decls": ["transform: translateY(-2px)", "box-shadow: ..."]
    }
  ]
}
```

- `startLine/endLine` 是**整条规则**（选择器行 → `}` 行），点进去高亮整段。
- `atRules` 记外层条件（外→内）：`["@media (max-width: 520px)"]`，
  `@supports`/`@layer` 同理。同一个选择器在 @media 内外各有一条，靠这个区分。
- `specificity` 是三元组 `[id, class/attr/伪类, 类型/伪元素]`；逗号列表取最大。
- `hash` 是源码指纹，留给将来做失效判定（现在每次导入直接覆盖）。
- 文件名是**路径的哈希**（`shortHash(file)`），所以同一路径重导入只会覆盖、不会堆积。

`@keyframes` 里的 `from/to` 不是选择器，不入索引。

## 链路

```
点元素
  → bridge: lastClickEl（捕获阶段记录，不受 locate 的门禁影响）
  → 父窗口 postMessage { type: "lh-css-query", nonce }
  → bridge: 遍历 document.styleSheets
       · rules[i].selectorText 存在 → el.matches(selectorText)（try/catch，非法选择器直接跳过）
       · 有 cssRules 的（@media/@supports/@layer）→ 递归，条件压栈
       · 跨源表读 cssRules 会抛 SecurityError → try/catch 跳过（内联后没这问题）
       · 元素本身没命中 → 向上找最多 4 层（点卡片里的标题，看到的是卡片的样式）；
         `html`/`body`/`:root`/`*` 这类哪都命中的规则不参与上溯，否则永远停在 body 的 margin 上
  → bridge 回传 { selector, cssText, file, conditions, active, specificity, order }
       file 来自内联时写的 data-lh-inline（写的是**库内路径** `项目示例/css/style.css`），
       所以「哪条规则来自哪个文件」是确定的，点进去也能直接按这个路径取文件
  → 父窗口 resolveCssHits：按 (file, 选择器, @ 条件) 回索引查行号
  → 右侧面板列出（最多 10 条）→ 点一条 → 只读 CodeMirror 打开 .css，整条高亮 + 滚到规则处
```

排序：specificity 从高到低，相同 specificity 源码靠后的优先（后者覆盖前者）。

`active` 是「条件当前是否成立」：宽屏上看 `@media (max-width: 520px)` 里的 `.card` 时，
规则**照列**（这正是需求要的：告诉你有这么一条、条件是什么），但会多一个「当前不生效」的标签，
免得以为它现在就在起作用。判定用 `window.matchMedia`；拿不到时按成立处理。

**匹配不到**（运行时注入的样式、HTML 里 `<style>`、索引缺失）→ `precision: "fuzzy"`，
面板上标「推断」，hover 提示「规则来自动态注入或 HTML 内联样式」，不给行号。

## 两个实现细节

**specificity 算了两次，靠测试锁住一致性。** 需求要求 bridge 自己排序，所以 ES5 版在
`bridge.client.js` 里；父窗口为了显示与二次排序又算了 TS 版。两份算法必须一致，
`bridge.jsdom.test.ts` 里逐条比对（14 个选择器）防漂移。

**行号只信 postcss 一次。** 索引由服务端 `PUT /api/library/file { cssIndex: true, file }`
生成（读完源码 → `postcss.parse(css, {from: file})` → `.langhuan/index/css/…`），
客户端只在导入时和「发现索引缺失」时触发。postcss 是动态 import，不进首屏包。

**`data-lh-inline` 必须写库内路径。** 内联发生在 `inlineProjectHtml` 里，它只知道
「项目内相对路径」（`css/style.css`），但索引键和文件 API 用的是库内路径
（`项目示例/css/style.css`）。所以 `HtmlReader` 传 `mapPath: (rel) => \`${project.root}/${rel}\``
把两者对齐 —— 少了这一步，命中能列出来，但每条都会退化成「推断」、且点进去 404。

## 已知限制

- 伪元素（`::before`）不参与 `matches()`，点击父元素不会列出 `::before` 规则 —— 浏览器本身
  就没有「伪元素的元素节点」。
- 内联样式（`style="..."`）不列，面板只讲样式表规则。
- `.css` 不是库文档（它是项目资源），所以高亮视图是只读的：改样式请改源文件后重新导入。
- 面板块是「最后一次点击」的语义。拖动框选不触发；点交互元素（`a`/`button`）**现在也会**弹面板
  （bridge 在捕获阶段先报 `lh-element`，父窗口再追问 `lh-css-query`）—— 定位源码那一步仍然跳过它们，
  因为按钮上的文字不是「这段文案来自源码哪里」的好线索。
- 桌面版（Tauri）不建索引（Rust 侧没有写库内文件的能力），面板会全部显示为「推断」。

## 验收

- `npm run check` 全绿。
- `src/lib/locate/cssLocate.test.ts`：选择器切分、specificity（含 `:is/:not/:where/:nth-child(of)`）、
  `@media`/`@supports` 嵌套与多行、CRLF 行号、keyframes 跳过、索引形状校验、
  `@media` 内外同选择器区分、fuzzy 退化，以及**用真实 demo 的 style.css 断言 4 条规则各自落在正确行**。
- `src/lib/locate/bridge.jsdom.test.ts`：点击后回传 4 条（`.card:hover`/`.card`/`@media` 内 `.card`/`body div`）、
  `data-lh-inline` 带出文件、`:focus` 与别的元素的 `:hover` 不误判、无点击返回空、未内联表 `file` 为空、
  bridge 与 TS 的 specificity 一致；以及**整条链路**——真实 demo 的 srcDoc（内联 + 插桩）在 jsdom 里点卡片，
  bridge 回传 → postcss 索引 → 4 条 `exact` 且每条的 `startLine` 指到真正的规则行。
- 手工验收：导入 `examples/样式定位验收` → 打开 `index.html` → 按 `README.md` 里的表逐条点
  （①卡片 4 条、②特异性顺序、③属性选择器、④`:is`/`:where`、⑤`:not`、⑥`@supports`套`@media`、
  ⑦两个文件的同名规则、⑧运行时注入/内联 `<style>` 标「推断」、⑨不弹面板、⑩切文件）。
- 自动化验收：`src/lib/locate/cssDemo.test.ts` 把同一份示例走真实链路（内联 + 插桩 + jsdom 点击 +
  postcss 索引），逐个方块比对「几条、什么选择器、来自哪个文件、exact/fuzzy、行号指到哪」——
  示例和 README 的表谁过期了都会红。
