# 预览点击 → 源码词级定位（+ 属性兜底）

在上期「预览 ⇄ 源码联动」基础上扩展，不改写原有匹配链路：**新增更精确的一层，原有层全部保留为回退**。

## 要解决的问题

1. 点击命中后精度只到「元素」：`locateStaticInRange` 算出文本级范围后，`locatePreviewClick` 直接返回整个 `data-lh` 容器。500 字的 `<p>` 点一个字 → 源码选中整段。
2. 没有可见文本的节点直接失效：`<img alt>`、`aria-label` 之类只有属性值，点击不发消息（或落到容器）。
3. 文本采集标签白名单过窄：`td/th/pre/code/blockquote/dt/dd/figcaption/caption` 不参与定位。

## 实现

- **词级定位（I1）**：bridge 用 `caretRangeFromPoint` / `caretPositionFromPoint` 取点击处的插入符，换算成「该 `data-lh` 容器渲染文本内的字符偏移」`plainOffset` 上报；父侧 `locateTextRunInRange` 用新增的 `buildHtmlPlainMap`（源码切片 → 渲染文本 + 双向索引）把偏移直接映射回源码，**不做文本匹配**，因此重复文本、行内标签（`<em>`/`<strong>`）都不再影响精度。
  - 分词：拉丁/数字取整词；CJK 取整段但截断到 24 字（居中所点位置）；点在空白/标点上吸附到相邻词。
- **属性兜底（I2）**：无可见文本时 bridge 上报 `attrName/attrValue`（`alt` > `aria-label` > `title` > `placeholder`），父侧 `locateAttrValueInRange` 在 start tag 内定位该值（支持单/双引号与无引号，属性值按实体解码后比较）。
- **标签白名单**：文本采集扩到表格单元格、代码块、引用、定义列表、图表说明等。
- **基线**：`golden.regression.test.ts` 的 fixture 默认按 LF 读取（期望值按 LF 编写，生产链路同样归一换行），`crlf` fixture 用 `"rawNewlines": true` 显式保留原样。

精度枚举不变（词级仍报 `exact`），`data-lh` 协议不变，sandbox 不变，用户源文件零写入。

## 单元测试

`npx vitest run src/lib/locate` → **197 passed / 1 expected fail**（新增 `htmlPlainMap.test.ts` 16 例；`htmlLocate.test.ts` 30 例；`bridge.jsdom.test.ts` 25 例含端到端契约）。

端到端契约用例驱动真实点击：instrumented srcDoc → JSDOM 加载生成的 bridge → 点击 → 把 payload 交给父侧解析 → 断言源码切出的正是被点的词 / 属性值，确保 bridge 偏移与 `buildHtmlPlainMap` 两侧永远同口径。

## 验收用例

| # | 项 | 说明 |
|---|----|------|
| 1 | 长段落点一个字 → 只选中该词 | 之前选中整段 |
| 2 | 点 `**加粗**` / 行内代码 → 词级，不吞标签 | 偏移穿过标签映射 |
| 3 | 点 `<img alt="折线图">` → 选中 `alt` 值 | 底栏文案「…（属性 alt）」 |
| 4 | 点表格单元格 / 代码块 / 引用 | 之前无反应 |
| 5 | 中文长句 | 选中被点的 24 字片段 |
| 6 | 空白处点击 | 行为不变：不跳转 |
| 7 | 旧 bridge / 无 caret API | 回退到整元素（后端兼容） |

## 已知限制

- CJK 无词边界：整段截断 24 字，不做分词（不引入新依赖）。
- `caretPositionFromPoint` 缺失且 `caretRangeFromPoint` 也不可用时不发 `plainOffset`，退回整元素语义。
- 行内元素（`a`/`strong`）的 Markdown 侧仍只到块级；MD 词级点击留待下一期（复用 `anchorPlainOffset`）。
