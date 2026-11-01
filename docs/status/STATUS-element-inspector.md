# 元素检视（点一个元素，一次看全 HTML / 样式 / 行为）

> 主题：把前三期（HTML 预览→源码定位、CSS 来源、JS 行为）合成一个抽屉。预览里点任意元素，
> 右侧弹出「元素检视」，三段一次全给：**它是什么（第几行）**、**谁给它上样式**、**谁给它绑事件**。
> 条目都能点，跳转后抽屉不关；可 pin 到右侧不遮挡阅读区；键盘 Esc / ↑↓ / Enter 走完全流程。
> 心智模型照 Chrome DevTools 的 Elements 面板，不做新范式。
>
> 实现：`src/lib/locate/elementInspect.ts`（HTML 段的纯函数）、
> `src/lib/store/slices/elementInspectSlice.ts`（三段数据一次算齐 + pin 状态）、
> `src/components/ElementInspector.tsx`（抽屉本体）、`src/components/HtmlReader.tsx`（布局与消息接线）、
> `src/lib/locate/bridge.client.js`（`lh-element` 带上 `range` / `attrs` / `text`）。
> 试玩：`examples/行为定位验收/`（`#btn` 三段都有内容）、`examples/项目示例/`（卡片）。

## 三段从哪来

| 段 | 数据来源 | 精度说法 |
|----|----------|----------|
| HTML | bridge 回传的 `tag` / `attrs` + 源码位置。有 `data-lh` 标注区间 → 精确；否则用 `htmlLocate`（`locatePreviewClick` / `locateInHtml`）的结果；再不然按元素自身文本找一次，**降级成推断** | `精确` / `推断` / `未定位` |
| 样式 | `lh-css-query` → bridge 用 `el.matches()` 逐条判命中（逗号列表逐支试）→ `resolveCssHits` 回 CSS 索引查行号，按 specificity 排序，最多 10 条 | 索引对得上就 `精确`；动态注入 / 同名规则无法唯一对应时 `推断` |
| 行为 | `resolveBehaviorHits({...element, ancestors}, jsIndexes)`：acorn 静态符号表反查 | `精确` / `父元素` / `页面级` |

`data-lh` 是预览插桩时打上的源码区间标注（`instrumentHtmlSrcDoc`），**只存在于 iframe 的 srcDoc 里**，
用户文件一个字节都不改。它是「精确」的唯一来源：有标注就直接换算行号，没有才走文本 / 属性近似。

`attrs` 由 bridge 从 DOM 直接读（`elementAttrs`），跳过 `data-lh*` 插桩属性、压平空白、单值超 80 字截断、
最多 12 个；面板只展示其中 6 个，其余收成 `… +N`。这条规则纯函数化在 `normalizeAttrs`，有单测。

## 一次点击的消息时序

```
点击（捕获阶段，bridge）
  → lh-element { element, ancestors, range, text }
        range = 最近带 data-lh 的祖先（含自己）的源码区间
        text  = 元素自身文本（≤60 字）
        每次点击都发：交互元素（button/a/input）不发 lh-locate，但抽屉对它们同样有意义
  → 父窗口回 lh-css-query { nonce }
  → （若该元素也过了 locate 门禁）lh-locate：父窗口 runLocate → 得到 LocateResult，暂存 ref
  → bridge 回 lh-css-hits { hits, element, ancestors }
  → store.inspectElement：三段一起算好
```

顺序保证：`lh-element` 一定先于 `lh-css-hits`（前者捕获阶段、后者是对 `lh-css-query` 的回复），
所以收到 `lh-css-hits` 时同一次点击的 `lh-locate` 结果已经在 ref 里了。`nonce` 校验挡掉连点时串号。

## 连点竞态：旧请求不许覆盖新结果

`inspectElement` 里要 await 索引补建（可能几次往返），而人是连着点的：第二次点击开始后，
第一次的 Promise 仍可能更晚完成，然后写回上一个元素的数据 —— 更糟的是第一次**没命中、
返回空结果**，把第二次已经开好的面板关掉。

