# 行为定位（点元素 → 谁绑了事件 → 第几行）

> 主题：预览里点元素，面板「行为」页列出绑在它身上的监听（事件名 / 函数名 / `文件:行`），
> 点条目跳到源码并高亮整个函数体；静态分析，找不到就明说。
> 对应实现：`src/lib/locate/jsIndex.ts`、`src/lib/store/slices/elementInspectSlice.ts`、
> `src/components/ElementInspector.tsx`、`src/lib/locate/bridge.client.js`（`element`/`ancestors` 字段）。
> 示例：`examples/行为定位验收/`（`#btn` 的 `click` 落在 `js/app.js:12`）。
> 边界契约（给使用者看的）另见 [docs/行为定位.md](../行为定位.md)。

## 为什么不是「运行时定位」

运行时拿到的是 `HTMLElement.onclick` 或 DevTools 的 listeners，**没有行号**，也跨不过 iframe 边界
（预览是 `allow-scripts` 无 `allow-same-origin` 的沙箱，父窗口拿不到子窗口的 DOM 对象）。
要走运行时就得插桩改写用户代码，再配 sourcemap 才能回行号 —— 本期明确不做。

所以反过来做：**源码里静态建符号表，点击时反查**。浏览器只负责回答「点到了哪个元素、它的祖先是谁」，
「这个元素上有什么监听」由源码回答。

## 索引

`content/.langhuan/index/js/<shortHash(path)>.json`，源文件不动：

```json
{
  "file": "行为定位验收/js/app.js",
  "hash": "fnv1a:812:1a2b3c4d",
  "functions": [{ "name": "onSaveClick", "kind": "declaration", "startLine": 8, "endLine": 10 }],
  "queries": [{ "selector": "#btn", "api": "getElementById", "line": 12, "fn": null }],
  "bindings": [{
    "event": "click", "line": 12, "selector": "#btn", "owner": "document.getElementById(\"btn\")",
    "handlerName": "onSaveClick", "highlightStart": 8, "highlightEnd": 10,
    "fn": null, "delegated": false, "precision": "exact"
  }]
}
```

- `functions` / `queries` / `bindings` 三类符号，都是行号级（`startLine/endLine`）。
- `handlerName`：命名函数直接取名字；箭头/匿名函数给 `"(anonymous)"`，面板显示「匿名函数」。
- `highlightStart/End`：**要跳过去高亮的区间** —— 命名 handler 是它自己的声明区间（可能在上方几十行），
  否则退化成绑定的那一行。这就是「点 `app.js:12` 却高亮 8–10」的由来，也是需求里说的「函数级定位」。
- `delegated`：`document` / `window` / `document.body` 上的监听，单列「页面级监听」。
- 解析不了的文件只留 `parseError`（`export const = 1` 这种），面板会显示「`x.js` 解析失败：…」，
  不产生任何符号 —— 宁可说不知道，也不给错行号。

三个符号类别的识别范围：

| 类别 | 认什么 |
|------|--------|
| 函数 | 函数声明、`const f = function/arrow`、对象方法、class 方法（含 `async`/generator） |
| DOM 查询 | `querySelector` / `querySelectorAll` / `getElementById` / `getElementsByClassName`，只认字符串字面量 |
| 绑定 | `X.addEventListener("event", handler)`，`X` 能静态归一成简单选择器时才算「精确」 |

`X` 的归一规则：`document.getElementById("btn")` → `#btn`；`document.querySelector(".item")` → `.item`；
经 `const btn = ...` 中转的查变量表（两轮）；`document/window/body` → delegated。
`el`（函数参数）、`this.el`、`forEach` 回调参数 → **归属不到**，计入 `unresolved`，不猜。

## 链路

```
导入项目（或首次点击时补建）
  → PUT /api/library/file { jsIndex: true, file } → acorn 解析 → .langhuan/index/js/<hash>.json
  → 快照 /api/library 带 jsIndexes[]
点任意元素
  → bridge（捕获阶段记 lastClickEl，不受 locate 门禁影响）
  → postMessage lh-element { element, ancestors, range, text }
       每次点击都发：交互元素（button/a/input）不会发 lh-locate，但抽屉对它们同样有意义
       ancestors = 最多 6 层，html 不进链；range = data-lh 标注区间（抽屉 HTML 段的精确行号）
  → 父窗口回一条 lh-css-query { nonce }
  → bridge 回 lh-css-hits { hits, element, ancestors }
       element = 真正点到的元素（样式面板会往上找祖先，行为不能跟着走）
  → store.inspectElement
       · HTML 段：buildElementHtmlInfo（标注区间 / locate 结果 / 文本推断）
       · 样式段：legacy 逻辑，未改
       · 行为段：resolveBehaviorHits({...element, ancestors}, jsIndexes)
  → 抽屉三段一起列出 → 点一条 → 只读 CodeMirror 打开源码，高亮对应行区间（抽屉不关）
```

