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
      "decls": ["transform: translateY(-2px)", "box-shadow: ..."],
      "occurrence": 0
    }
  ]
}
```

- `startLine/endLine` 是**整条规则**（选择器行 → `}` 行），点进去高亮整段。
- `atRules` 记外层条件（外→内）：`["@media (max-width: 520px)"]`，
  `@supports`/`@layer` 同理。同一个选择器在 @media 内外各有一条，靠这个区分。
- `specificity` 是三元组 `[id, class/attr/伪类, 类型/伪元素]`，**逗号列表取整列最大** ——
  这是「这条规则静态上最多能有多强」，不是「这次命中算多强」（后者由 bridge 算，见下节）。
- `occurrence` 是同一文件里「选择器 + @ 条件签名」都相同的第几条（0 起，源码顺序）。
  同条件下重复写同一个选择器时，它就是唯一能把运行时命中对回源码那一行的东西。
  旧索引没有这个字段也能读：读入时按位置重算（`parseCssIndex` 不信任文件里那份）。
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
  → bridge 回传 { selector, cssText, file, conditions, active, specificity, order,
                  occurrence, matchedBranches? }
       file 来自内联时写的 data-lh-inline（写的是**库内路径** `项目示例/css/style.css`），
       所以「哪条规则来自哪个文件」是确定的，点进去也能直接按这个路径取文件；
       occurrence 是「同条件同选择器的第几条」，matchedBranches 是逗号列表里真正命中的那几支
  → 父窗口 resolveCssHits：按 (file, 选择器, @ 条件, occurrence) 回索引查行号
  → 右侧面板列出（最多 10 条）→ 点一条 → 只读 CodeMirror 打开 .css，整条高亮 + 滚到规则处
```

排序：specificity 从高到低，相同 specificity 源码靠后的优先（后者覆盖前者）。
specificity 用的是**这次命中的**那份（见下节），不是索引里的整列最大值。

`active` 是「条件当前是否成立」：宽屏上看 `@media (max-width: 520px)` 里的 `.card` 时，
规则**照列**（这正是需求要的：告诉你有这么一条、条件是什么），但会多一个「当前不生效」的标签，
免得以为它现在就在起作用。判定用 `window.matchMedia`；拿不到时按成立处理。

**匹配不到**（运行时注入的样式、HTML 里 `<style>`、索引缺失）→ `precision: "fuzzy"`，
面板上标「推断」，hover 提示「规则来自动态注入或 HTML 内联样式」，不给行号。

## 同一选择器出现多次，与逗号选择器列表

这两件事是同一类错误的两个侧面：**拿一个粗略的 key 去索引里找唯一一条规则**。

### 同名规则：`occurrence`

`.card { }` 在同一文件、同一条件下完全可以写两遍（复制粘贴、构建产物合并、课程示例刻意对比）。
老实现用 `(file, 选择器, @ 条件)` 查索引，`find` 拿到的是**第一条**，于是两条命中都跳到第 1 行 ——
看起来"没毛病"，实际是把人领到了错的那条规则上。

现在两端数同一把尺子：

- bridge 每遇到一条带 `selectorText` 的规则，就按 `normalizeSelector(selector) + "|" +
  atRulesSignature(conditions)` 记一个计数器，回传 `occurrence`。计数**按样式表重置**，所以同一个
  文件被内联两次时，两份都指向索引里同一条规则（这本来就是同一条）。
- 索引侧按源码顺序给每条规则标同一个 `occurrence`；resolve 时把候选按条件签名筛一遍，
  取第 `occurrence` 条。
- **对不上号就不猜**：候选有多条但序号超出（样式表被运行时改过、索引过期），或者老 bridge
  根本没给序号 → `precision: "fuzzy"`、`startLine/endLine = 0`，面板只给文件名并写明
  「存在多条同名规则…无法唯一对应」。点进去打开文件停在第一行、不高亮 —— 比错跳到某一条强。
- 只有唯一候选时才允许"没有序号也标 exact"（老 bridge 的兼容路径）。
- 全程不看 `cssText`：文本可能被运行时改过，靠它猜行号等于造假。