规矩（`src/lib/store/inspectGate.ts`）：

- 每次请求领一张票（`id` 单调递增 + `epoch` 代数），**每个 await 之后、最终 set 之前验票**；
- 票过期就整份丢弃：不写索引缓存、不改面板、也不会 `set({ elementPanel: null })` 关掉别人的面板；
- 切文档（`openDoc` / `openHome`）与关抽屉（`closeInspector`）都把 `epoch` +1，在途请求一起作废；
  另有一层兜底：请求醒来时若「当前打开的文档」已经不是它点的那篇，同样丢弃；
- 不靠禁用点击或固定延时 —— 该点的照点，只是旧的回来不算数。

补建索引本身也收敛（`src/lib/locate/indexFreshness.ts`）：同一文件并发只发一次请求（单飞），
且按源码指纹决定要不要发 —— 见下节。

HTML 段的取位顺序（`HtmlReader`）：**`lh-locate` 的 `payload.range` → `lh-element.range` → 按文本推断**。
第一项给「精确」，第二项给「精确」，第三项明确降级成「推断」——绝不把文本匹配冒充成标注命中。

## 什么时候弹

有样式命中、有行为命中、或源码里**查过这个元素**（只有查询没有绑定 → 正好回答「找到了查询，但没找到绑定」）。
三样都没有就不弹：普通 HTML 笔记里点来点去不该冒出一个空抽屉。判定收在 `shouldOpenElementPanel`，有单测。

## 交互

- **抽屉出现**：默认浮在预览右侧（`absolute inset-y-0 right-0`，340px）；移动端（`<md`）改成底部弹出
  （`max-h-[62vh]`、圆角上沿、抓手条）。
- **pin**：`aria-pressed` 的图钉。pin 后抽屉变成**布局里的一列**（`md:relative` + `w-[340px]`），
  预览 stage 缩窄而不是被盖住 —— stage 有 `ResizeObserver`，缩窄会自动重算 iframe 的缩放，
  所以「不遮挡阅读区」是真的不遮挡。pin 状态跨点击保持（存在 store 里）。
- **三段**：`<h3><button aria-expanded aria-controls>` 控制自己的 `role="region"`，默认全展开。
  折叠只是视觉，键盘列表会跟着少掉那几行。
- **条目**：全是 `<button>`，Enter / Space 走原生激活；整张列表 roving tabindex，只有一条能被 Tab 到。
  `aria-current="true"` 标记「上一次跳转的那条」，从源码视图返回后选中态还在。
- **键盘**：抽屉容器收 ↑ ↓ Home End 移动焦点（到边界回绕）；Esc 关闭（先关源码视图，再关抽屉）。
  iframe 里按 Esc 也关抽屉：`HtmlReader` 的 `handleBridgeKey` 先看抽屉有没有开。
  源码编辑器里的 Esc 不抢（`.cm-editor` 内放行）。
- **焦点**：打开时焦点进抽屉（屏幕阅读器先读整体结构），关闭时还给打开前的元素。
- **跳转**：抽屉内就地覆盖一层只读 CodeMirror（`md:w-[min(560px,80vw)]`），高亮对应行区间；
  「← 返回」或 Esc 回到列表。抽屉本身不卸载，所以选中态、滚动位置、折叠状态都还在。

## 排版

- 行内一律 `min-w-0` + `truncate`，长选择器 / 长路径不会把 340px 的抽屉撑破。
- 打开标签用 `<pre class="whitespace-pre-wrap break-words">`：`<button>` 这种长标签换行而不是横向滚动。
- 纯数字 / 行号用 `font-mono`，中文标签用默认字体，避免等宽字体把中文撑到两三倍宽。
- 中英文混排、系统缩放 125% 都按 `text-[10px]` / `text-[11px]` / `text-[12px]` 三档走，不靠固定宽度。

## 已知限制

- HTML 段对「脚本动态生成的元素」只能给 `未定位`，并说明原因，不乱指行。
- 样式段靠 `el.matches()` 判命中（浏览器语义），但行号来自构建期索引：索引缺失 / 对不上时只能标
  「推断」、不给行号；伪元素（`::before`）不参与匹配。
