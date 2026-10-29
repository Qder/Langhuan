# Tauri 2 桌面壳（MVP）

## 状态

- **开发**：`npm run tauri:dev` 启动 Next（`beforeDevCommand`）并打开 WebView → `http://localhost:3000`。
- **库读写**：桌面侧经 Rust `invoke` 读写磁盘 `content/`（与 `contentFs.ts` 同布局）；浏览器仍走 Next `/api/library/*`。
- **content 根目录**
  - 开发：优先仓库 `content/`（相对 `src-tauri/../content`），可用环境变量 `LANGHUAN_CONTENT` 覆盖。
  - 生产安装包：`{app_data_dir}/琅嬛/content`（若不存在仓库 content）。
- **生产构建**：`tauri build` 可编译 Rust；前端暂用 `src-tauri/ui-dist` 占位页。完整安装包需后续静态导出或 sidecar Next（App Router + API 暂不能纯 export）。

## Windows 准备

1. 安装 [Rust](https://rustup.rs/)（stable）
2. 安装 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 通常已有）
3. Node 20+，在仓库根：`npm install`
4. `npm run tauri:dev`

安装包产物（本机 `tauri:build` 后）：`src-tauri/target/release/bundle/`（NSIS / MSI 等）。

## 命令一览（Rust）

`library_scan` · `library_put_doc` · `library_put_asset` · `library_delete_path` · `library_read_file` · `library_trash_*` · `library_mkdir` · `library_bulk` · `library_content_root`

## 已知限制

- `tauri:build` 安装包内 UI 仍是占位页；请用 `tauri:dev` 做功能验收。
- 大图预览走 base64 `data:` URL，极大附件可能偏慢。
- 未接系统托盘 / 自动更新。
