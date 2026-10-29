# 预览 ⇄ 源码双向联动 — 验收状态

实现提交目标：`main`（本文件随功能一并提交）。

## 实现摘要

- **锚点滚动**：`scrollSync.ts` 二分插值；缺锚点退化为百分比。
- **Markdown**：`rehypeSrcPositions` 写 `data-src-*`，代码块行级 `span`；`MarkdownReader` 测量锚点 + 点击定位 + 同步滚动。
- **HTML**：`htmlInstrument.ts`（parse5）在 **srcDoc 副本**注入 `data-lh`；`bridge.ts` 新协议（`lh-locate` / `lh-scroll-anchors` / `scrollToRange` / `highlightRange`）；脚本生成走 `locateDynamicHtml` 降级。
- **编辑器**：MD / HTML 均用 CM6 + `locateHighlight` StateField（朱砂 8% 行 / 20% 范围）；暴露 `revealRangeInView`。
- **工具条**：分栏时「同步滚动」开关（`Link2`），按文档持久化 `syncScrollByDoc`。
- **安全**：iframe 仍无 `allow-same-origin`；导出 / 新窗口用原始 `getContent` + `prepareHtmlPreview`，不含 `data-lh` / bridge。

## 单元测试

`npx vitest run` → **129 passed**（含 locate：scrollSync / htmlInstrument / bridge / mdLocate）。

## 验收用例

| # | 项 | 结果 | 说明 |
|---|----|------|------|
| 1 | MD 慢速滚动误差 ≤3 行；快速拖动无抖动回环 | **代码通过 / 待本机目视** | 锚点插值 + 80–120ms 忽略窗 + rAF；unit：`scrollSync.test.ts` |
| 2 | 源码滚动→预览；打字保持光标块可见 | **代码通过 / 待本机目视** | editor→`publishScrollSync`；cursor throttle 滚预览 |
| 3 | 点击段落 / 表格单元格 / 代码行 → 正确高亮 | **代码通过 / 待本机目视** | `data-src-*` + 行级 span；CM6 双层高亮 |
| 4 | HTML 静态 h2 → 行+范围高亮 | **代码通过 / 待本机目视** | parse5 `data-lh` 精确偏移；unit：`htmlInstrument.test.ts` |
| 5 | HTML 脚本动态（元素参考页）降级文案 | **代码通过 / 待本机目视** | `locateDynamicHtml`：script / 近似 / 容器；unit：mdLocate/htmlLocate 相关 |
| 6 | 预览左 / 右两种布局 | **代码通过** | 同步经 store 事件，与左右布局无关 |
| 7 | 软换行 + 长行 | **代码通过 / 待本机目视** | CM6 按文档位置换算，非 textarea 行高估算 |
| 8 | 编辑改行数后高亮清除/跟随 | **代码通过** | StateField `map` + 文档变更时 `clearRevealInView` |
| 9 | 关闭同步滚动后独立滚动；点击定位仍可用 | **代码通过** | `getSyncScrollEnabled` 仅门控滚动；locate 不检查该开关 |
| 10 | 导出 / 新窗口无 data-lh / bridge | **通过** | `openHtmlInNewTab` / 导出均用 raw `getContent`；unit：`stripInstrumentation` |

**本机建议复测**：`git pull` 后打开分栏，分别试 MD 长文与 `html-elements-reference`（或同类脚本生成页），确认状态栏文案与闪选。

## 模块清单

| 路径 | 角色 |
|------|------|
| `src/lib/locate/types.ts` | Anchor / 新协议类型 |
| `src/lib/locate/scrollSync.ts` (+test) | 插值 + 防回环辅助 |
| `src/lib/locate/htmlInstrument.ts` (+test) | parse5 插桩 |
| `src/lib/locate/bridge.ts` (+test) | 桥接脚本与 `buildInstrumentedSrcDoc` |
| `src/lib/locate/htmlLocate.ts` | 静态/动态定位 |
| `src/lib/locate/rehypeSrcPositions.ts` | MD 锚点属性 |
| `src/components/editor/locateHighlight.ts` | CM6 朱砂高亮 |
| `src/components/editor/HtmlCodeMirror.tsx` | HTML 源码 CM6 |
| `src/components/SourceEditor.tsx` | 按类型分发 |
| `src/components/HtmlReader.tsx` / `MarkdownReader.tsx` | 预览接线 |
| `src/components/editor/MdCodeMirror.tsx` | MD 编辑器接线 |
| `src/components/TopBar.tsx` | 同步滚动开关 |
| `src/lib/store.ts` | syncScroll / scrollSyncEvent / PendingReveal |
| `src/lib/mdSanitizeSchema.ts` | 放行 `data-src-*` |
| `package.json` | 依赖 `parse5` |

## 已知限制

- 超大文档（>5000 行）视口 ±3 屏精确测量逻辑已在 `scrollSync` / 测量函数侧预留，极端文档建议本机再压一轮。
- Hover 预览对应源码范围标为可选，本轮未做悬浮预览条。