- 行为段只做静态分析：绑在变量 / 参数上的监听、框架运行时挂载的监听都找不到。
- 索引按源码指纹取（`src/lib/locate/indexFreshness.ts`）：改了 `.css` / `.js` 后第一次点击会重建、
  按新行号跳；指纹一致则直接复用。拿不到当前源码（文件超内联上限 / 桌面版 / 老快照）时判「判不了」，
  先按现有索引用 —— 这种文件改过之后仍可能跳到旧行号。在应用外用别的编辑器改文件、又还没重新载入
  `content/` 时同理：客户端比的还是旧文本，刷新一次就自愈（预览本身也要刷新才变）。
- 桌面版（Tauri）不建索引：样式 / 行为段会一直说「没找到」。

## 验收

- `npm run check` 全绿（typecheck + lint + test）；`npm run build` 通过。
- `src/lib/locate/elementInspect.test.ts`（14 例）：`normalizeAttrs`（丢插桩属性 / 压空白 / 80 字截断 /
  上限 12 个 / 脏数据不炸）、`formatOpenTag`（引号、布尔属性、`… +N`）、`buildElementHtmlInfo`
  （标注区间→精确、多行元素行区间、文本命中→行、近似→保留推断、定位不到→行号 0 + 原话）、
  `formatElementLocation`、`precisionLabel`，以及真实 `examples/行为定位验收/index.html` 的行号核对。
- `src/components/ElementInspector.test.tsx`（12 例，`react-dom/server` 静态渲染）：`role="dialog"` +
  `aria-labelledby/describedby`、三段顺序与 `aria-expanded`、三个 `region` 与 `aria-controls` 对得上、
  整表只有一个 Tab 停靠点、三段内容（标签 / 行号 / 精度、选择器 / 位置 / 声明、事件 / 函数 / 行号）、
  行为空态原话、只有查询时列出查询、HTML 未定位时不冒充行号、pin 的 `aria-pressed`。
- `src/lib/locate/jsDemo.test.ts`（8 例，真实链路）：点 `#btn`（button，不发 `lh-locate`）也能靠
  `lh-element.range` 得到精确行号，且 `data-lh` 不出现在展示的属性里。
- `src/lib/locate/bridge.jsdom.test.ts`（33 例）：`lh-element` 带上 `range` / `text` / `attrs`，
  交互元素仍不发 `lh-locate`。
- `src/lib/locate/indexFreshness.test.ts`（16 例）：`sourceHash` 与 `buildCssIndex` / `hashJs` 写进
  索引的指纹一致、`projectTextFor`（嵌套项目取最深的根 / 项目外拿不到）、`checkIndex` 的
  fresh / stale / unknown、`pruneStaleIndexes`、单飞（并发只跑一次、落地后能再来、失败不粘住）。
- `src/lib/store/inspectElement.test.ts`（14 例，真 slice + 真 postcss 索引、只 mock「要索引」那一步）：
  指纹一致不发请求、指纹变了只重建一次并按新行号跳、同文件并发只发一次、重建失败丢索引降级 fuzzy、
  拿不到源码不盲目重建、`.js` 同规则；连点（先慢后快 → 面板是后一次）、旧请求空结果不关新面板、
  切文档后旧结果不落地、作废的请求不写索引缓存、闸门的单调性与作废语义。
- 手工验收：导入 `examples/行为定位验收` 打开 `index.html` → 点卡片 / `#btn` → 三段都有内容 →
  逐条点：HTML 跳 `index.html` 那一行、样式跳 `style.css` 那条规则、行为跳 `app.js`（高亮整个函数）→
  返回后选中态还在 → 点图钉，抽屉变一列、预览变窄 → 缩放窗口到手机宽度，抽屉从底部升起 →
  纯键盘走一遍（Tab 进抽屉、↑↓ 选、Enter 跳、Esc 关）→ 中英文界面都不出现横向滚动条 →
  改一行 `css/style.css` 重新导入，再点卡片：样式段的行号应跟着规则走（不是旧行号）。
