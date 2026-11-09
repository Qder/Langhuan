# 琅嬛 — Markdown 右键上传图片

tip：见本提交。`git pull` 后 `npm i && npm run check`。

## 做了什么

在藏书阁 Markdown 里，可以在**想插入的位置**右键 → **上传图片** → 选本地图片，写入库内附件（`content/…/assets/` + IDB 缓存），并在**右键时记下的源码偏移**插入 `![](./assets/…)`。

- **不**走第三方图床
- 取消文件对话框 → 不改正文
- 异步完成后仍写入右键时的那篇 `docId`（不会插到后来切过去的另一篇）
- 类型 / 大小与库 zip 单文件上限一致（8 MB）；安卓空 MIME 按扩展名认

## 入口

| 场景 | 怎么用 |
|------|--------|
| 预览（含专注纸面） | 正文右键 →「上传图片」（块缝 / 段落上下半 / 文末都会记 `insertAt`） |
| 源码 / 分栏源码 | CM6 编辑区右键 →「上传图片」（点到的光标偏移） |
| 触控 / 安卓 | 顶栏「更多」→「插入图片」；⌘K「插入图片」；侧栏「附件」旁 ＋（无附件时也能点）；插在文末 |
| 既有 | 粘贴 / 拖入图片仍可用（源码按光标；预览非编辑区仍偏文末） |

就地 visual CE（`[data-lh-inline-editor]`）仍走系统菜单，避免抢划词；CE 里粘贴图片照旧。

## 关键文件

- `src/lib/assets/imageUpload.ts` — 校验、选文件、偏移、插入
- `src/lib/assets/runImageUpload.ts` — pick → ingest → setDraft（预览 / 文末入口）
- `src/lib/store/slices/assetsSlice.ts` — `ingestImageFile` 走同一套校验
- `src/components/MarkdownReader.tsx` — 预览右键
- `src/components/editor/MdCodeMirror.tsx` — 源码右键（dispatch 到捕获偏移）
- `src/components/topbar/MoreMenu.tsx` / `TopBar.tsx` / `CommandPalette.tsx` / `AssetsPanel.tsx` — 触控可达入口

## 验收

1. 打开一篇 `.md` 预览，在两段中间右键 → 上传图片 → 图出现在两段之间，不是文末。
2. 源码模式把光标放在中间，右键上传 → 标记插在光标处。
3. 取消系统选图对话框 → 正文不变。
4. 选非图片或 >8 MB → 状态栏中文错误，正文不变。
5. 窄屏 / 平板：更多 → 插入图片，或 ⌘K「插入图片」。
6. `npm run check`。

## 限制

- 预览「粘贴到空白纸面」（非 CE）仍可能贴到文末；精确位置请用右键上传。
- 未做物理安卓手测；桌面交互需本机点选文件对话框。
- 未新增长按专用手势（避免和划词抢）；触控用「更多 / ⌘K / 附件＋」。
