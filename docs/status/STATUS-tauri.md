# Tauri 2 桌面壳（MVP）

上次更新：2026-11-05 · tip `3c6e994` 之后

## 一句话现状

- **浏览器 `npm run dev` 仍是完整产品**（唯一支持 HTML 项目导入 / CSS·JS 索引 / IDE 讲解的形态）。
- **`npm run tauri:dev`**：一条命令起 Next + WebView，桌面侧用 Rust `invoke` 读写磁盘 `content/`。已本机实测。
- **`npm run tauri:build`**：产出可安装包，**前端不再是占位页**——打开就是琅嬛 UI，能读、能改、能存本地 `content/`。已本机实测（NSIS + MSI）。

## 怎么跑

前情：Rust stable + [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 通常自带）+ Node 20+，仓库根 `npm install`。

### 开发（连 Next dev server，带 HMR）

```bash
npm run tauri:dev
```

`beforeDevCommand` 走 `scripts/tauri-dev-server.mjs`，不是裸 `next dev`。原因：WebView 硬编码加载 `build.devUrl` = `http://localhost:3000`；裸 `next dev` 在 3000 被占时会静默改用 3001，桌面窗口就打开别人的页面或白屏。脚本行为：

| 3000 状态 | 行为 |
| --- | --- |
| 空闲 | `next dev -p 3000` |
| 已是琅嬛 | 复用，不再起第二个 Next |
| 被其他程序占了 | **直接报错退出**，不打开错的 UI |

`content/` 根目录（debug 构建）：仓库的 `content/`，可用 `LANGHUAN_CONTENT=/abs/path` 覆盖。

### 打包（静态导出 + 本地 Rust API）

```bash
npm run tauri:build
```

产物：

- `src-tauri/target/release/langhuan.exe`（免安装可执行文件）
- `src-tauri/target/release/bundle/nsis/琅嬛_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/琅嬛_0.1.0_x64_zh-CN.msi`

### 只导出前端（排查 UI 问题用）

```bash
npm run desktop:ui    # → out/
```

## 打包路径是怎么走通的

App Router + Route Handlers 不能直接 `output: "export"`：`export const dynamic = "force-dynamic"` 与静态导出互斥，构建会直接失败。

关键事实：**桌面前端本来就不调那些 Route Handler**。`src/lib/storage/contentApi.ts` 里每个读写入口都有 `isTauriRuntime()` 分支，Tauri 下全部走 Rust `invoke`（`src-tauri/src/content.rs`）。所以：

1. `next.config.ts` 在 `LANGHUAN_DESKTOP_EXPORT=1` 时切到 `output: "export"` + `distDir: "out"`，并用 `pageExtensions: ["tsx"]` 把 `src/app/api/**/route.ts` 排除出构建。
2. `scripts/build-desktop-ui.mjs` 设置该环境变量跑一次 `next build`，产出 `out/`。
3. `tauri.conf.json` 的 `frontendDist` 指向 `../out`，`beforeBuildCommand` 是 `npm run desktop:ui`。

`distDir` 特意设成 `out` 而不是默认 `.next`：否则一次桌面构建会把正在跑的 `npm run dev` 的 `.next` 缓存冲掉。`out/` 已在 `.gitignore` 里。

没有 sidecar Node：不需要，桌面版也没有任何运行时依赖外部服务。

## content 根目录

按顺序解析（`resolve_content_root`，`src-tauri/src/content.rs`）：

1. `LANGHUAN_CONTENT`（显式覆盖）
2. **debug 构建**：仓库 `content/`（`CARGO_MANIFEST_DIR/../content`）
3. **release 构建**：可执行文件同级的 `content/`（便携安装）
4. `{app_data_dir}/琅嬛/content`，例如
   `C:\Users\<user>\AppData\Roaming\com.qder.langhuan\琅嬛\content`

第 2 条只在 debug 生效，是为了让安装后的 release 版本不去读开发机的仓库路径。首次运行且目录为空时，前端会把示例文档种进去（`hydrateFromContent` 的 seed 分支）。

## 命令一览（Rust）

`library_content_root` · `library_scan` · `library_put_doc` · `library_put_asset` · `library_delete_path` · `library_trash_restore` · `library_trash_purge` · `library_mkdir` · `library_read_file` · `library_bulk`

## 本机实测记录（2026-11-05）

`npm run tauri:build`：

```
✓ Compiled successfully · Route (app): ○ /  ○ /_not-found
[desktop-ui] 静态 UI 就绪：…\out（514 个条目）
Built application at: …\src-tauri\target\release\langhuan.exe
Finished 2 bundles at:
  …\bundle\nsis\琅嬛_0.1.0_x64-setup.exe (15.22 MiB)
  …\bundle\msi\琅嬛_0.1.0_x64_zh-CN.msi (16.08 MiB)
```

对**打包后的真实窗口**（WebView2 remote debugging，`http://tauri.localhost/`）跑的行为验证：

| 验收点 | 结果 |
| --- | --- |
| 不是占位页 | `title=琅嬛 Langhuan`，侧栏/顶栏/首页卡片全在 |
| 认出 Tauri 运行时 | `window.__TAURI_INTERNALS__` 存在 |
| 打开本地库 | `library_scan` 返回 7 篇（首次运行种进 app_data） |
| 打开一篇 md | 点「方法论·双链笔记」→ 预览渲染正文、双链胶囊、相对图 |
| 保存到磁盘 | 编辑器改 `快速上手.md` → 状态栏「已保存 快速上手.md」，磁盘文件已含新行 |
| 重启后仍在 | `Page.reload` 后 `library_scan` 与 UI 都还有该行 |

`npm run tauri:dev`：`GET / 200`、`GET /api/library 200`（dev 走 Next API）、`library_scan` 返回仓库 `content/` 的 24 篇。

## 已知限制

- **HTML 项目导入 / CSS·JS 资源索引 / 元素定位：桌面版不支持**，请用浏览器。桌面版 `fetchLibrary()` 返回 `desktopProjectsUnsupported: true`，`putLibraryRawFile` 直接抛 `DESKTOP_UNSUPPORTED_PROJECTS`，不会假装成功。
- **IDE 讲解（读码）：桌面版不可用**。它依赖 Next `/api/ide/explain` 的流式响应，静态导出里没有这个路由。面板里现在是明确文案，不是 fetch 报错。
- 图片预览走 base64 `data:` URL，极大附件会偏慢。
- 未接系统托盘 / 自动更新 / 代码签名。安装包未签名，Windows 会提示未知发布者。
- 依赖 Rust 工具链和 WebView2 运行时，不是「双击即用」的单文件分发。
- macOS / Linux 未验证；本仓库只在 Windows 上跑过。
- Android `src-tauri/gen/android` 脚手架未参与本次改动；`.kotlin` 会话/日志已在 `src-tauri/.gitignore` 里忽略。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 窗口白屏，dev 日志里 Next 端口是 3001 | 3000 被别的 Next 占了。`tauri:dev` 的守卫现在会直接报错；按提示结束占用进程 |
| 首页文档数不对 | 确认 `library_content_root` 返回哪个目录；打包版本读 app_data，不是仓库 `content/` |
| `tauri build` 卡在 WiX，报 `LGHT0311 ... code page '1252'` | MSI 的 en-US 代码页装不下「琅嬛」。已在 `bundle.windows.wix.language` 设为 `zh-CN`；改产品名时别再退回默认语言 |
| 只想看 UI，不想等 Rust 编译 | `npm run desktop:ui` 后直接用浏览器开 `out/index.html`（无 Tauri IPC，库是空的） |
