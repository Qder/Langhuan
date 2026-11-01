# 项目导入（多文件站点）

> 主题：导入 `index.html + css/ + js/` 的文件夹并让预览真正跑起来。
> 对应实现：`src/lib/project.ts`、`src/lib/importProject.ts`、`src/lib/inlineProject.ts`、
> `src/lib/store/slices/projectsSlice.ts`、`src/components/ProjectFileDialog.tsx`。
> 示例：`examples/项目示例/`。

## 问题

预览 iframe 的 sandbox 只有 `allow-scripts allow-popups allow-forms`（**不能**加 `allow-same-origin`），
`srcDoc` 没有可用的文档基准地址，所以 `css/style.css`、`js/app.js` 这类相对引用一定 404。
父页面也不能替 iframe 解析相对路径——只能在注入前把内容读进来。

## 数据形状

```
content/<项目名>/
  index.html
  about.html
  css/style.css
  js/app.js
  .langhuan/project.json
```

`project.json`（元数据，**不进正文索引**；`walkFiles` 跳过 `.langhuan/` 目录）：

```json
{
  "entry": "index.html",
  "files": ["about.html", "css/style.css", "index.html", "js/app.js"],
  "external": [],
  "importedAt": "2026-01-02T03:04:05.000Z"
}
```

- 只有 `.md` / `.html` / `.svg` 变成文档（进树、可编辑、走既有索引）；`.txt` 故意不进文档
  （扫描时会被规范成 `.md`，会撑破项目结构）。
- 其余文件（css/js/json/图片…）原样落盘，**不写** `.langhuan/index.json`，也不是附件。
- 项目根撞名时自动加序号（`demo` → `demo-2`）。

## 导入

入口：侧栏「导入 → 导入项目文件夹（含 css/js）」。`webkitdirectory` 拿到全部文件（含子目录），
按 `webkitRelativePath` 去掉最外层文件夹名，然后 `planProjectImport()` 做纯规划：

- 跳过点开头目录、`node_modules`、`__MACOSX`、`.DS_Store` 等；
- 单文件 8MB 上限；
- 入口识别：根目录 `index.html` → 否则全项目唯一的 `.html` → 都没有就报错（不猜）；
- `external` 在导入时扫一遍入口页（含 `<base href>` 的影响）写进元数据。

规划结果里 css/js/图片先落盘（`PUT /api/library/file` + `raw: true`，不建索引），
再写 `project.json`，最后让文档进库并打开入口页。

## 预览内联

`buildInstrumentedSrcDoc(raw, undefined, { inline })` 的顺序是：

```
raw 源码 → parse5 插桩(data-lh) → 内联 css/js → 清理(DOMPurify / 轻量剥 handler) → 注入 bridge
```

插桩必须在内联之前：`data-lh` 指向**原始源码**偏移，内联只替换标签、不改变元素数与可见文本，
所以偏移一直有效。单测用 `buildHtmlPlainMap` 对比内联前后的纯文本，管道测试断言 `data-lh` 仍在。

`inlineProjectHtml()` 的规则：

| 情形 | 处理 |
|------|------|
| `<link rel=stylesheet href="相对路径">` | 换成 `<style data-lh-inline="路径">` |
| `<script src="相对路径">` | 换成 `<script data-lh-inline="路径">`，连同紧随的 `</script>` 一起替换 |
| `http(s)://`、`//host` | 跳过，记入 `external`，UI 顶部提示「需联网」 |
| `data:` / `javascript:` / `#锚点` | 静默跳过 |
| `<base href>` 相对 | 以此目录为基准解析 |
| `<base href>` 指向外站 | 相对引用按 HTML 语义算外链，不内联 |
| 文件不存在 | 保留原标签，记入 `missing` |
| `<link rel=preload>` 等 | 不动 |

标签属性保留（`media`、`type=module` 等），只丢掉 `href`/`src`/`integrity`/`crossorigin`/
`referrerpolicy`/`async`/`defer`。内联正文里的 `</script` / `</style` 用 `<\/` 转义，避免提前截断。

## UI

- 树里项目就是一个可展开的文件夹节点，带「项目」徽标；双击打开入口页。
- 项目内非文档文件（css/js）以灰色等宽字显示，点击打开只读查看器（可复制）。
- 同一项目的多个 `.html` 都是文档，点一下就切换。
- 预览顶部在 `external` 非空时给出提示条。

## 已知限制

- 图片等二进制资源会随项目落盘，但**预览里不会显示**（本期只内联 css/js）。需要时可在
  `inlineProjectHtml` 里加 `<img src>` → data URL 的替换。
- 桌面版（Tauri）暂不支持项目导入：Rust 侧没有原样写文件的命令，`putLibraryRawFile` 会直接报错；
  扫描也不返回 `projects`。浏览器版（`npm run dev` / `next start`）完整可用。
- 项目文件改了要重新导入，没有「监视项目文件夹」。
- 项目里的 `.html` 仍然走普通文档编辑与自动保存；改动不会回写 `project.json`（`files` 是导入快照）。

## 验收

- `npm run check` 全绿。
- `src/lib/inlineProject.test.ts`：相对路径 / 外链 / `<base>` / 缺失文件 / 属性保留 /
  `</script>` 转义 / 注释与字符串里的假标签 / 文本与元素数不变 + `examples/项目示例` 端到端。
- `src/lib/importProject.test.ts`：入口识别、忽略表、根去重、`project.json` 形状、二进制分支。
- `src/lib/folders.test.ts`：项目文件挂到树里、与文档不重复。
- 手工验收：导入 `examples/项目示例` → 样式生效（宋体 + 朱砂色）→ 点「点我改文字」文案变化 →
  侧栏点 `about.html` 可切换。
