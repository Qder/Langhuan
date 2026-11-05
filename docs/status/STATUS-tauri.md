# Tauri 2 桌面壳（MVP）

上次更新：2026-11-05 · 桌面讲解 + Windows updater

## 一句话现状

- **浏览器 `npm run dev` 仍是完整产品**（唯一支持 HTML 项目导入 / CSS·JS 索引的形态）。IDE 讲解在浏览器走 Next `/api/ide/explain`。
- **`npm run tauri:dev`**：一条命令起 Next + WebView，桌面侧用 Rust `invoke` 读写磁盘 `content/`。已本机实测。
- **`npm run tauri:build`**：产出可安装包，**前端不再是占位页**——打开就是琅嬛 UI，能读、能改、能存本地 `content/`。已本机实测（NSIS + MSI）。
- **打包版读码讲解**：不依赖 Next Route Handler。前端把已组装的 prompt 交给 Rust `ide_explain`，由它直连**用户自己填的** OpenAI 兼容 Base URL 并推流。没填 Key 时仍是同一份本地示例讲解。

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

没有 sidecar Node：不需要。讲解也不是再起一个本地 HTTP 服务，只是 Rust 按用户填的 Base URL 发一次 `/chat/completions`。没填 Key、没填 URL 时不会联系任何地址。

## content 根目录

按顺序解析（`resolve_content_root`，`src-tauri/src/content.rs`）：

1. `LANGHUAN_CONTENT`（显式覆盖）
2. **debug 构建**：仓库 `content/`（`CARGO_MANIFEST_DIR/../content`）
3. **release 构建**：可执行文件同级的 `content/`（便携安装）
4. `{app_data_dir}/琅嬛/content`，例如
   `C:\Users\<user>\AppData\Roaming\com.qder.langhuan\琅嬛\content`

第 2 条只在 debug 生效，是为了让安装后的 release 版本不去读开发机的仓库路径。首次运行且目录为空时，前端会把示例文档种进去（`hydrateFromContent` 的 seed 分支）。

## 命令一览（Rust）

库：`library_content_root` · `library_scan` · `library_put_doc` · `library_put_asset` · `library_delete_path` · `library_trash_restore` · `library_trash_purge` · `library_mkdir` · `library_read_file` · `library_bulk`

讲解：`ide_explain`（带 Tauri Channel 推流）· `ide_explain_cancel`

### 桌面讲解的隐私边界

- **Key 从哪来**：IDE 设置（IndexedDB）。浏览器还可以读 `.env.local`；桌面版**不读环境变量**，只用设置里那一项。
- **Key 去哪**：随这一次 `ide_explain` IPC 进 Rust，放进 `Authorization` 头。不写磁盘、不写日志、不进 `content/`。
- **连谁**：只 POST 用户填的 `baseUrl`（空则默认 `https://api.openai.com/v1`）的 `/chat/completions`。没有账号系统、没有插件市场、没有遥测。
- **prompt 谁组**：TypeScript `src/lib/ide/explain.ts` 是唯一来源（和浏览器同一份 mock / system prompt）。Rust 是哑管道，不改写问题、不扫工程。
- **失败**：超时、连不上、401/404/429 都是中文短句；旧安装包没有这条命令时提示更新，而不是把 IPC 内部异常甩到面板上。

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
- **IDE 讲解（读码）**：打包版走 Rust `ide_explain`，不再依赖 Next `/api/ide/explain`。没配 Key 时是本地示例；配了 Key 就直连用户填的端点。浏览器 `npm run dev` 仍走原来的 Route Handler，两条通路共用 `explain.ts` 的 prompt / mock。
- 图片预览走 base64 `data:` URL，极大附件会偏慢。
- **自动更新**：Windows 已接 Tauri updater（设置 → 检查更新）。私钥不进仓库。详见 [STATUS-updater.md](./STATUS-updater.md)。安装包仍无 Authenticode，Windows 会提示未知发布者（与 updater 的 minisign 是两件事）。
- 依赖 Rust 工具链和 WebView2 运行时，不是「双击即用」的单文件分发。
- macOS / Linux 未验证；本仓库只在 Windows 上跑过。
- **Android debug APK**：见 [STATUS-android.md](./STATUS-android.md)。桌面包不含 APK；Android 包不含 NSIS/MSI。`.kotlin` 会话/日志已 ignore，不要提交。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 窗口白屏，dev 日志里 Next 端口是 3001 | 3000 被别的 Next 占了。`tauri:dev` 的守卫现在会直接报错；按提示结束占用进程 |
| 首页文档数不对 | 确认 `library_content_root` 返回哪个目录；打包版本读 app_data，不是仓库 `content/` |
| `tauri build` 卡在 WiX，报 `LGHT0311 ... code page '1252'` | MSI 的 en-US 代码页装不下「琅嬛」。已在 `bundle.windows.wix.language` 设为 `zh-CN`；改产品名时别再退回默认语言 |
| 只想看 UI，不想等 Rust 编译 | `npm run desktop:ui` 后直接用浏览器开 `out/index.html`（无 Tauri IPC，库是空的） |