内联 `<script>` **不落索引文件**：每次点击用当前编辑内容现解析（`buildInlineScriptIndexes`），
用 parse5 的 `sourceCodeLocationInfo` 拿到脚本文本节点的起始偏移 → 换算出起始行 →
把 acorn 的相对行号整体平移，行号因此是**宿主 HTML 的绝对行**。好处是改完 HTML 立刻准，
代价是每次点击多一次 parse（文件级，微秒量级）。

## 匹配算法（简单选择器）

复用 `cssLocate.splitSelectorList` 切逗号，然后：

1. 每段取**末尾复合选择器**（最后一个组合器之后的部分），只认 `tag` / `#id` / `.class`。
2. 该复合选择器命中点击元素本身 → `match: "self"`；只命中祖先链某层 → `match: "ancestor"`。
3. 有组合器（空格 / `>` / `+` / `~`）或剥掉了伪类 → `precision: "fuzzy"`，面板标「推断」。
4. 属性选择器、`*` 等静态判不了的形状 → 不计命中，计入 `unresolved`。

父元素命中时给的提示是「绑定在父元素 `ul#todo-list` 上（可能是事件委托）」—— 需求要求的是
**定位到父元素就算达标**，再往下猜「哪个子元素触发」就得跑运行时了。

## 面板

> 第二期之后，行为不再是独立页签：预览里点元素弹出的是**三合一抽屉**（HTML / 样式 / 行为一次全给）。
> 抽屉的交互、键盘、pin、跳转细节见 [STATUS-element-inspector.md](./STATUS-element-inspector.md)。
> 下面这段描述的是行为段本身的数据与文案，仍然有效。

`ElementInspector` 的三个段共用一次点击结果：

- **HTML**：打开标签 + `index.html:42` + 精确/推断。有 `data-lh` 标注 → 精确；否则按文本近似 → 推断。
- **样式**（原样保留）：规则按 specificity 排，点条目跳到 `.css` 高亮整条。
- **行为**：`事件` 徽章 + `→ 函数名` + `文件:行` + 精确/父元素/页面级徽章 + 相关查询 + 无法静态归属计数。
  空态是写死的原话「未在源码中找到直接绑定，可能通过事件委托注册」。
- `key={nonce}` 让新一次点击重置折叠状态、选中态与源码子视图。
- 什么时候弹：有样式命中、有行为命中、或源码里**查过这个元素**（只有查询没有绑定 → 正好回答
  「找到了查询，但没找到绑定」）。三样都没有就不弹，点来点去不该冒空抽屉。

## 已知限制

- 运行时动态注册的监听（`setTimeout` 里再绑、框架挂载后绑）定位不到。
- 绑定对象是变量 / 参数 / `this` 时归属不明，只计入 `unresolved`。
- 不解析 TS/JSX（`.js` 里写 JSX 会 parseError）；ESM 失败会退化成 script 解析再试一次。
- 索引按源码指纹取（`src/lib/locate/indexFreshness.ts`）：`hash` 与 `projectTexts` 里的当前源码
  一致就复用，不一致就重建，然后按新行号跳 —— 改了 `.js` 不必再手动删索引目录。拿不到当前源码
  （超内联上限 / 桌面版 / 老快照）时判「判不了」，先按现有索引用。
- 桌面版（Tauri）不建索引（Rust 侧不写库内文件），行为页会一直说「未找到」。
- 框架渲染出的 DOM 在源码里没有对应查询与绑定 → 未找到（这是设计，不是缺陷）。

## 验收

- `npm run check` 全绿（typecheck + lint + test）。
- `src/lib/locate/jsIndex.test.ts`（34 例）：逐行断言行号（声明/表达式/对象方法/class 方法）、
  选择器归一（`#btn`/`.card`/`#wrap > .item`）、绑定归属（直接/变量/参数不明）、委托降级提示、
  多文件合并、相关查询、解析失败、内联脚本行号平移、索引形状与路径。
- `src/lib/locate/jsDemo.test.ts`（8 例）：真实「内联 + 插桩 → jsdom 点击 → acorn 反查」链路，
  逐条比对 `#btn`（`click → onSaveClick`，`app.js:12`，高亮 8–10）、`<li>`（父元素 `#todo-list`）、
  `#reset`（变量间接）、内联脚本（行号指向 HTML）、灰区（原话提示 + 页面级监听 + 无法归属 1 处），
  以及抽屉 HTML 段：点 button 也能靠 `data-lh` 标注拿到精确行号。
- `src/lib/locate/bridge.jsdom.test.ts`：新增一例锁定 `lh-css-hits` 回传的 `element` /
  `ancestors`（真实点击目标是 `button#btn`，而不是 CSS 上溯到的容器，`html` 不进链）。
- 手工验收：导入 `examples/行为定位验收` → 打开 `index.html` → 按该文件夹 `README.md` 的表逐条点。