### 逗号列表：按**命中的分支**算特异性

`A, B { }` 在层叠里等价于两条独立规则 `A { }` 与 `B { }`（Cascading 4 §6.1），各自参与特异性比较。
所以「这次命中的特异性」应该是**命中的那几支里最高的那个**：元素只命中 `#id, .card` 的 `.card`
分支时是 `(0,1,0)`，不是 `(1,0,0)`。老实现无条件取整列最大值，排序会把这条规则抬到 `.card.wide`
之类的规则前面，误导学习者。

- bridge 用 `cssSplitList(selectorText)` 拆支，逐支 `el.matches(branch)`，命中支里取最大特异性；
  只命中一部分时把 `matchedBranches` 一起回传。
- 面板仍展示**完整选择器**，另加一个 `命中 .card` 的小徽标说明这次真正起作用的是哪一支
  （整列都命中时不标 —— 没什么可说明的）。
- `:is()`/`:not()`/`:has()` 的**参数**按规范取全部参数的最大值，不看是否命中，所以
  `:is(#hero, .card)` 即使命中的是 `.card` 支仍算 `(1,0,0)`；`:where()` 恒 0。
  这条区别写进了 `specificityOf` 的注释、`cssLocate.ts` 的说明与两组测试里。
- 拿不到命中分支时（老 bridge / 只有选择器文本）退回整列最大值兜底，行为与从前一致。

## 两个实现细节

**specificity 算了两次，靠测试锁住一致性。** 需求要求 bridge 自己排序，所以 ES5 版在
`bridge.client.js` 里；父窗口为了显示与二次排序又算了 TS 版。两份算法必须一致，
`bridge.jsdom.test.ts` 里逐条比对（14 个选择器）防漂移。比对用的都是单支选择器，
所以「命中分支的最高值」与 `specificityOf` 相等；逗号列表按命中支算，见上节。
另外 bridge 还用同一套算法去比 `normalizeSelector` / `atRulesSignature`（`occurrence` 的 key），
这两把尺子也必须与 TS 侧一致 —— `src/lib/locate/cssBranch.test.ts` 的端到端用例守的就是它。

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
  ⑦两个文件的同名规则、⑧运行时注入/内联 `<style>` 标「推断」、⑨不弹面板、⑩切文件、
  ⑪同名规则两条各跳各行、⑫逗号列表只命中一支时按那一支算并标「命中 .card」）。
- 自动化验收：`src/lib/locate/cssDemo.test.ts` 把同一份示例走真实链路（内联 + 插桩 + jsdom 点击 +
  postcss 索引），逐个方块比对「几条、什么选择器、来自哪个文件、exact/fuzzy、行号指到哪」——
  示例和 README 的表谁过期了都会红。

### 本期（同名规则 + 逗号列表）新增的用例

| 场景 | 在哪 |
|------|------|
| 同一文件同条件两次 `.card`，两条命中分别落到两行 | `cssBranch.test.ts`、`cssDemo.test.ts`（⑪） |
| 同一选择器在 `@media` 内外各一条，各按各的条件定位 | `cssBranch.test.ts`、`cssLocate.test.ts`（`DUP`） |
| `#id, .card` 命中只含 `.card` 的元素 → `(0,1,0)` + `matchedBranches` | `cssBranch.test.ts`、`cssLocate.test.ts` |
| 多个逗号分支同时命中 → 取命中支里最高的 | 同上 |
| `:is()`/`:where()` 与逗号列表组合（参数仍取全部最大值 / 0） | `cssBranch.test.ts` |
| 无法唯一对应 → `fuzzy`、不给行号、文案含「无法唯一对应」 | `cssLocate.test.ts`、`cssBranch.test.ts`、`ElementInspector.test.tsx` |
| 真实 srcDoc → bridge 点击 → `resolveCssHits` 端到端 | `cssBranch.test.ts` |
| 旧索引（JSON 里没有 `occurrence`）读入后仍能精确跳 | `cssLocate.test.ts` |
